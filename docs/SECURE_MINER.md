# Secure node-to-miner connection

KOREK Planck v0.6 uses the incompatible `korek-planck-miner/2` protocol. Every authenticated request includes an HMAC-SHA256 signature over the HTTP method, path, timestamp, random nonce, and SHA-256 body hash. The node rejects altered requests, reused nonces, and timestamps outside a 30-second window.

## Local mining

The miner service binds to `127.0.0.1` by default. A miner on the same computer can connect without certificates or a token:

```bash
npm start
```

In another terminal:

```bash
npm run mine:remote -- \
  --node-url http://127.0.0.1:9833 \
  --rewards-inner-hash YOUR_64_CHARACTER_INNER_HASH
```

Never make an unauthenticated miner port reachable from another machine.

## Secure remote mining

Use a trusted TLS certificate and a random shared token. Generate the token once:

```bash
openssl rand -hex 32
```

Keep the token out of source control, screenshots, logs, and shell history. In production, load it from a root-readable environment file or secret manager.

Start the node:

```bash
export KOREK_MINER_AUTH_TOKEN='PASTE_THE_RANDOM_TOKEN'

node src/server.js \
  --miner-host 0.0.0.0 \
  --miner-listen-port 9833 \
  --miner-auth-token "$KOREK_MINER_AUTH_TOKEN" \
  --miner-tls-cert /etc/letsencrypt/live/node.example.com/fullchain.pem \
  --miner-tls-key /etc/letsencrypt/live/node.example.com/privkey.pem
```

Start the matching miner:

```bash
export KOREK_MINER_AUTH_TOKEN='PASTE_THE_SAME_RANDOM_TOKEN'

npm run mine:remote -- \
  --node-url https://node.example.com:9833 \
  --auth-token "$KOREK_MINER_AUTH_TOKEN" \
  --rewards-inner-hash YOUR_64_CHARACTER_INNER_HASH
```

For a private certificate authority, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` on the miner. Do not disable TLS verification.

The node deliberately refuses `--miner-host 0.0.0.0` or any other non-loopback bind unless both a certificate/key pair and authentication token are configured. Node and miner clocks must be synchronized because signed requests expire after 30 seconds.

## Security scope

TLS protects the connection and verifies the server. HMAC authenticates possession of the shared token and prevents replay within the acceptance window. This is not mutual TLS, QUIC/Noise, hardware-backed key storage, proof verification, or an audited production protocol. Those remain required before mainnet.
