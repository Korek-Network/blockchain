import { randomBytes } from "node:crypto";
import { addressFromPublicKey,cryptoProvider,sha256 } from "./crypto.js";
import { NETWORK } from "./config.js";

export const COMPUTE_VALIDATOR_MIN_STAKE=10_000n*100_000_000n;
export const COMPUTE_VALIDATOR_SET_SIZE=5;
export const COMPUTE_VALIDATOR_THRESHOLD=3;
export const COMPUTE_VALIDATOR_EXIT_DELAY_MS=24*60*60*1000;
export const COMPUTE_VALIDATOR_SELECTION_VERSION="korek-compute-validator-selection/1";

const addressPattern=/^krk1[0-9a-f]{40}$/;
const schemes=new Set(["transparent-v1","wormhole-v1"]);
const assertAddress=value=>{if(!addressPattern.test(String(value||"")))throw new Error("Invalid KOREK address")};
const assertScheme=value=>{if(!schemes.has(value))throw new Error("Unsupported address scheme")};
const assertFresh=(timestamp,now)=>{if(!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp)>5*60*1000)throw new Error("Validator request timestamp is outside the allowed clock window")};
const assertSignedBy=(input,address,scheme,message)=>{assertAddress(address);assertScheme(scheme);if(addressFromPublicKey(input.publicKey,scheme)!==address)throw new Error("Public key mismatch");if(!cryptoProvider.verify(message,input.signature,input.publicKey))throw new Error("Invalid signature")};
const credit=(chain,address,amount)=>chain.balances.set(address,(chain.balances.get(address)||0n)+amount);
const debit=(chain,address,amount)=>chain.balances.set(address,(chain.balances.get(address)||0n)-amount);
const reservedTransfers=(chain,address)=>chain.pending.filter(tx=>tx.from===address).reduce((sum,tx)=>sum+BigInt(tx.amount)+BigInt(tx.fee),0n);
const availableBalance=(chain,address)=>(chain.balances.get(address)||0n)-reservedTransfers(chain,address);

export const validatorRegisterMessage=input=>["compute-validator-register-v1",NETWORK.networkId,input.validator,input.addressScheme||"transparent-v1",String(input.stake),String(input.timestamp)].join("|");
export const validatorExitMessage=input=>["compute-validator-exit-v1",NETWORK.networkId,input.validator,input.addressScheme||"transparent-v1",String(input.timestamp)].join("|");
export const validatorWithdrawMessage=input=>["compute-validator-withdraw-v1",NETWORK.networkId,input.validator,input.addressScheme||"transparent-v1",String(input.timestamp)].join("|");

const publicValidator=entry=>({validator:entry.validator,status:entry.status,stake:entry.stake,registeredAt:entry.registeredAt,exitRequestedAt:entry.exitRequestedAt||null,unlockAt:entry.unlockAt||null,assignedJobs:[...entry.assignedJobs],completedVotes:entry.completedVotes||0,disagreementVotes:entry.disagreementVotes||0,missedVotes:entry.missedVotes||0});

export class ComputeValidatorRegistry{
 constructor(chain,state=null){this.chain=chain;this.validators=new Map();if(state)this.restore(state)}
 register(input,now=Date.now()){
  const validator=String(input.validator||"").toLowerCase(),addressScheme=String(input.addressScheme||"transparent-v1"),timestamp=Number(input.timestamp),stake=BigInt(input.stake);
  assertFresh(timestamp,now);assertAddress(validator);assertScheme(addressScheme);if(stake<COMPUTE_VALIDATOR_MIN_STAKE)throw new Error("Compute validator stake must be at least 10,000 KRK");if(this.validators.has(validator))throw new Error("Validator is already registered");
  const canonical={...input,validator,addressScheme,timestamp,stake:stake.toString()};assertSignedBy(input,validator,addressScheme,validatorRegisterMessage(canonical));if(availableBalance(this.chain,validator)<stake)throw new Error("Insufficient available balance for validator stake");
  debit(this.chain,validator,stake);const entry={validator,addressScheme,stake:stake.toString(),status:"active",registeredAt:now,publicKey:input.publicKey,signature:input.signature,assignedJobs:new Set(),completedVotes:0,disagreementVotes:0,missedVotes:0};this.validators.set(validator,entry);return publicValidator(entry);
 }
 requestExit(input,now=Date.now()){
  const validator=String(input.validator||"").toLowerCase(),entry=this.require(validator),addressScheme=String(input.addressScheme||entry.addressScheme),timestamp=Number(input.timestamp);assertFresh(timestamp,now);if(entry.status!=="active")throw new Error("Validator is not active");const canonical={...input,validator,addressScheme,timestamp};assertSignedBy(input,validator,addressScheme,validatorExitMessage(canonical));entry.status="exiting";entry.exitRequestedAt=now;entry.unlockAt=now+COMPUTE_VALIDATOR_EXIT_DELAY_MS;return publicValidator(entry);
 }
 withdraw(input,now=Date.now()){
  const validator=String(input.validator||"").toLowerCase(),entry=this.require(validator),addressScheme=String(input.addressScheme||entry.addressScheme),timestamp=Number(input.timestamp);assertFresh(timestamp,now);if(entry.status!=="exiting")throw new Error("Validator has not requested exit");if(now<entry.unlockAt)throw new Error("Validator stake is still locked");if(entry.assignedJobs.size)throw new Error("Validator still has active compute assignments");const canonical={...input,validator,addressScheme,timestamp};assertSignedBy(input,validator,addressScheme,validatorWithdrawMessage(canonical));const stake=BigInt(entry.stake);credit(this.chain,validator,stake);entry.status="withdrawn";entry.withdrawnAt=now;entry.stake="0";return publicValidator(entry);
 }
 eligible({exclude=[]}={}){const blocked=new Set(exclude.map(value=>String(value||"").toLowerCase()));return[...this.validators.values()].filter(entry=>entry.status==="active"&&BigInt(entry.stake)>=COMPUTE_VALIDATOR_MIN_STAKE&&!blocked.has(entry.validator))}
 select({jobId,creator,tipHash,entropy=null,count=COMPUTE_VALIDATOR_SET_SIZE}){
  const eligible=this.eligible({exclude:[creator]});if(eligible.length<count)throw new Error(`At least ${count} active staked validators are required before creating a compute job`);const beacon=entropy||randomBytes(32).toString("hex"),seed=sha256(`${COMPUTE_VALIDATOR_SELECTION_VERSION}|${NETWORK.networkId}|${jobId}|${tipHash}|${beacon}`),ranked=eligible.map(entry=>({entry,score:sha256(`${seed}|${entry.validator}`)})).sort((a,b)=>a.score.localeCompare(b.score)||a.entry.validator.localeCompare(b.entry.validator)),selected=ranked.slice(0,count).map(item=>item.entry.validator);
  selected.forEach(address=>this.validators.get(address).assignedJobs.add(jobId));return{version:COMPUTE_VALIDATOR_SELECTION_VERSION,beacon,seed,tipHash,validators:selected,threshold:COMPUTE_VALIDATOR_THRESHOLD};
 }
 isAssigned(jobId,validator){return this.validators.get(String(validator||"").toLowerCase())?.assignedJobs.has(jobId)||false}
 finalizeJob(jobId,votes=[],outcome=null){
  const byAddress=new Map((votes||[]).map(vote=>[String(vote.verifier||"").toLowerCase(),vote]));for(const entry of this.validators.values()){if(!entry.assignedJobs.has(jobId))continue;const vote=byAddress.get(entry.validator);if(outcome&&vote){entry.completedVotes++;const agrees=outcome==="accepted"?Boolean(vote.approve):!Boolean(vote.approve);if(!agrees)entry.disagreementVotes++}entry.assignedJobs.delete(jobId)}
 }
 require(address){const entry=this.validators.get(String(address||"").toLowerCase());if(!entry)throw new Error("Compute validator is not registered");return entry}
 validator(address){return publicValidator(this.require(address))}
 list({status=null,limit=100}={}){const capped=Math.max(1,Math.min(500,Number(limit)||100));return[...this.validators.values()].filter(entry=>!status||entry.status===status).sort((a,b)=>a.registeredAt-b.registeredAt).slice(0,capped).map(publicValidator)}
 stats(){const entries=[...this.validators.values()],active=entries.filter(entry=>entry.status==="active"),locked=entries.reduce((sum,entry)=>sum+BigInt(entry.stake||0),0n);return{minStake:COMPUTE_VALIDATOR_MIN_STAKE.toString(),setSize:COMPUTE_VALIDATOR_SET_SIZE,threshold:COMPUTE_VALIDATOR_THRESHOLD,exitDelayMs:COMPUTE_VALIDATOR_EXIT_DELAY_MS,registered:entries.length,active:active.length,lockedStake:locked.toString()}}
 snapshot(){return{version:1,networkId:NETWORK.networkId,validators:[...this.validators.values()].map(entry=>({...entry,assignedJobs:[...entry.assignedJobs]}))}}
 restore(state){if(state?.version!==1||state.networkId!==NETWORK.networkId||!Array.isArray(state.validators))throw new Error("Unsupported compute validator registry state");this.validators=new Map(state.validators.map(entry=>[String(entry.validator).toLowerCase(),{...entry,validator:String(entry.validator).toLowerCase(),assignedJobs:new Set(entry.assignedJobs||[])}]))}
}
