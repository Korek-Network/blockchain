import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groth16, wtns } from "snarkjs";
import { FIELD, openBackend, witnessFor, contextFor } from "./backend.mjs";
import { ROWS, CHANNELS, PAIRS, fixture, reference } from "./workload.mjs";

const rows = fixture();
let backend, bundle, job;
before(async () => {
  backend = await openBackend();
  job = { chainId: "korek-isolated-work-demo-1", jobId: "33".repeat(32), worker: `kwp1${"44".repeat(32)}`,
    reward: "100", deadline: 100, inputRoot: backend.commit(rows) };
  bundle = await backend.prove(job, rows);
});
after(async () => { if (backend) await backend.close(); });

test("actual analytics proof verifies and matches independent statistics", async () => {
  assert.deepEqual(bundle.result, reference(rows));
  assert.equal(await backend.verify(bundle, job), true);
  assert.equal(await backend.verify(bundle, job), true); // Verifier is stateless, NOT a payment/replay gate.
});
for (const field of ["chainId", "jobId", "worker", "reward", "deadline", "inputRoot"]) {
  test(`proof cannot be rebound to ${field}, even with a replacement public commitment`, async () => {
    const changed = structuredClone(job);
    if (field === "chainId") changed.chainId = "other-chain";
    if (field === "jobId") changed.jobId = "55".repeat(32);
    if (field === "worker") changed.worker = `kwp1${"66".repeat(32)}`;
    if (field === "reward") changed.reward = "101";
    if (field === "deadline") changed.deadline = 101;
    if (field === "inputRoot") changed.inputRoot = ((BigInt(changed.inputRoot) + 1n) % FIELD).toString();
    assert.equal(await backend.verify(bundle, changed), false);
    assert.equal(await backend.verify({ ...bundle, publicSignals: backend.signalsFor(changed, bundle.result) }, changed), false);
  });
}
for (const field of ["sums", "crossProducts"]) {
  test(`false ${field} cannot be hidden by recomputing the public commitment`, async () => {
    const bad = structuredClone(bundle); bad.result[field][0]++;
    bad.publicSignals = backend.signalsFor(job, bad.result);
    assert.equal(await backend.verify(bad, job), false);
  });
  test(`circuit rejects false ${field} independently of host result validation`, async () => {
    const witness = witnessFor(job, rows, bundle.result);
    witness[field][0] = (BigInt(witness[field][0]) + 1n).toString();
    await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "statistics_js/statistics.wasm"), { type: "mem" }));
  });
}
test("changed curve point and public signal fail cryptographic verification", async () => {
  const bad = structuredClone(bundle); bad.proof.pi_a[0] = (BigInt(bad.proof.pi_a[0]) + 1n).toString();
  assert.equal(await backend.verify(bad, job), false);
  assert.equal(await backend.rawVerify([((BigInt(bundle.publicSignals[0]) + 1n) % FIELD).toString()], bundle.proof), false);
});
test("ordered dataset commitment detects mutation, reordering and wrong batch", async () => {
  const changed = structuredClone(rows); changed[0][0]++;
  assert.notEqual(backend.commit(changed), job.inputRoot);
  assert.notEqual(backend.commit([...rows].reverse()), job.inputRoot);
  const swapped = rows.map(row => [row[1], row[0], ...row.slice(2)]);
  assert.notEqual(backend.commit(swapped), job.inputRoot);
  await assert.rejects(backend.prove(job, changed), /Dataset/);
  await assert.rejects(backend.prove(job, rows.slice(1)), /128/);
});
function recomputeOverField(witness) {
  const mod = x => ((x % FIELD + FIELD) % FIELD).toString();
  const values = witness.data.map(row => row.map(x => BigInt(x) - 32768n));
  witness.sums = Array.from({ length: CHANNELS }, (_, c) => mod(values.reduce((n, row) => n + row[c], 4194304n)));
  witness.crossProducts = PAIRS.map(([a, b]) => mod(values.reduce((n, row) => n + row[a]*row[b], 137438953472n)));
}
for (const badInteger of ["65536", (FIELD - 1n).toString()]) {
  test(`circuit rejects non-16-bit encoded sensor value ${badInteger.slice(0, 8)}`, async () => {
    const witness = witnessFor(job, rows, bundle.result); witness.data[0][0] = badInteger;
    recomputeOverField(witness); // Satisfy all arithmetic relations; the input range must still fail.
    await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "statistics_js/statistics.wasm"), { type: "mem" }));
  });
}
test("circuit rejects oversized context limb", async () => {
  const witness = witnessFor(job, rows, bundle.result); witness.context[0] = (1n << 128n).toString();
  await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "statistics_js/statistics.wasm"), { type: "mem" }));
});
test("extreme signed values produce a real valid proof without integer wraparound", async () => {
  const extremes = Array.from({ length: ROWS }, () => Array.from({ length: CHANNELS }, (_, c) => c % 2 ? 32767 : -32768));
  const extremeJob = { ...job, inputRoot: backend.commit(extremes) };
  const proof = await backend.prove(extremeJob, extremes);
  assert.deepEqual(proof.result, reference(extremes));
  assert.equal(await backend.verify(proof, extremeJob), true);
});
test("malformed, oversized, noncanonical and key-injection bundles fail closed", async () => {
  const cases = [null, {}, { ...bundle, version: "fake" }, { ...bundle, verificationKey: {} },
    { ...bundle, publicSignals: [] }, { ...bundle, publicSignals: [FIELD.toString()] },
    { ...bundle, publicSignals: [`0${bundle.publicSignals[0]}`] }, { ...bundle, result: "x".repeat(40000) },
    { ...bundle, proof: { ...bundle.proof, protocol: "fake" } },
    { ...bundle, proof: { ...bundle.proof, pi_a: ["-1", "0", "1"] } },
    { ...bundle, proof: { ...bundle.proof, pi_b: [] } }];
  for (const bad of cases) assert.equal(await backend.verify(bad, job), false);
});
test("invalid expected roots and job contexts fail before proof acceptance", () => {
  for (const inputRoot of ["-1", "01", FIELD.toString(), 1]) assert.throws(() => contextFor({ ...job, inputRoot }));
  for (const reward of ["0", "01", (1n << 64n).toString()]) assert.throws(() => contextFor({ ...job, reward }));
  assert.throws(() => contextFor({ ...job, deadline: Number.MAX_SAFE_INTEGER + 1 }));
});
test("async verification snapshots inputs instead of reading later mutations", async () => {
  const submitted = structuredClone(bundle), expected = structuredClone(job);
  const pending = backend.verify(submitted, expected);
  submitted.result.sums[0]++; expected.inputRoot = "1";
  assert.equal(await pending, true);
});
test("a modified verification key does not validate the proof", async () => {
  const key = JSON.parse(await readFile(join(backend.manifest.directory, "verification_key.json"), "utf8"));
  key.vk_alpha_1 = key.IC[0];
  assert.equal(await groth16.verify(key, bundle.publicSignals, bundle.proof), false);
});
