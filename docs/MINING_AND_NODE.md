# Mining and running a KOREK Planck testnet node

This guide covers creating a KOREK wormhole reward account, running a Planck testnet node, and mining test KRK on macOS, Linux, and Windows through WSL2.

> Planck v0.6 is experimental testnet software. It supports signed peer discovery, longer-chain snapshot synchronization, and authenticated TLS miner connections, but it does not yet provide production consensus or hostile-fork resistance. Mining is a CPU proof-of-work prototype; GPU/AI useful-work verification is not yet active. Test KRK has no monetary value.

## Prerequisites

Before starting, you need:

1. **KOREK Wallet v0.2 or newer.** Download it from the [KOREK Wallet releases](https://github.com/Korek-Network/wallet/releases/tag/wallet-testnet-latest). The wallet holds transparent funds and mining rewards.
2. **A KOREK 24-word recovery phrase.** Create one in the wallet or with `npm run key`. KOREK recovery phrases are currently a project-specific testnet format, not BIP39.
3. **A wormhole address for rewards.** Planck mining rewards accumulate only to wormhole addresses. The wallet derives a separate wormhole signing account from the same recovery phrase, so rewards appear in the app and can be spent directly without a claiming transaction.
4. Git, Node.js 22 or newer, and npm.

Check the tools:

```bash
git --version
node --version
npm --version
```

## Understanding wormhole addresses

The wallet derives a wormhole signing key on the separate `wormhole/0` testnet path. It then hashes the domain-separated public key to produce a 32-byte **inner hash**. The Planck node converts that value into the reward address without receiving your mnemonic or private signing key.

Wormhole and transparent addresses both use the `krk1` prefix. Their derivation paths and transaction signature domains are separate.

Run the key setup command:

```bash
npm run key
```

You may paste an existing KOREK v0.2 recovery phrase or press Enter to create a new one.

| Value | What it is | What to do |
|---|---|---|
| Address | Wormhole account credited by mining | Use it to monitor your reward balance |
| Inner Hash | 32-byte public reward identifier | Pass it to the miner with `--rewards-inner-hash` |
| Secret phrase | 24 words that recover both accounts | Back it up offline; never share it |

The inner hash does not contain the private signing key, but it links mining activity to the reward address. Treat it as private operational information. The 24-word phrase is the critical backup: anyone who has it can spend both balances.

Existing v0.1 wallet files still open, but they have no recovery phrase or wormhole derivation. Create or restore a v0.2 wallet before mining.

## Automated setup

Clone the blockchain repository and run the guided script:

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
chmod +x scripts/setup-miner.sh
./scripts/setup-miner.sh
```

The script validates Node.js, creates or restores the wormhole account, asks for its inner hash, and starts a local Planck node and miner. Leave the terminal open. Press `Ctrl+C` to stop.

## Standalone node and miner binaries

Download the archive for your operating system from [Planck node and miner releases](https://github.com/Korek-Network/blockchain/releases/tag/planck-testnet-latest), then extract it. Each matching v0.6.0 package contains:

- `korek-node` — Planck node, REST API, explorer, and miner-protocol server
- `korek-miner` — separate miner client
- `korek-node-key` — P2P node identity generator
- `korek-key` — 24-word phrase and wormhole inner-hash generator
- `public/` — explorer assets used by the node

Windows executables use the `.exe` suffix.

### 1. Generate the node identity

```bash
./korek-node-key node_key.p2p
```

The command creates `node_key.p2p` with private-file permissions and prints its peer ID. Never share or commit this file. It identifies the node and is completely separate from your wallet phrase.

### 2. Generate or restore the wormhole account

```bash
./korek-key
```

Paste an existing KOREK 24-word phrase or press Enter to create one. Back up the words offline and copy the displayed inner hash. Wallet v0.2+ performs the same derivation.

### 3. Start the node

Replace `<YOUR_NODE_NAME>` and `<YOUR_INNER_HASH>` before running:

```bash
./korek-node \
  --name <YOUR_NODE_NAME> \
  --validator \
  --miner-listen-port 9833 \
  --chain planck \
  --node-key-file node_key.p2p \
  --p2p-port 9333 \
  --p2p-advertise http://YOUR_NODE_IP:9333 \
  --rewards-inner-hash <YOUR_INNER_HASH> \
  --max-blocks-per-request 64 \
  --sync full
```

- `<YOUR_NODE_NAME>` can be any short descriptive name. It appears in node status and logs. KOREK does not yet operate a public telemetry website.
- `<YOUR_INNER_HASH>` is the 64-character value from the wallet or `korek-key`.
- Keep the extracted `public/` directory beside the node binary if you want the explorer at `http://127.0.0.1:8365`.

### 4. Start the separate miner

In another terminal, from the same extracted directory:

```bash
./korek-miner \
  --node-url http://127.0.0.1:9833 \
  --rewards-inner-hash <YOUR_INNER_HASH>
```

The node and miner must use the same `korek-planck-miner/2` protocol version. A mismatch is rejected with an upgrade-required error. Localhost mining is intentionally bound to `127.0.0.1`. See [Secure node-to-miner connection](SECURE_MINER.md) for authenticated TLS access from another machine.

### Note on syncing

Planck v0.6 polls configured seed peers, verifies their Ed25519 node identity and network/protocol handshake, discovers advertised peers, and adopts a longer snapshot after the existing block-linkage and supply checks pass. Add a seed with `--peer http://NODE_IP:9333`. The miner pauses while all configured peers are offline or while synchronization is active.

This is a functional testnet synchronization layer, not production consensus. It assumes honest compatible peers and does not yet resolve hostile equal-height forks, score cumulative work, authenticate trust policy, or stream bounded block batches. See [Running a local P2P testnet](P2P_TESTNET.md).

## Manual setup

### 1. Download and test the node

```bash
git clone https://github.com/Korek-Network/blockchain.git
cd blockchain
npm test
```

### 2. Generate or restore the wormhole account

```bash
npm run key
```

Back up the displayed 24 words. Copy the 64-character inner hash.

### 3. Start a local Planck node with mining

```bash
npm run mine -- --rewards-inner-hash YOUR_64_CHARACTER_INNER_HASH
```

The node listens on port `8365`, mines approximately one reward block per second, and logs the derived wormhole reward address at startup.

Open the explorer:

```text
http://127.0.0.1:8365
```

Verify the node from another terminal:

```bash
curl http://127.0.0.1:8365/api/status
curl http://127.0.0.1:8365/api/blocks
```

### 4. Connect a separate miner to a node API

Start the node without its built-in miner:

```bash
npm start
```

Then run a miner process on the same machine:

```bash
npm run mine:remote -- \
  --node-url http://127.0.0.1:9833 \
  --rewards-inner-hash YOUR_64_CHARACTER_INNER_HASH
```

For another computer, do not expose plain HTTP. Configure TLS and a shared authentication token as described in [Secure node-to-miner connection](SECURE_MINER.md). The node refuses a non-loopback miner bind without both controls.

### 5. Open the wallet

Open the same recovery phrase in KOREK Wallet v0.2. Select **Mining rewards** to see the wormhole address, inner hash, and balance. The **Send KRK** screen can spend directly from either the transparent or wormhole account.

## WSL2 notes

Run every terminal command inside the Linux distribution. The Windows wallet can normally reach a WSL2 node through `http://127.0.0.1:8365`. If it cannot, run `hostname -I` in WSL2 and put `http://WSL_IP:8365` in the wallet's Node field.

## macOS notes

The unsigned testnet `.dmg` and `.zip` are built on GitHub Actions. On first launch, macOS may require Control-clicking the app, selecting **Open**, and confirming. Production releases will require Apple signing and notarization.

## Mining parameters

| Parameter | Planck testnet value |
|---|---:|
| Network ID | `korek-planck-testnet-1` |
| API port | `8365` |
| Target reward interval | 1 second |
| Initial reward | 1.15740740 KRK |
| Reward halving | 126,144,000 reward blocks, approximately four years |
| Mining allocation | 292,000,000 KRK |
| Current proof | CPU security proof-of-work prototype |

Rapid transaction-finality blocks do not mint KRK and do not advance the mining reward counter.

## Troubleshooting

- **`npm: command not found`:** install Node.js 22 or newer, which includes npm.
- **Invalid recovery phrase:** use a phrase created by KOREK Wallet v0.2 or `npm run key`; other wallet mnemonics are not currently compatible.
- **Invalid inner hash:** copy all 64 hexadecimal characters with no `0x` prefix.
- **Port already in use:** stop the earlier node, or set another port: `KOREK_PORT=8366 npm start`.
- **Wallet says Offline:** confirm the node is running and enter the correct reachable URL in the wallet.
- **State fails to load:** preserve the data directory and its `chain-state.json` for recovery; the node refuses snapshots with an invalid checksum or block linkage.
- **Peer remains Offline:** verify both nodes use v0.6, the P2P port is reachable, and the seed URL begins with `http://` or `https://`.
- **Remote miner bind refused:** a non-loopback `--miner-host` requires `--miner-auth-token`, `--miner-tls-cert`, and `--miner-tls-key`.
- **Miner authentication fails:** verify both sides use exactly the same 32+ character token and synchronize their system clocks.
