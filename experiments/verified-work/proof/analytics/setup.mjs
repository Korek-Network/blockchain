import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { powersOfTau, zKey, curves } from "snarkjs";
import { VERSION } from "./workload.mjs";

const root = dirname(fileURLToPath(import.meta.url)), dependencies = dirname(root);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(join(root, "build"), { recursive: true });
const directory = await mkdtemp(join(root, "build", "setup-")), path = name => join(directory, name);
const start = performance.now();
let curve;
try {
  const compiler = spawnSync(process.execPath, [join(dependencies, "node_modules/circom2/cli.js"),
    "analytics/statistics.circom", "--r1cs", "--wasm", "--sym", "--inspect", "--O2", "-l", "node_modules", "-o", directory],
  { cwd: dependencies, encoding: "utf8", timeout: 180_000, maxBuffer: 8_000_000 });
  process.stdout.write(compiler.stdout ?? "");
  await writeFile(path("compiler.txt"), (compiler.stdout ?? "") + (compiler.stderr ?? ""));
  if (compiler.stderr) console.log("Compiler diagnostics saved in compiler.txt for review.");
  if (compiler.status !== 0) throw new Error(`Circuit compilation failed: ${compiler.error ?? compiler.status}`);
  const counts = /non-linear constraints: (\d+)[\s\S]*?linear constraints: (\d+)/.exec(compiler.stdout);
  if (!counts) throw new Error("Cannot read circuit constraint count");
  const constraints = Number(counts[1]) + Number(counts[2]);
  if (constraints + 2 >= 2 ** 15) throw new Error("Circuit exceeds bounded power-15 experiment");
  console.log(`Creating TEST-ONLY single-operator setup: ${constraints} constraints, power 15.`);
  curve = await curves.getCurveFromName("bn128");
  await powersOfTau.newAccumulator(curve, 15, path("initial.ptau"));
  await powersOfTau.contribute(path("initial.ptau"), path("contributed.ptau"),
    "local-test-only", randomBytes(64).toString("hex"));
  if (!await powersOfTau.verify(path("contributed.ptau"))) throw new Error("Invalid powers of tau");
  console.log("Preparing phase 2.");
  await powersOfTau.preparePhase2(path("contributed.ptau"), path("prepared.ptau"));
  if (await zKey.newZKey(path("statistics.r1cs"), path("prepared.ptau"), path("initial.zkey")) === -1) {
    throw new Error("Circuit-specific setup failed");
  }
  await zKey.contribute(path("initial.zkey"), path("statistics.zkey"),
    "local-test-only", randomBytes(64).toString("hex"));
  console.log("Checking the circuit-specific key.");
  if (!await zKey.verifyFromR1cs(path("statistics.r1cs"), path("prepared.ptau"), path("statistics.zkey"))) {
    throw new Error("Invalid circuit-specific setup");
  }
  await writeFile(path("verification_key.json"), JSON.stringify(await zKey.exportVerificationKey(path("statistics.zkey")), null, 2));
  const artifacts = {};
  for (const name of ["statistics.r1cs", "statistics_js/statistics.wasm", "statistics.zkey", "verification_key.json"]) {
    const bytes = await readFile(path(name));
    artifacts[name] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  const manifest = { version: VERSION, directory, constraints, power: 15,
    circuitSha256: sha(await readFile(join(root, "statistics.circom"))),
    lockfileSha256: sha(await readFile(join(dependencies, "package-lock.json"))),
    setup: "single-operator local test only; no production trust claim",
    setupMs: performance.now() - start, setupPeakRssBytes: process.resourceUsage().maxRSS * 1024, artifacts };
  await writeFile(path("manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, "build/current.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
} finally { if (curve) await curve.terminate(); }
