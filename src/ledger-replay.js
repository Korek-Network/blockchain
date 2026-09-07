// Peer state is reconstructed from genesis. Historical off-chain faucet and
// compute accounting is intentionally ineligible for network consensus.
export function validatePeerLedger(state) {
 if(BigInt(state.testnetFaucetSupply||0)!==0n||!Array.isArray(state.faucetClaims)||state.faucetClaims.length)
  throw new Error("Peer faucet history is unverifiable; use a fresh PoW-funded network");
 const balances=new Map(),credit=(address,value)=>balances.set(address,(balances.get(address)||0n)+value);
 for(const block of state.chain.slice(1)){
  for(const tx of block.transactions){
   const amount=BigInt(tx.amount),cost=amount+BigInt(tx.fee),available=balances.get(tx.from)||0n;
   if(available<cost)throw new Error("Peer ledger replay: insufficient balance");
   credit(tx.from,-cost);credit(tx.to,amount);
  }
  if(block.workProof){credit(block.miner,BigInt(block.minerReward)+BigInt(block.feePayout));credit(block.treasuryAddress,BigInt(block.treasuryReward));}
 }
 const claimed=new Map(state.balances.map(([address,value])=>[address,BigInt(value)]));
 for(const address of new Set([...claimed.keys(),...balances.keys()]))
  if((claimed.get(address)||0n)!==(balances.get(address)||0n))throw new Error("Peer ledger replay: balance mismatch");
 return balances;
}
