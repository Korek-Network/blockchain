# Fresh-testnet rehearsal results

Run: `node experiments/network-benchmark/run.mjs --fixed --fresh --smoke`.
The isolated three-process loopback run passed. Evidence is in
`experiments/network-benchmark/results/fresh-rehearsal.json`.

- Network testnet-2, version 4 signed transfers, real lab PoW funding.
- All 35 rate-sweep transfers replicated, plus outage and fork scenarios.
- Follower SIGKILL and manual ingress failover recovered.
- Before the faucet stage, all nodes and disk restores agreed at height 53,
  retaining 50 of 51 acknowledged transfers. The deliberate stronger-work fork
  orphaned one tentative transfer as expected.
- A subsequent 1 KRK faucet payout replicated across all three nodes with no
  new supply. Faucet cooldown remained enforced after the faucet node was killed
  and restarted.
- All 127 Node regression tests pass after the harness update.

This is a short functional rehearsal, not a capacity, WAN or finality measurement.
The finalState evidence field precedes the additional faucet stage. The test uses
difficulty 3 and a 250ms reward interval, not deployment defaults.

Packaging checks: Bun 1.4.2 compiled the Linux x64 node and the executable started
on an isolated empty testnet-2 directory. All 13 SQLite storage tests passed under
Bun, including rollback and forced-process recovery. This does not establish
Windows/macOS binary behavior or full multi-node behavior under compiled Bun.
Node 24 remains the runtime used for the three-node rehearsal.

Public deployment, packaged desktop interaction/GPU testing, other operating
systems, multi-host rehearsal and independent security review remain outstanding.
No release or live reset was performed.
