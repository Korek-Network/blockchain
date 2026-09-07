# KOREK Network — Planck Testnet

KOREK is an experimental proof-of-work blockchain research project connecting network security with verifiable distributed computation. Planck v0.7.1 is a public testnet, not production cryptocurrency software. Test KRK has no monetary value and will not migrate to mainnet.

This experimental branch uses `korek-planck-p2p/4`, replay-verified PoW-funded
balances and SQLite storage v3. The reproduced balance gate now passes.
**Not deployed:** old faucet-funded histories cannot join this peer network.
Read [replay and SQLite migration notes](docs/REPLAY_SQLITE_FIX.md) before testing.
Independent review and packaged-runtime validation remain required.

## Start mining

Most testers do not need to run a node.

1. Download [KOREK Miner](https://github.com/Korek-Network/korekUI/releases/tag/korekui-testnet-latest).
2. Create or restore an encrypted 24-word mining wallet.
3. Use `https://rpc.planck.korek.network` for both the mining gateway and blockchain API.
4. Choose CPU threads and optionally one experimental WebGPU adapter.
5. Start mining and monitor accepted blocks and spendable test KRK.

See [Mining and running a node](docs/MINING_AND_NODE.md) for complete instructions.

## Planck v0.7.1

- Wallet-signed Mining Protocol v3 with proof-of-work performed on the miner computer
- Selectable CPU workers and experimental WebGPU SHA-256
- Rewards credited directly to spendable wormhole accounts
- Persistent node storage and signed node identities
- Signed P2P discovery, stronger-work fork choice and exact same-chain extensions
- Public explorer, mining gateway and REST API
- Windows, Linux and macOS miner, wallet and node packages
- Rapid local transfer inclusion, with fees pooled for the next successful miner; no guaranteed finality

## Monetary policy under test

| Parameter | Planck testnet value |
|---|---:|
| Network ID | `korek-planck-testnet-1` |
| Symbol | KRK |
| Decimals | 8 |
| Maximum supply | 210,000,000 KRK |
| Genesis premine | 0 KRK |
| Initial total block subsidy | 50 KRK |
| Miner subsidy share | 95% |
| Treasury subsidy share | 5% |
| Transaction fees | 100% to successful miner |
| Reward-block target | 60 seconds |
| Halving interval | 2,100,000 reward blocks |
| Mining protocol | `korek-planck-miner/3` |

All supply is issued through accepted proof-of-work blocks. At the initial subsidy, a block pays 47.5 KRK to the miner and 2.5 KRK to the public testnet treasury, plus all accumulated transaction fees to the miner. There is no founder, team or private genesis allocation.

Faucet balances are test-only, sit outside fixed-supply issuance counters, and never migrate to mainnet.

## Public services

- Website: [korek.network](https://korek.network)
- Explorer: [scan.planck.korek.network](https://scan.planck.korek.network)
- Mining gateway and API: [rpc.planck.korek.network](https://rpc.planck.korek.network)
- Miner status: [rpc.planck.korek.network/miner/v3/status](https://rpc.planck.korek.network/miner/v3/status)

## Run a development node

Requires Node.js 24 or newer on this experimental branch.

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
npm install
npm test
npm run node:key -- ~/.korek/node_key.p2p
npm start -- \
  --name YOUR_NODE_NAME \
  --validator \
  --chain planck \
  --node-key-file ~/.korek/node_key.p2p \
  --data-dir ~/.korek/planck \
  --sync full
```

Local API verification:

```bash
curl http://127.0.0.1:8365/api/status
```

Localhost is only for a node operator checking their own machine. Ordinary miners should use the public HTTPS gateway above.

## Mainnet gate

Mainnet is not live. It requires independent consensus and security audits, difficulty-adjustment and fork-choice review, protocol fuzzing, denial-of-service testing, cross-vendor GPU validation, reproducible signed binaries, public treasury governance, and an extended adversarial testnet.
