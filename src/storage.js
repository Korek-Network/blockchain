import { createHash,randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { dirname,join,resolve } from "node:path";

const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy=value=>JSON.parse(JSON.stringify(value));
const zero="0".repeat(64);
function updateFor(previous,next) {
 // Bundles replace; plain snapshots append blocks and retain all other fields.
 if(previous&&Array.isArray(previous.chain)&&Array.isArray(next.chain)&&next.chain.length>=previous.chain.length&&
   previous.chain.every((block,index)=>JSON.stringify(block)===JSON.stringify(next.chain[index]))) {
   const {chain,...fields}=next;
   return {kind:"append",from:previous.chain.length,blocks:chain.slice(previous.chain.length),fields};
 }
 return {kind:"replace",state:next};
}
function applyUpdate(previous,update) {
 if(update?.kind==="replace")return update.state;
 if(update?.kind!=="append"||!Array.isArray(previous?.chain)||update.from!==previous.chain.length||
   !Array.isArray(update.blocks)||!update.fields||Object.hasOwn(update.fields,"chain"))throw new Error("Invalid journal append");
 return {...update.fields,chain:[...previous.chain,...update.blocks]};
}

// One writer per directory. Acknowledgments follow journal and directory fsync.
// Checksums detect accidental damage, not hostile edits by a disk attacker.
export class StateStore {
 constructor(directory,{batchMs=5,checkpointEvery=128,maxQueued=1024,io=filesystem}={}) {
  if(!Number.isInteger(batchMs)||batchMs<0||batchMs>100||!Number.isInteger(checkpointEvery)||checkpointEvery<1||
    !Number.isInteger(maxQueued)||maxQueued<1)throw new Error("Invalid storage options");
  this.directory=resolve(directory);this.file=join(this.directory,"chain-state.json");
  this.journal=join(this.directory,"chain-journal.jsonl");this.io=io;
  this.batchMs=batchMs;this.checkpointEvery=checkpointEvery;this.maxQueued=maxQueued;
  this.pending=[];this.state=null;this.sequence=0;this.head=zero;this.loaded=false;this.error=null;
  this.stats={saves:0,commits:0,checkpoints:0,bytesWritten:0,recoveredPartialBytes:0};
 }
 status(){return {mode:"journal-fsync-v2",healthy:!this.error,error:this.error?.message||null,
   batchMs:this.batchMs,queued:this.pending.length,...this.stats};}
 assertWritable(){if(this.pending.length>=this.maxQueued)throw new Error("Storage queue is full");if(this.error)throw new Error("Storage is stopped after an error; restart after repair: "+this.error.message);}
 async load() {
  if(this.loaded)return this.state===null?null:copy(this.state);
  try {
   const envelope=JSON.parse(await this.io.readFile(this.file,"utf8"));
   if(envelope.format!=="korek-chain-state"||![1,2].includes(envelope.version))throw new Error("Unsupported state file");
   const expected=envelope.version===1?digest(envelope.state):digest({state:envelope.state,journal:envelope.journal});
   if(expected!==envelope.checksum)throw new Error("Chain state checksum verification failed");
   this.state=envelope.state;
   this.checkpointV2=envelope.version===2;
   if(envelope.version===2){if(!Number.isSafeInteger(envelope.journal?.sequence)||envelope.journal.sequence<0||
     !/^[0-9a-f]{64}$/.test(envelope.journal.head))throw new Error("Invalid checkpoint cursor");
     this.sequence=envelope.journal.sequence;this.head=envelope.journal.head;}
  }catch(error){if(error.code!=="ENOENT")throw error;}
  let raw;
  try{raw=await this.io.readFile(this.journal);}catch(error){if(error.code!=="ENOENT")throw error;raw=Buffer.alloc(0);}
  const completeBytes=raw.lastIndexOf(10)+1,checkpointSequence=this.sequence;
  this.stats.recoveredPartialBytes=raw.length-completeBytes;this.validJournalBytes=completeBytes;
  this.expectedJournalBytes=completeBytes;
  let previousRecord=null;
  for(const line of raw.subarray(0,completeBytes).toString("utf8").split("\n").filter(Boolean)) {
   const record=JSON.parse(line),{checksum,...payload}=record;
   if(record.version!==1||!Number.isSafeInteger(record.sequence)||record.sequence<1||checksum!==digest(payload)||
      !/^[0-9a-f]{64}$/.test(record.previous))throw new Error("Journal checksum or format verification failed");
   if(previousRecord&&(record.sequence!==previousRecord.sequence+1||record.previous!==previousRecord.checksum))
     throw new Error("Journal sequence or link mismatch");
   previousRecord=record;
   if(record.sequence<=checkpointSequence){if(record.sequence===checkpointSequence&&checksum!==this.head)
     throw new Error("Journal does not match checkpoint");continue;}
   if(record.sequence!==this.sequence+1||record.previous!==this.head)throw new Error("Journal does not extend checkpoint");
   this.state=applyUpdate(this.state,record.update);this.sequence=record.sequence;this.head=checksum;
  }
  this.loaded=true;return this.state===null?null:copy(this.state);
 }
 save(stateOrProvider) {
  try{this.assertWritable();if(this.pending.length>=this.maxQueued)throw new Error("Storage queue is full");}
  catch(error){return Promise.reject(error);}
  // Values freeze now. Providers explicitly select current state at group commit;
  // the server verifies that each acknowledged transaction still exists afterward.
  let value;try{value=typeof stateOrProvider==="function"?stateOrProvider:copy(stateOrProvider);}
  catch(error){return Promise.reject(error);}
  this.stats.saves++;
  const promise=new Promise((resolve,reject)=>this.pending.push({value,resolve,reject}));
  this.schedule();return promise;
 }
 schedule(){if(this.running||this.timer||!this.pending.length)return;
  this.timer=setTimeout(()=>{this.timer=null;this.flush();},this.batchMs);}
 async flush() {
  if(this.running)return;
  this.running=true;const group=this.pending.splice(0);
  try{await this.commit(group.at(-1).value);for(const item of group)item.resolve();}
  catch(error){this.error=error;for(const item of [...group,...this.pending.splice(0)])item.reject(error);}
  finally{this.running=false;this.schedule();}
 }
 async syncDirectory(directory=this.directory){const handle=await this.io.open(directory,"r");try{await handle.sync();}finally{await handle.close();}}
 async prepare() {
  const first=await this.io.mkdir(this.directory,{recursive:true});
  if(first){const stop=dirname(resolve(first));for(let path=this.directory;;path=dirname(path)){await this.syncDirectory(path);if(path===stop)break;}}
  if(this.stats.recoveredPartialBytes){const handle=await this.io.open(this.journal,"r+");
   try{await handle.truncate(this.validJournalBytes);await handle.sync();}finally{await handle.close();}
   this.stats.recoveredPartialBytes=0;}
 }
 async commit(value) {
  if(!this.loaded)await this.load();await this.prepare();
  // Fence old binaries before the first new-format acknowledgment: they must
  // reject version 2 instead of silently loading an obsolete version-1 snapshot.
  if(!this.checkpointV2)await this.checkpoint({rotate:false});
  const snapshot=typeof value==="function"?value():value;
  const payload={version:1,sequence:this.sequence+1,previous:this.head,update:updateFor(this.state,snapshot)};
  // Serialize before I/O can allow mutation of the live chain.
  const record=JSON.parse(JSON.stringify({...payload,checksum:digest(payload)})),bytes=JSON.stringify(record)+"\n";
  const handle=await this.io.open(this.journal,"a",0o600);
  try{
   if((await handle.stat()).size!==this.expectedJournalBytes)throw new Error("Journal changed outside this writer; stop and inspect the data directory");
   await handle.writeFile(bytes);
   const expected=this.expectedJournalBytes+Buffer.byteLength(bytes);
   if((await handle.stat()).size!==expected)throw new Error("Concurrent journal modification detected");
   await handle.sync();this.expectedJournalBytes=expected;
  }finally{await handle.close();}
  await this.syncDirectory();
  this.state=applyUpdate(this.state,record.update);this.sequence=record.sequence;this.head=record.checksum;
  this.stats.commits++;this.stats.bytesWritten+=Buffer.byteLength(bytes);
  if(this.sequence%this.checkpointEvery===0)await this.checkpoint();
 }
 async checkpoint({rotate=true}={}) {
  const journal={sequence:this.sequence,head:this.head},state=this.state;
  const bytes=JSON.stringify({format:"korek-chain-state",version:2,savedAt:Date.now(),state,journal,checksum:digest({state,journal})});
  const temporary=this.file+"."+randomUUID()+".tmp",handle=await this.io.open(temporary,"wx",0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await this.io.rename(temporary,this.file);await this.syncDirectory();
  this.checkpointV2=true;
  // Durable checkpoint first; recovery also accepts the old untrimmed journal.
  if(rotate){const log=await this.io.open(this.journal,"r+");
   try{await log.truncate(0);await log.sync();this.expectedJournalBytes=0;}finally{await log.close();}}
  this.stats.checkpoints++;this.stats.bytesWritten+=Buffer.byteLength(bytes);
 }
}
