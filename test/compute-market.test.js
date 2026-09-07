import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { ComputeMarket,COMPUTE_WORKER_SHARE_BPS,computeJobMessage,computeClaimMessage,computeResultMessage,computeVoteMessage,computeCancelMessage } from "../src/compute-market.js";
import { ComputeValidatorRegistry,COMPUTE_VALIDATOR_MIN_STAKE,COMPUTE_VALIDATOR_SET_SIZE,COMPUTE_VALIDATOR_THRESHOLD,validatorRegisterMessage } from "../src/validator-registry.js";

const hash=value=>createHash("sha256").update(value).digest("hex");
const signed=(wallet,message,fields)=>({...fields,publicKey:wallet.publicKey,signature:cryptoProvider.sign(message,wallet.privateKey)});
const registerValidator=(chain,registry,wallet,now)=>{chain.claimFaucet(wallet.address,COMPUTE_VALIDATOR_MIN_STAKE+1_000n*100_000_000n,now-10_000);const fields={validator:wallet.address,addressScheme:"transparent-v1",stake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),timestamp:now};return registry.register(signed(wallet,validatorRegisterMessage(fields),fields),now)};
const setup=(now,count=5)=>{const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),validators=Array.from({length:count},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>registerValidator(chain,registry,wallet,now+index));const market=new ComputeMarket(chain,registry,null,{entropyProvider:()=>"11".repeat(32)});return{chain,registry,validators,market}};
const makeJob=(market,chain,creator,now,payment="1000000000",extra={})=>{chain.claimFaucet(creator.address,100n*100_000_000n,now-10_000);const fields={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:hash("input"),payment,deadline:now+60_000,timestamp:now,...extra};return market.createJob(signed(creator,computeJobMessage(fields),fields),now)};
const claim=(market,job,worker,now)=>{const fields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",timestamp:now};return market.claimJob(job.id,signed(worker,computeClaimMessage(fields),fields),now)};
const result=(market,job,worker,now,outputHash=hash("output"))=>{const fields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",outputHash,timestamp:now};return market.submitResult(job.id,signed(worker,computeResultMessage(fields),fields),now)};
const vote=(market,job,verifier,now,approve=true,outputHash=hash("output"))=>{const fields={jobId:job.id,verifier:verifier.address,addressScheme:"transparent-v1",outputHash,approve,timestamp:now};return market.vote(job.id,signed(verifier,computeVoteMessage(fields),fields),now)};
const walletFor=(wallets,address)=>wallets.find(wallet=>wallet.address===address);

test("network selects five staked validators and settles 3-of-5 without minting KRK",()=>{
 const now=2_000_000_000_000,{chain,registry,validators,market}=setup(now),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),minedBefore=chain.minedSupply,job=makeJob(market,chain,creator,now+100,"1000000000");
 assert.equal(job.verifiers.length,COMPUTE_VALIDATOR_SET_SIZE);assert.equal(new Set(job.verifiers).size,COMPUTE_VALIDATOR_SET_SIZE);assert.equal(job.verificationThreshold,COMPUTE_VALIDATOR_THRESHOLD);assert.match(job.selectionSeed,/^[0-9a-f]{64}$/);job.verifiers.forEach(address=>assert.equal(registry.isAssigned(job.id,address),true));
 claim(market,job,worker,now+101);result(market,job,worker,now+102);const voters=job.verifiers.slice(0,3).map(address=>walletFor(validators,address));vote(market,job,voters[0],now+103);vote(market,job,voters[1],now+104);const settled=vote(market,job,voters[2],now+105);
 const payment=1_000_000_000n,workerPayout=payment*COMPUTE_WORKER_SHARE_BPS/10_000n,verifierPayout=Object.values(settled.verifierPayouts).reduce((sum,value)=>sum+BigInt(value),0n);
 assert.equal(settled.status,"settled");assert.equal(BigInt(chain.balance(worker.address)),workerPayout);assert.equal(verifierPayout,payment-workerPayout);assert.equal(chain.minedSupply,minedBefore);assert.equal(market.stats().escrowed,"0");assert.equal(Object.keys(settled.verifierPayouts).length,3);assert.match(settled.receipt.hash,/^[0-9a-f]{64}$/);job.verifiers.forEach(address=>assert.equal(registry.isAssigned(job.id,address),false));
});

test("three network-selected rejection votes refund the customer and do not pay worker",()=>{
 const now=2_100_000_000_000,{chain,validators,market}=setup(now),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),job=makeJob(market,chain,creator,now+100,"500000000"),before=chain.balance(creator.address);claim(market,job,worker,now+101);result(market,job,worker,now+102);const voters=job.verifiers.slice(0,3).map(address=>walletFor(validators,address));vote(market,job,voters[0],now+103,false,hash("different-1"));vote(market,job,voters[1],now+104,false,hash("different-2"));const rejected=vote(market,job,voters[2],now+105,false,hash("different-3"));
 assert.equal(rejected.status,"rejected");assert.equal(chain.balance(creator.address),(BigInt(before)+500_000_000n).toString());assert.equal(chain.balance(worker.address),"0");assert.equal(rejected.receipt.refundedTo,creator.address);
});

test("customer cannot choose verifier wallets or lower the 3-of-5 threshold",()=>{
 const now=2_200_000_000_000,{chain,market}=setup(now),creator=cryptoProvider.createWallet();chain.claimFaucet(creator.address,100n*100_000_000n,now-10_000);const attacker=cryptoProvider.createWallet();
 const chosen={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:hash("input"),payment:"100000000",deadline:now+60_000,timestamp:now,verifiers:[attacker.address]};assert.throws(()=>market.createJob(signed(creator,computeJobMessage(chosen),chosen),now),/selected by the network/);
 const weak={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:hash("input-2"),payment:"100000000",deadline:now+60_000,timestamp:now+1,verificationThreshold:2};assert.throws(()=>market.createJob(signed(creator,computeJobMessage(weak),weak),now+1),/fixed at 3 of 5/);
});

test("unselected wallets cannot vote and selected validators cannot claim worker role",()=>{
 const now=2_300_000_000_000,{chain,registry,validators,market}=setup(now,6),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),job=makeJob(market,chain,creator,now+100),selectedWallet=walletFor(validators,job.verifiers[0]),outsider=validators.find(wallet=>!job.verifiers.includes(wallet.address));
 const selectedClaim={jobId:job.id,worker:selectedWallet.address,addressScheme:"transparent-v1",timestamp:now+101};assert.throws(()=>market.claimJob(job.id,signed(selectedWallet,computeClaimMessage(selectedClaim),selectedClaim),now+101),/selected validator/);
 claim(market,job,worker,now+102);result(market,job,worker,now+103);assert.equal(registry.isAssigned(job.id,outsider.address),false);const outsiderVote={jobId:job.id,verifier:outsider.address,addressScheme:"transparent-v1",outputHash:hash("output"),approve:true,timestamp:now+104};assert.throws(()=>market.vote(job.id,signed(outsider,computeVoteMessage(outsiderVote),outsiderVote),now+104),/network-selected staked validator/);
});

test("network-selected jobs cannot be freely cancelled to grind validator sets and refund only at deadline",()=>{
 const now=2_400_000_000_000,{chain,registry,market}=setup(now),creator=cryptoProvider.createWallet(),job=makeJob(market,chain,creator,now+100,"250000000",{deadline:now+1100}),afterEscrow=BigInt(chain.balance(creator.address)),cancelFields={jobId:job.id,creator:creator.address,addressScheme:"transparent-v1",timestamp:now+200};
 assert.throws(()=>market.cancelJob(job.id,signed(creator,computeCancelMessage(cancelFields),cancelFields),now+200),/cannot be cancelled after validator selection/);assert.equal(BigInt(chain.balance(creator.address)),afterEscrow);job.verifiers.forEach(address=>assert.equal(registry.isAssigned(job.id,address),true));assert.throws(()=>market.expireJob(job.id,now+1000),/not reached/);
 const expired=market.expireJob(job.id,now+1101);assert.equal(expired.status,"expired");assert.equal(BigInt(chain.balance(creator.address)),afterEscrow+250_000_000n);job.verifiers.forEach(address=>assert.equal(registry.isAssigned(job.id,address),false));assert.throws(()=>market.expireJob(job.id,now+1102),/already final/);
});

test("compute and validator state survive snapshot restore without changing chain supply",()=>{
 const now=2_500_000_000_000,{chain,registry,market}=setup(now),creator=cryptoProvider.createWallet(),job=makeJob(market,chain,creator,now+100,"123456789"),chainSnapshot=chain.snapshot(),registrySnapshot=registry.snapshot(),marketSnapshot=market.snapshot(),restoredChain=KorekChain.fromSnapshot(chainSnapshot),restoredRegistry=new ComputeValidatorRegistry(restoredChain,registrySnapshot),restored=new ComputeMarket(restoredChain,restoredRegistry,marketSnapshot,{entropyProvider:()=>"22".repeat(32)});
 assert.equal(restored.job(job.id).payment,"123456789");assert.equal(restored.stats().escrowed,"123456789");assert.equal(restoredRegistry.stats().active,5);job.verifiers.forEach(address=>assert.equal(restoredRegistry.isAssigned(job.id,address),true));assert.equal(restoredChain.minedSupply,chain.minedSupply);
});
