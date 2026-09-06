# KOREK Network (KRK)

KOREK is an experimental blockchain research project connecting blockchain security with verifiable, distributed AI computation. This repository is the first runnable **testnet prototype**, not production cryptocurrency software.

## Current prototype

- KRK native ledger with a hard-coded maximum issuance of **365,000,000 KRK**
- Deterministic genesis block, signed transfers, balances and proof-of-work blocks
- Useful-work job registry connected to mining metadata
- Local REST API, block explorer, test wallet generator and one-click test miner
- Replaceable cryptography boundary for a future post-quantum provider
- No runtime dependencies beyond Node.js 22+

## Run it

```bash
npm test
npm start
```

Open `http://localhost:8365`. Download the standalone desktop wallet from [Korek-Network/wallet](https://github.com/Korek-Network/wallet).

For complete beginner-friendly instructions, see the [KOREK Testnet Guide](docs/TESTNET_GUIDE.md).

## Desktop wallet

The encrypted Windows and Linux desktop wallet is maintained separately at [Korek-Network/wallet](https://github.com/Korek-Network/wallet).

## Network parameters

| Parameter | Testnet value |
|---|---:|
| Network ID | `korek-testnet-1` |
| Symbol | `KRK` |
| Decimals | 8 |
| Maximum supply | 365,000,000 KRK |
| Mining allocation | 292,000,000 KRK (80%) |
| AI ecosystem allocation | 36,500,000 KRK (10%) |
| Development allocation | 18,250,000 KRK (5%) |
| Security/community allocation | 18,250,000 KRK (5%) |
| Initial reward | 1.15740740 KRK |
| Reward halving | Every 126,144,000 reward blocks (~4 years) |
| Target reward-block interval | 1 second |
| Default API/mining port | 8365 |

Testnet faucet balances are deliberately excluded from the fixed mainnet allocation counters.

## Architecture direction

The intended system separates consensus, execution, useful-compute verification, storage, networking and cryptography. AI jobs must eventually use redundant execution, challenge sampling, staking/slashing and deterministic workload profiles. Post-quantum wallet work targets standardized ML-DSA signatures with a hybrid migration period. Neither feature is implemented securely in v0.1.

The proposed 100 million transactions-per-second figure is a research target, not a present capability claim. It would require parallel execution, sharding or rollup-style batching and independently reproducible benchmarks.

## Security warning

This code uses Ed25519 only as a portable testnet bootstrap and stores generated test keys in plaintext JSON. It has not been audited. Do not use it for real funds, public investment, exchange listing, or production AI workloads.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), and [SECURITY.md](SECURITY.md).
