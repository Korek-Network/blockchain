import { cpus,platform,release } from "node:os";
import { performance } from "node:perf_hooks";
import { KorekChain,hashBlock } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";

const count=(name,fallback,max)=>Math.max(1,Math.min(max,Number(process.env[name]||fallback)));
const transactionCount=count("KOREK_BENCH_TX",500,5_000),hashCount=count("KOREK_BENCH_HASHES",20_000,1_000_000),round=value=>Math.round(value*100)/100;
const chain=new KorekChain(),sender=cryptoProvider.createWallet(),recipient=cryptoProvider.createWallet(),now=Date.now(),amount="1",gasPrice="1",gasLimit="21000";
chain.claimFaucet(sender.address,BigInt(transactionCount)*(BigInt(amount)+21_000n),now);

let started=performance.now();
for(let index=0;index<transactionCount;index++){
 const timestamp=now+index,message=`${sender.address}|${recipient.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}`;
 chain.addTransaction({version:2,from:sender.address,to:recipient.address,amount,timestamp,gasPrice,gasLimit,publicKey:sender.publicKey,signature:cryptoProvider.sign(message,sender.privateKey)},now);
}
const admissionMs=performance.now()-started;
chain.sealPending(now+transactionCount);
const snapshot=chain.snapshot(),snapshotBytes=Buffer.byteLength(JSON.stringify(snapshot));
started=performance.now();KorekChain.fromSnapshot(snapshot);const restoreMs=performance.now()-started;
const tip=chain.chain.at(-1);started=performance.now();for(let index=0;index<hashCount;index++)hashBlock({...tip,nonce:index});const hashingMs=performance.now()-started;
const result={benchmark:"korek-planck-v1",timestamp:new Date().toISOString(),runtime:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model||"unknown",logicalThreads:cpus().length},workload:{transactions:transactionCount,blockHashes:hashCount,snapshotBytes},results:{transactionAdmissionMs:round(admissionMs),transactionsPerSecond:round(transactionCount/(admissionMs/1000)),snapshotValidationMs:round(restoreMs),snapshotValidationMBps:round(snapshotBytes/1_048_576/(restoreMs/1000)),blockHashingMs:round(hashingMs),blockHashesPerSecond:round(hashCount/(hashingMs/1000))}};
console.log(JSON.stringify(result,null,2));
