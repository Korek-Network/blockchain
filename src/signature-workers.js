import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

const workerUrl=new URL("./signature-worker.js",import.meta.url);
const runWorker=items=>new Promise((resolve,reject)=>{const worker=new Worker(workerUrl,{workerData:items});worker.once("message",resolve);worker.once("error",reject);worker.once("exit",code=>{if(code!==0)reject(new Error(`Signature worker exited with code ${code}`))})});

export async function verifySignaturesParallel(items,{workers=Math.min(availableParallelism(),8)}={}){
 if(!Array.isArray(items)||items.length===0)return[];
 const count=Math.max(1,Math.min(workers,items.length)),chunks=Array.from({length:count},()=>[]);
 items.forEach((item,index)=>chunks[index%count].push({index,...item}));
 const results=(await Promise.all(chunks.map(runWorker))).flat().sort((a,b)=>a.index-b.index);
 return results.map(item=>item.valid);
}
