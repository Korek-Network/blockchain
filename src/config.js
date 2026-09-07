export const NETWORK=Object.freeze({
 name:"KOREK",symbol:"KRK",networkId:process.env.KOREK_NETWORK_ID||"korek-planck-testnet-1",decimals:8,
 maxSupply:210_000_000n*100_000_000n,miningAllocation:210_000_000n*100_000_000n,
 genesisPremine:0n,minerShareBps:9_500n,treasuryShareBps:500n,
 treasuryAddress:"krk1d1ee0261919684cf511b9bd702697b5c4816c61e",
 initialReward:50n*100_000_000n,halvingInterval:2_100_000,
 rewardBlockTimeMs:Number(process.env.KOREK_BLOCK_TIME_MS||60_000),
 finalityTargetMs:null,localInclusionTargetMs:200,difficulty:Number(process.env.KOREK_DIFFICULTY||7),finalityMode:"not-guaranteed",
 nodeMinerAddress:process.env.KOREK_BLOCK_PRODUCER||`krk1${"0".repeat(40)}`,apiPort:Number(process.env.KOREK_PORT||8365),
});
export function rewardAtHeight(height){const halvings=Math.floor(height/NETWORK.halvingInterval);return halvings>=64?0n:NETWORK.initialReward>>BigInt(halvings)}
export function splitSubsidy(subsidy){const treasury=subsidy*NETWORK.treasuryShareBps/10_000n;return{miner:subsidy-treasury,treasury}}
