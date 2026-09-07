import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { StateStore } from "../src/storage.js";

const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function setup(t,options={}){const directory=await fs.mkdtemp(join(tmpdir(),"korek-storage-test-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return new StateStore(directory,{batchMs:0,...options});}
const snapshot=n=>({version:1,chain:Array.from({length:n},(_,height)=>({height,data:"x".repeat(64)})),balances:[["test",String(n)]]});

test("legacy checksum snapshots load and migrate without rewriting original blocks",async t=>{
 const store=await setup(t,{checkpointEvery:2}),state=snapshot(1);
 await fs.writeFile(store.file,JSON.stringify({format:"korek-chain-state",version:1,state,checksum:digest(state)}));
 assert.deepEqual(await store.load(),state);await store.save(snapshot(2));await store.save(snapshot(3));
 assert.equal(JSON.parse(await fs.readFile(store.file)).version,2);
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(3));
});
test("queued value snapshots freeze before caller mutation",async t=>{
 const store=await setup(t,{batchMs:10}),state=snapshot(1),saved=store.save(state);
 state.chain.push({height:1});state.balances[0][1]="corrupt";await saved;
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(1));
});
test("the first journal acknowledgment fences legacy snapshot readers",async t=>{
 const store=await setup(t);await store.save(snapshot(1));
 const checkpoint=JSON.parse(await fs.readFile(store.file,"utf8"));assert.equal(checkpoint.version,2);
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(1));
});
test("provider group commit durably covers all concurrent saves",async t=>{
 const store=await setup(t,{batchMs:10});let state=snapshot(0);const waiting=[];
 for(let i=1;i<=20;i++){state=snapshot(i);waiting.push(store.save(()=>state));}
 await Promise.all(waiting);assert.equal(store.status().commits,1);assert.equal(store.status().saves,20);
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(20));
});
test("append records retain only new blocks and restore exact state",async t=>{
 const store=await setup(t);await store.save(snapshot(10));await store.save(snapshot(11));
 const records=(await fs.readFile(store.journal,"utf8")).trim().split("\n").map(JSON.parse);
 assert.equal(records[1].update.kind,"append");assert.equal(records[1].update.blocks.length,1);
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(11));
});
test("fork replacement, shorter state and arbitrary compute bundles restore exactly",async t=>{
 const store=await setup(t);await store.save(snapshot(3));const fork=snapshot(2);fork.chain[1].data="fork";
 await store.save(fork);assert.deepEqual(await new StateStore(store.directory).load(),fork);
 const bundle={bundleVersion:2,chain:fork,compute:{jobs:["job"]},validators:{locked:"3"}};
 await store.save(bundle);assert.deepEqual(await new StateStore(store.directory).load(),bundle);
});
test("an incomplete final record is ignored and removed before further appends",async t=>{
 const store=await setup(t);await store.save(snapshot(1));await fs.appendFile(store.journal,'{"version":1,"sequence":2');
 const recovered=new StateStore(store.directory,{batchMs:0});assert.deepEqual(await recovered.load(),snapshot(1));
 assert.ok(recovered.status().recoveredPartialBytes>0);await recovered.save(snapshot(2));
 assert.deepEqual(await new StateStore(store.directory).load(),snapshot(2));
});
test("corrupt complete records and broken links fail closed",async t=>{
 const store=await setup(t);await store.save(snapshot(1));await store.save(snapshot(2));
 const raw=await fs.readFile(store.journal,"utf8"),records=raw.trim().split("\n").map(JSON.parse);
 records[1].update.fields.balances[0][1]="999";await fs.writeFile(store.journal,records.map(JSON.stringify).join("\n")+"\n");
 await assert.rejects(new StateStore(store.directory).load(),/checksum/);
 records[1]=JSON.parse(raw.trim().split("\n")[1]);records[1].previous="f".repeat(64);
 const {checksum,...payload}=records[1];records[1].checksum=digest(payload);
 await fs.writeFile(store.journal,records.map(JSON.stringify).join("\n")+"\n");
 await assert.rejects(new StateStore(store.directory).load(),/link mismatch/);
});
test("out-of-band journal truncation stops subsequent acknowledgments",async t=>{
 const store=await setup(t);await store.save(snapshot(1));await store.save(snapshot(2));
 const first=(await fs.readFile(store.journal,"utf8")).split("\n")[0];await fs.writeFile(store.journal,first+"\n");
 await assert.rejects(store.save(snapshot(3)),/changed outside this writer/);assert.equal(store.status().healthy,false);
});
test("checkpoint recovery tolerates old journal left before rotation",async t=>{
 const store=await setup(t,{checkpointEvery:2});await store.save(snapshot(1));
 const originalCheckpoint=store.checkpoint.bind(store);let oldJournal;
 store.checkpoint=async()=>{oldJournal=await fs.readFile(store.journal);await originalCheckpoint();};
 await store.save(snapshot(2));await fs.writeFile(store.journal,oldJournal);
 const recovered=new StateStore(store.directory,{batchMs:0});assert.deepEqual(await recovered.load(),snapshot(2));
 await recovered.save(snapshot(3));assert.deepEqual(await new StateStore(store.directory).load(),snapshot(3));
});
test("acknowledgment waits for journal fsync and an fsync failure stops later writes",async t=>{
 const store=await setup(t);await store.load();const events=[];
 store.io={...fs,open:async(path,...args)=>{
   const handle=await fs.open(path,...args);
   return new Proxy(handle,{get(target,key){if(key==="sync")return async()=>{events.push(path===store.journal?"journal-sync":"directory-sync");if(path===store.journal)throw new Error("injected disk sync failure");};const value=target[key];return typeof value==="function"?value.bind(target):value;}});
 }};
 let acknowledged=false;await assert.rejects(store.save(snapshot(1)).then(()=>{acknowledged=true;}),/disk sync failure/);
 assert.equal(acknowledged,false);assert.ok(events.includes("journal-sync"));assert.equal(store.status().healthy,false);
 await assert.rejects(store.save(snapshot(2)),/Storage is stopped/);
});
test("directory sync occurs after journal sync and before acknowledgment",async t=>{
 const store=await setup(t),events=[];
 store.io={...fs,open:async(path,...args)=>{const handle=await fs.open(path,...args);return new Proxy(handle,{get(target,key){
   if(key==="sync")return async()=>{await target.sync();events.push(path===store.journal?"journal":"directory");};
   const value=target[key];return typeof value==="function"?value.bind(target):value;}});}};
 await store.save(snapshot(1));events.push("ack");
 assert.ok(events.indexOf("journal")<events.lastIndexOf("directory"));assert.equal(events.at(-1),"ack");
});
test("bounded queue rejects overload and resumes after the group completes",async t=>{
 const store=await setup(t,{batchMs:10,maxQueued:2}),a=store.save(snapshot(1)),b=store.save(snapshot(2));
 await assert.rejects(store.save(snapshot(3)),/queue is full/);await Promise.all([a,b]);
 await store.save(snapshot(4));assert.deepEqual(await new StateStore(store.directory).load(),snapshot(4));
});

test("SIGKILL recovery retains every acknowledgment reported by the writer",async t=>{
 const store=await setup(t),child=fork(new URL("../scripts/storage-writer-fixture.mjs",import.meta.url),[store.directory],{execArgv:[],stdio:["ignore","ignore","pipe","ipc"]});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");});
 let acknowledged=0,logs="";child.stderr.on("data",data=>{logs+=data;});
 const exited=once(child,"exit");
 child.on("message",message=>{acknowledged=Math.max(acknowledged,message.acknowledged);if(acknowledged>=10)child.kill("SIGKILL");});
 const [code,signal]=await exited;assert.equal(signal,"SIGKILL",logs);assert.ok(acknowledged>=10);
 const recovered=await new StateStore(store.directory).load();assert.ok(recovered.counter>=acknowledged);
 assert.equal(recovered.chain.length,recovered.counter);
});
