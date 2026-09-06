import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname,extname,join,normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KorekChain } from "./blockchain.js";
import { NETWORK } from "./config.js";
import { cryptoProvider,wormholeAddressFromInnerHash } from "./crypto.js";
import { CHAIN_NAME,MINER_PROTOCOL,NODE_VERSION } from "./protocol.js";
import { StateStore } from "./storage.js";

const arg=(name)=>{const prefix=`--${name}=`;const inline=process.argv.find(x=>x.startsWith(prefix));if(inline)return inline.slice(prefix.length);const at=process.argv.indexOf(`--${name}`);return at>=0?process.argv[at+1]:undefined};
if(process.argv.includes("--version")){console.log(`korek-node ${NODE_VERSION} · ${CHAIN_NAME} · ${MINER_PROTOCOL}`);process.exit(0)}
if(process.argv.includes("--help")){console.log(`KOREK node ${NODE_VERSION}\n\n--name NAME\n--validator\n--miner-listen-port PORT\n--chain planck\n--node-key-file FILE\n--rewards-inner-hash HASH\n--max-blocks-per-request NUMBER\n--sync full\n--data-dir DIRECTORY\n--mine (built-in test miner)\n`);process.exit(0)}

const chainName=arg("chain")||CHAIN_NAME;if(chainName!==CHAIN_NAME)throw new Error(`Unsupported chain '${chainName}'. Use --chain planck.`);
const nodeName=arg("name")||process.env.KOREK_NODE_NAME||"korek-planck-node",validator=process.argv.includes("--validator"),syncMode=arg("sync")||"full",maxBlocks=Math.max(1,Math.min(256,Number(arg("max-blocks-per-request")||64))),minerPort=Number(arg("miner-listen-port")||process.env.KOREK_MINER_PORT||9833),nodeKeyFile=arg("node-key-file");
const miningEnabled=process.argv.includes("--mine")||process.env.KOREK_MINE==="1",rewardsInnerHash=arg("rewards-inner-hash")||process.env.KOREK_REWARDS_INNER_HASH;
let rewardsAddress=null,nodeIdentity=null,mining=false;if(rewardsInnerHash)rewardsAddress=wormholeAddressFromInnerHash(rewardsInnerHash);if(miningEnabled&&!rewardsAddress)throw new Error("Built-in mining requires --rewards-inner-hash <64 hex characters>");
if(nodeKeyFile){const key=JSON.parse(await readFile(nodeKeyFile,"utf8"));if(key.format!=="korek-node-key"||key.version!==1||!key.peerId||!key.privateKey)throw new Error("Unsupported or damaged node key file");nodeIdentity=key.peerId}
const sourceRoot=fileURLToPath(new URL("../public/",import.meta.url)),binaryRoot=join(dirname(process.execPath),"public"),root=process.versions.bun&&existsSync(binaryRoot)?binaryRoot:sourceRoot;
const dataDirectory=arg("data-dir")||process.env.KOREK_DATA_DIR||join(process.cwd(),".korek",chainName),stateStore=new StateStore(dataDirectory),savedState=await stateStore.load();
let chain=savedState?KorekChain.fromSnapshot(savedState):new KorekChain();const jobs=new Map(),sync={mode:syncMode,state:"Idle",peers:0,note:"Standalone prototype: P2P chain synchronization is not implemented"};
const json=(res,status,value,cors=false)=>{res.writeHead(status,{"content-type":"application/json",...(cors?{"access-control-allow-origin":"*"}:{})});res.end(JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item))};
const body=async(req)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks)||"{}")};
const nodeStatus=()=>({...chain.status(),version:NODE_VERSION,chain:chainName,name:nodeName,validator,nodeIdentity,dataDirectory,persistent:true,minerProtocol:MINER_PROTOCOL,minerListenPort:minerPort,maxBlocksPerRequest:maxBlocks,sync,mining:{enabled:miningEnabled,rewardsAddress}});
const rewardAddress=input=>input.rewardsInnerHash?wormholeAddressFromInnerHash(input.rewardsInnerHash):input.address;
const mineInput=input=>{const miner=rewardAddress(input),queued=[...jobs.values()].find(j=>j.status==="queued");if(queued){queued.status="verified-prototype";queued.miner=miner;queued.completedAt=Date.now()}return chain.mine(miner,queued?{type:"ai-job",jobId:queued.id,score:1}:{type:"security-pow",score:0})};
const mineAndSave=async input=>{const block=mineInput(input);await stateStore.save(chain.snapshot());return block};

const apiServer=createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);
 if(req.method==="GET"&&url.pathname==="/api/status")return json(res,200,nodeStatus(),true);
 if(req.method==="GET"&&url.pathname==="/api/blocks"){const limit=Math.min(maxBlocks,Number(url.searchParams.get("limit")||50));return json(res,200,chain.chain.slice(-limit).reverse(),true)}
 if(req.method==="GET"&&url.pathname==="/api/transactions")return json(res,200,chain.transactions(),true);
 if(req.method==="GET"&&url.pathname.startsWith("/api/transaction/")){const tx=chain.transaction(url.pathname.split("/").at(-1));return tx?json(res,200,tx,true):json(res,404,{error:"Transaction not found"},true)}
 if(req.method==="GET"&&url.pathname.startsWith("/api/block/")){const block=chain.block(url.pathname.split("/").at(-1));return block?json(res,200,block,true):json(res,404,{error:"Block not found"},true)}
 if(req.method==="GET"&&url.pathname.startsWith("/api/balance/")){const address=url.pathname.split("/").at(-1);return json(res,200,{address,balance:chain.balance(address)},true)}
 if(req.method==="POST"&&url.pathname==="/api/wallet"){const wallet=cryptoProvider.createWallet();res.setHeader("cache-control","no-store");return json(res,201,wallet,true)}
 if(req.method==="POST"&&url.pathname==="/api/transactions"){const tx=chain.addTransaction(await body(req));chain.sealPending();await stateStore.save(chain.snapshot());return json(res,201,chain.transaction(tx.id),true)}
 if(req.method==="POST"&&url.pathname==="/api/faucet"){const input=await body(req),claim=chain.claimFaucet(input.address);await stateStore.save(chain.snapshot());return json(res,201,claim,true)}
 if(req.method==="POST"&&url.pathname==="/api/jobs"){const job={id:crypto.randomUUID(),status:"queued",createdAt:Date.now(),...(await body(req))};jobs.set(job.id,job);return json(res,201,job,true)}
 if(req.method==="GET"&&url.pathname==="/api/jobs")return json(res,200,[...jobs.values()],true);
 if(req.method==="POST"&&url.pathname==="/api/mine")return json(res,201,await mineAndSave(await body(req)),true);
 if(req.method!=="GET")return json(res,404,{error:"Not found"},true);const relative=url.pathname==="/"?"index.html":url.pathname.replace(/^\//,"");const file=normalize(join(root,relative));if(!file.startsWith(root))return json(res,403,{error:"Forbidden"},true);let contents;try{contents=await readFile(file)}catch(error){if(error.code==="ENOENT")return json(res,404,{error:"File not found"},true);throw error}const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".ico":"image/x-icon"};res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream"});res.end(contents);
 }catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message},true)}});

const minerServer=createServer(async(req,res)=>{try{if(req.headers["x-korek-miner-protocol"]!==MINER_PROTOCOL)return json(res,426,{error:`Miner protocol mismatch; node requires ${MINER_PROTOCOL}`});const url=new URL(req.url,`http://${req.headers.host}`);if(req.method==="GET"&&url.pathname==="/status")return json(res,200,nodeStatus());if(req.method==="POST"&&url.pathname==="/mine"){if(sync.state!=="Idle")return json(res,409,{error:`Node is ${sync.state}; mining paused`});return json(res,201,await mineAndSave(await body(req)))}return json(res,404,{error:"Not found"})}catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message})}});

apiServer.on("error",error=>{console.error(`API server error: ${error.message}`);process.exitCode=1});minerServer.on("error",error=>{console.error(`Miner server error: ${error.message}`);process.exitCode=1});
apiServer.listen(NETWORK.apiPort,()=>{console.log(`KOREK node ${NODE_VERSION} '${nodeName}'`);console.log(`Chain: ${chainName} · API/explorer: http://localhost:${NETWORK.apiPort}`);console.log(`Storage: ${dataDirectory} · restored height ${chain.chain.length-1}`);console.log(`Sync: ${sync.state} · peers: ${sync.peers} (${sync.note})`);if(nodeIdentity)console.log(`Node identity: ${nodeIdentity}`);if(rewardsAddress)console.log(`Configured rewards: ${rewardsAddress}`)});
minerServer.listen(minerPort,()=>console.log(`Miner protocol ${MINER_PROTOCOL} listening on http://localhost:${minerPort}`));
if(miningEnabled)setInterval(async()=>{if(mining)return;mining=true;try{const block=await mineAndSave({rewardsInnerHash});console.log(`Mined block #${block.height} · ${block.reward} atomic KRK · ${block.hash}`)}catch(error){console.error(`Mining error: ${error.message}`)}finally{mining=false}},NETWORK.rewardBlockTimeMs);
