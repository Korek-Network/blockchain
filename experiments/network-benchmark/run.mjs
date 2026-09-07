import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../../src/storage.js";
import { cryptoProvider } from "../../src/crypto.js";
import { miningRequestMessage, miningSubmissionMessage, powDigest, meetsDifficulty, randomRequestNonce } from "../../src/mining-protocol.js";
import { wallet, transfer, commonPlacement, phaseMetrics } from "./metrics.mjs";

const root = dirname(fileURLToPath(import.meta.url)), repository = join(root, "../..");
const smoke = process.argv.includes("--smoke"), fixed = process.argv.includes("--fixed");
if (process.argv.slice(2).some(x => !["--smoke", "--fixed"].includes(x))) throw new Error("Only --smoke and --fixed are supported; no external endpoint mode");
const profile = { durationMs: smoke ? 1000 : 6000, offeredRates: smoke ? [10, 25] : [10, 50, 100],
  maxInFlight: 16, observerIntervalMs: 200, replicationTimeoutMs: 20000, peerSyncIntervalMs: 2000,
  difficulty: 3, rewardBlockTimeMs: 250, failureBatchSize: smoke ? 4 : 24 };
// The driver's independent snapshot validator must use the same explicit lab
// configuration as its children. Dynamic imports avoid capturing default 7 first.
process.env.KOREK_DIFFICULTY = String(profile.difficulty);
process.env.KOREK_BLOCK_TIME_MS = String(profile.rewardBlockTimeMs);
const { KorekChain, hashBlock } = await import("../../src/blockchain.js");
const { verifyEnvelope } = await import("../../src/p2p.js");
const { NODE_PROTOCOL } = await import("../../src/protocol.js");
assert.equal(NODE_PROTOCOL, fixed ? "korek-planck-p2p/4" : "korek-planck-p2p/1", "On the patched P2P v4 branch use --fixed; legacy expectations belong to the baseline branch");
await mkdir(join(root, ".runs"), { recursive: true });
const directory = await mkdtemp(join(root, ".runs", "run-"));
const origin = performance.now(), clock = () => performance.now()-origin;
const nodes = [], phases = [], events = [], archiveMetrics = [], allRecords = [];
let stoppingForSignal = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (stoppingForSignal) return;
  stoppingForSignal = true;
  await Promise.all(nodes.map(node => stop(node).catch(() => {})));
  process.exit(signal === "SIGINT" ? 130 : 143);
});
const sender = wallet(), recipient = wallet(), miner = wallet();
let sequence = 0, controlId = 0;
const timestampBase = Date.now();
const sha = data => createHash("sha256").update(data).digest("hex");
const report = { version: fixed ? "korek-local-multinode-benchmark/4" : "korek-local-multinode-benchmark/1", runAt: new Date().toISOString(), profile,
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  sourceSha256: {}, scope: { realServerProcesses: 3, transport: "loopback HTTP, same host", signedTransactions: true,
    signature: "Ed25519, version 3 wormhole-v1 address scheme", ingress: "one funded sender, one recipient, fixed fee, sequentially scheduled requests",
    funding: "real lab PoW reward to sender; no faucet or live funds", computeMvp: false,
    labOverrides: "difficulty 3 and reward interval 250ms versus source defaults 7 and 60000ms; default 2000ms P2P polling retained",
    instrumentation: "method timings, loopback-only listener shim, IPC peer configuration; production handlers and fork choice unchanged",
    persistence: "SQLite rollback transactions, EXTRA synchronization and 5-ms save grouping; hardware power loss not tested",
    finalityClaim: false, publicTestnetCapacityClaim: false, nodeProtocol: NODE_PROTOCOL, fixedSemantics: fixed }, phases, events };
for (const file of ["server.js", "blockchain.js", "p2p.js", "storage.js", "config.js", "crypto.js", "mining-protocol.js", "protocol.js", ...(fixed ? ["confirmation.js", "chain-selection.js", "ledger-replay.js", "legacy-storage.js"] : [])]) {
  report.sourceSha256[file] = sha(await readFile(join(repository, "src", file)));
}
report.benchmarkSourceSha256 = {};
for (const file of ["run.mjs", "child.mjs", "metrics.mjs"]) report.benchmarkSourceSha256[file] = sha(await readFile(join(root, file)));

async function request(node, path, body, p2p = false) {
  const response = await fetch(`${p2p ? node.p2p : node.api}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
async function ok(node, path, body, p2p = false) {
  const response = await request(node, path, body, p2p);
  if (response.status >= 400) throw new Error(`${node.label} ${path}: ${response.body.error}`);
  return response.body;
}
async function control(node, command, extra = {}) {
  const requestId = ++controlId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { node.pending.delete(requestId); reject(new Error(`${command} control timeout`)); }, 25000);
    node.pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    node.process.send({ command, requestId, ...extra });
  });
}
async function start(node) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("KOREK_") && !["NODE_OPTIONS", "NODE_PATH"].includes(key)));
  Object.assign(env, { KOREK_PORT: "0", KOREK_COMPUTE_MVP: "0", KOREK_MINE: "0", KOREK_DIFFICULTY: "3", KOREK_BLOCK_TIME_MS: "250" });
  node.pending = new Map(); node.view = new Map(); node.blocks = new Map(); node.logs = "";
  const child = fork(join(root, "child.mjs"), [node.directory, node.label], { env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  node.process = child;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { node.logs = (node.logs + data).slice(-64000); });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${node.label} startup timeout: ${node.logs}`)), 20000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("message", message => {
      if (message.type === "listener") {
        if (message.address !== "127.0.0.1") { clearTimeout(timer); reject(new Error("Unexpected listener address")); return; }
        node[message.kind] = `http://127.0.0.1:${message.port}`;
        if (message.kind === "miner") { clearTimeout(timer); resolve(); }
      } else if (message.type === "reply") {
        const pending = node.pending.get(message.requestId); node.pending.delete(message.requestId);
        if (pending) message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer); reject(new Error(`${node.label} exited: ${code}/${signal}: ${node.logs}`));
      for (const pending of node.pending.values()) pending.reject(new Error("Benchmark node exited"));
      node.pending.clear();
    });
  });
  await ready;
  const status = await ok(node, "/api/status");
  assert.equal(status.storage.mode, "sqlite-extra-v3");
  assert.equal(status.nodeIdentity, node.peerId); assert.equal(status.compute.enabled, false);
  events.push({ type: "node-start", node: node.label, atMs: clock(), restoredHeight: status.height });
}
async function makeNode(label) {
  const node = { label, directory: join(directory, label) };
  await mkdir(node.directory, { mode: 0o700 });
  const keys = generateKeyPairSync("ed25519"), publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  node.peerId = sha(publicKey);
  await writeFile(join(node.directory, "node-key.json"), JSON.stringify({ format: "korek-node-key", version: 1,
    peerId: node.peerId, publicKey, privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }) }), { mode: 0o600 });
  nodes.push(node); await start(node); return node;
}
async function stop(node, signal = "SIGTERM") {
  if (!node.process || node.process.exitCode !== null || node.process.signalCode !== null) return;
  const child = node.process, exited = new Promise(resolve => child.once("exit", resolve));
  child.kill(signal); await exited;
  await writeFile(join(node.directory, "last-node.log"), node.logs);
  events.push({ type: "node-stop", node: node.label, signal, atMs: clock() });
}
const wire = active => Promise.all(active.map(node => control(node, "peers", { urls: active.filter(x => x !== node).map(x => x.p2p) })));
async function snapshot(node) {
  const envelope = await ok(node, "/p2p/snapshot", undefined, true);
  return verifyEnvelope(envelope, { peerId: node.peerId }).snapshot;
}
async function observe(node) {
  let blocks = (await ok(node, "/api/blocks?limit=500")).reverse();
  const first = blocks[0];
  if (first.height > 0 && node.blocks.get(first.height-1) !== first.previousHash) blocks = (await snapshot(node)).chain;
  const boundary = blocks[0].height, prior = node.view;
  node.view = new Map([...prior].filter(([, value]) => value.height < boundary));
  for (const height of node.blocks.keys()) if (height >= boundary) node.blocks.delete(height);
  const observedMs = clock();
  for (const block of blocks) {
    node.blocks.set(block.height, block.hash);
    for (const tx of block.transactions) {
      const previous = prior.get(tx.id);
      node.view.set(tx.id, { blockHash: block.hash, height: block.height,
        observedMs: previous?.blockHash === block.hash ? previous.observedMs : observedMs });
    }
  }
}
async function waitReplicated(records, active = nodes, timeout = profile.replicationTimeoutMs) {
  const deadline = clock()+timeout;
  do {
    await Promise.all(active.map(observe));
    if (records.every(r => commonPlacement(r.id, active.map(n => n.view)))) return true;
    if (clock() >= deadline) return false;
    await delay(profile.observerIntervalMs);
  } while (true);
}
function inputs(count) {
  const started = clock();
  const values = Array.from({ length: count }, () => transfer(sender, recipient.address, timestampBase + sequence++));
  return { values, signingMs: clock()-started };
}
async function submit(node, input, scheduledMs = clock()) {
  const record = { id: input.id, scheduledMs, sentMs: clock(), httpStatus: null };
  try {
    const response = await request(node, "/api/transactions", input.tx);
    record.httpStatus = response.status; record.responseId = response.body.id ?? null;
    record.reportedStatus = response.body.status ?? null; record.error = response.body.error ?? null;
  } catch (error) { record.error = error.message; }
  record.responseMs = clock(); allRecords.push(record); return record;
}
async function load(name, ingress, rate, count, active = nodes) {
  const signed = inputs(count), startedMs = clock(), records = [], pending = new Set();
  let finished = false, observerError;
  const monitor = (async () => { while (!finished) {
    try { await Promise.all(active.map(observe)); } catch (error) { observerError = error; return; }
    await delay(profile.observerIntervalMs);
  } })();
  try {
    for (let i = 0; i < count; i++) {
      const scheduled = startedMs+i*1000/rate;
      if (clock() < scheduled) await delay(scheduled-clock());
      if (pending.size >= profile.maxInFlight) await Promise.race(pending);
      const task = submit(ingress, signed.values[i], scheduled).then(value => records.push(value));
      pending.add(task); task.finally(() => pending.delete(task));
    }
    await Promise.all(pending);
  } finally { finished = true; await monitor; }
  if (observerError) throw observerError;
  const accepted = records.filter(r => r.httpStatus === 201);
  const replicated = await waitReplicated(accepted, active);
  for (const record of records) record.observations = Object.fromEntries(active.map(node => [node.label, node.view.get(record.id) ?? null]));
  const result = { name, nodesObserved: active.map(n => n.label), signingMs: signed.signingMs,
    ...phaseMetrics(records, active.map(n => n.view), startedMs, clock(), rate), records };
  phases.push(result);
  console.log(`${name}: accepted ${result.accepted}/${count}; replicated ${result.replicatedOnAllNodes}; complete-batch TPS ${result.completeBatchReplicationTps?.toFixed(2) ?? "not established"}`);
  assert.equal(replicated, true, `${name}: accepted transactions did not replicate in the bounded window`);
  assert.equal(result.accepted, count, `${name}: workload rejected or transport failed; inspect partial report`);
  return { records, lastInput: signed.values.at(-1) };
}
async function collectMetrics(label, active = nodes) {
  archiveMetrics.push({ label, atMs: clock(), nodes: Object.fromEntries(await Promise.all(active.map(async n => [n.label, await control(n, "metrics")]))) });
}
async function mineAnchor(node, owner = miner) {
  const startedMs = clock(), timestamp = Date.now(), requestNonce = randomRequestNonce();
  const work = { address: owner.address, publicKey: owner.publicKey, timestamp, requestNonce };
  work.signature = cryptoProvider.sign(miningRequestMessage(work), owner.privateKey);
  const template = await ok(node, "/miner/v3/work", work);
  let nonce = template.nonceStart, digest;
  const deadline = clock()+10000;
  while (true) {
    digest = powDigest(template.challenge, nonce);
    if (meetsDifficulty(digest, template.difficulty)) break;
    if (++nonce > template.nonceEnd || clock()>deadline) throw new Error("Bounded lab proof search failed");
  }
  if (Date.now() < template.notBefore) await delay(template.notBefore-Date.now()+1);
  const submission = { address: owner.address, publicKey: owner.publicKey, templateId: template.templateId,
    nonce, powHash: digest, timestamp: Date.now(), hashesTried: nonce+1, device: "local-benchmark" };
  submission.signature = cryptoProvider.sign(miningSubmissionMessage(submission), owner.privateKey);
  const result = await ok(node, "/miner/v3/submit", submission);
  assert.equal(result.accepted, true);
  return { minerReward: result.block.minerReward, height: result.block.height, hash: result.block.hash, difficulty: template.difficulty, hashesTried: nonce+1, elapsedMs: clock()-startedMs };
}
async function waitTip(expectedHash, active = nodes) {
  const deadline = clock()+profile.replicationTimeoutMs;
  do {
    const tips = await Promise.all(active.map(n => ok(n, "/api/blocks?limit=1")));
    if (tips.every(x => x[0].hash === expectedHash)) return true;
    await delay(200);
  } while (clock()<deadline);
  return false;
}

try {
  const a = await makeNode("A"), b = await makeNode("B"), c = await makeNode("C");
  await wire(nodes);
  const funding = await mineAnchor(a, sender); report.fundingProof = funding;
  assert.equal(await waitTip(funding.hash), true);
  assert.equal((await request(a, "/api/faucet", { address: sender.address })).status, 400);
  const warmup = inputs(1).values[0], warm = await submit(a, warmup);
  assert.equal(warm.httpStatus, 201); assert.equal(await waitReplicated([warm]), true);
  await collectMetrics("before-rate-sweep");
  let lastInput;
  for (const rate of profile.offeredRates) {
    ({ lastInput } = await load(`zero-work-${rate}-offered-tps`, a, rate, Math.ceil(rate*profile.durationMs/1000)));
  }
  await collectMetrics("after-rate-sweep");
  const duplicate = await request(a, "/api/transactions", lastInput.tx);
  const tampered = await request(a, "/api/transactions", { ...inputs(1).values[0].tx, amount: "2" });
  assert.equal(duplicate.status, 400); assert.match(duplicate.body.error, /Duplicate/);
  assert.equal(tampered.status, 400); assert.match(tampered.body.error, /signature/);
  report.invalidRequests = { duplicateRejected: true, tamperedSignatureRejected: true };

  await collectMetrics("before-follower-crash");
  await stop(c, "SIGKILL");
  const outage = await load("follower-offline", a, 50, profile.failureBatchSize, [a, b]);
  const recoveryStarted = clock(); await start(c); await wire(nodes);
  assert.equal(await waitReplicated(outage.records), true);
  report.followerRecovery = { signal: "SIGKILL", offlineNode: "C", acknowledgedWhileOffline: outage.records.length,
    recoveredAll: true, restartToObservedRecoveryMs: clock()-recoveryStarted, reconnect: "driver rewires new ephemeral addresses" };

  await collectMetrics("before-ingress-crash");
  await stop(a, "SIGKILL"); await wire([b, c]);
  const failover = await load("manual-ingress-failover", b, 50, profile.failureBatchSize, [b, c]);
  const sourceRecovery = clock(); await start(a); await wire(nodes);
  assert.equal(await waitReplicated(failover.records), true);
  report.ingressRecovery = { signal: "SIGKILL", failedNode: "A", manualSubmissionNode: "B", recoveredAll: true,
    restartToObservedRecoveryMs: clock()-sourceRecovery, automaticFailoverClaim: false };

  await Promise.all(nodes.map(n => control(n, "disconnect")));
  const forkInputs = inputs(3).values;
  const left = await submit(a, forkInputs[0]), right = await submit(b, forkInputs[1]);
  assert.equal(left.httpStatus, 201); assert.equal(right.httpStatus, 201);
  if (fixed) { assert.equal(left.reportedStatus, "included"); assert.equal(right.reportedStatus, "included"); }
  await wire(nodes); await delay(profile.peerSyncIntervalMs*2+300);
  const equalTips = await Promise.all(nodes.map(n => ok(n, "/api/blocks?limit=1")));
  assert.notEqual(equalTips[0][0].hash, equalTips[1][0].hash, "Expected source equal-work/equal-height fork retention changed");
  const extension = await submit(a, forkInputs[2]); assert.equal(extension.httpStatus, 201);
  let firstAnchor;
  if (fixed) {
    await delay(profile.peerSyncIntervalMs*2+300); await observe(b);
    assert.equal(b.view.has(right.id), true, "A longer equal-work fork must not replace B's history");
    assert.equal(b.view.has(left.id), false);
    firstAnchor = await mineAnchor(a); // A genuine stronger-work fork may still reorganize tentative transfers.
  }
  assert.equal(await waitReplicated([left, extension]), true);
  assert.equal(nodes.every(n => !n.view.has(right.id)), true);
  report.partitionProbe = { controlledPeerDisconnection: true, equalHeightForkDidNotConverge: true,
    waitAfterReconnectMs: profile.peerSyncIntervalMs*2+300,
    acknowledgedTransactionLostFromAllNodes: right.id, lostApiReportedStatus: right.reportedStatus,
    longerEqualWorkForkRejected: fixed, convergedAfterSourceExtension: !fixed, convergedAfterStrongerWork: fixed,
    meaning: fixed ? "Tentative inclusion is not finality; only stronger verified work resolved the conflicting branches" : "A locally confirmed transfer can be removed by a later selected branch" };

  firstAnchor ??= await mineAnchor(a); assert.equal(await waitTip(firstAnchor.hash), true);
  const gatedInputs = inputs(profile.failureBatchSize).values, gated = [];
  for (const input of gatedInputs) gated.push(await submit(a, input));
  assert.equal(gated.every(r => r.httpStatus === 201), true);
  const gateStarted = clock();
  if (fixed) assert.equal(await waitReplicated(gated, nodes, profile.peerSyncIntervalMs*2+300), true);
  else { await delay(profile.peerSyncIntervalMs*2+300); await Promise.all(nodes.map(observe)); }
  const beforeAnchorCount = gated.filter(r => commonPlacement(r.id, nodes.map(n => n.view))).length;
  assert.equal(beforeAnchorCount, fixed ? gated.length : 0, "Post-mining propagation expectation failed");
  if (fixed) for (const node of nodes) {
    const tx = await ok(node, `/api/transaction/${gated[0].id}`);
    assert.equal(tx.status, "included"); assert.equal(tx.powConfirmations, 0); assert.equal(tx.finalized, false);
  }
  const gateObservedMs = clock()-gateStarted;
  const secondAnchor = await mineAnchor(a);
  assert.equal(await waitReplicated(gated), true);
  assert.equal(await waitTip(secondAnchor.hash), true);
  report.positiveWorkGate = { firstAnchor, secondAnchor, accepted: gated.length, replicatedBeforeNewWork: beforeAnchorCount,
    observationWindowBeforeNewWorkMs: profile.peerSyncIntervalMs*2+300, replicatedAfterNewWork: gated.length,
    timeToObservedReplicationBeforeNewWorkMs: fixed ? gateObservedMs : null,
    explanation: fixed ? "Exact extensions propagate at equal positive work, before a further mining block exists" : "Equal positive cumulative work does not trigger sync for new zero-work transfer blocks" };
  if (fixed) {
    for (const node of nodes) {
      const tx = await ok(node, `/api/transaction/${gated[0].id}`);
      assert.equal(tx.status, "anchored"); assert.equal(tx.powConfirmations, 1); assert.equal(tx.finalized, false);
      assert.equal(tx.finalityTimeMs, null);
      const block = await ok(node, `/api/block/${tx.blockHeight}`);
      const raw = await ok(node, block.canonicalPath);
      assert.equal(hashBlock(raw), raw.hash); assert.equal(raw.transactions[0].status, "confirmed");
      assert.equal(block.transactions[0].status, "anchored");
    }
    report.publicStatusChecks = { inclusionNotFinality: true, proofAnchoringNotFinality: true, canonicalBlockHashPreserved: true };
  }

  await collectMetrics("final");
  report.finalStorageStatus = await Promise.all(nodes.map(async node=>({node:node.label,...(await ok(node,"/api/status")).storage})));
  const states = await Promise.all(nodes.map(snapshot));
  for (const state of states) KorekChain.fromSnapshot(state,{peer:true});
  const stateHash = state => sha(JSON.stringify([state.chain.at(-1).hash, [...state.balances].sort(), state.feePool,
    state.minedSupply, state.testnetFaucetSupply, state.pending]));
  assert.equal(new Set(states.map(stateHash)).size, 1);
  await Promise.all(nodes.map(n => stop(n)));
  const diskStates = await Promise.all(nodes.map(n => new StateStore(join(n.directory, "state")).load()));
  for (let i = 0; i < nodes.length; i++) {
    KorekChain.fromSnapshot(diskStates[i],{peer:true}); assert.equal(stateHash(diskStates[i]), stateHash(states[i]));
  }
  const finalIds = new Set(states[0].chain.flatMap(block => block.transactions.map(tx => tx.id)));
  const acknowledged = allRecords.filter(r => r.httpStatus === 201);
  const missing = acknowledged.filter(r => !finalIds.has(r.id)).map(r => r.id);
  assert.deepEqual(missing, [right.id]);
  const expectedFinalCount = acknowledged.length-1;
  assert.equal(finalIds.size, expectedFinalCount);
  const finalChain = KorekChain.fromSnapshot(states[0]);
  assert.equal(finalChain.balance(sender.address), (BigInt(report.fundingProof.minerReward)-BigInt(expectedFinalCount)*21001n).toString());
  assert.equal(finalChain.balance(recipient.address), String(expectedFinalCount));
  report.finalState = { consistentAcrossNodes: true, restoredSnapshotsMatch: true, exactTransferBalancesMatched: true,
    height: states[0].chain.length-1, uniqueTransfers: finalIds.size, cumulativeWork: finalChain.cumulativeWork().toString(),
    acknowledgedTotal: acknowledged.length, acknowledgedButAbsent: missing,
    powerLossDurabilityTested: false, nodeFailuresOccurredAfterPriorPhaseAcknowledgments: true };
  report.completed = true;
} catch (error) {
  report.completed = false; report.failure = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all(nodes.map(node => stop(node).catch(error => events.push({ type: "cleanup-error", node: node.label, error: error.message }))));
  report.nodeMetrics = archiveMetrics; report.totalMs = clock();
  report.driver = { cpuUsageMicros: process.cpuUsage(), maxRssBytes: process.resourceUsage().maxRSS*1024 };
  report.limitations = ["Single same-host run; finite offered-rate windows and a small growing chain, not a sustainable capacity estimate",
    "Closed maximum-in-flight cap can throttle the offered schedule; recorded lateness must be inspected",
    "Driver polling, timing wrappers and three server processes compete on the same CPU/disk",
    "All-node observation is sampled, not exact arrival time, economic finality, or Byzantine consensus",
    "Rate-sweep transfer blocks add zero work but extend a real PoW-funded chain",
    "Crash tests stop owned processes after acknowledgments; no power loss, corrupt disk or mid-write fault injection",
    "No WAN, geographic decentralization, adversarial validator quorum, long-duration saturation, or public-testnet TPS measurement"];
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed, report: join(directory, "report.json"),
    finalState: report.finalState, failure: report.failure?.message }, null, 2));
}
