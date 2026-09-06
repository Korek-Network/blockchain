import { createHash,createPrivateKey,createPublicKey,randomBytes,scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input,stdout as output } from "node:process";

const PREFIXES=["amber","brisk","cedar","dawn","ember","frost","green","harbor","ivory","jolly","kind","lunar","maple","north","ocean","prairie"];
const SUFFIXES=["arch","bird","cloud","drum","elm","field","glow","hill","isle","jade","kite","leaf","moon","nest","oak","pine"];
const WORDS=Array.from({length:256},(_,i)=>`${PREFIXES[i>>4]}${SUFFIXES[i&15]}`),KNOWN=new Set(WORDS),PREFIX=Buffer.from("302e020100300506032b657004220420","hex");
const sha256=(v)=>createHash("sha256").update(v).digest("hex"),normalize=(v)=>v.trim().toLowerCase().split(/\s+/).join(" ");
const generated=()=>[...randomBytes(24)].map(b=>WORDS[b]).join(" ");
const rl=createInterface({input,output});const answer=normalize(await rl.question("Paste your existing KOREK 24-word phrase, or press Enter to create one:\n> "));rl.close();
const mnemonic=answer||generated(),words=mnemonic.split(" ");if(words.length!==24||!words.every(w=>KNOWN.has(w))){console.error("Invalid phrase. Use the 24-word KOREK phrase created by wallet v0.2 or this command.");process.exit(1)}
const seed=scryptSync(mnemonic,"KOREK_PLANCK_wormhole/0",32),privateKey=createPrivateKey({key:Buffer.concat([PREFIX,seed]),format:"der",type:"pkcs8"}),publicKey=createPublicKey(privateKey).export({type:"spki",format:"pem"}),innerHash=sha256(`korek-wormhole-v1:${publicKey}`),address=`krk1${innerHash.slice(0,40)}`;
console.log("\nKOREK Planck wormhole account\n");console.log(`Address:       ${address}`);console.log(`Inner Hash:    ${innerHash}`);console.log(`Secret phrase: ${mnemonic}`);console.log("\nBack up the 24-word phrase offline. Never share it. The inner hash may be supplied to your own node.");
