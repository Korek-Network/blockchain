import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { StateStore } from "../src/storage.js";

const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshot=n=>({version:1,chain:Array.from({length:n},(_,height)=>({height,data:"x".repeat(64)})),balances:[["test",String(n)]]});
async function setup(t,options={}){const directory=await fs.mkdtemp(join(tmpdir(),"korek-sqlite-test-"));const store=new StateStore(directory,{batchMs:0,...options});t.after(()=>{store.close();return fs.rm(directory,{recursive:true,force:true});});return store;}
async function restored(store){return new StateStore(store.directory).load();}

test("legacy state imports exactly and old readers are fenced before acknowledgment",async t=>{
 const store=await setup(t),state=snapshot(1),raw=JSON.stringify({format:"korek-chain-state",version:1,state,checksum:digest(state)});
 await fs.writeFile(store.file,raw);assert.deepEqual(await store.load(),state);await store.save(snapshot(2));
 assert.equal(JSON.parse(await fs.readFile(store.file)).version,3);assert.equal(await fs.readFile(store.file+".pre-sqlite","utf8"),raw);
 assert.deepEqual(await restored(store),snapshot(2));
});
test("queued values freeze and provider groups capture a complete final state",async t=>{
 const store=await setup(t,{batchMs:10}),state=snapshot(1),p=store.save(state);state.balances[0][1]="bad";await p;
 assert.deepEqual(await restored(store),snapshot(1));let current;const waiting=[];
 for(let i=2;i<=20;i++){current=snapshot(i);waiting.push(store.save(()=>current));}
 await Promise.all(waiting);assert.equal(store.status().commits,2);assert.deepEqual(await restored(store),snapshot(20));
});
test("extensions update only new block rows; forks and bundles restore exactly",async t=>{
 const store=await setup(t);await store.save(snapshot(10));const previous=store.status().rowsWritten;
 await store.save(snapshot(11));assert.equal(store.status().rowsWritten-previous,2);
 const fork=snapshot(3);fork.chain[1].data="fork";await store.save(fork);assert.deepEqual(await restored(store),fork);
 const bundle={bundleVersion:2,chain:fork,compute:{jobs:["a"]}};await store.save(bundle);assert.deepEqual(await restored(store),bundle);
});
test("failed transaction rolls back all partial rows and rejects acknowledgments",async t=>{
 const store=await setup(t);await store.save(snapshot(2));store.beforeCommit=()=>{throw new Error("injected transaction failure");};
 await assert.rejects(store.save(snapshot(4)),/injected/);assert.deepEqual(await restored(store),snapshot(2));
 assert.equal(store.status().healthy,false);await assert.rejects(store.save(snapshot(5)),/Storage is stopped/);
});
test("a stale second writer cannot overwrite a committed state",async t=>{
 const store=await setup(t),second=new StateStore(store.directory,{batchMs:0});t.after(()=>second.close());
 await store.load();await second.load();await store.save(snapshot(1));
 await assert.rejects(second.save(snapshot(2)),/Stale storage writer/);assert.deepEqual(await restored(store),snapshot(1));
});
test("SQLite checksum detects externally changed state",async t=>{
 const store=await setup(t);await store.save(snapshot(2));const db=new DatabaseSync(store.database);
 db.exec("UPDATE state SET payload='{}'");db.close();await assert.rejects(restored(store),/checksum/);
});
test("malformed SQLite files fail closed instead of loading an old snapshot",async t=>{
 const store=await setup(t);await fs.writeFile(store.database,"not a SQLite database");await assert.rejects(store.load());
});
test("queue is bounded and resumes after successful commit",async t=>{
 const store=await setup(t,{batchMs:10,maxQueued:2}),a=store.save(snapshot(1)),b=store.save(snapshot(2));
 await assert.rejects(store.save(snapshot(3)),/queue is full/);await Promise.all([a,b]);await store.save(snapshot(4));
 assert.deepEqual(await restored(store),snapshot(4));
});
test("legacy journal import is read-only and preserves verified records",async t=>{
 const store=await setup(t),payload={version:1,sequence:1,previous:"0".repeat(64),update:{kind:"replace",state:snapshot(1)}};
 const path=join(store.directory,"chain-journal.jsonl"),raw=JSON.stringify({...payload,checksum:digest(payload)})+"\n";
 await fs.writeFile(path,raw);assert.deepEqual(await store.load(),snapshot(1));await store.save(snapshot(2));
 assert.equal(await fs.readFile(path,"utf8"),raw);assert.deepEqual(await restored(store),snapshot(2));
});
test("a legacy sequence gap refuses migration without inventing missing state",async t=>{
 const store=await setup(t),payload={version:1,sequence:3,previous:"0".repeat(64),update:{kind:"replace",state:snapshot(3)}};
 await fs.writeFile(join(store.directory,"chain-journal.jsonl"),JSON.stringify({...payload,checksum:digest(payload)})+"\n");
 await assert.rejects(store.save(snapshot(4)),/extend checkpoint/);await assert.rejects(fs.access(store.database));
});
test("SQLite uses rollback journaling with EXTRA synchronization",async t=>{
 const store=await setup(t);await store.save(snapshot(1));assert.equal(store.db.prepare("PRAGMA synchronous").get().synchronous,3);
 assert.equal(store.db.prepare("PRAGMA journal_mode").get().journal_mode,"delete");
 assert.equal((await fs.stat(store.database)).mode&0o777,0o600);
});
for(const phase of ["during","after"])test("SIGKILL "+phase+" transaction preserves every acknowledged state",async t=>{
 const store=await setup(t),child=fork(new URL("../scripts/storage-writer-fixture.mjs",import.meta.url),[store.directory,phase],{execArgv:[],stdio:["ignore","ignore","pipe","ipc"]});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");});
 let acknowledged=0,logs="";child.stderr.on("data",data=>{logs+=data;});const exited=once(child,"exit");
 child.on("message",message=>{acknowledged=Math.max(acknowledged,message.acknowledged);if(phase==="after"&&acknowledged>=10)child.kill("SIGKILL");});
 const [,signal]=await exited;assert.equal(signal,"SIGKILL",logs);assert.ok(acknowledged>=9);
 const state=await restored(store);assert.ok(state.counter>=acknowledged);assert.equal(state.chain.length,state.counter);
 if(phase==="during")assert.equal(state.counter,9);
});
