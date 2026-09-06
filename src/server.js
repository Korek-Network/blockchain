import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname,extname,join,normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KorekChain } from "./blockchain.js";
import { NETWORK } from "./config.js";
import { cryptoProvider,wormholeAddressFromInnerHash } from "./crypto.js";
import { MinerAuthVerifier } from "./miner-auth.js";
import { createTemplate,verifySubmission,verifyWorkRequest } from "./mining-protocol.js";
import { P2PNetwork } from "./p2p.js";
import { CHAIN_NAME,MINER_PROTOCOL,NODE_PROTOCOL,NODE_VERSION } from "./protocol.js";
import { StateStore } from "./storage.js";

const arg=name=>{const prefix=`--${name}=`;const inline=process.argv.find(value=>value.startsWith(prefix));if(inline)return inline.slice(prefix.length);const at=process.argv.indexOf(`--${name}`);return at>=0?process.argv[at+1]:undefined};
const args=name=>{const values=[];for(let index=0;index<process.argv.length;index++){const value=process.argv[index],prefix=`--${name}=`;if(value.startsWith(prefix))values.push(value.slice(prefix.length));else if(value===`--${name}`&&process.argv[index+1])values.push(process.argv[++index])}return values};
if(process.argv.includes("--version")){console.log(`korek-node ${NODE_VERSION} · ${CHAIN_NAME} · ${MINER_PROTOCOL} · ${NODE_PROTOCOL}`);process.exit(0)}
if(process.argv.includes("--help")){console.log(`KOREK node ${NODE_VERSION}\n\n--name NAME\n--validator\n--api-host HOST\n--miner-host HOST\n--miner-listen-port PORT\n--miner-auth-token TOKEN\n--miner-tls-cert FILE\n--miner-tls-key FILE\n--chain planck\n--node-key-file FILE\n--p2p-port PORT\n--p2p-advertise URL\n--peer URL (repeatable)\n--rewards-inner-hash HASH\n--max-blocks-per-request NUMBER\n--sync full\n--data-dir DIRECTORY\n--mine\n`);process.exit(0)}

const apiHost=arg("api-host")||process.env.KOREK_API_HOST||"127.0.0.1";
const chainName=arg("chain")||CHAIN_NAME;if(chainName!==CHAIN_NAME)throw new Error(`Unsupported chain '${chainName}'. Use --chain planck.`);
const nodeName=arg("name")||process.env.KOREK_NODE_NAME||"korek-planck-node",validator=process.argv.includes("--validator"),syncMode=arg("sync")||"full",maxBlocks=Math.max(1,Math.min(256,Number(arg("max-blocks-per-request")||64))),minerPort=Number(arg("miner-listen-port")||process.env.KOREK_MINER_PORT||9833),nodeKeyFile=arg("node-key-file");
const minerHost=arg("miner-host")||process.env.KOREK_MINER_HOST||"127.0.0.1",minerAuthToken=arg("miner-auth-token")||process.env.KOREK_MINER_AUTH_TOKEN,minerTlsCert=arg("miner-tls-cert")||process.env.KOREK_MINER_TLS_CERT,minerTlsKey=arg("miner-tls-key")||process.env.KOREK_MINER_TLS_KEY,minerTls=Boolean(minerTlsCert&&minerTlsKey),loopbackMiner=["127.0.0.1","::1","localhost"].includes(minerHost);
if(Boolean(minerTlsCert)!==Boolean(minerTlsKey))throw new Error("Both --miner-tls-cert and --miner-tls-key are required");
if(!loopbackMiner&&(!minerTls||!minerAuthToken))throw new Error("A non-loopback miner endpoint requires TLS and --miner-auth-token");
const minerVerifier=minerAuthToken?new MinerAuthVerifier(minerAuthToken):null,minerTlsOptions=minerTls?{cert:await readFile(minerTlsCert),key:await readFile(minerTlsKey)}:null;
const peerSeeds=[...args("peer"),...(process.env.KOREK_PEERS||"").split(",")].filter(Boolean),p2pRequested=Boolean(nodeKeyFile&&(arg("p2p-port")||process.env.KOREK_P2P_PORT||peerSeeds.length)),p2pPort=p2pRequested?Number(arg("p2p-port")||process.env.KOREK_P2P_PORT||9333):null,p2pAdvertise=arg("p2p-advertise")||process.env.KOREK_P2P_ADVERTISE;
const miningEnabled=process.argv.includes("--mine")||process.env.KOREK_MINE==="1",rewardsInnerHash=arg("rewards-inner-hash")||process.env.KOREK_REWARDS_INNER_HASH;
let rewardsAddress=null,nodeKey=null,mining=false;if(rewardsInnerHash)rewardsAddress=wormholeAddressFromInnerHash(rewardsInnerHash);if(miningEnabled&&!rewardsAddress)throw new Error("Built-in mining requires --rewards-inner-hash <64 hex characters>");
if(nodeKeyFile){nodeKey=JSON.parse(await readFile(nodeKeyFile,"utf8"));if(nodeKey.format!=="korek-node-key"||nodeKey.version!==1||!nodeKey.peerId||!nodeKey.publicKey||!nodeKey.privateKey)throw new Error("Unsupported or damaged node key file")}
const sourceRoot=fileURLToPath(new URL("../public/",import.meta.url)),binaryRoot=join(dirname(process.execPath),"public"),root=process.versions.bun&&existsSync(binaryRoot)?binaryRoot:sourceRoot;
const dataDirectory=arg("data-dir")||process.env.KOREK_DATA_DIR||join(process.cwd(),".korek",chainName),stateStore=new StateStore(dataDirectory),savedState=await stateStore.load();
let chain=savedState?KorekChain.fromSnapshot(savedState):new KorekChain();const jobs=new Map(),workTemplates=new Map(),usedTemplates=new Map(),requestNonces=new Map(),workRate=new Map(),workStats={templatesIssued:0,accepted:0,rejected:0,duplicates:0,stale:0};
const sync={mode:syncMode,state:"Idle",peers:0,note:p2pRequested?"Signed Planck peer synchronization enabled":"P2P disabled; pass --node-key-file and --p2p-port"};
const json=(res,status,value,cors=false)=>{res.writeHead(status,{"content-type":"application/json",...(cors?{"access-control-allow-origin":"*"}:{})});res.end(JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item))};
const rawBody=async(req,maxBytes=64*1024)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error("Request body is too large");chunks.push(chunk)}return Buffer.concat(chunks).toString("utf8")};
const body=async req=>JSON.parse((await rawBody(req))||"{}");
let p2p=null;
const updateSync=()=>{if(!p2p)return;const status=p2p.networkStatus();sync.state=status.state;sync.peers=status.connectedPeers;sync.note=status.lastError||"Signed Planck peer synchronization enabled"};
const nodeStatus=()=>({...chain.status(),version:NODE_VERSION,chain:chainName,name:nodeName,validator,nodeIdentity:nodeKey?.peerId||null,dataDirectory,persistent:true,minerProtocol:MINER_PROTOCOL,minerListenPort:minerPort,minerTransport:{host:minerHost,tls:minerTls,authenticated:Boolean(minerVerifier)},maxBlocksPerRequest:maxBlocks,sync,p2p:p2p?.networkStatus()||{enabled:false},mining:{enabled:true,mode:"wallet-signed-client-pow",activeTemplates:workTemplates.size,...workStats,rewardsAddress:null}});
const rewardAddress=input=>input.rewardsInnerHash?wormholeAddressFromInnerHash(input.rewardsInnerHash):input.address;
const mineInput=input=>{const miner=rewardAddress(input),queued=[...jobs.values()].find(job=>job.status==="queued");if(queued){queued.status="verified-prototype";queued.miner=miner;queued.completedAt=Date.now()}return chain.mine(miner,queued?{type:"ai-job",jobId:queued.id,score:1}:{type:"security-pow",score:0})};
const mineAndSave=async input=>{const block=mineInput(input);await stateStore.save(chain.snapshot());return block};
const cleanupWork=(now=Date.now())=>{for(const[id,item]of workTemplates)if(item.expiresAt<now)workTemplates.delete(id);for(const[id,expires]of usedTemplates)if(expires<now)usedTemplates.delete(id);for(const[id,expires]of requestNonces)if(expires<now)requestNonces.delete(id);for(const[id,seen]of workRate)if(now-seen>60_000)workRate.delete(id)};
const issueWork=async input=>{const now=Date.now();cleanupWork(now);if(workTemplates.size>=10_000)throw new Error("Mining work queue is full");verifyWorkRequest(input,now);const replayKey=`${input.address}:${input.requestNonce}`;if(requestNonces.has(replayKey))throw new Error("Mining work request replayed");requestNonces.set(replayKey,now+60_000);const previous=workRate.get(input.address)||0;if(now-previous<250)throw new Error("Mining work requests are rate limited");workRate.set(input.address,now);if(chain.pending.length){chain.sealPending(now);await stateStore.save(chain.snapshot())}const template=createTemplate({...chain.miningTemplateData(input.address,now),publicKey:input.publicKey});workTemplates.set(template.templateId,template);workStats.templatesIssued++;return template};
const submitWork=async input=>{const now=Date.now();cleanupWork(now);try{if(usedTemplates.has(input.templateId)){workStats.duplicates++;throw new Error("Duplicate work submission")}const template=workTemplates.get(input.templateId);if(!template)throw new Error("Unknown or expired work template");verifySubmission(input,template,now);if(template.height!==chain.chain.length||template.previousHash!==chain.chain.at(-1).hash){workTemplates.delete(input.templateId);workStats.stale++;throw new Error("Stale work template")}const block=chain.acceptClientProof(template,input);usedTemplates.set(input.templateId,now+60_000);for(const[id,item]of workTemplates)if(item.height<=block.height)workTemplates.delete(id);await stateStore.save(chain.snapshot());workStats.accepted++;return{accepted:true,block,balance:chain.balance(block.miner)}}catch(error){workStats.rejected++;throw error}};

if(p2pRequested){p2p=new P2PNetwork({identity:nodeKey,name:nodeName,port:p2pPort,advertiseUrl:p2pAdvertise,seeds:peerSeeds,maxPeers:64,getChain:()=>chain,onSnapshot:async(snapshot,peer)=>{const candidate=KorekChain.fromSnapshot(snapshot);if(candidate.chain.length<=chain.chain.length)return;chain=candidate;await stateStore.save(chain.snapshot());console.log(`Synced to block #${chain.chain.length-1} from ${peer.peerId.slice(0,12)} at ${peer.url}`)}});await p2p.start();updateSync();setInterval(updateSync,500).unref()}

const apiServer=createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);
 if(req.method==="GET"&&url.pathname==="/api/status")return json(res,200,nodeStatus(),true);
 if(req.method==="GET"&&url.pathname==="/api/peers")return json(res,200,p2p?.publicPeers()||[],true);
 if(req.method==="GET"&&url.pathname==="/api/blocks"){const limit=Math.max(1,Math.min(500,Number(url.searchParams.get("limit")||50)));return json(res,200,chain.chain.slice(-limit).reverse(),true)}
 if(req.method==="GET"&&url.pathname==="/api/transactions"){const limit=Math.max(1,Math.min(500,Number(url.searchParams.get("limit")||100)));return json(res,200,chain.transactions().slice(0,limit),true)}
 if(req.method==="GET"&&url.pathname.startsWith("/api/transaction/")){const tx=chain.transaction(url.pathname.split("/").at(-1));return tx?json(res,200,tx,true):json(res,404,{error:"Transaction not found"},true)}
 if(req.method==="GET"&&url.pathname.startsWith("/api/block/")){const block=chain.block(url.pathname.split("/").at(-1));return block?json(res,200,block,true):json(res,404,{error:"Block not found"},true)}
 if(req.method==="GET"&&url.pathname.startsWith("/api/balance/")){const address=url.pathname.split("/").at(-1);return json(res,200,{address,balance:chain.balance(address)},true)}
 if(req.method==="GET"&&url.pathname==="/miner/v3/status")return json(res,200,nodeStatus(),true);
 if(req.method==="POST"&&url.pathname==="/miner/v3/work")return json(res,201,await issueWork(await body(req)),true);
 if(req.method==="POST"&&url.pathname==="/miner/v3/submit")return json(res,201,await submitWork(await body(req)),true);
 if(req.method==="POST"&&url.pathname==="/api/wallet"){const wallet=cryptoProvider.createWallet();res.setHeader("cache-control","no-store");return json(res,201,wallet,true)}
 if(req.method==="POST"&&url.pathname==="/api/transactions"){const tx=chain.addTransaction(await body(req));chain.sealPending();await stateStore.save(chain.snapshot());return json(res,201,chain.transaction(tx.id),true)}
 if(req.method==="POST"&&url.pathname==="/api/faucet"){const input=await body(req),claim=chain.claimFaucet(input.address);await stateStore.save(chain.snapshot());return json(res,201,claim,true)}
 if(req.method==="POST"&&url.pathname==="/api/jobs"){const job={id:crypto.randomUUID(),status:"queued",createdAt:Date.now(),...(await body(req))};jobs.set(job.id,job);return json(res,201,job,true)}
 if(req.method==="GET"&&url.pathname==="/api/jobs")return json(res,200,[...jobs.values()],true);
 if(req.method==="POST"&&url.pathname==="/api/mine")return json(res,410,{error:"Legacy server-side mining is disabled; use korek-planck-miner/3"},true);
 if(req.method!=="GET")return json(res,404,{error:"Not found"},true);const relative=url.pathname==="/"?"index.html":url.pathname.replace(/^\//,""),file=normalize(join(root,relative));if(!file.startsWith(root))return json(res,403,{error:"Forbidden"},true);let contents;try{contents=await readFile(file)}catch(error){if(error.code==="ENOENT")return json(res,404,{error:"File not found"},true);throw error}const types={".html":"text/html",".css":"text/css",".js":"text/javascript",".ico":"image/x-icon"};res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream"});res.end(contents)
 }catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message},true)}});
const minerHandler=async(req,res)=>{try{if(req.headers["x-korek-miner-protocol"]!==MINER_PROTOCOL)return json(res,426,{error:`Miner protocol mismatch; node requires ${MINER_PROTOCOL}`});const url=new URL(req.url,`${minerTls?"https":"http"}://${req.headers.host}`),raw=req.method==="POST"?await rawBody(req):"";if(minerVerifier)try{minerVerifier.verify(req.headers,{method:req.method,path:url.pathname,body:raw})}catch(error){return json(res,401,{error:error.message})}if(req.method==="GET"&&url.pathname==="/status")return json(res,200,nodeStatus());if(req.method==="POST"&&url.pathname==="/work")return json(res,201,await issueWork(JSON.parse(raw||"{}")));if(req.method==="POST"&&url.pathname==="/submit")return json(res,201,await submitWork(JSON.parse(raw||"{}")));return json(res,404,{error:"Not found"})}catch(error){if(res.headersSent)return res.end();json(res,400,{error:error.message})}};
const minerServer=minerTls?createHttpsServer(minerTlsOptions,minerHandler):createServer(minerHandler);
apiServer.on("error",error=>{console.error(`API server error: ${error.message}`);process.exitCode=1});minerServer.on("error",error=>{console.error(`Miner server error: ${error.message}`);process.exitCode=1});
apiServer.listen(NETWORK.apiPort,apiHost,()=>{console.log(`KOREK node ${NODE_VERSION} '${nodeName}'`);console.log(`Chain: ${chainName} · API/explorer: http://${apiHost}:${NETWORK.apiPort}`);console.log(`Storage: ${dataDirectory} · restored height ${chain.chain.length-1}`);console.log(`Sync: ${sync.state} · peers: ${sync.peers} (${sync.note})`);if(nodeKey)console.log(`Node identity: ${nodeKey.peerId}`);if(p2p)console.log(`P2P ${NODE_PROTOCOL} listening on http://localhost:${p2pPort}`);if(rewardsAddress)console.log(`Configured rewards: ${rewardsAddress}`)});
minerServer.listen(minerPort,minerHost,()=>console.log(`Miner protocol ${MINER_PROTOCOL} listening on ${minerTls?"https":"http"}://${minerHost}:${minerPort} · auth ${minerVerifier?"required":"loopback only"}`));
if(miningEnabled)console.warn("Built-in server-side mining is disabled in protocol v3. Run KOREK Miner so proof of work is performed by client hardware.");
