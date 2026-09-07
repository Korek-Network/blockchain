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
export class LegacyStateReader {
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

}
