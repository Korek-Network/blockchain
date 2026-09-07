import test from "node:test";
import assert from "node:assert/strict";
import { KorekChain, blockWork } from "../../src/blockchain.js";
import { summarize, wallet, transfer, commonPlacement, phaseMetrics } from "./metrics.mjs";

test("percentiles handle empty samples and reject invalid durations", () => {
  assert.equal(summarize([]).p50Ms, null);
  assert.deepEqual(summarize([4, 1, 3, 2]), { count: 4, p50Ms: 2, p95Ms: 4, maxMs: 4 });
  assert.throws(() => summarize([-1])); assert.throws(() => summarize([NaN]));
});
test("benchmark signs real version-three transfers with fees and unique IDs", () => {
  const chain = new KorekChain(), sender = wallet(), recipient = wallet(), now = Date.now();
  chain.claimFaucet(sender.address);
  const a = transfer(sender, recipient.address, now), b = transfer(sender, recipient.address, now+1);
  assert.notEqual(a.id, b.id);
  assert.equal(chain.addTransaction(a.tx).id, a.id);
  assert.throws(() => chain.addTransaction(a.tx), /Duplicate/);
  assert.throws(() => chain.addTransaction({ ...b.tx, amount: "2" }), /signature/);
  chain.sealPending();
  assert.equal(chain.transaction(a.id).status, "confirmed");
  assert.equal(chain.transaction(a.id).fee, "21000");
  assert.equal(blockWork(chain.chain.at(-1)), 0n); // API-style "confirmed" is not finality.
});
test("replication requires every observer and identical block placement", () => {
  assert.equal(commonPlacement("id", []), null);
  const a = new Map([["id", { blockHash: "a", height: 1, observedMs: 10 }]]);
  const b = new Map([["id", { blockHash: "a", height: 1, observedMs: 15 }]]);
  assert.equal(commonPlacement("id", [a, b]).observedMs, 15);
  assert.equal(commonPlacement("id", [a, new Map()]), null);
  b.get("id").blockHash = "fork";
  assert.equal(commonPlacement("id", [a, b]), null);
});
test("partial results never become complete-batch TPS or finality", () => {
  const records = [{ id: "a", responseId: "a", httpStatus: 201, scheduledMs: 0, sentMs: 0, responseMs: 2 },
    { id: "b", responseId: "b", httpStatus: 201, scheduledMs: 1, sentMs: 1, responseMs: 3 }];
  const view = new Map([["a", { blockHash: "h", height: 1, observedMs: 10 }]]);
  const result = phaseMetrics(records, [view, view], 0, 100, 10);
  assert.equal(result.replicatedOnAllNodes, 1); assert.equal(result.unreplicatedAccepted, 1);
  assert.equal(result.completeBatchReplicationTps, null); assert.equal(result.finalityTps, null);
});
test("rejections and network errors are included in attempted-work denominator", () => {
  const records = [{ id: "a", responseId: "a", httpStatus: 201, scheduledMs: 0, sentMs: 0, responseMs: 2 },
    { id: "b", httpStatus: 400, scheduledMs: 1, sentMs: 1, responseMs: 3 },
    { id: "c", httpStatus: null, scheduledMs: 2, sentMs: 2, responseMs: 4 }];
  const view = new Map([["a", { blockHash: "h", height: 1, observedMs: 10 }]]);
  const result = phaseMetrics(records, [view], 0, 100, 10);
  assert.equal(result.attempted, 3); assert.equal(result.rejected, 1); assert.equal(result.transportErrors, 1);
  assert.equal(result.completeBatchReplicationTps, null);
});
test("complete replication timing includes the last node rather than last HTTP acknowledgment", () => {
  const records = [{ id: "a", responseId: "a", httpStatus: 201, scheduledMs: 0, sentMs: 0, responseMs: 2 }];
  const a = new Map([["a", { blockHash: "h", height: 1, observedMs: 10 }]]);
  const b = new Map([["a", { blockHash: "h", height: 1, observedMs: 100 }]]);
  const result = phaseMetrics(records, [a, b], 0, 101, 10);
  assert.equal(result.completeBatchReplicationTps, 10); assert.equal(result.localAcknowledgmentTps, 500);
});
