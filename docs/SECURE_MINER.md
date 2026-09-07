# Secure public mining gateway

KOREK Planck v0.7.1 uses wallet-signed Mining Protocol v3. The miner performs proof-of-work locally and signs both work requests and proof submissions. The server verifies that the signing key owns the reward address.

Protocol identifier: `korek-planck-miner/3`

## Public miner connection

Official desktop miners use:

`https://rpc.planck.korek.network`

The same HTTPS origin provides:

- `GET /api/status`
- `GET /api/balance/:address`
- `POST /miner/v3/work`
- `POST /miner/v3/submit`
- `GET /miner/v3/status`

No shared HMAC token or reward inner hash is used by Protocol v3. The wallet's recovery phrase and private key must remain on the miner computer.

## Node binding

Keep the node API and raw miner listener on loopback:

```text
127.0.0.1:8365
127.0.0.1:9833
```

Do not open port 9833 in the public firewall. Publish the API and Protocol v3 paths through an HTTPS reverse proxy.

Example Caddy site:

```caddyfile
rpc.planck.example.com {
    encode zstd gzip
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-Frame-Options DENY
    }
    reverse_proxy 127.0.0.1:8365
}
```

Use a valid public certificate, keep the operating system updated, apply request/body/time limits at the edge, monitor rejections, and preserve node data and identity backups.

## Verification

From another computer:

```bash
curl https://rpc.planck.example.com/api/status
curl https://rpc.planck.example.com/miner/v3/status
```

Both responses must identify `korek-planck-testnet-1` and `korek-planck-miner/3`.

## Security scope

TLS authenticates and encrypts the network connection. Wallet signatures bind work and submissions to the reward account. Single-use request nonces and short timestamp windows reduce replay risk. These controls do not replace a consensus audit, denial-of-service protection, hardware-backed wallet security, protocol fuzzing or hostile-network testing.
