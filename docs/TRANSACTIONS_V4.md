# Version 4 transactions

Planck v0.7 introduces a chain-bound transaction envelope for new clients. Legacy version 1–3 transactions remain readable during the testnet migration.

Required signed fields are `networkId`, `from`, `to`, `amount`, `nonce`, `timestamp`, `expiresAt`, `gasPrice`, `gasLimit`, and `addressScheme`. The signature message is those values joined in that order with `|`.

Clients first call `GET /api/nonce/<address>`, sign with the returned `nextNonce` and `networkId`, then submit to `POST /api/transactions`. The single-transaction route keeps its existing immediate testnet sealing behavior for wallet compatibility.

`POST /api/transactions/batch` accepts `{ "transactions": [...] }` with 1–1000 independently signed transactions. Signature checks run across worker threads; state admission remains deterministic and atomic. One invalid signature, nonce, balance, network ID or expiry rejects the whole batch.

The mempool is capped at 10,000 transactions, individual transaction input is capped at 64 KiB, expiry is required for v4, and transaction lifetime is capped at one hour. Fee ordering applies across independent senders while nonce order is preserved within each sender.

These controls improve prototype safety and throughput but do not provide production consensus or establish public-network TPS.
