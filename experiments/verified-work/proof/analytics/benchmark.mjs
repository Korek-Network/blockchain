import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { openBackend } from "./backend.mjs";
import { VERSION, ROWS, CHANNELS, PAIRS, fixture, compute, reference, covarianceNumerators } from "./workload.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const summarize = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, count: samples.length, p50Ms: sorted[Math.ceil(sorted.length / 2) - 1], maxMs: sorted.at(-1) };
};
function verifyStatistics(rows, result) {
  const actual = compute(rows); // Ordinary Number arithmetic, not the slower BigInt test oracle.
  for (let i = 0; i < CHANNELS; i++) if (actual.sums[i] !== result.sums[i]) return false;
  for (let i = 0; i < PAIRS.length; i++) if (actual.crossProducts[i] !== result.crossProducts[i]) return false;
  return true;
}
function breakEven(prover, verifier, direct) {
  // Wall-time proxy ONLY: direct producer + N rechecks vs proof producer + N proof verifications.
  // Root preparation is shared/once, already trusted in both paths. No fees/energy/network model.
  return verifier >= direct ? null : Math.max(1, Math.floor((prover - direct) / (direct - verifier)) + 1);
}

const begin = performance.now(), backend = await openBackend();
const initializationMs = performance.now() - begin;
try {
  const rows = fixture(), expected = reference(rows), preprocessingTimes = [];
  let inputRoot;
  for (let i = 0; i < 10; i++) {
    const start = performance.now(); inputRoot = backend.commit(rows); preprocessingTimes.push(performance.now() - start);
  }
  const job = { chainId: "korek-isolated-work-demo-1", jobId: "33".repeat(32), worker: `kwp1${"44".repeat(32)}`,
    reward: "100", deadline: 100, inputRoot };
  const proveTimes = [], verifyTimes = [], nativeTimes = [], authenticatedTimes = [];
  let bundle;
  for (let i = 0; i < 3; i++) {
    const start = performance.now(); bundle = await backend.prove(job, rows); proveTimes.push(performance.now() - start);
    assert.deepEqual(bundle.result, expected);
    assert.equal(await backend.verify(bundle, job), true);
  }
  for (let i = 0; i < 100; i++) assert.equal(verifyStatistics(rows, expected), true);
  for (let i = 0; i < 10; i++) {
    let start = performance.now(), accepted = 0;
    for (let j = 0; j < 100; j++) accepted += Number(verifyStatistics(rows, expected));
    nativeTimes.push((performance.now() - start) / 100); assert.equal(accepted, 100);
    start = performance.now();
    const authenticated = backend.commit(rows) === job.inputRoot && verifyStatistics(rows, expected);
    authenticatedTimes.push(performance.now() - start); assert.equal(authenticated, true);
    start = performance.now(); const valid = await backend.verify(bundle, job);
    verifyTimes.push(performance.now() - start); assert.equal(valid, true);
  }
  const prover = summarize(proveTimes), verifier = summarize(verifyTimes);
  const native = summarize(nativeTimes), authenticated = summarize(authenticatedTimes);
  const report = {
    version: VERSION, runAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
      logicalCpusVisible: cpus().length, threading: "snarkjs default workers; no affinity pinning" },
    scope: { protocol: "Groth16", curve: "bn128", realProof: true, rows: ROWS, channels: CHANNELS,
      signedInputBits: 16, crossProductsPerJob: ROWS * PAIRS.length, outputStatistics: CHANNELS + PAIRS.length,
      constraints: backend.manifest.constraints, dataset: "deterministic generated sensor records, not customer data",
      usefulFunction: "exact channel sums and upper-triangular cross-products for covariance analytics",
      trustBoundary: "customer/publisher supplies the expected ordered-batch root before work; sensor truth and completeness are external",
      setup: backend.manifest.setup, productionSafe: false, blockchainTps: null,
      excluded: ["network/consensus", "input source authentication", "storage/settlement", "fees/electricity/fiat cost", "privacy audit"] },
    initializationMs, setupMs: backend.manifest.setupMs,
    timing: { datasetCommitmentPreparation: summarize(preprocessingTimes), directTrustedDataRecheck: native,
      authenticatedDataAndRecheck: authenticated, executionAndProof: prover, applicationProofVerification: verifier },
    ratios: { proofVerificationToTrustedRecheck: verifier.p50Ms / native.p50Ms,
      proofVerificationToAuthenticatedRecheck: verifier.p50Ms / authenticated.p50Ms,
      proofGenerationToNativeRecheck: prover.p50Ms / native.p50Ms },
    wallTimeProxy: { model: "P + N*V versus D + N*D; same fixed job and hardware, not an economic or TPS forecast",
      sharedRootPreparationExcludedFromBoth: true,
      breakEvenVerifierCountTrustedData: breakEven(prover.p50Ms, verifier.p50Ms, native.p50Ms),
      breakEvenVerifierCountAuthenticatedData: breakEven(prover.p50Ms, verifier.p50Ms, authenticated.p50Ms),
      nullMeaning: "no break-even at any verifier count when per-proof verification is already slower than this direct recheck",
      examples: [1, 10, 100, 1000].map(n => ({ verifiers: n, proofPathMs: prover.p50Ms + n*verifier.p50Ms,
        trustedDirectPathMs: (n+1)*native.p50Ms, authenticatedDirectPathMs: (n+1)*authenticated.p50Ms })) },
    sizes: { inputJsonBytes: Buffer.byteLength(JSON.stringify(rows)), expectedJobJsonBytes: Buffer.byteLength(JSON.stringify(job)),
      proofJsonBytes: Buffer.byteLength(JSON.stringify(bundle.proof)), bundleJsonBytes: Buffer.byteLength(JSON.stringify(bundle)),
      resultJsonBytes: Buffer.byteLength(JSON.stringify(bundle.result)), artifacts: backend.manifest.artifacts },
    memory: { benchmarkMaxRssBytes: process.resourceUsage().maxRSS * 1024, rssBytesAtEnd: process.memoryUsage().rss,
      setupMainProcessPeakRssBytes: backend.manifest.setupPeakRssBytes,
      scope: "whole benchmark process with workers; setup metric excludes the separately spawned compiler" },
    checks: { realProofVerified: true, independentBigIntOracleMatched: true },
    example: { firstChannelMean: { numerator: expected.sums[0], denominator: ROWS },
      firstChannelPopulationVariance: { numerator: covarianceNumerators(expected)[0], denominator: ROWS ** 2 } },
    limitations: ["One fixed 128x8 size, three proof samples and ten verifier samples; no extrapolated crossover claims",
      "Warmed JIT native rechecks inspect every output; an optimized native implementation could be faster",
      "Data commitment is not proof of honest sensors, data availability, or inclusion of all relevant records",
      "Standalone stateless proof verifier does not enforce deadlines, prevent replay or pay anyone",
      "Experimental compiler and single-operator setup; inherited dependency advisories remain",
      "No demonstrated customer demand, money savings, throughput gain, decentralization or production security"]
  };
  const { directory: unused, ...portableSetup } = backend.manifest;
  const example = { warning: "TEST-ONLY setup. Repository fixture is trusted configuration, never a prover-selected key.",
    circuitSha256: backend.manifest.circuitSha256, lockfileSha256: backend.manifest.lockfileSha256,
    rows, job, bundle, verificationKey: JSON.parse(await readFile(join(backend.manifest.directory, "verification_key.json"), "utf8")) };
  await writeFile(join(root, "build/benchmark.json"), JSON.stringify(report, null, 2));
  await writeFile(join(root, "build/example.json"), JSON.stringify(example, null, 2));
  await writeFile(join(root, "build/setup.json"), JSON.stringify(portableSetup, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await backend.close(); }
