import { verify } from "node:crypto";
import { parentPort,workerData } from "node:worker_threads";

const results=workerData.map(item=>{try{return{index:item.index,valid:verify(null,Buffer.from(item.message),item.publicKey,Buffer.from(item.signature,"base64"))}}catch{return{index:item.index,valid:false}}});
parentPort.postMessage(results);
