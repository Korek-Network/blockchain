import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { KorekChain } from '../src/blockchain.js';
import { NETWORK } from '../src/config.js';
import { FundedFaucet } from '../src/funded-faucet.js';
import { cryptoProvider } from '../src/crypto.js';

test('v4 rejects wrong networks and relabelled signatures',()=>{
 const chain=new KorekChain(),faucet=new FundedFaucet(cryptoProvider.createWallet());
 chain.claimFaucet(faucet.address);
 const tx=faucet.claim(chain,cryptoProvider.createWallet().address);
 const target=new KorekChain();target.claimFaucet(faucet.address);
 assert.throws(()=>target.addTransaction({...tx,networkId:'korek-other-network'}),/Network-bound/);
 const fake={...tx,networkId:'korek-other-network'};
 fake.signature=cryptoProvider.sign(`korek-transfer-v4|${fake.networkId}|${fake.from}|${fake.to}|${fake.amount}|${fake.timestamp}|1|21000|wormhole-v1`,faucet.wallet.privateKey);
 assert.throws(()=>target.addTransaction({...fake,networkId:NETWORK.networkId}),/signature/);
 chain.sealPending();const snapshot=chain.snapshot();snapshot.chain[1].transactions[0].networkId='korek-other-network';
 assert.throws(()=>KorekChain.fromSnapshot(snapshot));
});
test('fresh network rejects legacy transfers even with valid signatures',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`
 import {KorekChain} from './src/blockchain.js';import {cryptoProvider} from './src/crypto.js';
 const chain=new KorekChain(),w=cryptoProvider.createWallet(),to=cryptoProvider.createWallet().address,timestamp=Date.now();chain.claimFaucet(w.address);
 const tx={version:3,from:w.address,to,amount:'1',timestamp,gasPrice:'1',gasLimit:'21000',addressScheme:'transparent-v1',publicKey:w.publicKey};
 tx.signature=cryptoProvider.sign(tx.from+'|'+to+'|1|'+timestamp+'|1|21000|transparent-v1',w.privateKey);
 try{chain.addTransaction(tx);process.exit(2)}catch(error){if(!error.message.includes('Network-bound'))throw error}
 `],{env:{...process.env,KOREK_NETWORK_ID:'korek-planck-testnet-2'}});
 assert.equal(result.status,0,result.stderr.toString());
});
