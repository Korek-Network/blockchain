import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { phaseMetrics } from "./metrics.mjs";

const report = JSON.parse(await readFile(new URL("./results/benchmark.json", import.meta.url), "utf8"));
const trace = await readFile(new URL("./results/latency-samples.jsonl", import.meta.url), "utf8");
assert.equal(createHash("sha256").update(trace).digest("hex"), report.rawTimingTrace.sha256);
const [header, ...rows] = trace.trim().split("\n").map(JSON.parse);
assert.equal(header.columns.length, 12);
assert.equal(rows.length, report.rawTimingTrace.rows);
assert.equal(new Set(rows.map(row => row[1])).size, rows.length);
for (const phase of report.phases) {
  const phaseRows = rows.filter(row => row[0] === phase.name);
  const records = phaseRows.map(row => ({ id: row[1], scheduledMs: row[2], sentMs: row[3], responseMs: row[4],
    httpStatus: row[5], responseId: row[6] ? row[1] : null }));
  const views = phase.nodesObserved.map(name => new Map(phaseRows.map(row => {
    assert.equal(row.length, 12);
    const observedMs = row[7 + ["A", "B", "C"].indexOf(name)];
    assert.ok(Number.isFinite(observedMs));
    return [row[1], { height: row[10], blockHash: row[11], observedMs }];
  })));
  const start = Math.min(...records.map(r => r.scheduledMs));
  const result = phaseMetrics(records, views, start, start+phase.elapsedThroughObservationMs, phase.offeredRate);
  for (const key of ["attempted", "accepted", "rejected", "transportErrors", "replicatedOnAllNodes",
    "completeBatchReplicationTps", "localAcknowledgmentTps", "ackLatency", "allNodeObservationLatency", "scheduleLateness"]) {
    assert.deepEqual(result[key], phase[key], `${phase.name}: ${key}`);
  }
  assert.equal(phase.finalityTps, null); assert.equal(phase.guaranteedFinalityMs, null);
}
console.log(`Recomputed recorded metrics from ${rows.length} timing rows. Trace consistency is not a security or finality proof.`);
