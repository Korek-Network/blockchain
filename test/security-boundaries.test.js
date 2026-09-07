import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain,hashBlock } from "../src/blockchain.js";
import { cryptoProvider,sha256 } from "../src/crypto.js";

function transfer(chain,{gasPrice="1",gasLimit="21000",amount="1",timestamp=Date.now()}={}) {
  const sender=cryptoProvider.createWallet(),receiver=cryptoProvider.createWallet();
  chain.claimFaucet(sender.address);
  const message=`${sender.address}|${receiver.address}|${amount}|${timestamp}|${gasPrice}|${gasLimit}`;
  return {version:2,from:sender.address,to:receiver.address,amount,timestamp,gasPrice,gasLimit,
    publicKey:sender.publicKey,signature:cryptoProvider.sign(message,sender.privateKey),id:sha256(message+cryptoProvider.sign(message,sender.privateKey))};
}
test("peer validation refuses legacy reward blocks without a client proof",()=>{
  const chain=new KorekChain();chain.mine(`krk1${"ab".repeat(20)}`,undefined,Date.now(),{difficulty:0});
  assert.doesNotThrow(()=>KorekChain.fromSnapshot(chain.snapshot())); // Local historical compatibility only.
  assert.throws(()=>KorekChain.fromSnapshot(chain.snapshot(),{peer:true}),/client proof/);
});
test("a self-consistent foreign genesis cannot be loaded",()=>{
  const state=new KorekChain().snapshot();state.chain[0].timestamp++;state.chain[0].hash=hashBlock(state.chain[0]);
  assert.throws(()=>KorekChain.fromSnapshot(state),/genesis/);
});
test("stored signed negative or undersized gas fields are rejected",()=>{
  for(const options of [{gasPrice:"-1"},{gasPrice:"0"},{gasLimit:"1"}]) {
    const chain=new KorekChain(),input=transfer(chain,options);
    const state=chain.snapshot();state.pending=[{...input,addressScheme:"transparent-v1",gasUsed:"21000",
      fee:(21000n*BigInt(input.gasPrice)).toString(),receivedAt:input.timestamp,status:"pending",
      blockHeight:null,transactionIndex:null,confirmedAt:null}];
    assert.throws(()=>KorekChain.fromSnapshot(state),/transaction fields/);
  }
});
test("pending reservations are checked against persisted spendable balances",()=>{
  const chain=new KorekChain(),input=transfer(chain);chain.addTransaction(input);
  const state=structuredClone(chain.snapshot());state.balances[0][1]="1";
  assert.throws(()=>KorekChain.fromSnapshot(state),/pending balance/);
});
