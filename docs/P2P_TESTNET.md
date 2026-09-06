# Running a local KOREK P2P testnet

Planck v0.5 can run multiple node processes that authenticate messages with their independent node keys, discover advertised peers, and synchronize to the longest reachable chain.

> This is testnet synchronization, not production consensus. Only connect nodes you control. Full block-by-block state execution, cumulative-work fork choice, peer scoring, transport encryption and adversarial testing remain required before mainnet.

## Prepare two node identities

```bash
cd ~/blockchain
git pull --ff-only
npm test

mkdir -p local-p2p
node scripts/node-key.mjs local-p2p/node-a.p2p
node scripts/node-key.mjs local-p2p/node-b.p2p
```

## Terminal 1: seed node and miner

Replace the inner hash with the 64-character value from KOREK Wallet:

```bash
cd ~/blockchain

KOREK_PORT=8366 KOREK_MINER_PORT=9834 node src/server.js \
  --name seed-node \
  --validator \
  --node-key-file local-p2p/node-a.p2p \
  --p2p-port 9333 \
  --p2p-advertise http://127.0.0.1:9333 \
  --data-dir local-p2p/node-a-data \
  --mine \
  --rewards-inner-hash YOUR_64_CHARACTER_INNER_HASH
```

## Terminal 2: syncing peer

```bash
cd ~/blockchain

KOREK_PORT=8367 KOREK_MINER_PORT=9835 node src/server.js \
  --name peer-node \
  --validator \
  --node-key-file local-p2p/node-b.p2p \
  --p2p-port 9334 \
  --p2p-advertise http://127.0.0.1:9334 \
  --peer http://127.0.0.1:9333 \
  --data-dir local-p2p/node-b-data
```

Within a few seconds, the second terminal logs a synchronization message and its height catches the seed node.

## Verify both nodes

```bash
curl http://127.0.0.1:8366/api/status
curl http://127.0.0.1:8367/api/status
curl http://127.0.0.1:8367/api/peers
```

The second status response should show:

- `p2p.enabled: true`
- `p2p.connectedPeers: 1`
- `sync.state: "Idle"` after catching up
- approximately the same block height as the seed

## Connect computers on a LAN

On the seed computer, replace `127.0.0.1` in `--p2p-advertise` with its LAN address. On the peer computer, use that same address in `--peer`. Permit only the selected P2P TCP port through the local firewall.

Do not expose this prototype P2P or miner protocol directly to the public internet.
