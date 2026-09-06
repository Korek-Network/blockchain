# Run a KOREK Planck testnet node and miner

> Planck v0.7 is experimental public testnet software. Test KRK has no monetary value. It is not approved for mainnet.

Mining Protocol v3 performs proof-of-work on the miner computer. The node issues a short-lived work template, the miner searches nonces locally with selected CPU threads and optional experimental WebGPU, and the node verifies the signed proof before crediting a reward.

Planck tests the proposed economics before they are frozen for mainnet: 210 million KRK maximum supply, zero genesis premine, 60-second reward blocks, 50 KRK initial subsidy, a 2,100,000-block halving interval, 95% of subsidy to the successful miner, 5% to the public treasury, and 100% of transaction fees to the next successful miner. Testnet faucet balances are outside the mining supply and never migrate to mainnet.

## Node

Download the matching v0.7 node archive from [Planck releases](https://github.com/Korek-Network/blockchain/releases/tag/planck-testnet-latest), or clone this repository and use Node.js 22+.

Generate a persistent node identity once:

```bash
npm run node:key -- ~/.korek/node_key.p2p
```

Start a local node:

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

To participate in P2P synchronization, also configure `--p2p-port 9333`, a reachable `--p2p-advertise` URL, and one or more `--peer` seed URLs. Planck P2P is functional testnet synchronization, not production fork choice or hostile-consensus protection.

Verify the node:

```bash
curl http://127.0.0.1:8365/api/status
curl http://127.0.0.1:8365/api/blocks
```

Run long-lived nodes with systemd and keep the API/miner listener on loopback behind an HTTPS reverse proxy. Never expose unrestricted administrative or legacy routes.

## Desktop miner

Download the matching KOREK Miner v0.3 testnet build from [KOREK UI releases](https://github.com/Korek-Network/korekUI/releases/tag/korekui-testnet-latest).

1. Create or restore the encrypted 24-word KOREK mining wallet.
2. Select CPU threads and, if supported, one GPU for experimental WebGPU mining.
3. Use `https://rpc.planck.korek.network` for both the mining gateway and blockchain API.
4. Test the connection and select **Start mining**.

No inner hash needs to be pasted into Protocol v3. The unlocked wallet signs work requests and submissions locally; its recovery phrase and private key are never sent to the node.

The dashboard reports hashes actually attempted by local workers. NVIDIA utilization, temperature, and power are shown when `nvidia-smi` is available. Unsupported telemetry remains blank rather than being estimated.

## Reward rules

A node rewards only a proof that passes wallet ownership, signature, timestamp, replay, template, chain-tip, nonce-range, hash, target, and duplicate checks. Accepted rewards are immediately spendable from the wormhole account; there is no separate claim transaction.

Transaction fees confirmed by rapid testnet-finality blocks accumulate in the consensus fee pool and are paid in full with the next accepted proof. The temporary Planck treasury sink is `krk1d1ee0261919684cf511b9bd702697b5c4816c61e`; mainnet requires a separately generated, publicly documented multisignature treasury.

## Protocol compatibility

The node and desktop miner must both report `korek-planck-miner/3`. See [Miner Protocol v3](MINER_PROTOCOL_V3.md) and the canonical [reference package and vectors](https://github.com/Korek-Network/template).

## Mainnet gate

Before mainnet, KOREK still requires an independent consensus/security audit, difficulty-adjustment and fork-choice review, protocol fuzzing, denial-of-service load testing, cross-vendor GPU kernel validation, reproducible signed binaries, and an extended public adversarial testnet.
