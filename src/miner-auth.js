import { createHash,createHmac,randomBytes,timingSafeEqual } from "node:crypto";

export const AUTH_WINDOW_MS=30_000;
export const bodyHash=body=>createHash("sha256").update(body||"").digest("hex");
const payload=(method,path,timestamp,nonce,body)=>[method.toUpperCase(),path,String(timestamp),nonce,bodyHash(body)].join("\n");

export function createMinerAuthHeaders(token,{method="GET",path="/status",body="",timestamp=Date.now(),nonce=randomBytes(16).toString("hex")}={}){
 if(typeof token!=="string"||token.length<32)throw new Error("Miner authentication token must contain at least 32 characters");
 return{"x-korek-miner-timestamp":String(timestamp),"x-korek-miner-nonce":nonce,"x-korek-miner-signature":createHmac("sha256",token).update(payload(method,path,timestamp,nonce,body)).digest("hex")};
}

export class MinerAuthVerifier{
 constructor(token,{windowMs=AUTH_WINDOW_MS,now=()=>Date.now()}={}){if(typeof token!=="string"||token.length<32)throw new Error("Miner authentication token must contain at least 32 characters");this.token=token;this.windowMs=windowMs;this.now=now;this.nonces=new Map()}
 verify(headers,{method="GET",path="/status",body=""}={}){
  const timestamp=Number(headers["x-korek-miner-timestamp"]),nonce=headers["x-korek-miner-nonce"],received=headers["x-korek-miner-signature"];
  if(!Number.isFinite(timestamp)||typeof nonce!=="string"||!/^[0-9a-f]{32}$/.test(nonce)||typeof received!=="string"||!/^[0-9a-f]{64}$/.test(received))throw new Error("Missing or malformed miner authentication headers");
  const current=this.now();if(Math.abs(current-timestamp)>this.windowMs)throw new Error("Expired miner authentication timestamp");
  for(const [value,seen] of this.nonces)if(current-seen>this.windowMs)this.nonces.delete(value);
  if(this.nonces.has(nonce))throw new Error("Replayed miner request");
  const expected=createHmac("sha256",this.token).update(payload(method,path,timestamp,nonce,body)).digest("hex"),a=Buffer.from(received,"hex"),b=Buffer.from(expected,"hex");
  if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error("Invalid miner authentication signature");
  this.nonces.set(nonce,current);return true;
 }
}
