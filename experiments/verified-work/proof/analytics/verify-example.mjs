import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildPoseidon } from "circomlibjs";
import { curves } from "snarkjs";
import { datasetRoot, makeVerifier } from "./backend.mjs";
import { reference } from "./workload.mjs";

const example = JSON.parse(await readFile(new URL("./results/example.json", import.meta.url), "utf8"));
const report = JSON.parse(await readFile(new URL("./results/benchmark.json", import.meta.url), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(example.circuitSha256, sha(await readFile(new URL("./statistics.circom", import.meta.url))));
assert.equal(example.lockfileSha256, sha(await readFile(new URL("../package-lock.json", import.meta.url))));
assert.equal(sha(JSON.stringify(example.verificationKey, null, 2)), report.sizes.artifacts["verification_key.json"].sha256);
try {
  const poseidon = await buildPoseidon();
  assert.equal(datasetRoot(poseidon, example.rows), example.job.inputRoot);
  assert.deepEqual(example.bundle.result, reference(example.rows));
  assert.equal(await makeVerifier(example.verificationKey, poseidon)(example.bundle, example.job), true);
  console.log("Recorded sensor-statistics proof, expected dataset root and exact result verified. No on-chain settlement implied.");
} finally { const curve = await curves.getCurveFromName("bn128"); await curve.terminate(); }
