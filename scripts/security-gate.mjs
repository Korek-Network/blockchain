// Read-only local model check. No live endpoint or funds are touched.
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { chainSelection } from "../src/chain-selection.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const chain=new KorekChain(),owner=cryptoProvider.createWallet(),other=cryptoProvider.createWallet();
chain.claimFaucet(owner.address);
chain.mine(owner.address,undefined,Date.now(),{difficulty:0,rewardEnabled:false});
const state=structuredClone(chain.snapshot());
state.balances=[[other.address,state.balances[0][1]]];
let substitutedBalanceAccepted=false;
try{substitutedBalanceAccepted=chainSelection(new KorekChain(),KorekChain.fromSnapshot(state,{peer:true})).adopt;}catch{}
const replay=spawnSync(process.execPath,["--test",fileURLToPath(new URL("../test/ledger-replay.test.js",import.meta.url))],{env:{...process.env,KOREK_DIFFICULTY:"3"},stdio:"inherit"});
console.log(JSON.stringify({gate:"hostile-network-ledger-validation",passed:!substitutedBalanceAccepted&&replay.status===0,
 substitutedBalanceAccepted,liveNetworkTouched:false,
 replaySuitePassed:replay.status===0,next:"Independent review and coordinated PoW-funded testnet migration; no release approval implied"},null,2));
if(substitutedBalanceAccepted||replay.status!==0)process.exitCode=1;
