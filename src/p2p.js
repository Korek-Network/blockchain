import { createHash,sign,verify } from "node:crypto";
import { createServer } from "node:http";
import { NETWORK } from "./config.js";
import { CHAIN_NAME,NODE_PROTOCOL,NODE_VERSION } from "./protocol.js";
import { KorekChain } from "./blockchain.js";
import { chainSelection } from "./chain-selection.js";

const encode=value=>JSON.stringify(value);
const peerIdFromKey=publicKey=>createHash("sha256").update(publicKey).digest("hex");
const validUrl=value=>{try{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password?url.href.replace(/\/$/,""):null}catch{return null}};
const parseWork=value=>/^\d{1,78}$/.test(String(value??"0"))?BigInt(value??0):0n;
const checkedStatus=payload=>{if(!Number.isSafeInteger(payload.height)||payload.height<0||!/^[0-9a-f]{64}$/.test(payload.tip)||typeof payload.cumulativeWork!=="string"||!/^(0|[1-9][0-9]{0,77})$/.test(payload.cumulativeWork))throw new Error("Malformed peer chain status");return payload};
const reply=(res,status,value)=>{res.writeHead(status,{"content-type":"application/json"});res.end(encode(value))};
const signed=(identity,payload)=>({payload,publicKey:identity.publicKey,signature:sign(null,Buffer.from(encode(payload)),identity.privateKey).toString("base64")});
export function verifyEnvelope(envelope,expected={}){
 if(!envelope?.payload||typeof envelope.publicKey!=="string"||typeof envelope.signature!=="string")throw new Error("Malformed P2P envelope");
 const peerId=peerIdFromKey(envelope.publicKey);if(peerId!==envelope.payload.peerId)throw new Error("P2P peer identity mismatch");
 if(expected.peerId&&peerId!==expected.peerId)throw new Error("P2P responder identity changed");
 if(!verify(null,Buffer.from(encode(envelope.payload)),envelope.publicKey,Buffer.from(envelope.signature,"base64")))throw new Error("Invalid P2P signature");
 if(envelope.payload.protocol!==NODE_PROTOCOL)throw new Error(`P2P protocol mismatch: ${envelope.payload.protocol}`);
 if(envelope.payload.networkId!==NETWORK.networkId||envelope.payload.chain!==CHAIN_NAME)throw new Error("Peer belongs to a different chain");
 return envelope.payload;
}
async function getJson(url,timeoutMs=4_000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{headers:{accept:"application/json"},signal:controller.signal});const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024){controller.abort();throw new Error("Peer response exceeds 16 MiB limit")}chunks.push(chunk)}const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!response.ok)throw new Error(value.error||`Peer returned ${response.status}`);return value}finally{clearTimeout(timer)}}

export class P2PNetwork{
 constructor({identity,name,port,advertiseUrl,seeds=[],maxPeers=64,syncIntervalMs=2_000,syncBatchSize=128,getChain,onSnapshot}){
  if(!identity?.peerId||!identity.publicKey||!identity.privateKey)throw new Error("P2P requires a valid node identity key");
  this.identity=identity;this.name=name;this.port=port;this.advertiseUrl=validUrl(advertiseUrl);this.maxPeers=maxPeers;this.syncIntervalMs=syncIntervalMs;this.syncBatchSize=Math.max(1,Math.min(256,syncBatchSize));this.getChain=getChain;this.onSnapshot=onSnapshot;this.peers=new Map();this.state="Starting";this.lastError=null;this.server=null;this.timer=null;seeds.forEach(url=>this.addPeer(url,"seed"));
 }
 addPeer(value,source="discovered"){const url=validUrl(value);if(!url||url===this.advertiseUrl||this.peers.has(url)||this.peers.size>=this.maxPeers)return false;this.peers.set(url,{url,source,state:"new",peerId:null,name:null,height:null,lastSeen:null,error:null});return true}
 publicPeers(){return[...this.peers.values()].map(({url,source,state,peerId,name,height,lastSeen,error})=>({url,source,state,peerId,name,height,lastSeen,error}))}
 networkStatus(){const connected=[...this.peers.values()].filter(peer=>peer.state==="connected").length;return{enabled:true,protocol:NODE_PROTOCOL,listenPort:this.port,advertiseUrl:this.advertiseUrl,knownPeers:this.peers.size,connectedPeers:connected,state:this.state,lastError:this.lastError}}
 statusPayload(){const chain=this.getChain();return{protocol:NODE_PROTOCOL,networkId:NETWORK.networkId,chain:CHAIN_NAME,version:NODE_VERSION,peerId:this.identity.peerId,name:this.name,height:chain.chain.length-1,tip:chain.chain.at(-1).hash,cumulativeWork:chain.cumulativeWork().toString(),timestamp:Date.now(),peers:[this.advertiseUrl,...this.peers.keys()].filter(Boolean).slice(0,this.maxPeers)}}
 snapshotPayload(){return{...this.statusPayload(),snapshot:this.getChain().snapshot()}}
 blocksPayload(url){const chain=this.getChain(),from=Math.max(1,Number(url.searchParams.get("from")||1)),limit=Math.max(1,Math.min(256,Number(url.searchParams.get("limit")||this.syncBatchSize))),snapshot=chain.snapshot(),blocks=snapshot.chain.slice(from,from+limit),complete=from+blocks.length>=snapshot.chain.length,{chain:ignored,...state}=snapshot;return{...this.statusPayload(),from,blocks,complete,state:complete?state:null}}
 async start(){this.server=createServer((req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);if(req.method==="GET"&&url.pathname==="/p2p/status")return reply(res,200,signed(this.identity,this.statusPayload()));if(req.method==="GET"&&url.pathname==="/p2p/blocks")return reply(res,200,signed(this.identity,this.blocksPayload(url)));if(req.method==="GET"&&url.pathname==="/p2p/snapshot")return reply(res,200,signed(this.identity,this.snapshotPayload()));return reply(res,404,{error:"P2P route not found"})}catch(error){return reply(res,400,{error:error.message})}});await new Promise((resolve,reject)=>{this.server.once("error",reject);this.server.listen(this.port,()=>{this.server.off("error",reject);resolve()})});this.state=this.peers.size?"Connecting":"Idle";this.timer=setInterval(()=>this.syncOnce().catch(error=>{this.lastError=error.message}),this.syncIntervalMs);this.timer.unref();await this.syncOnce();return this.server.address()}
 async stop(){clearInterval(this.timer);if(this.syncInFlight)await this.syncInFlight.catch(()=>{});if(this.server)await new Promise(resolve=>this.server.close(resolve))}
 async inspect(peer){try{const envelope=await getJson(`${peer.url}/p2p/status`),status=checkedStatus(verifyEnvelope(envelope));if(status.peerId===this.identity.peerId)throw new Error("Refusing self peer");Object.assign(peer,{state:"connected",peerId:status.peerId,name:status.name,height:status.height,tip:status.tip,lastSeen:Date.now(),error:null});for(const url of status.peers||[])this.addPeer(url);return status}catch(error){Object.assign(peer,{state:"offline",error:error.message});return null}}
 async incrementalSnapshot(peer,status){
  const chain=[...this.getChain().chain];let from=chain.length;
  if(from>status.height)return null; // A shorter, stronger-work fork needs a full snapshot.
  // Follow a moving tip, but bound total range requests. Only the FINAL signed
  // response supplies the matching state/tip; the initial status is just a hint.
  for(let batch=0;batch<32;batch++){
   const envelope=await getJson(`${peer.url}/p2p/blocks?from=${from}&limit=${this.syncBatchSize}`,15_000),payload=checkedStatus(verifyEnvelope(envelope,{peerId:status.peerId}));
   if(payload.from!==from||!Array.isArray(payload.blocks)||!payload.blocks.length||payload.blocks.length>this.syncBatchSize)throw new Error("Invalid incremental block response");
   if(payload.blocks[0].previousHash!==chain.at(-1).hash)return null;
   for(const block of payload.blocks){if(block.height!==chain.length||block.previousHash!==chain.at(-1).hash)throw new Error("Non-contiguous incremental blocks");chain.push(block)}
   from=chain.length;
   if(payload.complete){if(!payload.state||chain.length!==payload.height+1||chain.at(-1).hash!==payload.tip)throw new Error("Incomplete incremental synchronization");return{snapshot:{...payload.state,chain},status:payload}}
  }
  return null; // Bounded, consistent full-snapshot fallback for a continually advancing peer.
 }
 async syncFrom(peer,status){
  this.state="Syncing";let candidateData=await this.incrementalSnapshot(peer,status);
  if(!candidateData){const envelope=await getJson(`${peer.url}/p2p/snapshot`,15_000),payload=checkedStatus(verifyEnvelope(envelope,{peerId:status.peerId}));if(payload.snapshot?.chain?.at(-1)?.hash!==payload.tip||payload.snapshot.chain.length!==payload.height+1)throw new Error("Peer snapshot tip mismatch");candidateData={snapshot:payload.snapshot,status:payload}}
  const candidate=KorekChain.fromSnapshot(candidateData.snapshot),verifiedWork=candidate.cumulativeWork();
  if(verifiedWork!==parseWork(candidateData.status.cumulativeWork))throw new Error("Peer work advertisement does not match validated chain");
  const decision=chainSelection(this.getChain(),candidate);
  if(!decision.adopt){peer.error=`Candidate retained locally: ${decision.reason}`;return false}
  // Recheck against current local state after download, then let the server
  // independently validate/recheck before assigning. A veto is NOT success.
  const accepted=await this.onSnapshot(candidateData.snapshot,{peerId:status.peerId,url:peer.url,height:candidate.chain.length-1,tip:candidate.chain.at(-1).hash,cumulativeWork:verifiedWork.toString()});
  return accepted!==false;
 }
 syncOnce(){
  if(this.syncInFlight)return this.syncInFlight;
  this.syncInFlight=this.synchronize().finally(()=>{this.syncInFlight=null});
  return this.syncInFlight;
 }
 async synchronize(){
  const peers=[...this.peers.values()];if(!peers.length){this.state="Idle";return false}
  const statuses=(await Promise.all(peers.map(async peer=>({peer,status:await this.inspect(peer)})))).filter(item=>item.status);
  if(!statuses.length){this.state="Offline";this.lastError="No configured peers are reachable";return false}
  statuses.sort((a,b)=>{const work=parseWork(b.status.cumulativeWork)-parseWork(a.status.cumulativeWork);return work>0n?1:work<0n?-1:b.status.height-a.status.height||String(a.status.tip).localeCompare(String(b.status.tip))});
  let lastError=null;
  for(const item of statuses){
   const local=this.getChain(),remoteWork=parseWork(item.status.cumulativeWork),localWork=local.cumulativeWork();
   if(remoteWork<localWork||(remoteWork===localWork&&item.status.height<=local.chain.length-1))continue;
   try{if(await this.syncFrom(item.peer,item.status)){this.state="Idle";this.lastError=null;return true}}
   catch(error){item.peer.error=error.message;lastError=error}
  }
  this.state=lastError?"Error":"Idle";this.lastError=lastError?.message||null;
  if(lastError)throw lastError;return false;
 }
}
