import { createHash } from "node:crypto";
import { mkdir,readFile,rename,writeFile } from "node:fs/promises";
import { join,resolve } from "node:path";

const checksum=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class StateStore{
 constructor(directory){this.directory=resolve(directory);this.file=join(this.directory,"chain-state.json");this.queue=Promise.resolve()}
 async load(){try{const envelope=JSON.parse(await readFile(this.file,"utf8"));if(envelope.format!=="korek-chain-state"||envelope.version!==1||checksum(envelope.state)!==envelope.checksum)throw new Error("Chain state checksum verification failed");return envelope.state}catch(error){if(error.code==="ENOENT")return null;throw error}}
 save(state){this.queue=this.queue.then(async()=>{await mkdir(this.directory,{recursive:true});const envelope={format:"korek-chain-state",version:1,savedAt:Date.now(),state,checksum:checksum(state)},temporary=`${this.file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(envelope),{mode:0o600});await rename(temporary,this.file)});return this.queue}
}
