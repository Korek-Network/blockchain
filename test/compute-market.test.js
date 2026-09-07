import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { ComputeMarket,COMPUTE_WORKER_SHARE_BPS,computeJobMessage,computeClaimMessage,computeResultMessage,computeVoteMessage,computeCancelMessage } from "../src/compute-market.js";

const hash=value=>createHash("sha256").update(value).digest("hex");
const signed=(wallet,message,fields)=>({...fields,publicKey:wallet.publicKey,signature:cryptoProvider.sign(message,wallet.privateKey)});
const makeJob=(market,creator,now,payment="1000000000",extra={},verifierWallets=null)=>{
 const wallets=verifierWallets||[cryptoProvider.createWallet(),cryptoProvider.createWallet()];
 const fields={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:hash("input"),payment,deadline:now+60_000,verificationThreshold:2,verifiers:wallets.map(wallet=>wallet.address),timestamp:now,...extra};
 return market.createJob(signed(creator,computeJobMessage(fields),fields),now);
};
const claim=(market,job,worker,now)=>{const fields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",timestamp:now};return market.claimJob(job.id,signed(worker,computeClaimMessage(fields),fields),now)};
const result=(market,job,worker,now,outputHash=hash("output"))=>{const fields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",outputHash,timestamp:now};return market.submitResult(job.id,signed(worker,computeResultMessage(fields),fields),now)};
const vote=(market,job,verifier,now,approve=true,outputHash=hash("output"))=>{const fields={jobId:job.id,verifier:verifier.address,addressScheme:"transparent-v1",outputHash,approve,timestamp:now};return market.vote(job.id,signed(verifier,computeVoteMessage(fields),fields),now)};

test("compute escrow settles existing KRK without minting new supply",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),v1=cryptoProvider.createWallet(),v2=cryptoProvider.createWallet(),now=2_000_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const creatorBefore=BigInt(chain.balance(creator.address)),minedBefore=chain.minedSupply,job=makeJob(market,creator,now,"1000000000",{},[v1,v2]);
 assert.equal(BigInt(chain.balance(creator.address)),creatorBefore-1_000_000_000n);assert.equal(market.stats().escrowed,"1000000000");
 claim(market,job,worker,now+1);result(market,job,worker,now+2);vote(market,job,v1,now+3);const settled=vote(market,job,v2,now+4);
 const workerPayout=1_000_000_000n*COMPUTE_WORKER_SHARE_BPS/10_000n,verifierPool=1_000_000_000n-workerPayout;
 assert.equal(settled.status,"settled");assert.equal(BigInt(chain.balance(worker.address)),workerPayout);assert.equal(BigInt(chain.balance(v1.address))+BigInt(chain.balance(v2.address)),verifierPool);assert.equal(chain.minedSupply,minedBefore);assert.equal(market.stats().escrowed,"0");assert.match(settled.receipt.hash,/^[0-9a-f]{64}$/);
});

test("two designated verifier rejections refund the customer and do not pay worker",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),v1=cryptoProvider.createWallet(),v2=cryptoProvider.createWallet(),now=2_100_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const before=chain.balance(creator.address),job=makeJob(market,creator,now,"500000000",{},[v1,v2]);claim(market,job,worker,now+1);result(market,job,worker,now+2);vote(market,job,v1,now+3,false,hash("different-1"));const rejected=vote(market,job,v2,now+4,false,hash("different-2"));
 assert.equal(rejected.status,"rejected");assert.equal(chain.balance(creator.address),before);assert.equal(chain.balance(worker.address),"0");assert.equal(rejected.receipt.refundedTo,creator.address);
});

test("expired jobs require explicit expiry and refund exactly once",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),now=2_200_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const before=chain.balance(creator.address),job=makeJob(market,creator,now,"250000000",{deadline:now+1000});
 const fields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",timestamp:now+1001};assert.throws(()=>market.claimJob(job.id,signed(worker,computeClaimMessage(fields),fields),now+1001),/expired/);assert.notEqual(chain.balance(creator.address),before);
 const expired=market.expireJob(job.id,now+1001);assert.equal(expired.status,"expired");assert.equal(chain.balance(creator.address),before);assert.throws(()=>market.expireJob(job.id,now+1002),/already final/);
});

test("creator can cancel only an unclaimed job with a valid signature",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),attacker=cryptoProvider.createWallet(),now=2_300_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const before=chain.balance(creator.address),job=makeJob(market,creator,now,"100000000");
 const forged={jobId:job.id,creator:creator.address,addressScheme:"transparent-v1",timestamp:now+1};assert.throws(()=>market.cancelJob(job.id,signed(attacker,computeCancelMessage(forged),forged),now+1),/Public key mismatch/);
 const fields={...forged,timestamp:now+2};const cancelled=market.cancelJob(job.id,signed(creator,computeCancelMessage(fields),fields),now+2);assert.equal(cancelled.status,"cancelled");assert.equal(chain.balance(creator.address),before);
});

test("only designated verifiers can vote and each can vote once",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),v1=cryptoProvider.createWallet(),v2=cryptoProvider.createWallet(),outsider=cryptoProvider.createWallet(),now=2_400_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const job=makeJob(market,creator,now,"1000000000",{},[v1,v2]);claim(market,job,worker,now+1);result(market,job,worker,now+2);
 const outsiderFields={jobId:job.id,verifier:outsider.address,addressScheme:"transparent-v1",outputHash:hash("output"),approve:true,timestamp:now+3};assert.throws(()=>market.vote(job.id,signed(outsider,computeVoteMessage(outsiderFields),outsiderFields),now+3),/not a designated verifier/);
 vote(market,job,v1,now+4);const duplicate={jobId:job.id,verifier:v1.address,addressScheme:"transparent-v1",outputHash:hash("output"),approve:true,timestamp:now+5};assert.throws(()=>market.vote(job.id,signed(v1,computeVoteMessage(duplicate),duplicate),now+5),/already voted/);
});

test("a designated verifier cannot claim the worker role",()=>{
 const chain=new KorekChain(),market=new ComputeMarket(chain),creator=cryptoProvider.createWallet(),v1=cryptoProvider.createWallet(),v2=cryptoProvider.createWallet(),now=2_450_000_000_000;
 chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const job=makeJob(market,creator,now,"1000000000",{},[v1,v2]),fields={jobId:job.id,worker:v1.address,addressScheme:"transparent-v1",timestamp:now+1};
 assert.throws(()=>market.claimJob(job.id,signed(v1,computeClaimMessage(fields),fields),now+1),/designated verifier/);
});

test("compute state survives snapshot restore without changing chain supply",()=>{
 const chain=new KorekChain(),creator=cryptoProvider.createWallet(),now=2_500_000_000_000;chain.claimFaucet(creator.address,100n*100_000_000n,now-3_600_000);const market=new ComputeMarket(chain),job=makeJob(market,creator,now,"123456789"),snapshot=market.snapshot(),restoredChain=KorekChain.fromSnapshot(chain.snapshot()),restored=new ComputeMarket(restoredChain,snapshot);
 assert.equal(restored.job(job.id).payment,"123456789");assert.equal(restored.stats().escrowed,"123456789");assert.equal(restoredChain.minedSupply,chain.minedSupply);
});
