const arg=(name)=>{const prefix=`--${name}=`;const inline=process.argv.find(x=>x.startsWith(prefix));if(inline)return inline.slice(prefix.length);const at=process.argv.indexOf(`--${name}`);return at>=0?process.argv[at+1]:undefined};
const base=new URL(arg("node-url")||process.env.KOREK_NODE_URL||"http://127.0.0.1:8365").origin;
const innerHash=(arg("rewards-inner-hash")||process.env.KOREK_REWARDS_INNER_HASH||"").toLowerCase();
if(!/^[0-9a-f]{64}$/.test(innerHash)){console.error("Use --rewards-inner-hash with exactly 64 hexadecimal characters.");process.exit(1)}
const request=async(path,options)=>{const response=await fetch(`${base}${path}`,options),data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data};
const status=await request("/api/status");console.log(`Connected to ${status.networkId} at ${base}`);console.log(`Target reward interval: ${status.rewardBlockTimeMs} ms`);
let stopping=false;process.on("SIGINT",()=>{stopping=true;console.log("\nMiner stopped.")});
while(!stopping){const started=Date.now();try{const block=await request("/api/mine",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({rewardsInnerHash:innerHash})});console.log(`Block #${block.height} · reward ${Number(block.reward)/1e8} KRK · ${block.hash}`)}catch(error){console.error(`Mining request failed: ${error.message}`)}const wait=Math.max(100,(status.rewardBlockTimeMs||1000)-(Date.now()-started));await new Promise(resolve=>setTimeout(resolve,wait))}
