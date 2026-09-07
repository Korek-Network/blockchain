import { sha256 } from "./crypto.js";

export const COMPUTE_FRAUD_PROOF_VERSION="korek-compute-fraud-proof/1";
export const COMPUTE_CHALLENGE_WINDOW_MS=5*60*1000;
export const COMPUTE_MAX_WITNESS_BYTES=32*1024;

const stable=value=>JSON.stringify(value);
const safeInt=value=>Number.isSafeInteger(value)&&Math.abs(value)<=1_000_000;

const validateBatch=witness=>{
 if(!witness||!Array.isArray(witness.items)||witness.items.length<1||witness.items.length>256)throw new Error("sha256-batch-v1 witness must contain 1 to 256 items");
 return{items:witness.items.map(item=>{if(typeof item!=="string"||Buffer.byteLength(item)>1024)throw new Error("sha256-batch-v1 items must be strings no larger than 1024 bytes");return item})};
};

const validateMatrix=witness=>{
 if(!witness||!Array.isArray(witness.left)||!Array.isArray(witness.right))throw new Error("matrix-multiply-int-v1 witness requires left and right matrices");
 const left=witness.left,right=witness.right;if(left.length<1||left.length>16||right.length<1||right.length>16)throw new Error("Matrices must contain 1 to 16 rows");
 const leftCols=Array.isArray(left[0])?left[0].length:0,rightCols=Array.isArray(right[0])?right[0].length:0;if(leftCols<1||leftCols>16||rightCols<1||rightCols>16||right.length!==leftCols)throw new Error("Matrix dimensions are incompatible or exceed 16x16");
 const cleanLeft=left.map(row=>{if(!Array.isArray(row)||row.length!==leftCols||!row.every(safeInt))throw new Error("Invalid left matrix");return row.map(Number)}),cleanRight=right.map(row=>{if(!Array.isArray(row)||row.length!==rightCols||!row.every(safeInt))throw new Error("Invalid right matrix");return row.map(Number)});
 return{left:cleanLeft,right:cleanRight};
};

export function canonicalWitness(profile,witness){
 const value=profile==="sha256-batch-v1"?validateBatch(witness):profile==="matrix-multiply-int-v1"?validateMatrix(witness):(()=>{throw new Error("Unsupported fraud-proof workload profile")})();
 const encoded=stable(value);if(Buffer.byteLength(encoded)>COMPUTE_MAX_WITNESS_BYTES)throw new Error("Fraud-proof witness is too large");return{value,encoded};
}

export function witnessHash(profile,witness){return sha256(canonicalWitness(profile,witness).encoded)}

export function executeDeterministicWorkload(profile,witness){
 const{value}=canonicalWitness(profile,witness);
 if(profile==="sha256-batch-v1")return{result:value.items.map(item=>sha256(item))};
 const rows=value.left.length,cols=value.right[0].length,inner=value.right.length,result=Array.from({length:rows},()=>Array(cols).fill(0));
 for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){let sum=0;for(let k=0;k<inner;k++){sum+=value.left[i][k]*value.right[k][j];if(!Number.isSafeInteger(sum))throw new Error("Matrix result exceeds safe integer range")}result[i][j]=sum}
 return{result};
}

export function deterministicOutputHash(profile,witness){return sha256(stable(executeDeterministicWorkload(profile,witness)))}

export function verifyFraudWitness({profile,inputHash,claimedOutputHash,witness}){
 const committedInput=witnessHash(profile,witness);if(committedInput!==String(inputHash||"").toLowerCase())throw new Error("Fraud-proof witness does not match the committed input hash");
 const expectedOutputHash=deterministicOutputHash(profile,witness),claimed=String(claimedOutputHash||"").toLowerCase();return{version:COMPUTE_FRAUD_PROOF_VERSION,expectedOutputHash,claimedOutputHash:claimed,fraudProven:expectedOutputHash!==claimed};
}
