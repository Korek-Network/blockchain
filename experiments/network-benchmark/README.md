# KOREK local multi-node benchmark

The current security/storage follow-up uses P2P v3 and records evidence in
`results/durable/`. Run with `--fixed`; verify that evidence with `--durable`.
The existing `--fixed` verifier still checks the previous P2P-v2 evidence.
See [SECURITY_AND_STORAGE.md](../../docs/SECURITY_AND_STORAGE.md) for the release
blocker, storage-only comparison and compatibility requirements. Earlier reports
below are historical and their result files are preserved.

## Experimental fix rerun

The original evidence below is frozen at commit
`aad233179a5977d164572588636cf501906d2aca`. It describes the **pre-fix** behavior,
not the current branch. The confirmation/synchronization changes and the new
three-node results are documented in
[CONFIRMATION_AND_SYNC.md](../../docs/CONFIRMATION_AND_SYNC.md). New evidence is
kept separately in [results/fixed/benchmark.json](results/fixed/benchmark.json)
and [results/fixed/latency-samples.jsonl](results/fixed/latency-samples.jsonl).

On this branch, use `node experiments/network-benchmark/run.mjs --fixed` (add
`--smoke` for a short check), then
`node experiments/network-benchmark/verify-results.mjs --fixed` to verify the
committed fixed trace. The driver rejects a mismatched protocol/expectation mode.
The no-flag verifier still checks the original evidence without starting nodes.
Unlike the original benchmark-only branch, this branch **does change production
source**, but does not deploy it or change mining/supply rules.

## Original baseline report (historical)

**The benchmark works, but it does not establish finality or public-testnet TPS.**
It reproduced a locally "confirmed" transfer disappearing after a branch change,
and transfer propagation waiting for additional proof-of-work after mining began.
These correctness/confirmation semantics need attention before a speed-up claim.

No production source, live service, mining allocation, validator rule or deployment
configuration is changed. Everything runs on loopback with fresh local identities,
local faucet funds and isolated data directories. The three nodes are real
`src/server.js` processes, not mocked validators or an in-memory admission loop.

## Recorded run

7 September 2026; Node v24.19.0, Linux x64, AMD EPYC 9V74, nine visible logical
CPUs. Each offered-rate window is six seconds. Rates run sequentially against the
same growing chain, rather than independently reset databases. All 960 offered
rate-sweep transactions were accepted and observed in identical blocks on A, B
and C. No sweep request was rejected or had a transport error.

| Offered TPS | Transfers | Local acknowledgment TPS | Complete-batch replication TPS | All-node observation p95 |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 60 | 10.16 | 7.51 | 2.02 s |
| 50 | 300 | 50.07 | 37.12 | 7.78 s |
| 100 | 600 | 100.04 | 74.11 | 7.80 s |

**74.11 is a finite-batch result, not KOREK's maximum or sustainable TPS.** The
denominator includes waiting for the last observed replica after submission ends.
The 100-TPS submission schedule was followed closely: p95 lateness 0.64 ms, maximum
4.28 ms. Local acknowledgment p95 was 11.72 ms at that offered rate. Fast local
responses did not imply fast agreement across nodes. There is no measured TTF or
deterministic finality: those report fields are deliberately `null`.

The sweep uses zero-work transfer blocks before the controlled mining scenario.
It must not be generalized to an already-mining public network. The driver and
all nodes share CPU, disk and network stack; there is no WAN latency or geographic
decentralization. A short rate sweep is not a saturation or long-duration test.

## Failures and recovery

- **Follower crash:** C was killed with SIGKILL. A and B replicated 24 subsequent
  transfers. Restarted C caught up in about 2.44 seconds after restart began.
- **Ingress crash:** A was killed; the driver manually sent 24 transfers to B.
  B and C replicated them, and restarted A recovered in about 2.44 seconds.
  This does not demonstrate automatic routing or automatic leader election.
- **Partition/branch probe:** A and B each acknowledged a different signed
  transfer while disconnected. Their equal-height branches did not converge in
  the 4.3-second reconnect window. Extending A made all nodes select its branch;
  B's transfer, previously reported as `confirmed`, was absent on all three.
- **Positive-work propagation gate:** after a real signed client PoW block was
  accepted and replicated, A acknowledged 24 more transfers. None reached all
  nodes during a 4.3-second observation window. A second valid PoW block caused
  all 24 to propagate. This is the current greater-work selection rule in action.
- Exact duplicate and signature-tampered HTTP submissions were rejected.
- At the end, all nodes agreed on the tip and balances. Each saved snapshot was
  independently restored and checked, including exact sender/recipient accounting.

The run acknowledged 1,036 unique transfers overall. Exactly one—the deliberately
competing-branch transfer—was missing from final state; the other 1,035 remained.
Final height was 1,037, including two client-PoW blocks. This is not evidence of
general no-loss safety. Crashes occurred after prior phase acknowledgments, not
during disk writes. No power-loss, disk-corruption or Byzantine-quorum test ran.

## Where the time goes

The ingress node's method timings through the rate sweep, including warm-up:

| Instrumented operation | Median | p95 |
| --- | ---: | ---: |
| Transaction admission/signature validation | 0.246 ms | 0.414 ms |
| Sealing and execution | 0.0207 ms | 0.0505 ms |
| Snapshot persistence, including queue wait | 4.469 ms | 7.627 ms |

Persistence was a much larger measured local component than admission/execution.
The server writes a full snapshot after each transfer, rather than persisting
only the new transaction. These instrumented intervals are not a decomposition
of all HTTP costs; asynchronous times may overlap and must not simply be summed.

Default P2P polling remains two seconds. B recorded three failed synchronization
attempts and C six through the sweep, while eventual convergence succeeded.
The counter does not identify each error's cause. Full-chain snapshot validation
and retries are additional follow-up targets; do not attribute all latency solely
to polling or claim a particular fix's speed-up without another measurement.

## Source explanation and next change

The [transaction HTTP handler](../../src/server.js) calls `addTransaction`,
`sealPending`, then `StateStore.save` before responding. In
[the chain implementation](../../src/blockchain.js), `sealPending` creates
zero-difficulty, zero-reward blocks whose transactions are labeled `confirmed`.
Such blocks contribute zero to `cumulativeWork`.

[Peer selection](../../src/p2p.js) follows greater cumulative work; greater height
alone triggers synchronization only when both local and remote cumulative work
are zero. [The server's snapshot acceptance guard](../../src/server.js) also
rejects equal positive-work candidates. Updating only the P2P test would therefore
not be a complete propagation fix. Existing snapshot storage uses write/rename
but does not issue fsync: a successful write is not a power-loss durability proof.

Recommended next task: define and implement truthful acceptance/confirmation
states and safe same-chain-extension/reorganization rules, preserving the
stronger-work protection. Add regression checks for both scenarios above before
changing live behavior. Then benchmark incremental persistence/batching and peer
synchronization, followed by longer tests on geographically separated machines.
This benchmark does not authorize or perform those protocol changes.

## Reproduce and inspect the baseline

Use a separate checkout of baseline commit
`aad233179a5977d164572588636cf501906d2aca` for these historical no-flag run commands.
From its repository root, using Node 22 or newer, without additional dependencies:

```sh
node --test experiments/network-benchmark/metrics.test.mjs
node experiments/network-benchmark/run.mjs --smoke
node experiments/network-benchmark/run.mjs
```

The last command prints the path to its ignored `.runs/run-*/report.json`. To
export a completed run, pass that exact path to:

```sh
node experiments/network-benchmark/export-results.mjs PATH_PRINTED_BY_RUN
node experiments/network-benchmark/verify-results.mjs
```

The exporter writes a new ignored `export-*` directory, not over the committed
result. The verifier independently reconstructs committed latency percentiles
and throughput from the recorded timing rows; it starts no nodes. This checks
trace consistency, not cryptographic consensus or trust in the machine that ran it.

Committed evidence: [benchmark.json](results/benchmark.json) includes all metrics,
source hashes, failure results, configuration and limitations.
[latency-samples.jsonl](results/latency-samples.jsonl) retains all 1,008 rate/failure
phase timings, transaction IDs and common block placements. The first line defines
columns; times are unrounded monotonic milliseconds. Null observations identify
the intentionally offline node. Warm-up, branch-probe and mining-gate transfers
are counted separately in the final-state checks, not in this timing trace.

The benchmark configures difficulty 3 and a 250-ms reward interval solely to
bound its mining probes (source defaults: 7 and 60,000 ms). It does not override
signature validation, balances, transaction fees, fork selection, mining proof
validation or the default P2P polling interval. The driver explicitly snapshots
node observations; its 200-ms polling resolution contributes to measured latency.
Pre-signing time is measured separately. At most 16 requests may be in flight;
lateness is recorded so driver backpressure cannot be hidden as achieved load.

Peer lists are controlled through a benchmark-only IPC wrapper to create local
partitions and reconnect fresh ephemeral ports. The wrapper forces the production
P2P listener onto loopback and records method timings. Fresh key files are private
and ignored, never exported. Only owned child processes are stopped; no running
testnet node or existing state directory is contacted. Completed runs preserve
their local state/logs for inspection. SIGINT/SIGTERM cleanup stops owned nodes,
and children exit if their parent's IPC connection disappears.

All 75 repository tests passed, including six new metric/signature tests. The
end-to-end smoke run and full failure scenarios also passed their assertions.
Some assertions intentionally pin the current problematic fork behavior: after
changing consensus/confirmation rules, review those expectations rather than
treating a benchmark failure as a reason to restore the unsafe behavior.
