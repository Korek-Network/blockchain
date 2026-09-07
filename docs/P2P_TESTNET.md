# Running a local KOREK P2P testnet

Planck v0.7.1 can run multiple node processes with independent signed identities. Nodes select a compatible chain by verified cumulative proof-of-work rather than height alone, so a longer zero-work chain cannot replace a stronger chain.

**Experimental compatibility change:** this branch uses `korek-planck-p2p/2` and
rejects version-1 envelopes. The displayed node version is still `0.7.1`; check
the protocol field, not the version label alone. Use this exact experimental
revision for every node in an isolated test. Do not point these nodes at the live
testnet or upgrade live nodes individually. Review and a coordinated testnet
upgrade are still required; no deployment is included here.

Equal-work candidates are accepted only when they strictly extend every block
hash in the current local chain, including after mining starts. Conflicting
equal-work forks do not win by height. A shorter chain can win with greater
verified cumulative work; inclusion and PoW anchoring can both be reorganized.
See [the API and migration notes](CONFIRMATION_AND_SYNC.md).

Peers with a shared history download missing blocks in bounded ranges.
`--max-blocks-per-request` controls the range size from 1 to 256 blocks (default
64). A signed full snapshot is used when histories diverge, a stronger-work peer
is shorter, or 32 range requests cannot catch a moving tip. The final signed
response must match the downloaded tip, height and validated cumulative work.
Responses above 16 MiB fail closed; this is a resource bound, not a scalable
long-chain storage/synchronization design.

> This is testnet synchronization, not production hostile-network consensus. Use isolated development machines or a private LAN.

## Prepare two identities

```bash
cd ~/blockchain
git pull --ff-only
npm install
npm test
mkdir -p local-p2p
npm run node:key -- local-p2p/node-a.p2p
npm run node:key -- local-p2p/node-b.p2p
```

## Terminal 1: seed node

```bash
cd ~/blockchain
KOREK_PORT=8366 KOREK_MINER_PORT=9834 node src/server.js \
  --name seed-node \
  --validator \
  --node-key-file local-p2p/node-a.p2p \
  --p2p-port 9333 \
  --p2p-advertise http://127.0.0.1:9333 \
  --data-dir local-p2p/node-a-data
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

## Create blocks for synchronization testing

Connect the current KOREK Miner to `http://127.0.0.1:8366` for both local connection fields and mine to a test wallet. Protocol v3 performs the proof on the miner computer; the node no longer needs `--mine` or a pasted rewards inner hash.

## Verify

```bash
curl http://127.0.0.1:8366/api/status
curl http://127.0.0.1:8367/api/status
curl http://127.0.0.1:8367/api/peers
```

After synchronization, the peer should report P2P enabled, one connected peer, an idle sync state near the seed height, and the same `cumulativeWork` as the seed.

For separate LAN computers, replace loopback advertise/peer URLs with private LAN addresses and allow only the selected P2P port between those machines. Do not expose this prototype P2P service or raw miner port directly to the public internet.
