import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

export const sha256=(value)=>createHash("sha256").update(value).digest("hex");
export const stable=(value)=>JSON.stringify(value,Object.keys(value).sort());
export const isInnerHash=(value)=>/^[0-9a-f]{64}$/i.test(String(value||""));
export const wormholeAddressFromInnerHash=(innerHash)=>{if(!isInnerHash(innerHash))throw new Error("Rewards inner hash must be exactly 32 bytes (64 hexadecimal characters)");return`krk1${innerHash.toLowerCase().slice(0,40)}`};
export const addressFromPublicKey=(publicKey,scheme="transparent-v1")=>scheme==="wormhole-v1"?wormholeAddressFromInnerHash(sha256(`korek-wormhole-v1:${publicKey}`)):`krk1${sha256(publicKey).slice(0,40)}`;

// TESTNET ONLY. Ed25519 is a portable bootstrap signature. The provider
// boundary allows a future audited post-quantum replacement before mainnet.
export const cryptoProvider={
 algorithm:"Ed25519-testnet",
 createWallet(){const{publicKey,privateKey}=generateKeyPairSync("ed25519");const publicPem=publicKey.export({type:"spki",format:"pem"});const privatePem=privateKey.export({type:"pkcs8",format:"pem"});return{address:addressFromPublicKey(publicPem),publicKey:publicPem,privateKey:privatePem}},
 sign(message,privateKey){return sign(null,Buffer.from(message),privateKey).toString("base64")},
 verify(message,signature,publicKey){return verify(null,Buffer.from(message),publicKey,Buffer.from(signature,"base64"))},
};
