import { createHash,sign,verify } from "node:crypto";
import { createServer } from "node:http";
import { NETWORK } from "./config.js";
import { CHAIN_NAME,NODE_PROTOCOL,NODE_VERSION } from "./protocol.js";

const encode=value=>JSON.stringify(value);
const peerIdFromKey=publicKey=>createHash("sha256").update(publicKey).digest("hex");
const validUrl=value=>{try{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password?url.href.replace(/\/$/,""):null}catch{return null}};
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
async function getJson(url,timeoutMs=4_000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{headers:{accept:"application/json"},signal:controller.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||`Peer returned ${response.status}`);return value}finally{clearTimeout(timer)}}

export class P2PNetwork{
 constructor({identity,name,port,advertiseUrl,seeds=[],maxPeers=64,syncIntervalMs=2_000,getChain,onSnapshot}){
  if(!identity?.peerId||!identity.publicKey||!identity.privateKey)throw new Error("P2P requires a valid node identity key");
  this.identity=identity;this.name=name;this.port=port;this.advertiseUrl=validUrl(advertiseUrl);this.maxPeers=maxPeers;this.syncIntervalMs=syncIntervalMs;this.getChain=getChain;this.onSnapshot=onSnapshot;this.peers=new Map();this.state="Starting";this.lastError=null;this.server=null;this.timer=null;seeds.forEach(url=>this.addPeer(url,"seed"));
 }
 addPeer(value,source="discovered"){const url=validUrl(value);if(!url||url===this.advertiseUrl||this.peers.has(url)||this.peers.size>=this.maxPeers)return false;this.peers.set(url,{url,source,state:"new",peerId:null,name:null,height:null,lastSeen:null,error:null});return true}
 publicPeers(){return[...this.peers.values()].map(({url,source,state,peerId,name,height,lastSeen,error})=>({url,source,state,peerId,name,height,lastSeen,error}))}
 networkStatus(){const connected=[...this.peers.values()].filter(peer=>peer.state==="connected").length;return{enabled:true,protocol:NODE_PROTOCOL,listenPort:this.port,advertiseUrl:this.advertiseUrl,knownPeers:this.peers.size,connectedPeers:connected,state:this.state,lastError:this.lastError}}
 statusPayload(){const chain=this.getChain();return{protocol:NODE_PROTOCOL,networkId:NETWORK.networkId,chain:CHAIN_NAME,version:NODE_VERSION,peerId:this.identity.peerId,name:this.name,height:chain.chain.length-1,tip:chain.chain.at(-1).hash,timestamp:Date.now(),peers:[this.advertiseUrl,...this.peers.keys()].filter(Boolean).slice(0,this.maxPeers)}}
 snapshotPayload(){return{...this.statusPayload(),snapshot:this.getChain().snapshot()}}
 async start(){this.server=createServer((req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);if(req.method==="GET"&&url.pathname==="/p2p/status")return reply(res,200,signed(this.identity,this.statusPayload()));if(req.method==="GET"&&url.pathname==="/p2p/snapshot")return reply(res,200,signed(this.identity,this.snapshotPayload()));return reply(res,404,{error:"P2P route not found"})}catch(error){return reply(res,400,{error:error.message})}});await new Promise((resolve,reject)=>{this.server.once("error",reject);this.server.listen(this.port,()=>{this.server.off("error",reject);resolve()})});this.state=this.peers.size?"Connecting":"Idle";this.timer=setInterval(()=>this.syncOnce().catch(error=>{this.lastError=error.message}),this.syncIntervalMs);this.timer.unref();await this.syncOnce();return this.server.address()}
 async stop(){clearInterval(this.timer);if(this.server)await new Promise(resolve=>this.server.close(resolve))}
 async inspect(peer){try{const envelope=await getJson(`${peer.url}/p2p/status`),status=verifyEnvelope(envelope);if(status.peerId===this.identity.peerId)throw new Error("Refusing self peer");Object.assign(peer,{state:"connected",peerId:status.peerId,name:status.name,height:Number(status.height),tip:status.tip,lastSeen:Date.now(),error:null});for(const url of status.peers||[])this.addPeer(url);return status}catch(error){Object.assign(peer,{state:"offline",error:error.message});return null}}
 async syncFrom(peer,status){this.state="Syncing";const envelope=await getJson(`${peer.url}/p2p/snapshot`,15_000),payload=verifyEnvelope(envelope,{peerId:status.peerId}),local=this.getChain();if(payload.height<=local.chain.length-1)return false;if(payload.snapshot?.chain?.at(-1)?.hash!==payload.tip)throw new Error("Peer snapshot tip mismatch");await this.onSnapshot(payload.snapshot,{peerId:payload.peerId,url:peer.url,height:payload.height,tip:payload.tip});return true}
 async syncOnce(){const peers=[...this.peers.values()];if(!peers.length){this.state="Idle";return false}const statuses=(await Promise.all(peers.map(async peer=>({peer,status:await this.inspect(peer)})))).filter(item=>item.status);if(!statuses.length){this.state="Offline";this.lastError="No configured peers are reachable";return false}statuses.sort((a,b)=>b.status.height-a.status.height||String(a.status.tip).localeCompare(String(b.status.tip)));const best=statuses[0],local=this.getChain();try{const changed=best.status.height>local.chain.length-1?await this.syncFrom(best.peer,best.status):false;this.state="Idle";this.lastError=null;return changed}catch(error){best.peer.error=error.message;this.state="Error";this.lastError=error.message;throw error}}
}
