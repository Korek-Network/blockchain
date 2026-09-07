// Export a completed run without keys, snapshots, process logs or endpoint ports.
import assert from "node:assert/strict";
import { readFile, writeFile, realpath, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { commonPlacement, phaseMetrics } from "./metrics.mjs";

const root = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw new Error("Supply the report.json path printed by the benchmark");
const source = await realpath(resolve(process.argv[2]));
if (!source.startsWith(join(root, ".runs") + sep)) throw new Error("Only this experiment's local runs can be exported");
const report = JSON.parse(await readFile(source, "utf8"));
assert.equal(report.completed, true);
assert.ok(["korek-local-multinode-benchmark/1", "korek-local-multinode-benchmark/2"].includes(report.version));
const lines = [JSON.stringify({ columns: ["phase", "id", "scheduledMs", "sentMs", "responseMs", "httpStatus",
  "responseIdMatches", "A_observedMs", "B_observedMs", "C_observedMs", "blockHeight", "blockHash"] })];
for (const phase of report.phases) {
  const views = phase.nodesObserved.map(name => new Map(phase.records.map(r => [r.id, r.observations[name]])));
  // Recompute latency percentiles from retained per-node observations before export.
  const start = Math.min(...phase.records.map(r => r.scheduledMs));
  const recomputed = phaseMetrics(phase.records, views, start, start+phase.elapsedThroughObservationMs, phase.offeredRate);
  for (const name of ["ackLatency", "allNodeObservationLatency", "scheduleLateness"]) assert.deepEqual(recomputed[name], phase[name]);
  assert.equal(recomputed.completeBatchReplicationTps, phase.completeBatchReplicationTps);
  for (const record of phase.records) {
    const placement = commonPlacement(record.id, views);
    assert.ok(placement);
    lines.push(JSON.stringify([phase.name, record.id, record.scheduledMs, record.sentMs, record.responseMs, record.httpStatus,
      record.responseId === record.id, ...["A", "B", "C"].map(name => record.observations[name]?.observedMs ?? null),
      placement.height, placement.blockHash]));
  }
}
const trace = lines.join("\n") + "\n";
const summary = { ...report, phases: report.phases.map(({ records, ...phase }) => phase),
  rawTimingTrace: { file: "latency-samples.jsonl", rows: lines.length-1,
    sha256: createHash("sha256").update(trace).digest("hex"),
    units: "unrounded monotonic milliseconds since driver start; null observer means intentionally offline",
    recomputedPercentilesAndThroughputMatch: true } };
const output = await mkdtemp(join(dirname(source), "export-"));
await writeFile(join(output, "benchmark.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(join(output, "latency-samples.jsonl"), trace);
console.log(JSON.stringify({ output, records: lines.length-1, rawTimingSha256: summary.rawTimingTrace.sha256 }, null, 2));
