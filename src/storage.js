import { DatabaseSync } from "node:sqlite";
import { createHash,randomUUID } from "node:crypto";
import { mkdir,access,readFile,open,rename,copyFile,chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname,join,resolve } from "node:path";
import { LegacyStateReader } from "./legacy-storage.js";

const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone=value=>JSON.parse(JSON.stringify(value));
const representation=state=>{
 if(Array.isArray(state?.chain)){const {chain,...fields}=state;return {kind:"ledger",payload:JSON.stringify(fields),blocks:chain.map(JSON.stringify)};}
 return {kind:"bundle",payload:JSON.stringify(state),blocks:[]};
};
const decode=row=>row.kind==="ledger"?{...JSON.parse(row.payload),chain:row.blocks.map(JSON.parse)}:JSON.parse(row.payload);

// SQLite owns locking and rollback recovery. No custom journal append/truncation
// code runs here. A stale second writer fails its revision comparison.
export class StateStore {
 constructor(directory,{batchMs=5,maxQueued=1024,beforeCommit=null}={}) {
  if(!Number.isInteger(batchMs)||batchMs<0||batchMs>100||!Number.isInteger(maxQueued)||maxQueued<1)throw new Error("Invalid storage options");
  this.directory=resolve(directory);this.file=join(this.directory,"chain-state.json");this.database=join(this.directory,"chain.sqlite");
  this.batchMs=batchMs;this.maxQueued=maxQueued;this.beforeCommit=beforeCommit;this.pending=[];
  this.state=null;this.revision=0;this.blockRows=[];this.loaded=false;this.error=null;this.db=null;this.fenced=false;
  this.stats={saves:0,commits:0,rowsWritten:0};
 }
 status(){return {mode:"sqlite-extra-v3",healthy:!this.error,error:this.error?.message||null,batchMs:this.batchMs,queued:this.pending.length,...this.stats};}
 assertWritable(){if(this.error)throw new Error("Storage is stopped after an error: "+this.error.message);if(this.closed)throw new Error("Storage is closed");if(this.pending.length>=this.maxQueued)throw new Error("Storage queue is full");}
 async load(){
  if(this.loaded)return clone(this.state);
  let exists=true;try{await access(this.database);}catch(error){if(error.code!=="ENOENT")throw error;exists=false;}
  if(exists){
   const db=new DatabaseSync(this.database,{readOnly:true});
   try{
    db.exec("PRAGMA busy_timeout=100; BEGIN");
    if(db.prepare("PRAGMA quick_check").get().quick_check!=="ok")throw new Error("SQLite integrity check failed");
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='state'").get()){
     const row=db.prepare("SELECT * FROM state WHERE id=1").get();
     if(row){
      const blocks=db.prepare("SELECT height,json FROM blocks ORDER BY height").all();
      if(blocks.some((item,index)=>item.height!==index))throw new Error("SQLite block sequence mismatch");
      row.blocks=blocks.map(item=>item.json);
      if(hash({kind:row.kind,payload:row.payload,blocks:row.blocks})!==row.digest)throw new Error("SQLite state checksum mismatch");
      this.state=decode(row);this.revision=row.revision;this.blockRows=row.blocks;this.loaded=true;
     }
    }
    db.exec("COMMIT");
   }finally{db.close();}
  }
  if(!this.loaded){this.state=await new LegacyStateReader(this.directory).load();this.blockRows=[];this.loaded=true;}
  return clone(this.state);
 }
 save(stateOrProvider){
  let value;try{this.assertWritable();value=typeof stateOrProvider==="function"?stateOrProvider:clone(stateOrProvider);}catch(error){return Promise.reject(error);}
  this.stats.saves++;
  const promise=new Promise((resolve,reject)=>this.pending.push({value,resolve,reject}));this.schedule();return promise;
 }
 schedule(){if(this.running||this.timer||!this.pending.length)return;this.timer=setTimeout(()=>{this.timer=null;this.flush();},this.batchMs);}
 async flush(){
  if(this.running)return;this.running=true;const group=this.pending.splice(0);
  try{await this.commit(group.at(-1).value);for(const item of group)item.resolve();}
  catch(error){this.error=error;for(const item of [...group,...this.pending.splice(0)])item.reject(error);}
  finally{this.running=false;this.schedule();}
 }
 async syncDirectory(path=this.directory){const file=await open(path,"r");try{await file.sync();}finally{await file.close();}}
 async initialize(){
  if(this.db)return;
  const first=await mkdir(this.directory,{recursive:true,mode:0o700});
  if(first){const stop=dirname(resolve(first));for(let path=this.directory;;path=dirname(path)){await this.syncDirectory(path);if(path===stop)break;}}
  const created=await open(this.database,"a",0o600);await created.close();await chmod(this.database,0o600);
  const db=new DatabaseSync(this.database);
  try{
   db.exec("PRAGMA busy_timeout=100; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF;");
   if(db.prepare("PRAGMA synchronous").get().synchronous!==3)throw new Error("SQLite EXTRA synchronization unavailable");
   db.exec("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blocks(height INTEGER PRIMARY KEY,json TEXT NOT NULL);");
   await this.syncDirectory();this.db=db;
  }catch(error){db.close();throw error;}
 }
 async fenceLegacyReaders(){
  try{const legacy=JSON.parse(await readFile(this.file,"utf8"));
   if([1,2].includes(legacy.version)){
    try{await copyFile(this.file,this.file+".pre-sqlite",constants.COPYFILE_EXCL);}catch(error){if(error.code!=="EEXIST")throw error;}
    const backup=await open(this.file+".pre-sqlite","r");try{await backup.sync();}finally{await backup.close();}
   }
  }catch(error){if(error.code!=="ENOENT")throw error;}
  const temporary=this.file+"."+randomUUID()+".tmp",file=await open(temporary,"wx",0o600);
  try{await file.writeFile(JSON.stringify({format:"korek-chain-state",version:3,database:"chain.sqlite"}));await file.sync();}finally{await file.close();}
  await rename(temporary,this.file);await this.syncDirectory();this.fenced=true;
 }
 async commit(value){
  if(!this.loaded)await this.load();await this.initialize();
  const next=representation(typeof value==="function"?value():value),digest=hash(next),db=this.db;
  let rows=0;
  db.exec("BEGIN IMMEDIATE");
  try{
   const revision=db.prepare("SELECT revision FROM state WHERE id=1").get()?.revision||0;
   if(revision!==this.revision)throw new Error("Stale storage writer; reload before writing");
   let common=0;while(common<next.blocks.length&&common<this.blockRows.length&&next.blocks[common]===this.blockRows[common])common++;
   db.prepare("DELETE FROM blocks WHERE height>=?").run(common);
   const insert=db.prepare("INSERT INTO blocks(height,json) VALUES(?,?)");
   for(let i=common;i<next.blocks.length;i++){insert.run(i,next.blocks[i]);rows++;}
   db.prepare("INSERT INTO state(id,revision,kind,payload,digest) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,payload=excluded.payload,digest=excluded.digest").run(revision+1,next.kind,next.payload,digest);
   if(this.beforeCommit)this.beforeCommit({database:db,revision:revision+1}); // Synchronous fault-injection seam.
   db.exec("COMMIT");
   this.revision=revision+1;this.blockRows=next.blocks;this.state=decode(next);
  }catch(error){try{db.exec("ROLLBACK");}catch{}throw error;}
  if(!this.fenced)await this.fenceLegacyReaders();
  this.stats.commits++;this.stats.rowsWritten+=rows+1;
 }
 close(){if(this.running||this.pending.length)throw new Error("Wait for pending saves before closing");this.db?.close();this.db=null;this.closed=true;}
}
