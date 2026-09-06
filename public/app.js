const units = (n) => `${(Number(n) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} KRK`;
const elements = {
  height: document.querySelector("#height"), issued: document.querySelector("#issued"),
  crypto: document.querySelector("#crypto"), blocks: document.querySelector("#blocks"),
  gpu: document.querySelector("#gpu"), address: document.querySelector("#address"),
  mineButton: document.querySelector("#mineButton"), mineResult: document.querySelector("#mineResult"),
  walletButton: document.querySelector("#walletButton"), walletResult: document.querySelector("#walletResult"),
  faucetAddress: document.querySelector("#faucetAddress"), faucetButton: document.querySelector("#faucetButton"),
  faucetResult: document.querySelector("#faucetResult"),
  gasPrice: document.querySelector("#gasPrice"), transferGas: document.querySelector("#transferGas"),
  transactionCount: document.querySelector("#transactionCount"), pendingCount: document.querySelector("#pendingCount"),
  transactions: document.querySelector("#transactions"), scanQuery: document.querySelector("#scanQuery"),
  scanButton: document.querySelector("#scanButton"), scanDetail: document.querySelector("#scanDetail"),
};
const short=(value)=>value&&value.length>20?`${value.slice(0,10)}…${value.slice(-8)}`:value;
const time=(value)=>value?new Date(value).toLocaleString():"—";
const escapeHtml=(value)=>String(value??"—").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);

async function request(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

async function refresh() {
  try {
    const [status, blocks, transactions] = await Promise.all([request("/api/status"), request("/api/blocks"), request("/api/transactions")]);
    elements.height.textContent=status.height; elements.issued.textContent=units(status.minedSupply); elements.crypto.textContent=units(status.initialReward);
    elements.gasPrice.textContent=`${status.gasPrice} atomic`;elements.transferGas.textContent=Number(status.transferGas).toLocaleString();
    elements.transactionCount.textContent=Number(status.transactions).toLocaleString();elements.pendingCount.textContent=status.pending;
    elements.blocks.innerHTML=blocks.map(block=>`<button class="scan-row" data-block="${block.height}"><b>#${block.height}</b><span>${short(block.hash)}</span><span>${block.transactions.length} tx</span><time>${time(block.timestamp)}</time></button>`).join("");
    elements.transactions.innerHTML=transactions.length?transactions.map(tx=>`<button class="scan-row tx-row" data-tx="${tx.id}"><b>${tx.status}</b><span>${short(tx.id)}</span><span>${units(tx.amount)}</span><time>${time(tx.confirmedAt||tx.receivedAt)}</time></button>`).join(""):'<p class="empty">No transactions yet.</p>';
  } catch (error) {
    elements.blocks.textContent = `Node unavailable: ${error.message}`;
  }
}

function showDetail(title,fields){elements.scanDetail.hidden=false;elements.scanDetail.innerHTML=`<div class="detail-head"><h3>${escapeHtml(title)}</h3><button id="closeDetail">Close</button></div>${fields.map(([label,value])=>`<div class="detail-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></div>`).join("")}`;document.querySelector("#closeDetail").onclick=()=>{elements.scanDetail.hidden=true};elements.scanDetail.scrollIntoView({behavior:"smooth",block:"center"})}
async function showBlock(id){try{const block=await request(`/api/block/${encodeURIComponent(id)}`);showDetail(`Block #${block.height}`,[['Status','Confirmed'],['Block hash',block.hash],['Parent hash',block.previousHash],['Timestamp',time(block.timestamp)],['Confirmations',block.confirmations],['Miner',block.miner],['Transactions',block.transactions.length],['Gas used',block.gasUsed],['Transaction fees',units(block.fees)],['Block reward',units(block.reward)],['Nonce',block.nonce],['Size',`${block.sizeBytes} bytes`]])}catch(error){showDetail('Block not found',[['Error',error.message]])}}
async function showTransaction(id){try{const tx=await request(`/api/transaction/${encodeURIComponent(id)}`);showDetail('Transaction details',[['Status',tx.status],['Transaction hash',tx.id],['Block',tx.blockHeight??'Pending'],['Confirmations',tx.confirmations],['From',tx.from],['To',tx.to],['Value',units(tx.amount)],['Gas price',`${tx.gasPrice} atomic units`],['Gas limit',Number(tx.gasLimit).toLocaleString()],['Gas used',Number(tx.gasUsed).toLocaleString()],['Network fee',units(tx.fee)],['Wallet send time',time(tx.sentAt)],['Node receive time',time(tx.receivedAt)],['Confirmation time',time(tx.confirmedAt)],['Time to confirm',tx.confirmationTimeMs===undefined||tx.confirmationTimeMs===null?'Pending':`${tx.confirmationTimeMs} ms`]]);return true}catch{return false}}
elements.scanButton.addEventListener('click',async()=>{const query=elements.scanQuery.value.trim();if(!query)return;elements.scanButton.disabled=true;try{if(/^\d+$/.test(query))await showBlock(query);else if(!(await showTransaction(query)))await showBlock(query)}finally{elements.scanButton.disabled=false}});
elements.scanQuery.addEventListener('keydown',event=>{if(event.key==='Enter')elements.scanButton.click()});
elements.blocks.addEventListener('click',event=>{const row=event.target.closest('[data-block]');if(row)showBlock(row.dataset.block)});
elements.transactions.addEventListener('click',event=>{const row=event.target.closest('[data-tx]');if(row)showTransaction(row.dataset.tx)});
elements.gpu.textContent = navigator.gpu ? "WebGPU detected — compatible GPU browser" : "WebGPU unavailable — CPU test mode";
elements.walletButton.addEventListener("click", async () => {
  elements.walletButton.disabled=true; elements.walletResult.textContent="Creating wallet…";
  try {
    const wallet=await request("/api/wallet",{method:"POST"}); elements.address.value=wallet.address; elements.faucetAddress.value=wallet.address;
    const blobUrl=URL.createObjectURL(new Blob([JSON.stringify(wallet,null,2)],{type:"application/json"}));
    const link=document.createElement("a"); link.href=blobUrl; link.download=`korek-wallet-${wallet.address.slice(-8)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);
    elements.walletResult.textContent=`Wallet created\nAddress: ${wallet.address}\nPrivate test wallet downloaded. Keep it secret.`;
  } catch(error) { elements.walletResult.textContent=`Wallet error: ${error.message}`; }
  finally { elements.walletButton.disabled=false; }
});
elements.mineButton.addEventListener("click", async () => {
  elements.mineButton.disabled=true; elements.mineResult.textContent="Mining…";
  try {
    const block=await request("/api/mine",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:elements.address.value.trim()})});
    elements.mineResult.textContent=`Block #${block.height}\n${block.hash}\nReward: ${units(block.reward)}`; await refresh();
  } catch(error) { elements.mineResult.textContent=`Mining error: ${error.message}`; }
  finally { elements.mineButton.disabled=false; }
});
elements.faucetButton.addEventListener("click", async () => {
  elements.faucetButton.disabled=true; elements.faucetResult.textContent="Sending test KRK…";
  try {
    const claim=await request("/api/faucet",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:elements.faucetAddress.value.trim()})});
    const next=new Date(claim.nextClaimAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    elements.faucetResult.textContent=`Success: 100 test KRK sent\nBalance: ${units(claim.balance)}\nNext claim available at ${next}`;
    await refresh();
  } catch(error) { elements.faucetResult.textContent=`Faucet error: ${error.message}`; }
  finally { elements.faucetButton.disabled=false; }
});
refresh();setInterval(refresh,5000);
