import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";
import { curves, groth16 } from "snarkjs";
import { PROFILE, solve, validateInput } from "../workload.mjs";

export const VERSION = "korek-real-proof-benchmark/1";
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const root = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const decimal = (x, bound) => typeof x === "string" && /^(0|[1-9][0-9]{0,77})$/.test(x) && BigInt(x) < bound;

export function witnessFor(job, result) {
  if (!job || typeof job.chainId !== "string" || !/^[a-z0-9-]{1,64}$/.test(job.chainId) ||
      typeof job.jobId !== "string" || !/^[0-9a-f]{64}$/.test(job.jobId) ||
      typeof job.worker !== "string" || !/^kwp1[0-9a-f]{64}$/.test(job.worker) ||
      typeof job.reward !== "string" || !/^[1-9][0-9]{0,19}$/.test(job.reward) ||
      BigInt(job.reward) >= (1n << 64n) || !Number.isSafeInteger(job.deadline) || job.deadline < 1) {
    throw new Error("Invalid expected job context");
  }
  validateInput(job.input);
  if (job.input[1] !== 4) throw new Error("Proof profile is restricted to 4x4 matrices");
  if (!Array.isArray(result) || result.length !== 16) throw new Error("Invalid proof result shape");
  for (let i = 0; i < 16; i++) {
    if (!Number.isSafeInteger(result[i]) || Object.is(result[i], -0) || Math.abs(result[i]) > 4_000_000) {
      throw new Error("Invalid proof result integer");
    }
  }
  // Encode the full 256-bit hash as TWO 128-bit limbs, not a lossy field reduction.
  const contextHash = sha(JSON.stringify([VERSION, job.chainId, job.jobId,
    job.worker, job.reward, job.deadline, PROFILE, 4]));
  return { a: job.input[2].map(x => String(x + 1000)),
    b: job.input[3].map(x => String(x + 1000)), c: result.map(x => String(x + 4_000_000)),
    context: [BigInt(`0x${contextHash.slice(0, 32)}`).toString(), BigInt(`0x${contextHash.slice(32)}`).toString()] };
}

function proofShape(proof) {
  if (!proof || proof.protocol !== "groth16" || proof.curve !== "bn128" ||
      Object.keys(proof).sort().join() !== "curve,pi_a,pi_b,pi_c,protocol") return false;
  for (const point of [proof.pi_a, proof.pi_c]) {
    if (!Array.isArray(point) || point.length !== 3 || point[2] !== "1" ||
        !point.every(x => decimal(x, BASE_FIELD))) return false;
  }
  return Array.isArray(proof.pi_b) && proof.pi_b.length === 3 &&
    proof.pi_b.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(x => decimal(x, BASE_FIELD))) &&
    proof.pi_b[2][0] === "1" && proof.pi_b[2][1] === "0";
}

export function commitmentFor(poseidon, job, result) {
  const hashFields = values => poseidon.F.toString(poseidon(values.map(BigInt)));
  const w = witnessFor(job, result);
  return [hashFields([hashFields(w.a), hashFields(w.b), hashFields(w.c), ...w.context])];
}

export async function openBackend() {
  const manifest = JSON.parse(await readFile(join(root, "build/current.json"), "utf8"));
  const directory = resolve(manifest.directory);
  if (manifest.version !== VERSION || !directory.startsWith(join(root, "build") + sep)) {
    throw new Error("Invalid local setup manifest");
  }
  if (sha(await readFile(join(root, "matrix4.circom"))) !== manifest.circuitSha256 ||
      sha(await readFile(join(root, "package-lock.json"))) !== manifest.lockfileSha256) {
    throw new Error("Circuit or dependency lock changed; regenerate and review setup");
  }
  for (const name of ["matrix4.r1cs", "matrix4_js/matrix4.wasm", "matrix4.zkey", "verification_key.json"]) {
    if (sha(await readFile(join(directory, name))) !== manifest.artifacts[name]?.sha256) {
      throw new Error(`Setup artifact mismatch: ${name}`);
    }
  }
  const key = JSON.parse(await readFile(join(directory, "verification_key.json"), "utf8"));
  if (key.protocol !== "groth16" || key.curve !== "bn128" || key.nPublic !== 1) throw new Error("Wrong circuit key");
  // The verification key is loaded ONLY from local, reviewed configuration,
  // never from an incoming proof bundle. The manifest is not a trust anchor
  // against a malicious local administrator; it detects accidental mismatch.
  const poseidon = await buildPoseidon();
  const signalsFor = (job, result) => commitmentFor(poseidon, job, result);

  const verify = async (bundle, job) => {
    try {
      if (!bundle || Buffer.byteLength(JSON.stringify(bundle)) > 32_768 || bundle.version !== VERSION ||
          Object.keys(bundle).sort().join() !== "proof,publicSignals,result,version" || !proofShape(bundle.proof) ||
          !Array.isArray(bundle.publicSignals) || bundle.publicSignals.length !== 1 ||
          !decimal(bundle.publicSignals[0], FIELD)) return false;
      // O(n^2) validation/hashing, NO matrix multiplication in this verifier.
      const expected = signalsFor(job, bundle.result);
      if (expected[0] !== bundle.publicSignals[0]) return false;
      return await groth16.verify(key, expected, bundle.proof);
    } catch { return false; }
  };
  return {
    manifest: structuredClone(manifest), signalsFor,
    async prove(job) {
      const result = solve(job.input);
      const { proof, publicSignals } = await groth16.fullProve(witnessFor(job, result),
        join(directory, "matrix4_js/matrix4.wasm"), join(directory, "matrix4.zkey"));
      return { version: VERSION, result, proof, publicSignals };
    },
    verify,
    // Exposed for regression tests to check the cryptographic layer separately
    // from expected-job matching. This is NOT the application acceptance API.
    rawVerify: (signals, proof) => groth16.verify(key, signals, proof),
    async close() { const curve = await curves.getCurveFromName("bn128"); await curve.terminate(); },
  };
}

export class ReplayGate {
  #used = new Set();
  #pending = new Set();
  #backend;
  constructor(backend) { this.#backend = backend; }
  async accept(bundle, expectedJob, orderedTime) {
    // In-memory acceptance demo ONLY: no payments or durable replay protection.
    // Both expectedJob and orderedTime must come from trusted application state.
    const job = structuredClone(expectedJob), submitted = structuredClone(bundle);
    witnessFor(job, submitted?.result);
    if (!Number.isSafeInteger(orderedTime) || orderedTime < 0 || orderedTime >= job.deadline) {
      throw new Error("Expired proof submission");
    }
    const key = `${job.chainId}:${job.jobId}`;
    if (this.#used.has(key) || this.#pending.has(key)) throw new Error("Replay or concurrent acceptance");
    if (this.#used.size + this.#pending.size >= 100) throw new Error("Local acceptance limit reached");
    this.#pending.add(key);
    try {
      if (!await this.#backend.verify(submitted, job)) throw new Error("Invalid computation proof");
      this.#used.add(key);
      return { accepted: true, jobId: job.jobId, worker: job.worker };
    } finally { this.#pending.delete(key); }
  }
}
