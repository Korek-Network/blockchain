# KOREK architecture

KOREK is an experimental proof-of-work settlement network with a research path toward independently verifiable distributed computation. Consensus must remain safe when no useful-compute jobs are available, so useful work cannot replace the chain's independently verifiable security proof without a reviewed protocol.

Planck seals transfers into zero-work blocks separately from reward blocks. This is local inclusion, not finality: it neither mints KRK nor advances the reward-halving counter. A later accepted client-PoW block anchors prior transfers on the selected branch, but stronger-work reorganizations remain possible. See [confirmation and synchronization](CONFIRMATION_AND_SYNC.md) for the experimental observation API and P2P-v2 rules.

## Supply model under test

KRK has a proposed hard cap of 210,000,000 coins at eight decimals and zero genesis premine. All issuance begins with accepted proof-of-work blocks.

- Initial total block subsidy: 50 KRK
- Reward-block target: 60 seconds
- Halving interval: 2,100,000 reward blocks
- Successful miner: 95% of subsidy plus 100% of transaction fees
- Public treasury: 5% of subsidy
- Founder/team/private genesis allocation: none

At the initial subsidy, the miner receives 47.5 KRK plus fees and the treasury receives 2.5 KRK. Integer base-unit arithmetic determines later fractional payouts. Faucet KRK is test-only, excluded from issuance counters, and never migrates to mainnet.

## Current components

1. **Ledger and execution:** signed transfers, balances, fee pool and deterministic block validation.
2. **Mining:** wallet-signed Protocol v3 templates and independently verified SHA-256 proofs from CPU or experimental WebGPU clients.
3. **Networking:** signed node identities, peer discovery and verified stronger-work selection; equal-work candidates must be strict extensions of the entire selected block history. Conflicting equal-work branches are retained until stronger work resolves them.
4. **Storage:** checksummed persistent snapshots with restart recovery.
5. **Clients:** public explorer, desktop miner, desktop wallet and node packages.
6. **Crypto boundary:** versioned account formats designed to permit reviewed future migration.

## Required production work

- Cumulative-work fork choice and difficulty adjustment must be independently reviewed.
- P2P needs adversarial peer scoring, eclipse resistance, resource limits and hostile-fork testing.
- WebGPU kernels require cross-vendor validation and reproducible benchmarks.
- Useful-compute jobs require deterministic profiles, commitments and an auditable verification model.
- Wallet and node releases need reproducible signing and independent security audit.
- Treasury keys and governance must be public, multisignature and established before mainnet.
- Performance claims require reproducible workloads, hardware definitions and finality measurements.

## Reproducible local benchmark

Run `npm run benchmark` to measure signed transaction admission, verified snapshot restoration and block hashing on the current machine. The command prints JSON containing the workload, runtime, CPU model and results. Workload sizes can be changed with `KOREK_BENCH_TX` and `KOREK_BENCH_HASHES`; published comparisons must use identical values and include the complete JSON output.
