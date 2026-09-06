# KOREK architecture

KOREK is designed as two connected systems: a settlement/security network and a useful-compute market. Consensus must remain safe when no AI jobs are available, so v0.1 falls back to ordinary proof of work and records verified job references in blocks.

The local testnet uses a centralized rapid-finality sealer for near-instant transaction testing. It seals a submitted transfer immediately without a block reward; manual mining remains available for reward testing. This is a development convenience, not the final decentralized consensus design or evidence of production throughput.

## Supply model

KRK has a fixed 365 million mainnet allocation: 292 million (80%) mining, 36.5 million (10%) AI ecosystem, 18.25 million (5%) development, and 18.25 million (5%) security/community. Reward blocks target one second, start at exactly 1.15740740 KRK, and halve every 126,144,000 reward blocks. Rapid-finality transaction blocks do not advance this counter. Faucet KRK exists only in the in-memory testnet accounting domain and never consumes mainnet allocation.

## Proposed production components

1. **Consensus:** fork-choice, difficulty adjustment, peer discovery and protection against replay, eclipse and majority attacks.
2. **Execution:** deterministic transaction runtime with parallel conflict scheduling.
3. **Compute market:** clients submit priced AI jobs; schedulers match compatible miners; escrow releases KRK after verification.
4. **Verification:** multiple miners execute sampled jobs, challengers dispute results, and dishonest participants lose stake.
5. **Crypto agility:** versioned address and signature schemes allow migration from hybrid classical/post-quantum keys to audited post-quantum-only keys.
6. **Clients:** node, pool, wallet, desktop miner, explorer and developer SDK.

## Important unresolved research

- Many AI workloads are nondeterministic across GPU models. KOREK needs deterministic kernels or tolerance-aware commitments.
- Replicating every job wastes compute; probabilistic verification changes the economic security model.
- Post-quantum signatures are much larger than Ed25519 signatures and materially affect bandwidth and TPS.
- 100M TPS cannot be promised without defining finality, transaction complexity, hardware, shard count and benchmark methodology.
