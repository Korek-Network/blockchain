import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { powersOfTau, zKey, curves } from "snarkjs";

const root = dirname(fileURLToPath(import.meta.url));
await mkdir(join(root, "build"), { recursive: true });
const directory = await mkdtemp(join(root, "build", "setup-"));
const path = name => join(directory, name);
const start = performance.now();
let curve;
try {
  const compiler = spawnSync(process.execPath, [join(root, "node_modules/circom2/cli.js"),
    "matrix4.circom", "--r1cs", "--wasm", "--sym", "--inspect", "--O2", "-l", "node_modules", "-o", directory],
  { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2_000_000 });
  process.stdout.write(compiler.stdout ?? "");
  if (compiler.stderr) console.log("Compiler diagnostics retained in compiler.txt for review.");
  if (compiler.status !== 0) throw new Error(`Circuit compilation failed: ${compiler.error ?? compiler.status}`);
  await writeFile(path("compiler.txt"), (compiler.stdout ?? "") + (compiler.stderr ?? ""));

  // Fresh randomness is supplied in-process, never in argv, output or source.
  // ONE local operator is NOT an independently contributed trusted ceremony.
  console.log("Creating TEST-ONLY local Groth16 setup (power 12).");
  curve = await curves.getCurveFromName("bn128");
  await powersOfTau.newAccumulator(curve, 12, path("initial.ptau"));
  await powersOfTau.contribute(path("initial.ptau"), path("contributed.ptau"),
    "local-test-only", randomBytes(64).toString("hex"));
  if (!await powersOfTau.verify(path("contributed.ptau"))) throw new Error("Powers of tau verification failed");
  console.log("Preparing phase 2.");
  await powersOfTau.preparePhase2(path("contributed.ptau"), path("prepared.ptau"));
  const keyResult = await zKey.newZKey(path("matrix4.r1cs"), path("prepared.ptau"), path("initial.zkey"));
  if (keyResult === -1) throw new Error("Setup failed: circuit/powers-of-tau capacity or format mismatch");
  await zKey.contribute(path("initial.zkey"), path("matrix4.zkey"),
    "local-test-only", randomBytes(64).toString("hex"));
  if (!await zKey.verifyFromR1cs(path("matrix4.r1cs"), path("prepared.ptau"), path("matrix4.zkey"))) {
    throw new Error("Circuit-specific setup verification failed");
  }
  await writeFile(path("verification_key.json"), JSON.stringify(await zKey.exportVerificationKey(path("matrix4.zkey")), null, 2));
  const artifacts = {};
  for (const name of ["matrix4.r1cs", "matrix4_js/matrix4.wasm", "matrix4.zkey", "verification_key.json"]) {
    const bytes = await readFile(path(name));
    artifacts[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  const manifest = { version: "korek-real-proof-benchmark/1", directory,
    circuitSha256: createHash("sha256").update(await readFile(join(root, "matrix4.circom"))).digest("hex"),
    lockfileSha256: createHash("sha256").update(await readFile(join(root, "package-lock.json"))).digest("hex"),
    setup: "single-operator local test only; no production trust claim", power: 12,
    setupMs: performance.now() - start, artifacts };
  await writeFile(path("manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, "build", "current.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ directory, setupMs: manifest.setupMs, artifacts }, null, 2));
} finally {
  if (curve) await curve.terminate();
}
