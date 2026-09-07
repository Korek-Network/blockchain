import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groth16, wtns } from "snarkjs";
import { sampleInput } from "../workload.mjs";
import { FIELD, openBackend, ReplayGate, witnessFor } from "./backend.mjs";

const job = { chainId: "korek-isolated-work-demo-1", jobId: "11".repeat(32),
  worker: `kwp1${"22".repeat(32)}`, reward: "100", deadline: 100, input: sampleInput(4) };
let backend, bundle;
before(async () => { backend = await openBackend(); bundle = await backend.prove(job); });
after(async () => { if (backend) await backend.close(); });

test("real Groth16 proof verifies repeatedly without recomputing the matrix", async () => {
  assert.equal(bundle.proof.protocol, "groth16");
  assert.equal(await backend.verify(bundle, job), true);
  assert.equal(await backend.verify(bundle, job), true);
  assert.deepEqual(bundle.publicSignals, backend.signalsFor(job, bundle.result));
});

test("altering a curve point is rejected by cryptographic verification", async () => {
  const bad = structuredClone(bundle);
  bad.proof.pi_a[0] = (BigInt(bad.proof.pi_a[0]) + 1n).toString();
  assert.equal(await backend.verify(bad, job), false);
});

test("wrong public commitment is rejected by the proof system itself", async () => {
  const changed = [((BigInt(bundle.publicSignals[0]) + 1n) % FIELD).toString()];
  assert.equal(await backend.rawVerify(changed, bundle.proof), false);
});

for (const field of ["chainId", "jobId", "worker", "reward", "deadline", "matrixA", "matrixB"]) {
  test(`proof cannot be rebound to changed ${field}`, async () => {
    const changed = structuredClone(job);
    if (field === "chainId") changed.chainId = "another-network";
    else if (field === "jobId") changed.jobId = "33".repeat(32);
    else if (field === "worker") changed.worker = `kwp1${"44".repeat(32)}`;
    else if (field === "reward") changed.reward = "101";
    else if (field === "deadline") changed.deadline = 101;
    else changed.input[field === "matrixA" ? 2 : 3][0]++;
    assert.equal(await backend.verify(bundle, changed), false);
    // Also change the bundled root: application matching alone must not protect us.
    const bad = { ...bundle, publicSignals: backend.signalsFor(changed, bundle.result) };
    assert.equal(await backend.verify(bad, changed), false);
  });
}

test("false result with a freshly recomputed commitment still fails", async () => {
  const bad = structuredClone(bundle);
  bad.result[0]++;
  bad.publicSignals = backend.signalsFor(job, bad.result);
  assert.equal(await backend.verify(bad, job), false);
});

test("fake, malformed, oversized, noncanonical and key-injection bundles fail closed", async () => {
  const cases = [null, {}, { ...bundle, version: "fake-dev-receipt" },
    { ...bundle, verificationKey: {} }, { ...bundle, publicSignals: [] },
    { ...bundle, publicSignals: [FIELD.toString()] },
    { ...bundle, publicSignals: [`0${bundle.publicSignals[0]}`] },
    { ...bundle, result: "x".repeat(40_000) },
    { ...bundle, proof: { ...bundle.proof, protocol: "fake" } },
    { ...bundle, proof: { ...bundle.proof, pi_a: ["-1", "0", "1"] } },
    { ...bundle, proof: { ...bundle.proof, pi_a: ["0", "0", "1"] } },
    { ...bundle, proof: { ...bundle.proof, pi_b: [] } },
  ];
  for (const bad of cases) assert.equal(await backend.verify(bad, job), false);
});

test("a different verification key does not validate the proof", async () => {
  const key = JSON.parse(await readFile(join(backend.manifest.directory, "verification_key.json"), "utf8"));
  key.vk_alpha_1 = key.IC[0];
  assert.equal(await groth16.verify(key, bundle.publicSignals, bundle.proof), false);
});

test("circuit constraints reject a false witness even without host result checking", async () => {
  const witness = witnessFor(job, bundle.result);
  witness.c[0] = (BigInt(witness.c[0]) + 1n).toString();
  await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "matrix4_js/matrix4.wasm"),
    { type: "mem" }));
});

function rawProduct(witness) {
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    let sum = 4_000_000n;
    for (let k = 0; k < 4; k++) sum += (BigInt(witness.a[row*4+k])-1000n) * (BigInt(witness.b[k*4+col])-1000n);
    witness.c[row*4+col] = ((sum % FIELD + FIELD) % FIELD).toString();
  }
}

for (const badCoefficient of ["2001", (FIELD - 1n).toString()]) {
  test(`circuit range checks reject out-of-range field input ${badCoefficient.slice(0, 8)}`, async () => {
    const witness = witnessFor(job, bundle.result);
    witness.a[0] = badCoefficient;
    rawProduct(witness); // Algebraically correct over the field, but NOT an allowed integer job.
    await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "matrix4_js/matrix4.wasm"),
      { type: "mem" }));
  });
}

test("context limbs cannot exceed 128 bits inside the circuit", async () => {
  const witness = witnessFor(job, bundle.result);
  witness.context[0] = (1n << 128n).toString();
  await assert.rejects(wtns.calculate(witness, join(backend.manifest.directory, "matrix4_js/matrix4.wasm"),
    { type: "mem" }));
});

test("extreme positive and negative coefficients generate a valid proof", async () => {
  const extreme = structuredClone(job);
  extreme.input[2].fill(1000);
  extreme.input[3].fill(-1000);
  const proof = await backend.prove(extreme);
  assert.ok(proof.result.every(value => value === -4_000_000));
  assert.equal(await backend.verify(proof, extreme), true);
});

test("acceptance rejects replay and concurrent duplicate requests", async () => {
  const gate = new ReplayGate(backend);
  const results = await Promise.allSettled([gate.accept(bundle, job, 1), gate.accept(bundle, job, 1)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  await assert.rejects(gate.accept(bundle, job, 2), /Replay/);
});

test("invalid proofs do not consume the job acceptance slot", async () => {
  const gate = new ReplayGate(backend);
  const bad = structuredClone(bundle);
  bad.result[0]++;
  await assert.rejects(gate.accept(bad, job, 1), /Invalid computation proof/);
  assert.equal((await gate.accept(bundle, job, 2)).accepted, true);
});

test("mutating caller-owned objects during verification cannot change acceptance recipient", async () => {
  const mutableJob = structuredClone(job), mutableBundle = structuredClone(bundle);
  const pending = new ReplayGate(backend).accept(mutableBundle, mutableJob, 1);
  mutableJob.worker = `kwp1${"55".repeat(32)}`;
  mutableBundle.result[0]++;
  assert.equal((await pending).worker, job.worker);
});

test("expired proofs cannot be accepted at the exact deadline", async () => {
  await assert.rejects(new ReplayGate(backend).accept(bundle, job, 100), /Expired/);
});

test("host rejects unsupported dimensions and unsafe job fields", () => {
  for (const change of [{ input: sampleInput(8) }, { reward: "01" }, { reward: (1n << 64n).toString() },
    { worker: "someone" }, { deadline: 1.5 }, { chainId: "" }]) {
    assert.throws(() => witnessFor({ ...job, ...change }, bundle.result));
  }
});
