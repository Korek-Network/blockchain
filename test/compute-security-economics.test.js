import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { ComputeMarket,COMPUTE_MAX_JOB_PAYMENT,computeJobMessage,computeClaimMessage,computeResultMessage,computeVoteMessage,computeChallengeMessage } from "../src/compute-market.js";
import { ComputeValidatorRegistry,COMPUTE_VALIDATOR_MIN_STAKE,validatorRegisterMessage } from "../src/validator-registry.js";
import { deterministicOutputHash,witnessHash } from "../src/fraud-proof.js";

const signed=(wallet,message,fields)=>({...fields,publicKey:wallet.publicKey,signature:cryptoProvider.sign(message,wallet.privateKey)});
const register=(chain,registry,wallet,now)=>{chain.claimFaucet(wallet.address,COMPUTE_VALIDATOR_MIN_STAKE+100_000_000n,now-10_000);const fields={validator:wallet.address,addressScheme:"transparent-v1",stake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),timestamp:now};registry.register(signed(wallet,validatorRegisterMessage(fields),fields),now)};
const setup=now=>{const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),validators=Array.from({length:5},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>register(chain,registry,wallet,now+index));return{chain,registry,validators,market:new ComputeMarket(chain,registry,null,{entropyProvider:()=>"33".repeat(32)})}};
const walletFor=(wallets,address)=>wallets.find(wallet=>wallet.address===address);

test("MVP rejects jobs above 10,000 KRK before validator selection",()=>{
 const now=4_000_000_000_000,{market}=setup(now),creator=cryptoProvider.createWallet(),witness={items:["cap-test"]},fields={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:witnessHash("sha256-batch-v1",witness),payment:(COMPUTE_MAX_JOB_PAYMENT+1n).toString(),deadline:now+60_000,timestamp:now+100};
 assert.throws(()=>market.createJob(signed(creator,computeJobMessage(fields),fields),now+100),/cannot exceed 10,000 KRK/);
});

test("overturned false rejection pays full escrow to worker and no challenger bounty",()=>{
 const now=4_100_000_000_000,{chain,validators,market}=setup(now),creator=cryptoProvider.createWallet(),worker=cryptoProvider.createWallet(),challenger=cryptoProvider.createWallet(),witness={items:["honest-work"]},payment="900000000";chain.claimFaucet(creator.address,100n*100_000_000n,now-10_000);
 const jobFields={creator:creator.address,addressScheme:"transparent-v1",workloadProfile:"sha256-batch-v1",inputHash:witnessHash("sha256-batch-v1",witness),payment,deadline:now+60_000,timestamp:now+100},job=market.createJob(signed(creator,computeJobMessage(jobFields),jobFields),now+100),claimFields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",timestamp:now+101};market.claimJob(job.id,signed(worker,computeClaimMessage(claimFields),claimFields),now+101);
 const correct=deterministicOutputHash(job.workloadProfile,witness),resultFields={jobId:job.id,worker:worker.address,addressScheme:"transparent-v1",outputHash:correct,timestamp:now+102};market.submitResult(job.id,signed(worker,computeResultMessage(resultFields),resultFields),now+102);
 for(let i=0;i<3;i++){const validator=walletFor(validators,job.verifiers[i]),voteFields={jobId:job.id,verifier:validator.address,addressScheme:"transparent-v1",outputHash:`0${i+1}`.repeat(32),approve:false,timestamp:now+103+i};market.vote(job.id,signed(validator,computeVoteMessage(voteFields),voteFields),now+103+i)}
 const witnessCommit=witnessHash(job.workloadProfile,witness),challengeFields={jobId:job.id,challenger:challenger.address,addressScheme:"transparent-v1",witnessHash:witnessCommit,timestamp:now+107},challenged=market.challengeJob(job.id,signed(challenger,computeChallengeMessage(challengeFields),{...challengeFields,witness}),now+107);
 assert.equal(challenged.job.status,"settled");assert.equal(chain.balance(worker.address),payment);assert.equal(chain.balance(challenger.address),"0");assert.deepEqual(challenged.job.verifierPayouts,{});
});
