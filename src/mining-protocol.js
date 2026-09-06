import { createHash,randomBytes,randomUUID } from "node:crypto";
import { addressFromPublicKey,cryptoProvider,sha256 } from "./crypto.js";

export const MINER_PROTOCOL_V3="korek-planck-miner/3";
export const WORK_TTL_MS=30_000;
export const AUTH_WINDOW_MS=30_000;
export const MAX_NONCE=0xffff_ffff;

export const miningRequestMessage=({address,timestamp,requestNonce})=>
 `korek-miner-v3:work:${address}:${timestamp}:${requestNonce}`;
export const miningSubmissionMessage=({templateId,nonce,powHash,timestamp})=>
 `korek-miner-v3:submit:${templateId}:${nonce}:${powHash}:${timestamp}`;

export function powDigest(challenge,nonce){
 if(!/^[0-9a-f]{64}$/i.test(String(challenge||"")))throw new Error("Invalid work challenge");
 if(!Number.isSafeInteger(nonce)||nonce<0||nonce>MAX_NONCE)throw new Error("Nonce is outside the template range");
 const suffix=Buffer.allocUnsafe(4);suffix.writeUInt32BE(nonce);
 return createHash("sha256").update(Buffer.from(challenge,"hex")).update(suffix).digest("hex");
}
export const meetsDifficulty=(hash,difficulty)=>{
 if(!/^[0-9a-f]{64}$/i.test(String(hash||"")))return false;
 const value=Number(difficulty);
 return Number.isInteger(value)&&value>=1&&value<=16&&hash.startsWith("0".repeat(value));
};
export const workChallenge=template=>sha256(JSON.stringify({
 protocol:MINER_PROTOCOL_V3,networkId:template.networkId,templateId:template.templateId,
 height:template.height,previousHash:template.previousHash,rewardAddress:template.rewardAddress,
 reward:template.reward,difficulty:template.difficulty,issuedAt:template.issuedAt,notBefore:template.notBefore,expiresAt:template.expiresAt
}));
export function verifyWalletIdentity({address,publicKey}){
 if(addressFromPublicKey(publicKey,"wormhole-v1")!==address)throw new Error("Mining public key does not own the reward address");
}
export function verifyFresh(timestamp,now=Date.now()){
 if(!Number.isSafeInteger(Number(timestamp))||Math.abs(now-Number(timestamp))>AUTH_WINDOW_MS)throw new Error("Mining signature timestamp expired");
}
export function verifyWorkRequest(input,now=Date.now()){
 verifyFresh(input.timestamp,now);verifyWalletIdentity(input);
 if(!/^[0-9a-f]{32}$/i.test(String(input.requestNonce||"")))throw new Error("Invalid mining request nonce");
 if(!cryptoProvider.verify(miningRequestMessage(input),input.signature,input.publicKey))throw new Error("Invalid mining request signature");
}
export function verifySubmission(input,template,now=Date.now()){
 verifyFresh(input.timestamp,now);verifyWalletIdentity(input);
 if(input.address!==template.rewardAddress||input.publicKey!==template.publicKey)throw new Error("Submission identity does not match work template");
 if(input.templateId!==template.templateId)throw new Error("Submission template mismatch");
 if(now<template.notBefore)throw new Error("Block interval has not elapsed");
 if(now>template.expiresAt)throw new Error("Work template expired");
 if(!Number.isSafeInteger(input.nonce)||input.nonce<template.nonceStart||input.nonce>template.nonceEnd)throw new Error("Nonce is outside the template range");
 const expected=powDigest(template.challenge,input.nonce);
 if(input.powHash!==expected||!meetsDifficulty(expected,template.difficulty))throw new Error("Proof of work does not meet target");
 if(!cryptoProvider.verify(miningSubmissionMessage(input),input.signature,input.publicKey))throw new Error("Invalid mining submission signature");
 return expected;
}
export function createTemplate({networkId,height,previousHash,rewardAddress,publicKey,reward,difficulty,now=Date.now(),notBefore=now}){
 const template={protocol:MINER_PROTOCOL_V3,networkId,templateId:randomUUID(),height,previousHash,rewardAddress,publicKey,reward,difficulty,issuedAt:now,notBefore,expiresAt:Math.max(now+WORK_TTL_MS,notBefore+WORK_TTL_MS),nonceStart:0,nonceEnd:MAX_NONCE};
 return{...template,challenge:workChallenge(template)};
}
export const randomRequestNonce=()=>randomBytes(16).toString("hex");
