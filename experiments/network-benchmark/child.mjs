// Instrumented launcher for the ACTUAL production server. No transaction or
// fork-choice behavior is replaced. Test-only changes: loopback binding,
// configured lab environment, metrics, and driver-controlled peer lists.
import { Server } from "node:net";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { KorekChain } from "../../src/blockchain.js";
import { StateStore } from "../../src/storage.js";
import { P2PNetwork } from "../../src/p2p.js";
import { summarize } from "./metrics.mjs";

if (!process.send || !process.argv[2]) throw new Error("Use the isolated benchmark driver");
process.on("disconnect", () => process.exit(1)); // Never leave test servers behind if their owner exits.
const directory = resolve(process.argv[2]), label = process.argv[3];
let network, activeSync = 0, listener = 0;
const stats = new Map(), listeners = ["p2p", "api", "miner"];
function record(name, elapsed, failed) {
  const entry = stats.get(name) ?? { calls: 0, failures: 0, totalMs: 0, samples: [] };
  entry.calls++; entry.failures += Number(failed); entry.totalMs += elapsed;
  if (entry.samples.length < 10000) entry.samples.push(elapsed);
  stats.set(name, entry);
}
function timed(target, method, name, asyncMethod = false) {
  const original = target[method];
  target[method] = asyncMethod ? async function (...args) {
    const start = performance.now(); let failed = false;
    if (name === "peerSync") activeSync++;
    try { return await original.apply(this, args); } catch (error) { failed = true; throw error; }
    finally { record(name, performance.now()-start, failed); if (name === "peerSync") activeSync--; }
  } : function (...args) {
    const start = performance.now(); let failed = false;
    try { return original.apply(this, args); } catch (error) { failed = true; throw error; }
    finally { record(name, performance.now()-start, failed); }
  };
}
timed(KorekChain.prototype, "addTransaction", "admission");
timed(KorekChain.prototype, "sealPending", "sealAndExecution");
timed(KorekChain, "fromSnapshot", "snapshotValidation");
timed(StateStore.prototype, "save", "snapshotSaveIncludingQueue", true);
timed(P2PNetwork.prototype, "syncOnce", "peerSync", true);
const originalStart = P2PNetwork.prototype.start;
P2PNetwork.prototype.start = async function (...args) { network = this; return originalStart.apply(this, args); };
const originalListen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  // Production P2P omits a host; constrain that listener to loopback for safety.
  if (typeof args[0] === "number" && (args.length === 1 || typeof args[1] === "function")) args.splice(1, 0, "127.0.0.1");
  const kind = listeners[listener++];
  if (!kind || args[1] !== "127.0.0.1") throw new Error("Unexpected/non-loopback benchmark listener");
  this.once("listening", () => process.send({ type: "listener", kind, ...this.address() }));
  return originalListen.apply(this, args);
};

process.on("message", async message => {
  try {
    let result;
    if (message.command === "peers" || message.command === "disconnect") {
      network.peers.clear();
      const deadline = performance.now()+20000;
      while (activeSync) { if (performance.now()>deadline) throw new Error("Peer operation did not quiesce"); await delay(10); }
      network.peers.clear(); // In-flight discovery may have populated the first cleared map.
      for (const address of message.command === "peers" ? message.urls : []) {
        const url = new URL(address);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Non-local peer");
        network.addPeer(address, "benchmark-wiring");
      }
      result = { configured: network.peers.size };
    } else if (message.command === "metrics") {
      result = { methods: Object.fromEntries([...stats].map(([key, value]) => [key,
        { calls: value.calls, failures: value.failures, totalMs: value.totalMs, ...summarize(value.samples) }])),
      cpuUsageMicros: process.cpuUsage(), maxRssBytes: process.resourceUsage().maxRSS*1024 };
    } else throw new Error("Unknown benchmark control");
    process.send({ type: "reply", requestId: message.requestId, result });
  } catch (error) { process.send({ type: "reply", requestId: message.requestId, error: error.message }); }
});

process.argv = [process.execPath, resolve(new URL("../../src/server.js", import.meta.url).pathname),
  "--name", `benchmark-${label}`, "--api-host", "127.0.0.1", "--miner-host", "127.0.0.1",
  "--miner-listen-port", "0", "--p2p-port", "0", "--node-key-file", join(directory, "node-key.json"),
  "--data-dir", join(directory, "state")];
await import("../../src/server.js");
