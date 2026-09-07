# Experimental security review and journal storage

Historical report at commit `c26859e`. The follow-up
[REPLAY_SQLITE_FIX.md](REPLAY_SQLITE_FIX.md) documents replay validation, the now
passing balance gate, and replacement of the custom writer by SQLite. The prior
incident and evidence below remain preserved; they describe the previous version.

**Release blocked; not deployed.** This follow-up builds on
`fix/confirmation-and-sync` (commit `3a639e7`). It is an implementation review and
local regression work, not an independent security audit. Main, live services,
mining parameters and supply rules have not been changed by this branch.

## Confirmed security fixes

Four regression cases failed against the previous source and pass with this patch:

1. Peer snapshots now require an accepted client proof for reward issuance. Legacy
   `mine()` helper rewards without client proofs remain readable for offline
   historical testing, but cannot enter the peer network. Startup with P2P enabled
   also checks saved chain history against this rule.
2. Snapshot restore requires the expected genesis hash, rather than merely a
   self-consistent first block.
3. Stored signed transactions must satisfy positive, bounded numeric/gas rules
   and authentication-size limits. A signature alone does not make a negative gas
   price, zero price or undersized limit valid.
4. Persisted pending transfers cannot reserve more than the sender's balance.

Additional checks require a peer client-proof block to retain its signed timestamp,
consistent timing fields, empty transaction list and configured block interval.
A real peer test confirms proofless reward issuance never reaches the server
adoption callback. The stronger-work and exact-extension rules remain in place.

These stricter peer rules use **`korek-planck-p2p/3`**. Version-1 and version-2 peers
are incompatible. The display version remains 0.7.1 and is not a compatibility
signal. The miner protocol stays v3. No mainnet consensus or finality is introduced.

## Blocking finding: balances are not fully reconstructed

`node scripts/security-gate.mjs` deliberately exits **1** on this revision. It
constructs a local candidate that keeps total faucet supply unchanged but moves a
faucet balance to a different address. The candidate extends genesis, passes
current snapshot validation, and is eligible for adoption. No live node, remote
endpoint or real funds are involved in this check.

Block hashes, signatures and aggregate accounting do not bind all supplied account
balances to a replayable issuance/transfer history. Faucet grants and compute state
also include effects outside canonical block transactions. This is a deployment
blocker. The release-build workflow now runs this gate and stops while it fails;
passing unit tests must not be treated as release approval.

The next protocol task is to specify recorded faucet/issuance events, their
authorization, deterministic execution and state commitments, then reconstruct
each account and fee pool from validated history. Existing faucet grants cannot
be retrospectively proven from the current block log. A reviewed migration or
fresh isolated network will be needed; do not silently treat arbitrary peer state
as a trusted checkpoint. Independent review remains required after that work.

## Storage changes

- `StateStore` writes checksummed, sequence-linked journal records to
  `chain-journal.jsonl`. An exact history extension records new blocks and the
  other state fields. Fork replacements and compute bundles use a full replacement.
- Save calls are grouped over five milliseconds. Ordinary snapshot arguments are
  copied at call time, fixing the old mutable-reference queue problem. Explicit
  provider functions capture current state when a group commits. The transaction
  handler verifies the transaction remains selected after storage completes; a
  mining acknowledgment also checks that its block remains selected.
- A save resolves after file `fsync` and directory `fsync`. Periodic checkpoints
  write a temporary file, sync it, rename it, sync the directory, then truncate and
  sync the covered journal. The default checkpoint interval is 128 journal groups.
- The first write installs a version-2 checkpoint before any journal acknowledgment.
  Older snapshot readers therefore reject the directory instead of silently
  loading stale version-1 data. The checksum includes the checkpoint's sequence
  and journal hash as well as its state.
- Recovery checks complete-record checksums and links. Only an unterminated final
  record is ignored, then removed before another append. A corrupt complete record
  fails closed. Recovery handles a journal left untrimmed after a durable checkpoint.
- The pending-save queue is bounded to 1,024 entries. Storage errors reject pending
  saves and stop later mutations until restart/repair. `/api/status` reports storage
  mode, health, queued saves, commits, checkpoints and bytes written.
- Journal length is checked before and after an append. Detected truncation or
  concurrent modification stops later acknowledgments; this is not a file lock
  and cannot prevent an external process from altering already committed files.

This groups **storage writes**, not multiple transactions into a new consensus
block. Prefix comparisons still scan history, balance metadata is still rewritten,
and incoming snapshots still undergo full validation. Those CPU and account-growth
costs remain. WAL checksums detect corruption; they do not authenticate hostile
disk edits or supply missing consensus validation.

## Compatibility and operations

Only isolated Linux runs have been verified. Directory-sync behavior on other
platforms needs validation; failures are not silently downgraded to unsafe writes.
There must be **one writer per data directory**; no multiprocess lock is implemented.
Take a complete stopped-node backup before migration. The checkpoint **and journal**
are both required for restoration; do not copy just `chain-state.json` from an
active node, downgrade in place, or delete the journal to bypass a restore error.
Existing version-1 files are readable, but writing upgrades the storage format.

A save acknowledgment means the required OS sync calls succeeded. It does not prove
hardware power-loss behavior, Byzantine safety or transaction finality. A storage
error can leave unacknowledged state on disk; after repair, clients must check the
selected chain before retrying. Forks may still remove previously included or
PoW-anchored transfers. The explorer continues to report no guaranteed finality.

## Verification and performance evidence

Run:

```sh
npm test
node scripts/security-gate.mjs
node experiments/network-benchmark/storage-benchmark.mjs
node experiments/network-benchmark/run.mjs --fixed
node experiments/network-benchmark/verify-results.mjs --durable
```

The security-gate command above is expected to fail until the stated ledger
problem is fixed. The regression suite passes 115 tests, including disk-sync
failure, torn-tail recovery, checkpoint rotation, downgrade protection, immutable
queued snapshots, bounded save groups and SIGKILL recovery. The crash test retains
every acknowledgment received by the parent; extra unacknowledged state may survive.
These tests do not simulate actual power loss or every filesystem failure mode.

One development repeat failed at final recovery with a sequence gap (914 to 937)
in node A's journal. A restart-plus-60-append check and a subsequent isolated full
rerun passed. Workspace editing occurred during the failed run, but the root
cause has **not been established**. The new length guard has a deterministic
truncation regression. Preserve this incident for independent storage review;
later passing runs do not erase it or establish production durability.

The recorded storage-only comparison uses 512 prebuilt signed-transfer snapshots,
serial and burst-16 calls, and the prior store at commit `3a639e7` as its baseline.
Each condition runs once. The prior store does not call fsync, so latency is not an
equal-durability comparison. Values are storage-save rates, **not blockchain TPS**.
Final metrics are retained in
[storage-comparison.json](../experiments/network-benchmark/results/durable/storage-comparison.json).

| Workload | Prior saves/s | Journal saves/s | Prior bytes written | Journal bytes written |
| --- | ---: | ---: | ---: | ---: |
| Serial | 403.07 | 108.78 | 163,717,555 | 2,545,653 |
| Burst of 16 | 460.00 | 626.72 | 163,717,555 | 656,829 |

Burst grouping reduced 512 journal saves to 32 commits. Serial calls were slower
because grouping delay and disk synchronization add latency. These are local
storage results, not evidence that network transaction capacity increased.

The final three-node run and its 1,008 raw timing rows are retained separately in
[benchmark.json](../experiments/network-benchmark/results/durable/benchmark.json)
and [latency-samples.jsonl](../experiments/network-benchmark/results/durable/latency-samples.jsonl).
Previous baseline and confirmation-fix evidence remains unchanged. Source file
hashes identify the code actually run; `sourceCommit` names its checked-out parent
before edits were committed. No WAN, sustainable capacity, 10,000/50,000 TPS,
geographic decentralization or deterministic-finality claim follows from these runs.

| Offered TPS | Replicated transfers | All-node observation p95 | Complete-batch replication TPS |
| ---: | ---: | ---: | ---: |
| 10 | 60/60 | 2.03 s | 7.49 |
| 50 | 300/300 | 2.11 s | 37.01 |
| 100 | 600/600 | 2.26 s | 73.51 |

The previous confirmation-fix run measured 73.35 complete-batch TPS and 2.28 s
observation p95 at 100 offered TPS. This follow-up therefore establishes no
material network-throughput improvement. Its acknowledgment p95 was 26.75 ms.
All 24 post-mining transfers propagated before another proof, observed about
2.11 seconds after submission ended. Follower and ingress restart recovery took
about 2.58 and 2.62 seconds. Final state restored identically across all three
nodes, with the one deliberately competing transfer correctly accounted for as
orphaned after a stronger-work fork (1,035 retained of 1,036 acknowledged).

## Next work

Resolve replayable balances and faucet/issuance history before a coordinated
testnet upgrade. After review, measure transaction batching and incremental
validation, then run long-duration tests on separately operated, geographically
distributed nodes. Server access and that deployment remain outside this local
implementation; nothing here has upgraded the running public testnet.
