# KOREK Network — Planck Testnet

KOREK is an experimental blockchain research project connecting blockchain security with verifiable distributed AI computation. Planck v0.5 is a runnable testnet prototype, not production cryptocurrency software.

## Run and mine

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
npm test
chmod +x scripts/setup-miner.sh
./scripts/setup-miner.sh
```

The guided setup works on macOS, Linux, and WSL2. See [Mining and running a node](docs/MINING_AND_NODE.md) for manual commands, wormhole reward accounts, remote API mining, and troubleshooting.

## Planck v0.5 features

- Separate deterministic transparent and wormhole accounts derived from one KOREK 24-word recovery phrase
- Mining rewards credited only to spendable wormhole addresses
- Built-in node miner and separate API-connected miner
- Standalone Windows, Linux, Apple Silicon Mac, and Intel Mac node/miner packages
- Persistent `node_key.p2p` identity generation and version-matched miner protocol on port `9833`
- Checksummed atomic chain snapshots with verified restart recovery
- Signed node identity handshake, peer discovery, health tracking and longer-chain synchronization
- Fixed maximum issuance of **365,000,000 KRK**
- Signed transfers with millisecond local-testnet finality, gas and explorer details
- Useful-work job registry connected to mining metadata
- Faucet, block explorer, and REST API on port `8365`
- Windows, Linux, and macOS desktop wallet at [Korek-Network/wallet](https://github.com/Korek-Network/wallet)

## Network parameters

| Parameter | Planck testnet value |
|---|---:|
| Network ID | `korek-planck-testnet-1` |
| Symbol | `KRK` |
| Decimals | 8 |
| Maximum supply | 365,000,000 KRK |
| Mining allocation | 292,000,000 KRK (80%) |
| AI ecosystem allocation | 36,500,000 KRK (10%) |
| Development allocation | 18,250,000 KRK (5%) |
| Security/community allocation | 18,250,000 KRK (5%) |
| Initial reward | 1.15740740 KRK |
| Reward interval | 1 second target |
| Reward halving | Every 126,144,000 reward blocks (~4 years) |
| API/mining port | 8365 |

Faucet balances are test-only and excluded from fixed-supply issuance counters. Rapid transaction-finality blocks do not mint a reward or move the halving counter.

## Important limitations

Planck v0.5 provides signed testnet peer discovery and synchronization, but not production consensus, hostile-fork resistance, a production database, GPU compute proofs, authenticated miner ALPN, public telemetry, or public bootstrap nodes. Snapshot synchronization currently assumes honest compatible peers. CPU proof-of-work and AI-job verification are prototypes. The proposed 100 million TPS figure remains a research target, not current measured capability.

See the [local P2P guide](docs/P2P_TESTNET.md) to run two synchronized nodes.

Ed25519 is used only as a portable testnet bootstrap. Post-quantum work targets standardized ML-DSA with a hybrid migration period. The code has not been audited. Do not use it for real funds, investment, exchange listing, or production AI workloads.

See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [security policy](SECURITY.md).
