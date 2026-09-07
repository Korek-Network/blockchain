import assert from "node:assert/strict";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { createIdentity, signedRequest, WorkMarket } from "./market.mjs";
import { sampleInput, solve, verifyResult } from "./workload.mjs";

const customer = createIdentity(), honest = createIdentity(), dishonest = createIdentity();
const genesis = [[customer.address, "1000"]];
const market = new WorkMarket(genesis), events = [], outcomes = [];
function send(identity, kind, body, time) {
  const request = signedRequest(identity, kind, market.nonce(identity.address), body);
  const result = market.apply(request, time);
  events.push({ request, time });
  outcomes.push({ action: kind, status: result.status });
  return result;
}

const scenarioStart = performance.now();
const input = sampleInput(16);
const paidJob = send(customer, "create", [input, "100", 50], 1).jobId;
send(dishonest, "claim", [paidJob], 2);
const badResult = solve(input);
badResult[0]++;
assert.equal(send(dishonest, "submit", [paidJob, badResult], 3).status, "invalid-result");
assert.equal(market.balance(dishonest.address), "0");
send(honest, "claim", [paidJob], 4);
assert.equal(send(honest, "submit", [paidJob, solve(input)], 5).status, "paid");
const abandoned = send(customer, "create", [input, "200", 20], 6).jobId;
send(dishonest, "claim", [abandoned], 7);
send(honest, "refund", [abandoned], 20);
assert.equal(market.balance(customer.address), "900");
assert.equal(market.balance(honest.address), "100");
assert.equal(market.balance(dishonest.address), "0");
const scenarioMs = performance.now() - scenarioStart;

const replica = new WorkMarket(genesis);
for (const event of events) replica.apply(event.request, event.time);
assert.equal(replica.digest(), market.digest());

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = quantile => sorted[Math.ceil(quantile * sorted.length) - 1];
  return { p50Ms: at(0.5), p95Ms: at(0.95), samples: sorted.length };
}
const workloads = [];
for (const n of [8, 16, 32, 64]) {
  const jobInput = sampleInput(n), expected = solve(jobInput);
  for (let i = 0; i < 5; i++) { solve(jobInput); verifyResult(jobInput, expected); }
  const solveTimes = [], verifyTimes = [];
  // Alternate order to reduce systematic first/second-call measurement bias.
  for (let i = 0; i < 25; i++) {
    const worker = () => {
      const start = performance.now();
      const result = solve(jobInput);
      solveTimes.push(performance.now() - start);
      assert.deepEqual(result, expected);
    };
    const verifier = () => {
      const start = performance.now();
      const valid = verifyResult(jobInput, expected);
      verifyTimes.push(performance.now() - start);
      assert.equal(valid, true);
    };
    if (i % 2) { verifier(); worker(); } else { worker(); verifier(); }
  }
  const worker = summarize(solveTimes), verifier = summarize(verifyTimes);
  workloads.push({ dimension: n, inputBytes: Buffer.byteLength(JSON.stringify(jobInput)),
    resultBytes: Buffer.byteLength(JSON.stringify(expected)), worker, verifier,
    verifierToWorkerP50Ratio: verifier.p50Ms / worker.p50Ms });
}

console.log(JSON.stringify({
  experiment: "korek-verified-work-poc/1", runAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), arch: arch(),
    cpu: cpus()[0]?.model, logicalCpusVisible: cpus().length,
    workerThreadsUsed: 1, rssBytesAtEnd: process.memoryUsage().rss },
  scope: { execution: "single-process simulation with three generated signing identities",
    verification: "full-recomputation, not a succinct proof", consensus: "none",
    storage: "in-memory; replay from the same signed event sequence",
    currency: "fictional demo units, no Planck balances or issuance",
    chainFinalityMeasured: false, realWorldTps: null,
    electricityMeasured: false, fiatCostMeasured: false },
  scenario: { outcomes, successfulJobs: 1, rejectedResults: 1, refundedJobs: 1,
    balances: { customer: market.balance(customer.address), honestWorker: market.balance(honest.address),
      dishonestWorker: market.balance(dishonest.address) }, totalUnits: "1000",
    replayMatches: replica.digest() === market.digest(), localScenarioMs: scenarioMs },
  benchmark: { warmups: 5, timingExcludes: ["network", "disk", "consensus", "signatures", "escrow"],
    note: "Small warm in-memory kernels, not end-to-end job throughput; no cheap-proof claim.", workloads },
}, null, 2));
