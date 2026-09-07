import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { sampleInput, solve, verifyResult } from "../workload.mjs";
import { openBackend, ReplayGate, VERSION } from "./backend.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const job = { chainId: "korek-isolated-work-demo-1", jobId: "11".repeat(32),
  worker: `kwp1${"22".repeat(32)}`, reward: "100", deadline: 100, input: sampleInput(4) };
const summarize = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, count: samples.length,
    p50Ms: sorted[Math.ceil(sorted.length / 2) - 1], maxMs: sorted.at(-1) };
};
const start = performance.now();
const backend = await openBackend();
const initializationMs = performance.now() - start;
try {
  const proofTimes = [], verifyTimes = [], rawVerifyTimes = [], solveTimes = [], recomputeTimes = [];
  let bundle;
  for (let i = 0; i < 3; i++) {
    const begin = performance.now();
    bundle = await backend.prove(job);
    proofTimes.push(performance.now() - begin);
    assert.equal(await backend.verify(bundle, job), true);
  }
  // Native comparison uses the exact same 4x4 inputs/result, not the earlier 64x64 run.
  // Batch tiny kernels to reduce timer quantization; report amortized per operation.
  for (let i = 0; i < 100; i++) { solve(job.input); verifyResult(job.input, bundle.result); }
  let expectedChecksum = 0;
  for (let j = 0; j < 1000; j++) expectedChecksum ^= bundle.result[j % 16];
  for (let i = 0; i < 10; i++) {
    let begin = performance.now();
    let checksum = 0;
    for (let j = 0; j < 1000; j++) checksum ^= solve(job.input)[j % 16];
    solveTimes.push((performance.now() - begin) / 1000);
    assert.equal(checksum, expectedChecksum);
    begin = performance.now();
    for (let j = 0; j < 1000; j++) assert.equal(verifyResult(job.input, bundle.result), true);
    recomputeTimes.push((performance.now() - begin) / 1000);
    begin = performance.now();
    const rawValid = await backend.rawVerify(bundle.publicSignals, bundle.proof);
    rawVerifyTimes.push(performance.now() - begin);
    assert.equal(rawValid, true);
    begin = performance.now();
    const accepted = await backend.verify(bundle, job);
    verifyTimes.push(performance.now() - begin);
    assert.equal(accepted, true);
  }
  const gate = new ReplayGate(backend);
  await gate.accept(bundle, job, 1);
  await assert.rejects(gate.accept(bundle, job, 2), /Replay/);
  const rssBytesAtEnd = process.memoryUsage().rss;
  const usage = process.resourceUsage();
  const native = summarize(solveTimes), recompute = summarize(recomputeTimes);
  const proof = summarize(proofTimes), verifier = summarize(verifyTimes);
  const report = { version: VERSION, runAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), arch: arch(),
      cpu: cpus()[0]?.model, logicalCpusVisible: cpus().length,
      threading: "snarkjs default worker threads; CPU affinity not pinned" },
    scope: { realProof: true, protocol: "Groth16", curve: "bn128", dimension: 4,
      setup: backend.manifest.setup, compiler: "experimental circom2 WASM 0.2.23 / Circom 2.2.3",
      publicSignals: 1, constraints: 3172, privateInputSignals: 50,
      assumptions: "Groth16/BN254, trusted setup, SHA-256 and Poseidon, correct circuit/compiler/verifier",
      measurementsExclude: ["network", "blockchain consensus", "disk settlement", "fees", "electricity", "fiat cost"],
      privacyClaim: false, productionSafe: false, blockchainTps: null },
    initializationMs, setupMs: backend.manifest.setupMs,
    timing: { nativeSolve: native, fullRecomputation: recompute, executionAndProof: proof,
      rawCryptographicVerification: summarize(rawVerifyTimes), applicationVerification: verifier },
    ratios: { proofGenerationToNative: proof.p50Ms / native.p50Ms,
      applicationVerificationToRecomputation: verifier.p50Ms / recompute.p50Ms },
    sizes: { proofJsonBytes: Buffer.byteLength(JSON.stringify(bundle.proof)),
      publicSignalsJsonBytes: Buffer.byteLength(JSON.stringify(bundle.publicSignals)),
      bundleJsonBytes: Buffer.byteLength(JSON.stringify(bundle)),
      expectedJobJsonBytes: Buffer.byteLength(JSON.stringify(job)),
      artifacts: backend.manifest.artifacts },
    memory: { maxRssBytes: usage.maxRSS * 1024, rssBytesAtEnd,
      scope: "whole benchmark process including initialization/native loops/prover/verifier; setup runs separately",
      setupPeakRssBytes: null },
    checks: { realProofVerified: true, duplicateAcceptanceRejected: true },
    limitations: ["Only three proof samples; timing is indicative, not a throughput capacity test",
      "Tiny synthetic matrix is not evidence of paid customer demand",
      "Native solver timing includes consuming one output cell per operation in a checked checksum",
      "Native verifier timing includes an equality assertion per iteration",
      "Same operator controls setup; no independent ceremony/security audit",
      "Replay gate is in memory, does not pay KRK, and is not crash-safe"],
  };
  const example = { warning: "TEST-ONLY single-operator setup. Not evidence of on-chain finality.",
    circuitSha256: backend.manifest.circuitSha256, lockfileSha256: backend.manifest.lockfileSha256,
    job, bundle, verificationKey: JSON.parse(await readFile(join(backend.manifest.directory, "verification_key.json"), "utf8")) };
  await writeFile(join(root, "build/benchmark.json"), JSON.stringify(report, null, 2));
  await writeFile(join(root, "build/example.json"), JSON.stringify(example, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await backend.close(); }
