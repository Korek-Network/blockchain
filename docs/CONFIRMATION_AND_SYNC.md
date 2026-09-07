# Experimental confirmation and synchronization fixes

Implemented and tested locally on 7 September 2026. **Not deployed.** This is a
correctness patch for the existing JavaScript/Node engine, not a Rust or DAG
engine, a finality protocol, or evidence of 10,000/50,000 real-world TPS.

## What changed

- Both peer synchronization and the server adoption guard use the same selection
  rule. A validated, same-genesis candidate wins with strictly greater cumulative
  proof-of-work, even if shorter. At equal work, it must be longer and every local
  block hash must be an identical prefix. Lower work and conflicting equal-work
  forks are rejected. These checks use computed work, not a peer's claim.
- Transfers on an exact extension can now propagate after mining starts without
  waiting for another PoW block. Longer conflicting zero-work branches no longer
  replace the selected chain simply by adding blocks.
- Incremental downloads follow an advancing peer using the final signed response's
  matching height, tip and state. Downloads check continuity, bound range requests
  and response size, and fall back to a full snapshot when necessary. Overlapping
  synchronization calls share one run. An invalid or incompatible top-ranked peer
  does not prevent trying another eligible peer.
- The candidate is checked against current local state after downloading, then
  independently validated and checked again by the server before adoption. A
  server veto is no longer counted as successful synchronization.
- API and explorer observations distinguish local inclusion from proof anchoring.
  Pending snapshot entries cannot spoof placement in an existing block. If a
  transaction leaves the selected chain while its submission is awaiting storage,
  the handler returns HTTP 409 with `status: "reorganized"`, not HTTP 201 with null.

These are targeted protections, **not a complete hostile-network security audit**.
Equal-work conflicting branches may remain split until additional real work
resolves them. A stronger-work reorganization may remove either an included or an
anchored transfer. There is no automatic orphan requeue or persistent receipt
journal; later lookup of a removed transaction returns 404.

## Observation API version 2

Ordinary transaction and block endpoints return an observation of the node's
currently selected chain. They do not promise network-wide agreement.

| Field | Meaning on this branch |
| --- | --- |
| `status: "pending"` | Transaction is not in the selected block history. |
| `status: "included"` | In the selected history, with no accepted client-PoW block at or after its height. |
| `status: "anchored"` | At least one accepted client-PoW block at or after its height; still reversible. |
| `includedAt`, `inclusionTimeMs` | Recorded local inclusion timestamp and delay. Not TTF. |
| `anchoredAt` | Timestamp of the first such PoW block, or null. |
| `powConfirmations`, `confirmations` | Count of such PoW blocks; zero-work blocks do not increase this count. |
| `blockDepth` | Selected block depth, counting the containing block, separately from PoW confirmations. |
| `confirmedAt`, `confirmationTimeMs` | Compatibility field names now describe anchoring time/delay, or null. Neither is finality. |
| `finalized`, `finalityTimeMs`, `canReorganize` | Always `false`, null and `true`, respectively. No irreversible-finality claim. |
| `observationVersion` | `2`; genesis block observations use status `genesis`. |

The network metadata now has `finalityTargetMs: null`,
`finalityMode: "not-guaranteed"` and `localInclusionTargetMs: 200`. That inclusion
target is configuration, not a measured latency guarantee. The explorer labels
sampled throughput as local TPS and its timing statistic as average inclusion.

### Canonical bytes versus public views

Persisted and P2P block/transaction bytes retain their historical encoding,
including legacy `status: "confirmed"` and `rapid-testnet-finality` strings. These
strings are hash-covered history, **not evidence of actual finality**. The patch
does not rewrite old blocks, change their hashes or change mining/supply rules.

Public block views add `representation: "api-observation-not-canonical"` and a
`canonicalPath`. **Do not hash public observation transactions as block data.**
For raw hash verification request `/api/block/<hash>?format=canonical`, or use the
canonical blocks in a verified P2P snapshot. The raw endpoint intentionally
retains legacy status strings. `sizeBytes` in a block view measures its canonical
JSON size, not the larger projected API response. Consumers relying on raw blocks
from `/api/blocks` must migrate to the canonical endpoint.

## Compatibility and deployment gate

This changes equal-work selection policy and requires signed P2P protocol
`korek-planck-p2p/2`. Version-1 peers fail closed. The node's display version stays
`0.7.1`, so do not use that label as the compatibility check. Mining protocol v3,
network ID, genesis and monetary parameters are unchanged.

Do not mix old and new peers, publish this as a release, or replace live state
without review. First audit the changes and broader state validation, then arrange
an explicit, coordinated isolated-testnet upgrade with state backups and compatible
API clients. Keep original snapshots intact for recovery. Compatibility testing
restored the baseline's 1,037-block state without changing its serialized chain
snapshot; it does not prove compatibility with every historical file.

## Measured local rerun

Evidence: [fixed summary](../experiments/network-benchmark/results/fixed/benchmark.json)
and [1,008 timing rows](../experiments/network-benchmark/results/fixed/latency-samples.jsonl).
The [original evidence](../experiments/network-benchmark/results/benchmark.json)
is preserved separately. Both used three actual server processes on one host,
Node v24.19.0, Linux x64, AMD EPYC 9V74 and nine visible logical CPUs. Each offered
rate ran for six seconds against a growing chain. The lab used difficulty 3 and
a 250-ms reward interval; source defaults remain 7 and 60,000 ms. Peer polling
remained two seconds and observation polling 200 ms.

| Offered TPS | Transfers replicated on all 3 nodes | Baseline observation p95 | Patched observation p95 | Patched complete-batch replication TPS |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 60/60 | 2.02 s | 2.03 s | 7.50 |
| 50 | 300/300 | 7.78 s | 2.11 s | 36.92 |
| 100 | 600/600 | 7.80 s | 2.28 s | 73.35 |

At 100 offered TPS, local acknowledgment p95 was 26.22 ms versus 11.72 ms in the
baseline. Complete-batch replication TPS was 73.35 versus 74.11. This run shows
lower sampled replication latency at higher offered rates, **not increased
throughput capacity**; the runs are not repeated controlled trials. The finite-
batch denominator includes the final replication wait. None of these numbers is
TTF, a maximum TPS, sustainable capacity or public-network performance.

The focused checks passed:

- **Post-mining propagation:** 24/24 transfers reached all nodes before another
  PoW block, observed about 2.18 seconds after the submission batch ended. The
  original run observed 0/24 in its 4.3-second pre-proof window. These transfers
  were `included`, with zero PoW confirmations; the next proof made them
  `anchored`, not finalized.
- **Conflicting branches:** extending A without work did not replace B's fork.
  A real proof then made A stronger and caused convergence. B's deliberately
  competing transfer disappeared, having been reported as `included`, not final.
- **Crash/restart:** follower and manually rerouted ingress tests each recovered
  all applicable transfers; restart-to-observation was about 2.60 seconds each.
  This was manual routing and address rewiring, not automatic failover.
- Duplicate and signature-tampered HTTP submissions were rejected. API status and
  canonical block hash checks passed. Final tips, balances and restored snapshots
  matched across nodes: 1,035 retained transfers of 1,036 acknowledged, with the
  one deliberately orphaned transfer accounted for; height 1,037 and two PoW blocks.
- **95 repository tests passed**, including 19 confirmation/synchronization tests
  and a DOM-stub explorer regression. The short end-to-end smoke and full failure
  runs also passed. This is not a visual browser layout audit. Nested proof-system
  dependency tests were not rerun for this patch.

The result's `sourceCommit` records the checked-out baseline before these edits
were committed. Its per-file `sourceSha256` and `benchmarkSourceSha256` identify
the actual modified code used for this rerun.

## Reproduce

From this branch, using Node 22 or newer:

```sh
npm test
node experiments/network-benchmark/run.mjs --fixed --smoke
node experiments/network-benchmark/run.mjs --fixed
node experiments/network-benchmark/export-results.mjs PATH_PRINTED_BY_RUN
node experiments/network-benchmark/verify-results.mjs --fixed
node experiments/network-benchmark/verify-results.mjs
```

Runs use only fresh loopback nodes, local faucet funds and ignored state. The
exporter creates a new ignored directory without overwriting committed results.
The verifiers recompute trace metrics, not consensus security or trust in the host.

## Remaining work

The engine still writes and validates whole snapshots. Persistence has no fsync
power-loss guarantee; crashes here happened after prior acknowledgments, not
during a write. Snapshot balance/faucet state needs independent replay/state-
commitment review: existing aggregate accounting and signatures do not establish
full adversarial ledger-state correctness. Peer identity signatures are not a
validator quorum or eclipse resistance. The 16-MiB response cap and 32-range
fallback are bounds, not a complete denial-of-service or long-chain design.

Next: independently review fork choice, state validation and migration before any
deployment. Then benchmark incremental durable storage and batching, followed by
long-duration and geographically separated tests with adversarial traffic. These
changes do not establish decentralization, finality, or a high-TPS new engine.
