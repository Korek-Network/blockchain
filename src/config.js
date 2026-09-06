export const NETWORK=Object.freeze({
 name:"KOREK",symbol:"KRK",networkId:"korek-planck-testnet-1",decimals:8,
 maxSupply:365_000_000n*100_000_000n,miningAllocation:292_000_000n*100_000_000n,
 aiEcosystemAllocation:36_500_000n*100_000_000n,developmentAllocation:18_250_000n*100_000_000n,
 securityCommunityAllocation:18_250_000n*100_000_000n,initialReward:115_740_740n,
 halvingInterval:126_144_000,rewardBlockTimeMs:Number(process.env.KOREK_BLOCK_TIME_MS||1_000),
 finalityTargetMs:200,difficulty:Number(process.env.KOREK_DIFFICULTY||3),finalityMode:"rapid-testnet",
 nodeMinerAddress:process.env.KOREK_BLOCK_PRODUCER||`krk1${"0".repeat(40)}`,apiPort:Number(process.env.KOREK_PORT||8365),
});
export function rewardAtHeight(height){const halvings=Math.floor(height/NETWORK.halvingInterval);return halvings>=64?0n:NETWORK.initialReward>>BigInt(halvings)}
