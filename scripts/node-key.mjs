import { generateKeyPairSync,createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const output=process.argv.find((value,index)=>index>1&&!value.startsWith("-"))||"node_key.p2p";
const {publicKey,privateKey}=generateKeyPairSync("ed25519"),publicPem=publicKey.export({type:"spki",format:"pem"}),privatePem=privateKey.export({type:"pkcs8",format:"pem"}),peerId=createHash("sha256").update(publicPem).digest("hex");
const file={format:"korek-node-key",version:1,scheme:"ed25519-testnet",peerId,publicKey:publicPem,privateKey:privatePem,createdAt:new Date().toISOString()};
try{await writeFile(output,JSON.stringify(file,null,2),{mode:0o600,flag:"wx"})}catch(error){if(error.code==="EEXIST"){console.error(`${output} already exists. It was not overwritten.`);process.exit(1)}throw error}
console.log(`Node key written to ${output}`);console.log(`Peer ID: ${peerId}`);console.log("Keep this file private. It identifies your node and is not your wallet or recovery phrase.");
