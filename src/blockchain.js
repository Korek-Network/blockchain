import { NETWORK, rewardAtHeight } from "./config.js";
import { cryptoProvider, sha256 } from "./crypto.js";

export const GAS = Object.freeze({ transferLimit: 21_000n, price: 1n });
const hashBlock = (block) => sha256(JSON.stringify({
  height:block.height,rewardHeight:block.rewardHeight,previousHash:block.previousHash,timestamp:block.timestamp,transactions:block.transactions,
  miner:block.miner,usefulWork:block.usefulWork,reward:block.reward,gasUsed:block.gasUsed,fees:block.fees,nonce:block.nonce,
}));

export class KorekChain {
  constructor() {
    this.pending=[];this.balances=new Map();this.minedSupply=0n;this.testnetFaucetSupply=0n;this.rewardBlockCount=0;
    this.faucetClaims=new Map();this.chain=[this.genesis()];
  }

  genesis() {
    const block={height:0,rewardHeight:null,previousHash:"0".repeat(64),timestamp:1735689600000,transactions:[],miner:"genesis",
      usefulWork:{type:"genesis",score:0},reward:"0",gasUsed:"0",fees:"0",nonce:0};
    return {...block,hash:hashBlock(block)};
  }

  addTransaction(input, receivedAt=Date.now()) {
    const required=["from","to","amount","publicKey","signature","timestamp"];
    if(!required.every(key=>input[key]!==undefined)) throw new Error("Incomplete transaction");
    if(!/^krk1[0-9a-f]{40}$/.test(input.to)||BigInt(input.amount)<=0n) throw new Error("Invalid transfer");
    const version=Number(input.version||1); const gasPrice=version>=2?BigInt(input.gasPrice):0n;
    const gasLimit=version>=2?BigInt(input.gasLimit):0n;
    if(version>=2&&(gasPrice<GAS.price||gasLimit<GAS.transferLimit)) throw new Error("Gas price or gas limit is too low");
    const gasUsed=version>=2?GAS.transferLimit:0n; const fee=gasUsed*gasPrice;
    const message=version>=2?`${input.from}|${input.to}|${input.amount}|${input.timestamp}|${gasPrice}|${gasLimit}`:
      `${input.from}|${input.to}|${input.amount}|${input.timestamp}`;
    if(`krk1${sha256(input.publicKey).slice(0,40)}`!==input.from) throw new Error("Public key mismatch");
    if(!cryptoProvider.verify(message,input.signature,input.publicKey)) throw new Error("Invalid signature");
    const reserved=this.pending.filter(tx=>tx.from===input.from).reduce((sum,tx)=>sum+BigInt(tx.amount)+BigInt(tx.fee),0n);
    if((this.balances.get(input.from)||0n)-reserved<BigInt(input.amount)+fee) throw new Error("Insufficient balance for amount and network fee");
    const tx={...input,version,gasPrice:gasPrice.toString(),gasLimit:gasLimit.toString(),gasUsed:gasUsed.toString(),fee:fee.toString(),
      sentAt:Number(input.timestamp),receivedAt,status:"pending",blockHeight:null,transactionIndex:null,confirmedAt:null};
    tx.id=sha256(message+input.signature); this.pending.push(tx); return tx;
  }

  mine(miner,usefulWork={type:"benchmark",score:0},now=Date.now(),options={}) {
    if(!/^krk1[0-9a-f]{40}$/.test(miner)) throw new Error("Invalid miner address");
    const height=this.chain.length;const rewardEnabled=options.rewardEnabled!==false;const difficulty=options.difficulty??NETWORK.difficulty;
    const scheduledReward=rewardAtHeight(this.rewardBlockCount);const miningRemaining=NETWORK.miningAllocation-this.minedSupply;
    const reward=!rewardEnabled||miningRemaining<=0n?0n:[scheduledReward,miningRemaining].reduce((a,b)=>a<b?a:b);
    const transactions=this.pending.splice(0); let fees=0n; let gasUsed=0n;
    transactions.forEach((tx,index)=>{tx.status="confirmed";tx.blockHeight=height;tx.transactionIndex=index;tx.confirmedAt=now;
      tx.confirmationTimeMs=Math.max(0,now-tx.receivedAt);fees+=BigInt(tx.fee);gasUsed+=BigInt(tx.gasUsed)});
    const block={height,rewardHeight:rewardEnabled?this.rewardBlockCount:null,previousHash:this.chain.at(-1).hash,timestamp:now,transactions,miner,usefulWork,reward:reward.toString(),
      gasUsed:gasUsed.toString(),fees:fees.toString(),nonce:0};
    const target="0".repeat(difficulty);
    do{block.nonce++;block.hash=hashBlock(block)}while(!block.hash.startsWith(target));
    for(const tx of transactions){this.balances.set(tx.from,(this.balances.get(tx.from)||0n)-BigInt(tx.amount)-BigInt(tx.fee));
      this.balances.set(tx.to,(this.balances.get(tx.to)||0n)+BigInt(tx.amount))}
    this.balances.set(miner,(this.balances.get(miner)||0n)+reward+fees);this.minedSupply+=reward;
    if(rewardEnabled)this.rewardBlockCount++;this.chain.push(block);return block;
  }

  sealPending(now=Date.now()) {
    if(this.pending.length===0)return null;
    return this.mine(NETWORK.nodeMinerAddress,{type:"rapid-testnet-finality",score:1},now,{difficulty:0,rewardEnabled:false});
  }

  balance(address){return(this.balances.get(address)||0n).toString()}
  transactions(limit=50){return[...this.pending].reverse().concat(this.chain.slice(1).reverse().flatMap(block=>[...block.transactions].reverse())).slice(0,limit)}
  transaction(id){const tx=this.pending.find(item=>item.id===id)||this.chain.flatMap(block=>block.transactions).find(item=>item.id===id);if(!tx)return null;
    return{...tx,confirmations:tx.blockHeight===null?0:this.chain.length-tx.blockHeight}}
  block(id){const block=/^\d+$/.test(String(id))?this.chain[Number(id)]:this.chain.find(item=>item.hash===id);if(!block)return null;
    return{...block,confirmations:this.chain.length-block.height,sizeBytes:Buffer.byteLength(JSON.stringify(block))}}

  claimFaucet(address,amount=100n*100_000_000n,now=Date.now()) {
    if(!/^krk1[0-9a-f]{40}$/.test(address)) throw new Error("Invalid KOREK address");
    const cooldownMs=60*60*1000;const previousClaim=this.faucetClaims.get(address)||0;
    if(now-previousClaim<cooldownMs){const minutes=Math.max(1,Math.ceil((cooldownMs-(now-previousClaim))/60_000));throw new Error(`Faucet cooldown active. Try again in ${minutes} minute${minutes===1?"":"s"}`)}
    if(amount<=0n) throw new Error("Faucet amount unavailable");
    this.balances.set(address,(this.balances.get(address)||0n)+amount);this.testnetFaucetSupply+=amount;this.faucetClaims.set(address,now);
    return{address,amount:amount.toString(),balance:this.balance(address),network:NETWORK.networkId,claimedAt:now,nextClaimAt:now+cooldownMs};
  }

  status(){return{...NETWORK,maxSupply:NETWORK.maxSupply.toString(),miningAllocation:NETWORK.miningAllocation.toString(),
    aiEcosystemAllocation:NETWORK.aiEcosystemAllocation.toString(),developmentAllocation:NETWORK.developmentAllocation.toString(),
    securityCommunityAllocation:NETWORK.securityCommunityAllocation.toString(),minedSupply:this.minedSupply.toString(),issued:this.minedSupply.toString(),
    testnetFaucetSupply:this.testnetFaucetSupply.toString(),rewardBlockCount:this.rewardBlockCount,height:this.chain.length-1,pending:this.pending.length,
    transactions:this.chain.reduce((sum,block)=>sum+block.transactions.length,0),gasPrice:GAS.price.toString(),transferGas:GAS.transferLimit.toString(),crypto:cryptoProvider.algorithm}}
}
