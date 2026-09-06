import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync,createHash } from "node:crypto";
import { KorekChain } from "../src/blockchain.js";
import { P2PNetwork,verifyEnvelope } from "../src/p2p.js";

const identity=()=>{const {publicKey,privateKey}=generateKeyPairSync("ed25519"),pub=publicKey.export({type:"spki",format:"pem"}),priv=privateKey.export({type:"pkcs8",format:"pem"});return{peerId:createHash("sha256").update(pub).digest("hex"),publicKey:pub,privateKey:priv}};
test("P2P rejects unsigned and malformed envelopes",()=>{assert.throws(()=>verifyEnvelope({}),/Malformed/);assert.throws(()=>verifyEnvelope({payload:{peerId:"bad"},publicKey:"bad",signature:"bad"}),/identity|key/i)});
test("a second node discovers and synchronizes the longer signed Planck chain",async()=>{let source=new KorekChain(),target=new KorekChain();source.mine(`krk1${"ab".repeat(20)}`);const first=new P2PNetwork({identity:identity(),name:"first",port:0,advertiseUrl:null,getChain:()=>source,onSnapshot:async()=>{}}),address=await first.start(),seed=`http://127.0.0.1:${address.port}`,second=new P2PNetwork({identity:identity(),name:"second",port:0,advertiseUrl:null,seeds:[seed],syncIntervalMs:60_000,getChain:()=>target,onSnapshot:async snapshot=>{target=KorekChain.fromSnapshot(snapshot)}});try{await second.start();assert.equal(target.chain.length,source.chain.length);assert.equal(second.networkStatus().connectedPeers,1);assert.equal(second.networkStatus().state,"Idle")}finally{await second.stop();await first.stop()}});
