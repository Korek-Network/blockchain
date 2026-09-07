import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { KorekChain, hashBlock } from "../src/blockchain.js";
import { chainSelection } from "../src/chain-selection.js";
import { cryptoProvider, addressFromPublicKey, sha256 } from "../src/crypto.js";
import { P2PNetwork } from "../src/p2p.js";
import { createTemplate, powDigest, meetsDifficulty, miningSubmissionMessage } from "../src/mining-protocol.js";

const wallet = () => { const w=cryptoProvider.createWallet();return {...w,address:addressFromPublicKey(w.publicKey,"wormhole-v1")}; };
const clone = chain => KorekChain.fromSnapshot(structuredClone(chain.snapshot()));
const sender = wallet(), receiver = wallet();let sequence=0;
function transfer(chain) {
  const timestamp=Date.now()+sequence++,amount="1",gasPrice="1",gasLimit="21000",addressScheme="wormhole-v1";
  const message=`${sender.address}|${receiver.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}|${addressScheme}`;
  const tx=chain.addTransaction({version:3,from:sender.address,to:receiver.address,amount,timestamp,gasPrice,gasLimit,addressScheme,
    publicKey:sender.publicKey,signature:cryptoProvider.sign(message,sender.privateKey)});
  chain.sealPending();return tx.id;
}
function base() { const chain=new KorekChain();chain.claimFaucet(sender.address);return chain; }
function anchor(chain) {
  const miner=wallet(),template=createTemplate({...chain.miningTemplateData(miner.address),publicKey:miner.publicKey});
  assert.ok(template.difficulty<=3,"Run via npm test or with KOREK_DIFFICULTY=3");
  let nonce=0,powHash;do{powHash=powDigest(template.challenge,nonce++)}while(!meetsDifficulty(powHash,template.difficulty));
  const input={templateId:template.templateId,address:miner.address,publicKey:miner.publicKey,nonce:nonce-1,powHash,timestamp:template.notBefore};
  input.signature=cryptoProvider.sign(miningSubmissionMessage(input),miner.privateKey);
  return chain.acceptClientProof(template,input);
}
function identity() {
  const pair=generateKeyPairSync("ed25519"),publicKey=pair.publicKey.export({type:"spki",format:"pem"});
  return {peerId:sha256(publicKey),publicKey,privateKey:pair.privateKey.export({type:"pkcs8",format:"pem"})};
}

test("peer proof blocks must retain their signed timestamp and interval",()=>{
 const chain=base();anchor(chain);const state=structuredClone(chain.snapshot());
 state.chain.at(-1).timestamp++;state.chain.at(-1).hash=hashBlock(state.chain.at(-1));
 assert.throws(()=>KorekChain.fromSnapshot(state,{peer:true}),/proof placement/);
});

test("real P2P refuses proofless reward issuance before server adoption",async()=>{
 const source=base();source.mine(sender.address,undefined,Date.now(),{difficulty:0});
 await paired(source,new KorekChain(),async({targetPeer,accepted})=>{
   await assert.rejects(targetPeer.start(),/client proof/);assert.equal(accepted(),0);
 });
});
function peer(getChain,onSnapshot=async()=>{},extra={}) {
  return new P2PNetwork({identity:identity(),name:"regression",port:0,advertiseUrl:null,syncIntervalMs:60000,getChain,onSnapshot,...extra});
}
async function paired(source,local,action,extra={}) {
  const sourcePeer=peer(()=>source),address=await sourcePeer.start();let target=local,accepted=0;
  const targetPeer=peer(()=>target,async snapshot=>{target=KorekChain.fromSnapshot(snapshot);accepted++;return true;},
    {seeds:[`http://127.0.0.1:${address.port}`],...extra});
  try { await action({sourcePeer,targetPeer,target:()=>target,accepted:()=>accepted}); }
  finally { await targetPeer.stop();await sourcePeer.stop(); }
}

test("public inclusion is unanchored, projections preserve all canonical block bytes",()=>{
  const chain=base(),id=transfer(chain),original=JSON.stringify(chain.snapshot());
  const tx=chain.transaction(id),block=chain.block(tx.blockHeight);
  assert.equal(tx.status,"included");assert.equal(tx.powConfirmations,0);assert.equal(tx.confirmedAt,null);
  assert.equal(tx.confirmationTimeMs,null);assert.equal(tx.finalized,false);assert.equal(tx.finalityTimeMs,null);
  assert.equal(tx.includedAt,chain.chain[1].transactions[0].confirmedAt);
  assert.equal(block.transactions[0].status,"included");assert.equal(chain.transactions()[0].status,"included");
  assert.equal(chain.blocks()[0].transactions[0].status,"included");
  assert.equal(JSON.stringify(chain.snapshot()),original);
  const raw=chain.block(1,{canonical:true});assert.equal(raw.transactions[0].status,"confirmed");
  assert.equal(hashBlock(raw),raw.hash);raw.transactions[0].status="changed";
  assert.equal(JSON.stringify(chain.snapshot()),original);
});
test("only PoW blocks at or after inclusion create anchor depth, never ordinary block height",()=>{
  const chain=base(),id=transfer(chain);transfer(chain);
  assert.equal(chain.transaction(id).confirmations,0);assert.equal(chain.transaction(id).blockDepth,2);
  const first=anchor(chain),tx=chain.transaction(id);
  assert.equal(tx.status,"anchored");assert.equal(tx.powConfirmations,1);assert.equal(tx.anchoredAt,first.timestamp);
  assert.equal(tx.finalized,false);assert.equal(tx.canReorganize,true);
  const later=transfer(chain);assert.equal(chain.transaction(later).status,"included");
  anchor(chain);assert.equal(chain.transaction(id).powConfirmations,2);assert.equal(chain.transaction(later).powConfirmations,1);
  assert.equal(chain.transaction(id).anchoredAt,first.timestamp);
});
test("legacy snapshot restore changes observation labels without rehashing history",()=>{
  const chain=base(),id=transfer(chain);anchor(chain);
  const serialized=JSON.stringify(chain.snapshot()),restored=KorekChain.fromSnapshot(JSON.parse(serialized));
  assert.equal(restored.transaction(id).status,"anchored");assert.equal(JSON.stringify(restored.snapshot()),serialized);
  assert.equal(restored.status().finalityMode,"not-guaranteed");assert.equal(restored.status().finalityTargetMs,null);
});
test("persisted pending entries cannot spoof included or anchored placement",()=>{
  const chain=base();transfer(chain);anchor(chain);
  for(const status of ["confirmed","pending"]){
    const state=structuredClone(chain.snapshot());state.pending=[{...state.chain[1].transactions[0],status}];
    assert.throws(()=>KorekChain.fromSnapshot(state),/pending transaction placement/);
  }
});
test("exact same-chain extensions are accepted at zero and positive equal work",()=>{
  const local=base(),candidate=clone(local);transfer(candidate);
  assert.equal(chainSelection(local,candidate).reason,"exact-extension");
  anchor(candidate);const next=clone(candidate);transfer(next);
  assert.equal(chainSelection(candidate,next).adopt,true);assert.equal(candidate.cumulativeWork(),next.cumulativeWork());
});
test("longer conflicting equal-work branches cannot replace local history",()=>{
  for(const positive of [false,true]){
    const common=base();if(positive)anchor(common);
    const left=clone(common),right=clone(common);transfer(left);transfer(right);transfer(right);
    assert.deepEqual(chainSelection(left,right),{adopt:false,reason:"equal-work-fork"});
  }
});
test("shorter stronger-work forks still win, weaker taller forks and foreign genesis do not",()=>{
  const common=base(),tall=clone(common),strong=clone(common);
  for(let i=0;i<4;i++)transfer(tall);anchor(strong);
  assert.equal(chainSelection(tall,strong).reason,"stronger-work");assert.equal(chainSelection(tall,strong).adopt,true);
  assert.equal(chainSelection(strong,tall).reason,"weaker-work");
  const foreign=clone(strong);foreign.chain[0].hash="0".repeat(64);
  assert.equal(chainSelection(tall,foreign).reason,"different-genesis");
});
test("real P2P propagates a post-mining exact extension without another PoW block",async()=>{
  const common=base();anchor(common);const source=clone(common),id=transfer(source);
  await paired(source,clone(common),async({targetPeer,target})=>{
    await targetPeer.start();assert.equal(target().transaction(id).status,"included");
    assert.equal(target().cumulativeWork(),common.cumulativeWork());
  });
});
test("real P2P refuses a longer equal-positive-work fork",async()=>{
  const common=base();anchor(common);const local=clone(common),source=clone(common);
  const kept=transfer(local);transfer(source);transfer(source);
  await paired(source,local,async({targetPeer,target,accepted})=>{
    await targetPeer.start();assert.equal(accepted(),0);assert.ok(target().transaction(kept));
  });
});
test("a shorter real stronger-work chain uses full fallback and is adopted",async()=>{
  const common=base(),local=clone(common),source=clone(common);transfer(local);transfer(local);anchor(source);
  await paired(source,local,async({targetPeer,target,accepted})=>{
    await targetPeer.start();assert.equal(accepted(),1);assert.equal(target().chain.at(-1).hash,source.chain.at(-1).hash);
  });
});
test("incremental transfer follows a moving tip using terminal signed state, not stale discovery status",async()=>{
  const source=base(),local=clone(source);transfer(source);
  await paired(source,local,async({sourcePeer,targetPeer,target})=>{
    let advanced=false;const original=sourcePeer.blocksPayload.bind(sourcePeer);
    sourcePeer.blocksPayload=url=>{if(!advanced){advanced=true;transfer(source)}return original(url)};
    sourcePeer.snapshotPayload=()=>{throw new Error("must not require full fallback")};
    await targetPeer.start();assert.equal(target().chain.length,3);
  },{syncBatchSize:1});
});
test("a signed false cumulative-work claim is rejected before the adoption callback",async()=>{
  const source=base();transfer(source);
  await paired(source,base(),async({sourcePeer,targetPeer,accepted})=>{
    const original=sourcePeer.statusPayload.bind(sourcePeer);
    sourcePeer.statusPayload=()=>({...original(),cumulativeWork:"999999"});
    await assert.rejects(targetPeer.start(),/work advertisement/);assert.equal(accepted(),0);
  });
});
test("an extension that becomes stale while downloading cannot overwrite a newer local branch",async()=>{
  const common=base(),source=clone(common),local=clone(common);transfer(source);
  await paired(source,local,async({targetPeer,target,accepted})=>{
    const original=targetPeer.incrementalSnapshot.bind(targetPeer);
    targetPeer.incrementalSnapshot=async(...args)=>{const result=await original(...args);transfer(local);return result};
    await targetPeer.start();assert.equal(accepted(),0);assert.equal(target().chain.at(-1).hash,local.chain.at(-1).hash);
  });
});
test("sync calls coalesce into one in-flight operation and can run again afterward",async()=>{
  const network=peer(()=>base());let finish,calls=0;
  network.synchronize=()=>{calls++;return new Promise(resolve=>{finish=resolve})};
  const first=network.syncOnce(),second=network.syncOnce();assert.equal(first,second);assert.equal(calls,1);
  finish(true);assert.equal(await first,true);
  const third=network.syncOnce();assert.equal(calls,2);finish(false);assert.equal(await third,false);
});
test("a server adoption veto is not reported as successful synchronization",async()=>{
  const source=base(),local=clone(source);transfer(source);
  await paired(source,local,async({targetPeer,accepted})=>{
    targetPeer.onSnapshot=async()=>false;await targetPeer.start();
    assert.equal(await targetPeer.syncOnce(),false);assert.equal(accepted(),0);
  });
});
test("v1 peers fail closed rather than silently mixing fork-choice policies",async()=>{
  const source=base();transfer(source);
  await paired(source,base(),async({sourcePeer,targetPeer,accepted})=>{
    const original=sourcePeer.statusPayload.bind(sourcePeer);
    sourcePeer.statusPayload=()=>({...original(),protocol:"korek-planck-p2p/1"});
    await targetPeer.start();assert.equal(accepted(),0);assert.equal(targetPeer.state,"Offline");
    assert.match(targetPeer.publicPeers()[0].error,/protocol mismatch/);
  });
});
test("a mismatched terminal tip never reaches the adoption callback",async()=>{
  const source=base();transfer(source);
  await paired(source,base(),async({sourcePeer,targetPeer,accepted})=>{
    const original=sourcePeer.blocksPayload.bind(sourcePeer);
    sourcePeer.blocksPayload=url=>({...original(url),tip:"0".repeat(64)});
    await assert.rejects(targetPeer.start(),/Incomplete/);assert.equal(accepted(),0);
  });
});
test("a dishonest higher-ranked peer does not prevent a valid peer extension",async()=>{
  const local=base(),good=clone(local),bad=clone(local);transfer(good);transfer(bad);
  const goodPeer=peer(()=>good),badPeer=peer(()=>bad),a=await goodPeer.start(),b=await badPeer.start();
  const original=badPeer.statusPayload.bind(badPeer);badPeer.statusPayload=()=>({...original(),cumulativeWork:"999999"});
  let target=local;
  const client=peer(()=>target,async snapshot=>{target=KorekChain.fromSnapshot(snapshot);return true;},
    {seeds:[`http://127.0.0.1:${b.port}`,`http://127.0.0.1:${a.port}`]});
  try{await client.start();assert.equal(target.chain.at(-1).hash,good.chain.at(-1).hash);assert.equal(client.state,"Idle")}
  finally{await client.stop();await goodPeer.stop();await badPeer.stop()}
});
test("continually advancing incremental ranges are bounded before consistent full fallback",async()=>{
  const local=base(),source=clone(local);transfer(source);
  await paired(source,local,async({sourcePeer,targetPeer,target})=>{
    let ranges=0,snapshots=0;const original=sourcePeer.blocksPayload.bind(sourcePeer),full=sourcePeer.snapshotPayload.bind(sourcePeer);
    sourcePeer.blocksPayload=url=>{ranges++;transfer(source);return original(url)};
    sourcePeer.snapshotPayload=()=>{snapshots++;return full()};
    await targetPeer.start();assert.equal(ranges,32);assert.equal(snapshots,1);
    assert.equal(target().chain.at(-1).hash,source.chain.at(-1).hash);
  },{syncBatchSize:1});
});
