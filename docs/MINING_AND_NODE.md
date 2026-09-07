# Mine on KOREK Planck and optionally run a node

> Planck v0.7.1 is experimental public testnet software. Test KRK has no monetary value, will not migrate to mainnet, and must not be presented as an investment.

## Fast path: mine without running a node

A normal tester only needs the desktop miner and the public HTTPS service.

1. Download the latest [KOREK Miner testnet release](https://github.com/Korek-Network/korekUI/releases/tag/korekui-testnet-latest).
2. Install the app and create or restore the encrypted 24-word mining wallet.
3. Set both connection fields to:
   `https://rpc.planck.korek.network`
4. Select a compute profile:
   - CPU only: choose one or more CPU threads and set GPU to off.
   - GPU only: set CPU to 0, select one GPU, and choose GPU intensity.
   - CPU + GPU: select both.
5. Select **Test connection**, then **Start mining**.
6. Watch CPU/GPU hashrate, accepted or rejected proofs, session rewards and spendable balance.

At least one CPU thread or one GPU must remain enabled. The app reports the actual WebGPU adapter granted by the operating system. GPU hashing is experimental; unsupported adapters show a real error rather than a simulated rate.

No inner hash, private key or recovery phrase is sent to the server. The unlocked wallet signs every work request and proof submission locally.

## How Mining Protocol v3 works

The public node issues a short-lived work template. The miner searches nonces locally using SHA-256, signs a solution with the reward wallet, and submits it. The node independently checks wallet ownership, signature, timestamp, request nonce, template, chain tip, nonce range, hash, target and duplicates before accepting a block.

Protocol identifier: `korek-planck-miner/3`

Public status checks:

```bash
curl https://rpc.planck.korek.network/api/status
curl https://rpc.planck.korek.network/miner/v3/status
```

## Rewards and supply

- Maximum supply: 210,000,000 KRK
- Genesis premine: 0 KRK
- Initial total subsidy: 50 KRK
- Miner: 95% of each subsidy
- Public treasury: 5% of each subsidy
- Fees: 100% to the successful miner
- Reward-block target: 60 seconds
- Halving: every 2,100,000 reward blocks
- Founder/team genesis allocation: none

At the initial subsidy, an accepted block pays 47.5 KRK to the miner and 2.5 KRK to the Planck treasury. All accumulated transaction fees go to the miner. Rewards become spendable immediately in the wormhole account; there is no claim transaction.

The temporary Planck treasury address is `krk1d1ee0261919684cf511b9bd702697b5c4816c61e`. Mainnet requires a separately generated and publicly documented multisignature treasury.

## Optional: run a development node

Running a node is for operators and developers. It is not required for ordinary public testnet mining.

Requirements: Linux, macOS or WSL2; Git; Node.js 22 or newer.

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
npm install
npm test
npm run node:key -- ~/.korek/node_key.p2p
```

Start the node:

```bash
npm start -- \
  --name YOUR_NODE_NAME \
  --validator \
  --chain planck \
  --node-key-file ~/.korek/node_key.p2p \
  --data-dir ~/.korek/planck \
  --max-blocks-per-request 64 \
  --sync full
```

Verify that node on the same computer:

```bash
curl http://127.0.0.1:8365/api/status
curl http://127.0.0.1:8365/api/blocks
```

Those localhost addresses are private operator checks. Do not enter them in a miner running on a different computer.

For P2P test synchronization, configure `--p2p-port 9333`, a reachable `--p2p-advertise` URL, and one or more `--peer` seed URLs. Current P2P is testnet synchronization, not production hostile-fork consensus.

## Production operation

Run long-lived nodes under systemd. Keep ports 8365 and 9833 bound to loopback and publish only the required HTTP paths through a TLS reverse proxy such as Caddy. Never expose the unauthenticated raw miner listener directly to the internet.

See [Secure public mining gateway](SECURE_MINER.md), [P2P testnet](P2P_TESTNET.md), [Miner Protocol v3](MINER_PROTOCOL_V3.md), and the [reference vectors](https://github.com/Korek-Network/template).

## Troubleshooting

- **Protocol mismatch:** update both the node and miner; both must report `korek-planck-miner/3`.
- **Node unavailable:** confirm both app fields use `https://rpc.planck.korek.network`.
- **GPU rate is zero:** set CPU to 0 for a GPU-only test, select one GPU, then read the GPU runtime status.
- **WebGPU unavailable or kernel validation error:** install the latest miner and graphics driver, then retry.
- **Balance is zero after an accepted proof:** confirm the reward address in the miner matches the unlocked wallet and refresh against the public API.
- **Local port already in use:** only node operators need local ports; stop the earlier process before starting another node.

## Mainnet gate

Before mainnet, KOREK still requires independent consensus/security audit, difficulty-adjustment and fork-choice review, protocol fuzzing, denial-of-service load testing, cross-vendor GPU validation, reproducible signed binaries, treasury governance and an extended public adversarial testnet.
