import { StateStore } from "../src/storage.js";
if(process.send&&process.argv[2]) {
 const store=new StateStore(process.argv[2],{batchMs:0,beforeCommit:({revision})=>{if(process.argv[3]==="during"&&revision===10)process.kill(process.pid,"SIGKILL");}});
 await store.load();
 for(let counter=1;counter<=1000;counter++){
  await store.save({counter,chain:Array.from({length:counter},(_,height)=>({height}))});
  process.send({acknowledged:counter});
 }
 process.disconnect();
}
