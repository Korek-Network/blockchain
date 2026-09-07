import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildPoseidon } from "circomlibjs";
import { curves, groth16 } from "snarkjs";
import { commitmentFor, VERSION } from "./backend.mjs";

// Offline re-verification of this repository's recorded sample. These files
// are trusted EXAMPLE configuration, not arbitrary proof-supplied trust anchors.
const example = JSON.parse(await readFile(new URL("./results/example.json", import.meta.url), "utf8"));
const report = JSON.parse(await readFile(new URL("./results/benchmark.json", import.meta.url), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(example.circuitSha256, sha(await readFile(new URL("./matrix4.circom", import.meta.url))));
assert.equal(sha(JSON.stringify(example.verificationKey, null, 2)),
  report.sizes.artifacts["verification_key.json"].sha256);
assert.equal(example.bundle.version, VERSION);
try {
  const poseidon = await buildPoseidon();
  assert.deepEqual(commitmentFor(poseidon, example.job, example.bundle.result), example.bundle.publicSignals);
  assert.equal(await groth16.verify(example.verificationKey, example.bundle.publicSignals, example.bundle.proof), true);
  console.log("Recorded real proof verified against its job and test-only verification key. No blockchain settlement implied.");
} finally {
  const curve = await curves.getCurveFromName("bn128");
  await curve.terminate();
}
