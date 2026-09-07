import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("explorer renders inclusion and PoW anchors without claiming millisecond finality",async()=>{
  const elements=new Map(),element=selector=>{
    if(!elements.has(selector))elements.set(selector,{innerHTML:"",textContent:"",value:"",hidden:false,addEventListener(){},classList:{toggle(){},remove(){}}});
    return elements.get(selector);
  };
  const tx={id:"a".repeat(64),status:"included",from:`krk1${"1".repeat(40)}`,to:`krk1${"2".repeat(40)}`,
    amount:"1",fee:"21000",gasPrice:"1",gasLimit:"21000",gasUsed:"21000",blockHeight:1,
    includedAt:1000,inclusionTimeMs:3,anchoredAt:null,powConfirmations:0,blockDepth:1,finalized:false};
  const block={height:1,hash:"b".repeat(64),previousHash:"c".repeat(64),transactions:[tx],timestamp:1000,
    status:"included",powConfirmations:0,blockDepth:1,miner:tx.from,reward:"0",gasUsed:"21000",fees:"21000"};
  const status={height:1,transactions:1,pending:0,minedSupply:"0",maxSupply:"21000000000000000",sync:{peers:0},networkId:"test"};
  const fetch=async path=>({ok:true,json:async()=>path==="/api/status"?status:path==="/api/peers"?[]:
    path.startsWith("/api/blocks")?[block]:path.startsWith("/api/transactions")?[tx]:path.startsWith("/api/block/")?block:tx});
  const source=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const app=await runInNewContext(`(async()=>{${source}\nreturn {analytics,detail};})()`,{
    fetch,document:{querySelector:element,querySelectorAll:()=>[],documentElement:{dataset:{}},addEventListener(){}},
    location:{hash:"#/"},localStorage:{getItem(){return"light"},setItem(){}},addEventListener(){},scrollTo(){},setInterval(){return 0}
  });
  app.analytics();assert.match(element("#content").innerHTML,/Average inclusion/);
  assert.doesNotMatch(element("#content").innerHTML,/Average finality|200 ms target/);
  await app.detail("tx",tx.id);assert.match(element("#content").innerHTML,/Not guaranteed; can reorganize/);
  assert.match(element("#content").innerHTML,/PoW anchors/);assert.match(element("#content").innerHTML,/included/);
  await app.detail("block","1");assert.match(element("#content").innerHTML,/Not guaranteed/);
});
