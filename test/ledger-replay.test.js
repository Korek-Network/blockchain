import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain,hashBlock } from "../src/blockchain.js";
import { cryptoProvider,addressFromPublicKey } from "../src/crypto.js";
import { createTemplate,powDigest,meetsDifficulty,miningSubmissionMessage } from "../src/mining-protocol.js";

const wallet=()=>{const w=cryptoProvider.createWallet();return {...w,address:addressFromPublicKey(w.publicKey,"wormhole-v1")};};
function fund(chain,owner){const template=createTemplate({...chain.miningTemplateData(owner.address),publicKey:owner.publicKey});let nonce=0,powHash;
 do{powHash=powDigest(template.challenge,nonce++);}while(!meetsDifficulty(powHash,template.difficulty));
 const input={templateId:template.templateId,nonce:nonce-1,powHash,timestamp:template.notBefore,publicKey:owner.publicKey};
 input.signature=cryptoProvider.sign(miningSubmissionMessage(input),owner.privateKey);return chain.acceptClientProof(template,input);}
function fixture(){const chain=new KorekChain(),sender=wallet(),receiver=wallet();fund(chain,sender);return {chain,sender,receiver};}
function send(chain,sender,receiver,amount="1",timestamp=Date.now()){
 const gasPrice="1",gasLimit="21000",addressScheme="wormhole-v1",message=`${sender.address}|${receiver.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}|${addressScheme}`;
 chain.addTransaction({version:3,from:sender.address,to:receiver.address,amount,timestamp,gasPrice,gasLimit,addressScheme,publicKey:sender.publicKey,signature:cryptoProvider.sign(message,sender.privateKey)});chain.sealPending();}
test("PoW-funded transfers, self-transfers, fees and later payouts replay exactly",()=>{
 const {chain,sender,receiver}=fixture();send(chain,sender,receiver,"100000");send(chain,sender,sender,"1",Date.now()+1);fund(chain,receiver);
 assert.deepEqual(KorekChain.fromSnapshot(chain.snapshot(),{peer:true}).snapshot(),chain.snapshot());
});
test("redistributing balances without changing total supply is rejected",()=>{
 const {chain,sender,receiver}=fixture();send(chain,sender,receiver);const state=structuredClone(chain.snapshot());
 state.balances.find(x=>x[0]===sender.address)[1]=(BigInt(chain.balance(sender.address))-1n).toString();
 state.balances.find(x=>x[0]===receiver.address)[1]="2";
 assert.throws(()=>KorekChain.fromSnapshot(state,{peer:true}),/replay: balance mismatch/);
});
test("an account cannot spend coins before it receives them in history",()=>{
 const {chain,sender,receiver}=fixture();chain.balances.set(receiver.address,100000n);send(chain,receiver,sender);
 const state=chain.snapshot();state.balances=[];
 assert.throws(()=>KorekChain.fromSnapshot(state,{peer:true}),/replay: insufficient balance/);
});
test("faucet history is offline-only, even when its claimed balances are honest",()=>{
 const chain=new KorekChain();chain.claimFaucet(wallet().address);assert.doesNotThrow(()=>KorekChain.fromSnapshot(chain.snapshot()));
 assert.throws(()=>KorekChain.fromSnapshot(chain.snapshot(),{peer:true}),/faucet history/);
});
test("removing faucet labels cannot smuggle unearned balances into peer state",()=>{
 const chain=new KorekChain();chain.claimFaucet(wallet().address);const state=chain.snapshot();state.testnetFaucetSupply="0";state.faucetClaims=[];
 assert.throws(()=>KorekChain.fromSnapshot(state,{peer:true}),/balances|replay/);
});
test("a forged zero-work transfer chain cannot legitimize off-chain funding",()=>{
 const {chain,sender,receiver}=fixture();send(chain,sender,receiver);const state=structuredClone(chain.snapshot());
 // The signed transaction remains valid, but its funding proof is removed.
 state.chain.splice(1,1);state.chain[1].height=1;state.chain[1].previousHash=state.chain[0].hash;
 state.chain[1].transactions[0].blockHeight=1;state.chain[1].hash=hashBlock(state.chain[1]);
 state.minedSupply="0";state.rewardBlockCount=0;state.balances=[];
 assert.throws(()=>KorekChain.fromSnapshot(state,{peer:true}),/replay: insufficient balance/);
});
