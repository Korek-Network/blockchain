import test from "node:test";
import assert from "node:assert/strict";
import { createMinerAuthHeaders,MinerAuthVerifier } from "../src/miner-auth.js";

const token="test-token-that-is-longer-than-thirty-two-characters";
const now=1_800_000_000_000;

test("accepts a correctly signed miner request",()=>{
 const verifier=new MinerAuthVerifier(token,{now:()=>now});
 const headers=createMinerAuthHeaders(token,{method:"POST",path:"/mine",body:'{"work":1}',timestamp:now,nonce:"01".repeat(16)});
 assert.equal(verifier.verify(headers,{method:"POST",path:"/mine",body:'{"work":1}'}),true);
});

test("rejects a replayed nonce",()=>{
 const verifier=new MinerAuthVerifier(token,{now:()=>now});
 const headers=createMinerAuthHeaders(token,{timestamp:now,nonce:"02".repeat(16)});
 verifier.verify(headers);
 assert.throws(()=>verifier.verify(headers),/Replayed miner request/);
});

test("rejects body tampering",()=>{
 const verifier=new MinerAuthVerifier(token,{now:()=>now});
 const headers=createMinerAuthHeaders(token,{method:"POST",path:"/mine",body:'{"work":1}',timestamp:now,nonce:"03".repeat(16)});
 assert.throws(()=>verifier.verify(headers,{method:"POST",path:"/mine",body:'{"work":2}'}),/Invalid miner authentication signature/);
});

test("rejects expired timestamps",()=>{
 const verifier=new MinerAuthVerifier(token,{now:()=>now});
 const headers=createMinerAuthHeaders(token,{timestamp:now-30_001,nonce:"04".repeat(16)});
 assert.throws(()=>verifier.verify(headers),/Expired miner authentication timestamp/);
});

test("requires a sufficiently long token",()=>{
 assert.throws(()=>new MinerAuthVerifier("too-short"),/at least 32 characters/);
 assert.throws(()=>createMinerAuthHeaders("too-short"),/at least 32 characters/);
});
