import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";
import { curves, groth16 } from "snarkjs";
import { VERSION, ROWS, CHANNELS, OFFSET, SUM_OFFSET, CROSS_OFFSET, compute, validateRows, validateResult } from "./workload.mjs";

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const root = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const decimal = (x, bound) => typeof x === "string" && /^(0|[1-9][0-9]{0,77})$/.test(x) && BigInt(x) < bound;
const hash = (poseidon, values) => poseidon.F.toString(poseidon(values.map(BigInt)));

export function contextFor(job) {
  if (!job || Object.keys(job).sort().join() !== "chainId,deadline,inputRoot,jobId,reward,worker" ||
      typeof job.chainId !== "string" || !/^[a-z0-9-]{1,64}$/.test(job.chainId) ||
      typeof job.jobId !== "string" || !/^[0-9a-f]{64}$/.test(job.jobId) ||
      typeof job.worker !== "string" || !/^kwp1[0-9a-f]{64}$/.test(job.worker) ||
      typeof job.reward !== "string" || !/^[1-9][0-9]{0,19}$/.test(job.reward) || BigInt(job.reward) >= (1n << 64n) ||
      !Number.isSafeInteger(job.deadline) || job.deadline < 1 || !decimal(job.inputRoot, FIELD)) {
    throw new Error("Invalid expected job context");
  }
  const digest = sha(JSON.stringify([VERSION, ROWS, CHANNELS, job.chainId, job.jobId,
    job.worker, job.reward, job.deadline, job.inputRoot]));
  return [BigInt(`0x${digest.slice(0, 32)}`).toString(), BigInt(`0x${digest.slice(32)}`).toString()];
}

export function datasetRoot(poseidon, rows) {
  validateRows(rows);
  const packed = rows.map(row => row.reduce((n, x, c) => n + (BigInt(x + OFFSET) << BigInt(16*c)), 0n));
  const chunks = Array.from({ length: 8 }, (_, i) => hash(poseidon, packed.slice(i*16, i*16+16)));
  return hash(poseidon, [1, ...chunks]);
}

function encodedResult(result) {
  validateResult(result);
  return [...result.sums.map(x => String(x + SUM_OFFSET)),
    ...result.crossProducts.map(x => String(x + CROSS_OFFSET)), "0", "0", "0", "0"];
}

export function signalsFor(poseidon, job, result) {
  const context = contextFor(job), values = encodedResult(result);
  const chunks = Array.from({ length: 3 }, (_, i) => hash(poseidon, values.slice(i*16, i*16+16)));
  return [hash(poseidon, [job.inputRoot, ...chunks, ...context])];
}

export function witnessFor(job, rows, result) {
  validateRows(rows);
  const encoded = encodedResult(result);
  return { data: rows.map(row => row.map(x => String(x + OFFSET))), sums: encoded.slice(0, 8),
    crossProducts: encoded.slice(8, 44), context: contextFor(job) };
}

function proofShape(proof) {
  if (!proof || Object.keys(proof).sort().join() !== "curve,pi_a,pi_b,pi_c,protocol" ||
      proof.protocol !== "groth16" || proof.curve !== "bn128") return false;
  for (const point of [proof.pi_a, proof.pi_c]) {
    if (!Array.isArray(point) || point.length !== 3 || point[2] !== "1" || !point.every(x => decimal(x, BASE_FIELD))) return false;
  }
  return Array.isArray(proof.pi_b) && proof.pi_b.length === 3 &&
    proof.pi_b.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(x => decimal(x, BASE_FIELD))) &&
    proof.pi_b[2][0] === "1" && proof.pi_b[2][1] === "0";
}

export function makeVerifier(key, poseidon) {
  // Trusted local configuration only: never accept a verification key from a prover.
  const trustedKey = structuredClone(key);
  if (trustedKey.protocol !== "groth16" || trustedKey.curve !== "bn128" || trustedKey.nPublic !== 1) {
    throw new Error("Wrong circuit key");
  }
  return async (incoming, expectedJob) => {
    try {
      const json = JSON.stringify(incoming);
      if (typeof json !== "string" || Buffer.byteLength(json) > 32_768) return false;
      const bundle = JSON.parse(json), job = structuredClone(expectedJob);
      if (!bundle || Object.keys(bundle).sort().join() !== "proof,publicSignals,result,version" || bundle.version !== VERSION ||
          !proofShape(bundle.proof) || !Array.isArray(bundle.publicSignals) || bundle.publicSignals.length !== 1 ||
          !decimal(bundle.publicSignals[0], FIELD)) return false;
      const expected = signalsFor(poseidon, job, bundle.result);
      if (expected[0] !== bundle.publicSignals[0]) return false;
      return await groth16.verify(trustedKey, expected, bundle.proof);
    } catch { return false; }
  };
}

export async function openBackend() {
  const manifest = JSON.parse(await readFile(join(root, "build/current.json"), "utf8"));
  const directory = resolve(manifest.directory);
  if (manifest.version !== VERSION || !directory.startsWith(join(root, "build") + sep) ||
      sha(await readFile(join(root, "statistics.circom"))) !== manifest.circuitSha256 ||
      sha(await readFile(join(root, "../package-lock.json"))) !== manifest.lockfileSha256) {
    throw new Error("Setup/circuit/dependency mismatch; regenerate and review setup");
  }
  for (const name of ["statistics.r1cs", "statistics_js/statistics.wasm", "statistics.zkey", "verification_key.json"]) {
    if (sha(await readFile(join(directory, name))) !== manifest.artifacts[name]?.sha256) throw new Error(`Artifact mismatch: ${name}`);
  }
  const key = JSON.parse(await readFile(join(directory, "verification_key.json"), "utf8"));
  const poseidon = await buildPoseidon();
  return {
    manifest: structuredClone(manifest), commit: rows => datasetRoot(poseidon, rows),
    signalsFor: (job, result) => signalsFor(poseidon, job, result), verify: makeVerifier(key, poseidon),
    async prove(expectedJob, inputRows) {
      const job = structuredClone(expectedJob), rows = structuredClone(inputRows);
      contextFor(job);
      if (datasetRoot(poseidon, rows) !== job.inputRoot) throw new Error("Dataset does not match expected commitment");
      const result = compute(rows);
      const { proof, publicSignals } = await groth16.fullProve(witnessFor(job, rows, result),
        join(directory, "statistics_js/statistics.wasm"), join(directory, "statistics.zkey"));
      return { version: VERSION, result, proof, publicSignals };
    },
    rawVerify: (signals, proof) => groth16.verify(key, signals, proof),
    async close() { const curve = await curves.getCurveFromName("bn128"); await curve.terminate(); },
  };
}
