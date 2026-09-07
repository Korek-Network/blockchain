import { addressFromPublicKey, cryptoProvider } from './crypto.js';
import { NETWORK } from './config.js';

// One dedicated wallet per faucet. Limits are reconstructed from selected history
// and pending transfers, so a process restart cannot reset them.
export class FundedFaucet {
 constructor(wallet,{amount=100_000_000n,dailyBudget=100_000_000_000n,cooldownMs=86_400_000}={}) {
  if(typeof amount!== 'bigint'||amount<=0n||typeof dailyBudget!=='bigint'||dailyBudget<amount||!Number.isSafeInteger(cooldownMs)||cooldownMs<1)throw new Error('Invalid faucet limits');
  this.wallet=wallet;this.address=addressFromPublicKey(wallet.publicKey,'wormhole-v1');
  const proof=cryptoProvider.sign('korek-faucet-key-check',wallet.privateKey);
  if(!cryptoProvider.verify('korek-faucet-key-check',proof,wallet.publicKey))throw new Error('Faucet key mismatch');
  this.amount=amount;this.dailyBudget=dailyBudget;this.cooldownMs=cooldownMs;
 }
 claim(chain,address,now=Date.now()) {
  if(!/^krk1[0-9a-f]{40}$/.test(address)||address===this.address)throw new Error('Invalid faucet recipient');
  const outgoing=[...chain.chain.flatMap(block=>block.transactions),...chain.pending].filter(tx=>tx.from===this.address);
  if(outgoing.some(tx=>tx.to===address&&tx.timestamp>now-this.cooldownMs))throw new Error('Faucet cooldown active');
  const spent=outgoing.filter(tx=>tx.timestamp>now-86_400_000).reduce((sum,tx)=>sum+BigInt(tx.amount)+BigInt(tx.fee),0n);
  const fee=21_000n;
  if(spent+this.amount+fee>this.dailyBudget)throw new Error('Faucet daily budget exhausted');
  const input={version:4,networkId:NETWORK.networkId,from:this.address,to:address,amount:this.amount.toString(),timestamp:now,gasPrice:'1',gasLimit:'21000',addressScheme:'wormhole-v1',publicKey:this.wallet.publicKey};
  input.signature=cryptoProvider.sign(`korek-transfer-v4|${input.networkId}|${input.from}|${input.to}|${input.amount}|${now}|1|21000|wormhole-v1`,this.wallet.privateKey);
  return chain.addTransaction(input,now);
 }
}
