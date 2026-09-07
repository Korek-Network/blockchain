# Replay validation and SQLite recovery

Experimental follow-up to `c26859e`, tested on Node v24.19.0/Linux. **Not deployed
or merged into main.** This fixes the reproduced peer-balance acceptance problem
for PoW-funded histories and replaces the custom journal writer. It is not an
independent security audit, a new Rust/DAG engine, or production release approval.

## Which approach is better?

| Area | Previous implementation | This implementation |
| --- | --- | --- |
| Peer balances | Accepted supplied account balances if aggregate limits passed | Reconstructs each account from verified reward and transfer history and compares it with the supplied state |
| Faucet history | Off-chain grants could travel in a peer snapshot | Rejected by peer validation; faucet remains single-node only |
| Storage | Custom append/checkpoint/truncation journal with an unexplained sequence-gap incident | SQLite transactions, rollback journaling and EXTRA synchronization |
| Concurrent writers | Length guard, no atomic revision check | SQLite write lock plus revision comparison rejects stale writers |
| Compatibility | Node 22 and journal format v2 | Node 24+, SQLite storage v3 and P2P protocol v4 |

Prefer this approach for correctness and recovery. It has migration costs and is
not established as faster. SQLite is the storage backend; the blockchain engine
is still JavaScript/Node. Storage grouping is not consensus transaction batching.

## Balance validation

`validatePeerLedger` starts with zero balances at genesis, applies transfers in
order, rejects spending before funding, and credits verified miner/treasury payouts.
Existing signature, replay, gas, fee-pool, subsidy, proof and cumulative-work checks
still apply. Every claimed account must match the reconstructed balance. Pending
transfers remain subject to reservation checks.

Valid transfers, self-transfers, fees and subsequent mining payouts pass. Shifting
funds between accounts while keeping supply unchanged fails, including through a
real signed P2P response. Removing a funding proof or relabeling faucet balances
does not legitimize unearned funds. The security gate now tests valid and invalid
histories, not merely rejection of one faucet example, and passes.

There is **no trustworthy faucet event history in existing blocks**. Rather than
invent one, peer validation rejects nonzero faucet supply or faucet claims. The
HTTP faucet endpoint is disabled when P2P is configured. Historical local snapshots
and single-node compute/faucet experiments remain readable offline, but do not
become network-valid by importing them. No balances were reset or altered on a
running node. A reviewed migration or fresh isolated PoW-funded network is needed.

## Storage replacement

`StateStore` now uses `node:sqlite` with rollback journal mode `DELETE` and
`synchronous=EXTRA`. SQLite owns transaction rollback and file synchronization;
the node no longer appends to or truncates the custom journal. Calls still group
over five milliseconds and the pending queue remains bounded. Blocks and snapshot
metadata update inside one transaction, with a checksum covering both. Prefix
comparisons still scan history; only changed block rows are written.

A revision is checked inside `BEGIN IMMEDIATE`, so another writer cannot silently
overwrite a newer state. A failed transaction rolls back and rejects its callers.
Data files use mode 0600. Readback checks SQLite integrity, block ordering and state
checksum. Sync or migration failures stop acknowledgments rather than reporting
success. Hardware power loss and every filesystem failure mode have not been tested.

See the [Node SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) and
[SQLite synchronization settings](https://www.sqlite.org/pragma.html#pragma_synchronous)
for the underlying interfaces. Their guarantees still depend on the OS and storage
hardware behaving correctly.

The old journal is now handled only by `LegacyStateReader`. Valid legacy state can
be imported without rewriting the journal; the original snapshot is backed up as
`chain-state.json.pre-sqlite` and a version-3 marker makes old readers refuse the
directory. Migration fails closed on missing journal records or corruption.
**Already missing records cannot be reconstructed by this change.** The historical
914-to-937 gap remains preserved in the previous review; its cause was not proven.
The affected custom writing/rotation path has been retired, not declared repaired
by speculation about that incident.

## Validation

- **121 regression tests pass.** The balance-security gate passes.
- A real peer offering altered balances is rejected before adoption.
- Fault injection after partial SQL updates rolls back to the prior state.
- SIGKILL during a transaction restores the previous acknowledged state; SIGKILL
  after commit preserves every acknowledgment observed by the test parent.
- Stale writers, checksum damage, malformed databases and broken legacy journals
  fail closed. Valid legacy import preserves its source files.
- Both a smoke test and a full three-node run passed. The full run accepted and
  replicated all 960 offered sweep transactions. Final state matched across nodes
  and disk restore: height 1,038, three real PoW blocks, and 1,035 retained of 1,036
  acknowledged transfers. The one deliberately competing transfer was orphaned
  after a stronger-work fork; inclusion remains reversible.

Evidence is stored separately in
[results/replay-sqlite/benchmark.json](../experiments/network-benchmark/results/replay-sqlite/benchmark.json)
and its raw timing trace. This run funds the sender through real PoW instead of a
faucet and measures transfers on a chain with positive work from the start. Earlier
runs used different funding/history, so their rates are not a controlled speed
comparison. Source hashes identify the tested edits before their commit.

At 100 offered TPS, this short same-host run measured 74.87 complete-batch
replication TPS and 2.24 s p95 all-node observation latency. Neither is maximum
capacity or finality. All 24 post-mining transfers replicated before a further
proof block; the follower and ingress restart checks recovered in about 2.60
and 2.62 seconds. Earlier throughput numbers must not be presented as a direct
speed-up comparison with this differently funded workload.

## Reproduce and migration limits

Use Node 24 or later on an isolated development machine:

```sh
npm test
node scripts/security-gate.mjs
node experiments/network-benchmark/run.mjs --fixed --smoke
node experiments/network-benchmark/run.mjs --fixed
node experiments/network-benchmark/verify-results.mjs --sqlite
```

P2P is now `korek-planck-p2p/4`; do not mix earlier protocols. Mining protocol v3,
genesis and reward allocation remain unchanged. Stop the node and back up the
complete directory before migration; do not downgrade in place or remove a damaged
journal to force startup. SQLite imports do not bypass peer replay validation.

Node 24 is required by this branch. The existing Bun standalone-binary pipeline
has **not been validated with node:sqlite**; no new binaries or releases were built.
Independent review, packaged-runtime testing and a coordinated network migration
are still needed before deployment. No maximum TPS, finality or decentralization
claim is established by these local runs.
