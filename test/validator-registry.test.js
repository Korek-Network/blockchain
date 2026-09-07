import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider,sha256 } from "../src/crypto.js";
import { NETWORK } from "../src/config.js";
import {
 ComputeValidatorRegistry,COMPUTE_VALIDATOR_MIN_STAKE,COMPUTE_VALIDATOR_EXIT_DELAY_MS,COMPUTE_VALIDATOR_SET_SIZE,COMPUTE_VALIDATOR_THRESHOLD,COMPUTE_VALIDATOR_SELECTION_VERSION,COMPUTE_VALIDATOR_FRAUD_SLASH_BPS,
 validatorRegisterMessage,validatorExitMessage,validatorWithdrawMessage,
} from "../src/validator-registry.js";

const signed=(wallet,message,fields)=>({...fields,publicKey:wallet.publicKey,signature:cryptoProvider.sign(message,wallet.privateKey)});
const fundAndRegister=(chain,registry,wallet,now,stake=COMPUTE_VALIDATOR_MIN_STAKE)=>{chain.claimFaucet(wallet.address,stake+100n*100_000_000n,now-1000);const fields={validator:wallet.address,addressScheme:"transparent-v1",stake:stake.toString(),timestamp:now};return registry.register(signed(wallet,validatorRegisterMessage(fields),fields),now)};

test("validator registration locks at least 10,000 KRK without changing mined supply",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),wallet=cryptoProvider.createWallet(),now=3_000_000_000_000;chain.claimFaucet(wallet.address,COMPUTE_VALIDATOR_MIN_STAKE+100n*100_000_000n,now-1000);const before=BigInt(chain.balance(wallet.address)),minedBefore=chain.minedSupply,fields={validator:wallet.address,addressScheme:"transparent-v1",stake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),timestamp:now},entry=registry.register(signed(wallet,validatorRegisterMessage(fields),fields),now);
 assert.equal(entry.status,"active");assert.equal(entry.stake,COMPUTE_VALIDATOR_MIN_STAKE.toString());assert.equal(BigInt(chain.balance(wallet.address)),before-COMPUTE_VALIDATOR_MIN_STAKE);assert.equal(chain.minedSupply,minedBefore);assert.equal(registry.stats().lockedStake,COMPUTE_VALIDATOR_MIN_STAKE.toString());
});

test("validator stake rejects underfunding, forged identity and sub-minimum stake",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),wallet=cryptoProvider.createWallet(),attacker=cryptoProvider.createWallet(),now=3_100_000_000_000,small=(COMPUTE_VALIDATOR_MIN_STAKE-1n).toString();chain.claimFaucet(wallet.address,COMPUTE_VALIDATOR_MIN_STAKE+100n,now-1000);
 const low={validator:wallet.address,addressScheme:"transparent-v1",stake:small,timestamp:now};assert.throws(()=>registry.register(signed(wallet,validatorRegisterMessage(low),low),now),/at least 10,000 KRK/);
 const valid={validator:wallet.address,addressScheme:"transparent-v1",stake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),timestamp:now+1};assert.throws(()=>registry.register(signed(attacker,validatorRegisterMessage(valid),valid),now+1),/Public key mismatch/);
 const poor=cryptoProvider.createWallet(),poorFields={validator:poor.address,addressScheme:"transparent-v1",stake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),timestamp:now+2};assert.throws(()=>registry.register(signed(poor,validatorRegisterMessage(poorFields),poorFields),now+2),/Insufficient available balance/);
});

test("selection excludes creator, uses five validators, and is auditable from seed",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),now=3_200_000_000_000,validators=Array.from({length:6},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>fundAndRegister(chain,registry,wallet,now+index));const creator=validators[0],jobId="ab".repeat(32),tipHash="cd".repeat(32),entropy="ef".repeat(32),selection=registry.select({jobId,creator:creator.address,tipHash,entropy});
 assert.equal(selection.version,COMPUTE_VALIDATOR_SELECTION_VERSION);assert.equal(selection.validators.length,COMPUTE_VALIDATOR_SET_SIZE);assert.equal(selection.threshold,COMPUTE_VALIDATOR_THRESHOLD);assert.equal(selection.validators.includes(creator.address),false);assert.equal(new Set(selection.validators).size,COMPUTE_VALIDATOR_SET_SIZE);
 const expectedSeed=sha256(`${COMPUTE_VALIDATOR_SELECTION_VERSION}|korek-planck-testnet-1|${jobId}|${tipHash}|${entropy}`);assert.equal(selection.seed,expectedSeed);selection.validators.forEach(address=>assert.equal(registry.isAssigned(jobId,address),true));
});

test("exiting validator waits 24 hours and cannot withdraw while assigned",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),now=3_300_000_000_000,validators=Array.from({length:5},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>fundAndRegister(chain,registry,wallet,now+index));const jobId="12".repeat(32),selection=registry.select({jobId,creator:cryptoProvider.createWallet().address,tipHash:"34".repeat(32),entropy:"56".repeat(32)}),wallet=validators.find(item=>item.address===selection.validators[0]),exitFields={validator:wallet.address,addressScheme:"transparent-v1",timestamp:now+100},exiting=registry.requestExit(signed(wallet,validatorExitMessage(exitFields),exitFields),now+100);
 assert.equal(exiting.status,"exiting");assert.equal(exiting.unlockAt,now+100+COMPUTE_VALIDATOR_EXIT_DELAY_MS);
 const early={validator:wallet.address,addressScheme:"transparent-v1",timestamp:now+100+COMPUTE_VALIDATOR_EXIT_DELAY_MS-1};assert.throws(()=>registry.withdraw(signed(wallet,validatorWithdrawMessage(early),early),early.timestamp),/still locked/);
 const due={validator:wallet.address,addressScheme:"transparent-v1",timestamp:now+100+COMPUTE_VALIDATOR_EXIT_DELAY_MS};assert.throws(()=>registry.withdraw(signed(wallet,validatorWithdrawMessage(due),due),due.timestamp),/active compute assignments/);
 registry.finalizeJob(jobId,[],null);const before=BigInt(chain.balance(wallet.address)),withdrawn=registry.withdraw(signed(wallet,validatorWithdrawMessage(due),due),due.timestamp);assert.equal(withdrawn.status,"withdrawn");assert.equal(BigInt(chain.balance(wallet.address)),before+COMPUTE_VALIDATOR_MIN_STAKE);
});

test("proven fraud slashes 10%, credits treasury, jails an under-minimum validator and cannot slash twice",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),now=3_350_000_000_000,validators=Array.from({length:5},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>fundAndRegister(chain,registry,wallet,now+index));const jobId="44".repeat(32),selection=registry.select({jobId,creator:cryptoProvider.createWallet().address,tipHash:"55".repeat(32),entropy:"66".repeat(32)}),target=selection.validators[0],wallet=validators.find(item=>item.address===target),proofHash="77".repeat(32),treasuryBefore=BigInt(chain.balance(NETWORK.treasuryAddress)),receipts=registry.slashForFraud(jobId,[target],proofHash,now+100),expected=COMPUTE_VALIDATOR_MIN_STAKE*COMPUTE_VALIDATOR_FRAUD_SLASH_BPS/10_000n;
 assert.equal(receipts.length,1);assert.equal(BigInt(receipts[0].amount),expected);assert.equal(receipts[0].status,"jailed");assert.equal(BigInt(registry.validator(target).stake),COMPUTE_VALIDATOR_MIN_STAKE-expected);assert.equal(registry.validator(target).fraudProofs,1);assert.equal(BigInt(chain.balance(NETWORK.treasuryAddress)),treasuryBefore+expected);assert.equal(registry.stats().active,4);
 assert.deepEqual(registry.slashForFraud(jobId,[target],proofHash,now+101),[]);assert.equal(registry.validator(target).fraudProofs,1);
 const exitFields={validator:wallet.address,addressScheme:"transparent-v1",timestamp:now+102};assert.equal(registry.requestExit(signed(wallet,validatorExitMessage(exitFields),exitFields),now+102).status,"exiting");registry.finalizeJob(jobId,[],null);const due={validator:wallet.address,addressScheme:"transparent-v1",timestamp:now+102+COMPUTE_VALIDATOR_EXIT_DELAY_MS},before=BigInt(chain.balance(wallet.address)),withdrawn=registry.withdraw(signed(wallet,validatorWithdrawMessage(due),due),due.timestamp);assert.equal(BigInt(chain.balance(wallet.address)),before+BigInt(withdrawn.stake||0));
});

test("validator reputation records actual disagreements but not validators locked out after threshold",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),now=3_400_000_000_000,validators=Array.from({length:5},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>fundAndRegister(chain,registry,wallet,now+index));const jobId="78".repeat(32),selection=registry.select({jobId,creator:cryptoProvider.createWallet().address,tipHash:"9a".repeat(32),entropy:"bc".repeat(32)}),votes=[{verifier:selection.validators[0],approve:true},{verifier:selection.validators[1],approve:true},{verifier:selection.validators[2],approve:false}];registry.finalizeJob(jobId,votes,"accepted");
 const agree=registry.validator(selection.validators[0]),disagree=registry.validator(selection.validators[2]),noVote=registry.validator(selection.validators[4]);assert.equal(agree.completedVotes,1);assert.equal(agree.disagreementVotes,0);assert.equal(disagree.completedVotes,1);assert.equal(disagree.disagreementVotes,1);assert.equal(noVote.completedVotes,0);assert.equal(noVote.disagreementVotes,0);assert.equal(noVote.missedVotes,0);
});

test("registry snapshot preserves locked stake, slashing history and active assignments",()=>{
 const chain=new KorekChain(),registry=new ComputeValidatorRegistry(chain),now=3_500_000_000_000,validators=Array.from({length:5},()=>cryptoProvider.createWallet());validators.forEach((wallet,index)=>fundAndRegister(chain,registry,wallet,now+index));const jobId="de".repeat(32),selection=registry.select({jobId,creator:cryptoProvider.createWallet().address,tipHash:"ad".repeat(32),entropy:"be".repeat(32)});registry.slashForFraud(jobId,[selection.validators[0]],"fa".repeat(32),now+100);const restored=new ComputeValidatorRegistry(chain,registry.snapshot());assert.equal(restored.stats().active,4);assert.ok(BigInt(restored.stats().slashedStake)>0n);selection.validators.forEach(address=>assert.equal(restored.isAssigned(jobId,address),true));
});
