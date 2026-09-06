import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname,extname,join,normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KorekChain } from "./blockchain.js";
import { NETWORK } from "./config.js";
import { cryptoProvider,wormholeAddressFromInnerHash } from "./crypto.js";
import { P2PNetwork } from "./p2p.js";
import { CHAIN_NAME,MINER_PROTOCOL,NODE_PROTOCOL,NODE_VERSION } from "./protocol.js";
import { StateStore } from "./storage.js";

const arg=name=>{const prefix=`--${name}=`;const inline=process.argv.find(value=>value.startsWith(prefix));if(inline)return inline.slice(prefix.length);const at=process.argv.indexOf(`--${name}`);return at>=0?process.argv[at+1]:undefined};
const args=name=>{const values=[];for(let index=0;index<process.argv.length;index++){const value=process.argv[index],prefix=`--${name}=`;if(value.startsWith(prefix))values.push(value.slice(prefix.length));else if(value===`--${name}`&&process.argv[index+1])values.push(process.argv[++index])}return values};
if(process.argv.includes("--version")){console.log(`korek-node ${NODE_VERSION} · ${CHAIN_NAME} · ${MINER_PROTOCOL} · ${NODE_PROTOCOL}`);process.exit(0)}
if(process.argv.includes("--help")){console.log(`KOREK node ${NODE_VERSION}\n\n--name NAME\n--validator\n--miner-listen-port PORT\n--chain planck\n--node-key-file FILE\n--p2p-port PORT\n--p2p-advertise URL\n--peer URL (repeatable)\n--rewards-inner-hash HASH\n--max-blocks-per-request NUMBER\n--sync full\n--data-dir DIRECTORY\n--mine\n`);process.exit(0)}

const chainName=arg("chain")||CHAIN_NAME;if(chainName!==CHAIN_NAME)throw new Error(`Unsupported chain '${chainName}'. Use --chain planck.`);
const nodeName=arg("name")||process.env.KOREK_NODE_NAME||"korek-planck-node",validator=process.argv.includes("--validator"),syncMode=arg("sync")||"full",maxBlocks=Math.max(1,Math.min(256,Number(arg("max-blocks-per-request")||64))),minerPort=Number(arg("miner-listen-port")||process.env.KOREK_MINER_PORT||9833),nodeKeyFile=arg("node-key-file");
const peerSeeds=[...args("peer"),...(process.env.KOREK_PEERS||"").split(",")].filter(Boolean),p2pRequested=Boolean(nodeKeyFile&&(arg("p2p-port")||process.env.KOREK_P2P_PORT||peerSeeds.length)),p2pPort=p2pRequested?Number(arg("p2p-port")||process.env.KOREK_P2P_PORT||9333):null,p2pAdvertise=arg("p2p-advertise")||process.env.KOREK_P2P_ADVERTISE;
const miningEnabled=process.argv.includes("--mine")||process.env.KOREK_MINE==="1",rewardsInnerHash=arg("rewards-inner-hash")||process.env.KOREK_REWARDS_INNER_HASH;
let rewardsAddress=null,nodeKey=null,mining=false;if(rewardsInnerHash)rewardsAddress=wormholeAddressFromInnerHash(rewardsInnerHash);if(miningEnabled&&!rewardsAddress)throw new Error("Built-in mining requires --rewards-inner-hash <64 hex characters>");
if(nodeKeyFile){nodeKey=JSON.parse(await readFile(nodeKeyFile,"utf8"));if(nodeKey.format!=="korek-node-key"||nodeKey.version!==1||!nodeKey.peerId||!nodeKey.publicKey||!nodeKey.privateKey)throw new Error("Unsupported or damaged node key file")}
const sourceRoot=fileURLToPath(new URL("../public/",import.meta.url)),binaryRoot=join(dirname(process.execPath),"public"),root=process.versions.bun&&existsSync(binaryRoot)?binaryRoot:sourceRoot;
const dataDirectory=arg("data-dir")||process.env.KOREK_DATA_DIR||join(process.cwd(),".korek",chainName),stateStore=new StateStore(dataDirectory),savedState=await stateStore.load();
let chain=savedState?KorekChain.fromSnapshot(savedState):new KorekChain();const jobs=new Map();
const sync={mode:syncMode,state:"Idle",peers:0,note:p2pRequested?"Signed Planck peer synchronization enabled":"P2P disabled; pass --node-key-file and --p2p-port"};
const json=(res,status,value,cors=false)=>{res.writeHead(status,{"content-type":"application/json",...(cors?{"access-control-allow-origin":"*"}:{})});res.end(JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item))};
const body=async req=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks)||"{}")};
let p2p=null;
const updateSync=()=>{if(!p2p)return;const status=p2p.networkStatus();sync.state=status.state;sync.peers=status.connectedPeers;sync.note=status.lastError||"Signed Planck peer synchronization enabled"};
const nodeStatus=()=>({...chain.status(),version:NODE_VERSION,chain:chainName,name:nodeName,validator,nodeIdentity:nodeKey?.peerId||null,dataDirectory,persistent:true,minerProtocol:MINER_PROTOCOL,minerListenPort:minerPort,maxBlocksPerRequest:maxBlocks,sync,p2p:p2p?.networkStatus()||{enabled:false},mining:{enabled:miningEnabled,rewardsAddress}});
const rewardAddress=input=>input.rewardsInnerHash?wormholeAddressFromInnerHash(input.rewardsInnerHash):input.address;
const mineInput=input=>{const miner=rewardAddress(input),queued=[...jobs.values()].find(job=>job.status==="queued");if(queued){queued.status="verified-prototype";queued.miner=miner;queued.completedAt=Date.now()}return chain.mine(miner,queued?{type:"ai-job",jobId:queued.id,score:1}:{type:"security-pow",score:0})};
const mineAndSave=async input=>{const block=mineInput(input);await stateStore.save(chain.snapshot());return block};

if(p2pRequested){p2p=new P2PNetwork({identity:nodeKey,name:nodeName,port:p2pPort,advertiseUrl:p2pAdvertise,seeds:peerSeeds,maxPeers:64,getChain:()=>chain,onSnapshot:async(snapshot,peer)=>{const candidate=KorekChain.fromSnapshot(snapshot);if(candidate.chain.length<=chain.chain.length)return;chain=candidate;await stateStore.save(chain.snapshot());console.log(`Synced to block #${chain.chain.length-1} from ${peer.peerId.slice(0,12)} at ${peer.url}`)}});await p2p.start();updateSync();setInterval(updateSync,500).unref()}

const apiServer=createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);
 if(req.method==="GET"&&url.pathname==="/api/status")return json(res,200,nodeStatus(),true);
 if(req.method==="GET"&&url.pathname==="/api/peers")return json(res,200,p2p?.publicPeers()||[],true);
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
 if(req.method!=="GET")return json(res,404,{error:"Not found"},true);const relative=url.pathname==="/"?"index.html":url.pathname.replace(/^\//,""),file=normalize(join(root,relative));if(!file.startsWith(root))return json(res,403,{error:"Forbidden"},true);let contents;try{contents=await readFile(file)}catch(error){if(error.code==="ENOENT")return json(res,404,{error:"File not found"},true);throw error}const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".ico":"image/x-icon"};res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream"});res.end(contents)
 }catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message},true)}});
const minerServer=createServer(async(req,res)=>{try{if(req.headers["x-korek-miner-protocol"]!==MINER_PROTOCOL)return json(res,426,{error:`Miner protocol mismatch; node requires ${MINER_PROTOCOL}`});const url=new URL(req.url,`http://${req.headers.host}`);if(req.method==="GET"&&url.pathname==="/status")return json(res,200,nodeStatus());if(req.method==="POST"&&url.pathname==="/mine"){updateSync();if(sync.state!=="Idle")return json(res,409,{error:`Node is ${sync.state}; mining paused`});return json(res,201,await mineAndSave(await body(req)))}return json(res,404,{error:"Not found"})}catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message})}});
apiServer.on("error",error=>{console.error(`API server error: ${error.message}`);process.exitCode=1});minerServer.on("error",error=>{console.error(`Miner server error: ${error.message}`);process.exitCode=1});
apiServer.listen(NETWORK.apiPort,()=>{console.log(`KOREK node ${NODE_VERSION} '${nodeName}'`);console.log(`Chain: ${chainName} · API/explorer: http://localhost:${NETWORK.apiPort}`);console.log(`Storage: ${dataDirectory} · restored height ${chain.chain.length-1}`);console.log(`Sync: ${sync.state} · peers: ${sync.peers} (${sync.note})`);if(nodeKey)console.log(`Node identity: ${nodeKey.peerId}`);if(p2p)console.log(`P2P ${NODE_PROTOCOL} listening on http://localhost:${p2pPort}`);if(rewardsAddress)console.log(`Configured rewards: ${rewardsAddress}`)});
minerServer.listen(minerPort,()=>console.log(`Miner protocol ${MINER_PROTOCOL} listening on http://localhost:${minerPort}`));
if(miningEnabled)setInterval(async()=>{if(mining)return;updateSync();if(p2p&&peerSeeds.length&&sync.state!=="Idle")return;mining=true;try{const block=await mineAndSave({rewardsInnerHash});console.log(`Mined block #${block.height} · ${block.reward} atomic KRK · ${block.hash}`)}catch(error){console.error(`Mining error: ${error.message}`)}finally{mining=false}},NETWORK.rewardBlockTimeMs);
