import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { KorekChain } from '../src/blockchain.js';
import { FundedFaucet } from '../src/funded-faucet.js';
import { cryptoProvider } from '../src/crypto.js';
import { createTemplate,powDigest,meetsDifficulty,miningSubmissionMessage } from '../src/mining-protocol.js';

function fixture(options){
 const chain=new KorekChain(),wallet=cryptoProvider.createWallet(),faucet=new FundedFaucet(wallet,options);
 const template=createTemplate({...chain.miningTemplateData(faucet.address),publicKey:wallet.publicKey});
 let nonce=0,powHash;do{powHash=powDigest(template.challenge,nonce++);}while(!meetsDifficulty(powHash,template.difficulty));
 const input={templateId:template.templateId,nonce:nonce-1,powHash,timestamp:template.notBefore,publicKey:wallet.publicKey};
 input.signature=cryptoProvider.sign(miningSubmissionMessage(input),wallet.privateKey);chain.acceptClientProof(template,input);
 return {chain,wallet,faucet};
}
test('funded faucet preserves supply, passes peer replay and persists cooldown',()=>{
 const {chain,wallet,faucet}=fixture(),to=cryptoProvider.createWallet().address;
 const supply=chain.minedSupply;faucet.claim(chain,to);chain.sealPending();
 const restored=KorekChain.fromSnapshot(chain.snapshot(),{peer:true});
 assert.equal(restored.minedSupply,supply);assert.equal(restored.testnetFaucetSupply,0n);
 assert.equal(restored.balance(to),'100000000');
 assert.throws(()=>new FundedFaucet(wallet).claim(restored,to),/cooldown/);
});
test('pending claims reserve cooldown and daily budget including fees',()=>{
 const {chain,wallet,faucet}=fixture({dailyBudget:100_021_000n});
 const to=cryptoProvider.createWallet().address;faucet.claim(chain,to);
 assert.throws(()=>faucet.claim(chain,to),/cooldown/);
 assert.throws(()=>new FundedFaucet(wallet,{dailyBudget:100_021_000n}).claim(chain,cryptoProvider.createWallet().address),/budget/);
});
test('unfunded and self payouts fail without creating coins',()=>{
 const chain=new KorekChain(),faucet=new FundedFaucet(cryptoProvider.createWallet());
 assert.throws(()=>faucet.claim(chain,cryptoProvider.createWallet().address),/Insufficient/);
 assert.throws(()=>faucet.claim(chain,faucet.address),/recipient/);
 assert.equal(chain.pending.length,0);assert.equal(chain.testnetFaucetSupply,0n);
});
test('fresh network has a different genesis and rejects old snapshots',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {KorekChain} from './src/blockchain.js'; const old=JSON.parse(process.argv[1]); const chain=new KorekChain(); if(chain.chain[0].hash===old.chain[0].hash)process.exit(2); try{KorekChain.fromSnapshot(old);process.exit(3)}catch{};`,JSON.stringify(new KorekChain().snapshot())],{env:{...process.env,KOREK_NETWORK_ID:'korek-planck-testnet-2'}});
 assert.equal(result.status,0,result.stderr.toString());
});
