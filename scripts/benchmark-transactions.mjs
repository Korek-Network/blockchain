import { performance } from "node:perf_hooks";
import { KorekChain,transactionMessage } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { NETWORK } from "../src/config.js";

const count=Math.max(1,Math.min(10_000,Number(process.argv[2]||1_000))),chain=new KorekChain(),recipient=cryptoProvider.createWallet(),now=Date.now(),wallets=Array.from({length:count},()=>cryptoProvider.createWallet());
const transactions=wallets.map(wallet=>{chain.claimFaucet(wallet.address,1_000_000n,now);const input={version:4,networkId:NETWORK.networkId,from:wallet.address,to:recipient.address,amount:"1",nonce:0,timestamp:now,expiresAt:now+60_000,gasPrice:"1",gasLimit:"21000",addressScheme:"transparent-v1",publicKey:wallet.publicKey};return{...input,signature:cryptoProvider.sign(transactionMessage(input),wallet.privateKey)}});
const started=performance.now();await chain.addTransactionBatchParallel(transactions,now);const admitted=performance.now(),block=chain.sealPending(now+1),sealed=performance.now(),admissionSeconds=(admitted-started)/1_000,totalSeconds=(sealed-started)/1_000;
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch},transactions:count,workers:"up to 8",admissionMs:Number((admitted-started).toFixed(2)),admissionTps:Number((count/admissionSeconds).toFixed(2)),sealMs:Number((sealed-admitted).toFixed(2)),endToEndTps:Number((count/totalSeconds).toFixed(2)),blockBytes:Buffer.byteLength(JSON.stringify(block)),warning:"Local prototype benchmark; not decentralized network TPS."},null,2));
