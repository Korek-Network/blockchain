import test from "node:test";
import assert from "node:assert/strict";
import { deterministicOutputHash,executeDeterministicWorkload,verifyFraudWitness,witnessHash } from "../src/fraud-proof.js";

test("sha256 batch witness is deterministic and detects a wrong claimed output",()=>{
 const witness={items:["alpha","beta","gamma"]},inputHash=witnessHash("sha256-batch-v1",witness),correct=deterministicOutputHash("sha256-batch-v1",witness),proof=verifyFraudWitness({profile:"sha256-batch-v1",inputHash,claimedOutputHash:"00".repeat(32),witness});
 assert.match(inputHash,/^[0-9a-f]{64}$/);assert.match(correct,/^[0-9a-f]{64}$/);assert.equal(proof.expectedOutputHash,correct);assert.equal(proof.fraudProven,true);assert.equal(verifyFraudWitness({profile:"sha256-batch-v1",inputHash,claimedOutputHash:correct,witness}).fraudProven,false);
});

test("integer matrix multiplication has exact bounded execution",()=>{
 const witness={left:[[1,2,3],[4,5,6]],right:[[7,8],[9,10],[11,12]]},execution=executeDeterministicWorkload("matrix-multiply-int-v1",witness);assert.deepEqual(execution.result,[[58,64],[139,154]]);assert.match(deterministicOutputHash("matrix-multiply-int-v1",witness),/^[0-9a-f]{64}$/);
});

test("fraud witness must match the committed input hash",()=>{
 const witness={items:["correct"]};assert.throws(()=>verifyFraudWitness({profile:"sha256-batch-v1",inputHash:"11".repeat(32),claimedOutputHash:"22".repeat(32),witness}),/does not match the committed input hash/);
});

test("fraud execution rejects oversized or malformed workloads",()=>{
 assert.throws(()=>witnessHash("sha256-batch-v1",{items:Array(257).fill("x")}),/1 to 256/);assert.throws(()=>witnessHash("matrix-multiply-int-v1",{left:[[1,2]],right:[[1,2]]}),/incompatible/);assert.throws(()=>witnessHash("matrix-multiply-int-v1",{left:[[Number.MAX_SAFE_INTEGER]],right:[[2]]}),/Invalid left matrix/);
});
