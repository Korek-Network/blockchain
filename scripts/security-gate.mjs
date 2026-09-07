// Read-only local model check. No live endpoint or funds are touched.
import { KorekChain } from "../src/blockchain.js";
import { cryptoProvider } from "../src/crypto.js";
import { chainSelection } from "../src/chain-selection.js";
const chain=new KorekChain(),owner=cryptoProvider.createWallet(),other=cryptoProvider.createWallet();
chain.claimFaucet(owner.address);
chain.mine(owner.address,undefined,Date.now(),{difficulty:0,rewardEnabled:false});
const state=structuredClone(chain.snapshot());
state.balances=[[other.address,state.balances[0][1]]];
let substitutedBalanceAccepted=false;
try{substitutedBalanceAccepted=chainSelection(new KorekChain(),KorekChain.fromSnapshot(state,{peer:true})).adopt;}catch{}
console.log(JSON.stringify({gate:"hostile-network-ledger-validation",passed:!substitutedBalanceAccepted,
 substitutedBalanceAccepted,liveNetworkTouched:false,
 next:"Specify replayable faucet/issuance history and enforce per-account state reconstruction before a network release"},null,2));
if(substitutedBalanceAccepted)process.exitCode=1;
