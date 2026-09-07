// Storage-only comparison; no network or chain-capacity claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir,mkdtemp,readFile,writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join,dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../../src/storage.js";
import { KorekChain } from "../../src/blockchain.js";
import { wallet,transfer } from "./metrics.mjs";

if(process.argv.length!==2)throw new Error("No external directory or endpoint arguments supported");
const root=dirname(fileURLToPath(import.meta.url)),repository=join(root,"../.."),base="3a639e72a53490e3b296e78b55f0a915b200ac5a";
const legacy=execFileSync("git",["show",`${base}:src/storage.js`],{cwd:repository,encoding:"utf8"});
const {StateStore:LegacyStore}=await import("data:text/javascript;base64,"+Buffer.from(legacy).toString("base64"));
const hash=data=>createHash("sha256").update(data).digest("hex");
await mkdir(join(root,".runs"),{recursive:true});const directory=await mkdtemp(join(root,".runs","storage-"));
const sender=wallet(),recipient=wallet(),chain=new KorekChain(),snapshots=[],count=512;
chain.claimFaucet(sender.address);const now=Date.now();
for(let i=0;i<count;i++){
 const input=transfer(sender,recipient.address,now+i);
 chain.addTransaction(input.tx,now+i);chain.sealPending(now+i);
 const snapshot=chain.snapshot();snapshots.push({...snapshot,chain:[...snapshot.chain],pending:[...snapshot.pending]});
}
const rows=[];
for(const burst of [1,16])for(const name of ["legacy","sqlite"]){
 const Store=name==="legacy"?LegacyStore:StateStore,store=new Store(join(directory,`${name}-${burst}`));
 await store.load();const started=performance.now(),acknowledgments=[];
 for(let from=0;from<count;from+=burst){const promises=[];
  for(let i=from;i<Math.min(count,from+burst);i++){
   const sent=performance.now();promises.push(store.save(snapshots[i]).then(()=>acknowledgments.push(performance.now()-sent)));
  }await Promise.all(promises);
 }
 const elapsedMs=performance.now()-started,restored=await new Store(store.directory).load();
 assert.deepEqual(restored,snapshots.at(-1));KorekChain.fromSnapshot(restored);
 const sorted=[...acknowledgments].sort((a,b)=>a-b),status=name==="sqlite"?store.status():null;
 const legacyBytes=name==="legacy"?snapshots.reduce((sum,state)=>sum+Buffer.byteLength(JSON.stringify({format:"korek-chain-state",version:1,savedAt:Date.now(),state,checksum:hash(JSON.stringify(state))})),0):null;
 rows.push({name,burst,saves:count,elapsedMs,saveAcknowledgmentsPerSecond:count/(elapsedMs/1000),
  ackP95Ms:sorted[Math.ceil(sorted.length*.95)-1],bytesWritten:status?.bytesWritten??legacyBytes,
  rowsWritten:status?.rowsWritten??null,commits:status?.commits??count,fsync:name==="sqlite",restoredExactly:true,acknowledgmentMs:acknowledgments});
}
const report={version:"korek-storage-comparison/1",runAt:new Date().toISOString(),runtime:{node:process.version,cpu:cpus()[0]?.model,logicalCpus:cpus().length},
 sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim(),legacyCommit:base,
 sourceSha256:{legacy:hash(legacy),storage:hash(await readFile(join(repository,"src/storage.js"))),driver:hash(await readFile(fileURLToPath(import.meta.url)))},
 scope:"512 prebuilt signed-transfer snapshots; serial and burst-16 calls; whole history still scanned; legacy has no fsync; one run per condition; not TPS, saturation, network or power-loss evidence",rows};
const output=join(directory,"storage-comparison.json");await writeFile(output,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({output,rows:rows.map(({acknowledgmentMs,...row})=>row)},null,2));
