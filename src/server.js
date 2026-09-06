import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname,join,normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KorekChain } from "./blockchain.js";
import { NETWORK } from "./config.js";
import { cryptoProvider,wormholeAddressFromInnerHash } from "./crypto.js";

const chain=new KorekChain(),root=fileURLToPath(new URL("../public/",import.meta.url)),jobs=new Map();
const arg=(name)=>{const prefix=`--${name}=`;const inline=process.argv.find(x=>x.startsWith(prefix));if(inline)return inline.slice(prefix.length);const at=process.argv.indexOf(`--${name}`);return at>=0?process.argv[at+1]:undefined};
const miningEnabled=process.argv.includes("--mine")||process.env.KOREK_MINE==="1";
const rewardsInnerHash=arg("rewards-inner-hash")||process.env.KOREK_REWARDS_INNER_HASH;
let rewardsAddress=null,mining=false;
if(miningEnabled){if(!rewardsInnerHash)throw new Error("Mining requires --rewards-inner-hash <64 hex characters>");rewardsAddress=wormholeAddressFromInnerHash(rewardsInnerHash)}
const json=(res,status,value)=>{res.writeHead(status,{"content-type":"application/json","access-control-allow-origin":"*"});res.end(JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item))};
const body=async(req)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks)||"{}")};
const rewardAddress=(input)=>input.rewardsInnerHash?wormholeAddressFromInnerHash(input.rewardsInnerHash):input.address;

const server=createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);
 if(req.method==="GET"&&url.pathname==="/api/status")return json(res,200,{...chain.status(),planck:true,mining:{enabled:miningEnabled,rewardsAddress}});
 if(req.method==="GET"&&url.pathname==="/api/blocks")return json(res,200,chain.chain.slice(-50).reverse());
 if(req.method==="GET"&&url.pathname==="/api/transactions")return json(res,200,chain.transactions());
 if(req.method==="GET"&&url.pathname.startsWith("/api/transaction/")){const tx=chain.transaction(url.pathname.split("/").at(-1));return tx?json(res,200,tx):json(res,404,{error:"Transaction not found"})}
 if(req.method==="GET"&&url.pathname.startsWith("/api/block/")){const block=chain.block(url.pathname.split("/").at(-1));return block?json(res,200,block):json(res,404,{error:"Block not found"})}
 if(req.method==="GET"&&url.pathname.startsWith("/api/balance/")){const address=url.pathname.split("/").at(-1);return json(res,200,{address,balance:chain.balance(address)})}
 if(req.method==="POST"&&url.pathname==="/api/wallet"){const wallet=cryptoProvider.createWallet();res.setHeader("cache-control","no-store");return json(res,201,wallet)}
 if(req.method==="POST"&&url.pathname==="/api/transactions"){const tx=chain.addTransaction(await body(req));chain.sealPending();return json(res,201,chain.transaction(tx.id))}
 if(req.method==="POST"&&url.pathname==="/api/faucet"){const input=await body(req);return json(res,201,chain.claimFaucet(input.address))}
 if(req.method==="POST"&&url.pathname==="/api/jobs"){const job={id:crypto.randomUUID(),status:"queued",createdAt:Date.now(),...(await body(req))};jobs.set(job.id,job);return json(res,201,job)}
 if(req.method==="GET"&&url.pathname==="/api/jobs")return json(res,200,[...jobs.values()]);
 if(req.method==="POST"&&url.pathname==="/api/mine"){const input=await body(req),miner=rewardAddress(input),queued=[...jobs.values()].find(j=>j.status==="queued");if(queued){queued.status="verified-prototype";queued.miner=miner;queued.completedAt=Date.now()}return json(res,201,chain.mine(miner,queued?{type:"ai-job",jobId:queued.id,score:1}:{type:"security-pow",score:0}))}
 if(req.method!=="GET")return json(res,404,{error:"Not found"});const relative=url.pathname==="/"?"index.html":url.pathname.replace(/^\//,"");const file=normalize(join(root,relative));if(!file.startsWith(root))return json(res,403,{error:"Forbidden"});let contents;try{contents=await readFile(file)}catch(error){if(error.code==="ENOENT")return json(res,404,{error:"File not found"});throw error}const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".ico":"image/x-icon"};res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream"});res.end(contents);
 }catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message})}});

server.listen(NETWORK.apiPort,()=>{console.log(`KOREK Planck testnet running at http://localhost:${NETWORK.apiPort}`);if(miningEnabled){console.log(`Mining rewards: ${rewardsAddress}`);console.log(`Target interval: ${NETWORK.rewardBlockTimeMs} ms`);setInterval(()=>{if(mining)return;mining=true;try{const block=chain.mine(rewardsAddress,{type:"planck-security-pow",score:0});console.log(`Mined block #${block.height} · ${block.reward} atomic KRK · ${block.hash}`)}catch(error){console.error(`Mining error: ${error.message}`)}finally{mining=false}},NETWORK.rewardBlockTimeMs)}});
