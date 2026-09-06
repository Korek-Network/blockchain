# KOREK Planck Miner Protocol v3

> Experimental Planck testnet protocol. It is not approved for mainnet use.

Protocol identifier: `korek-planck-miner/3`

## Purpose

Protocol v3 moves proof-of-work from the node to the miner's selected hardware. The node issues a short-lived template, the desktop miner hashes locally, and the node independently verifies a wallet-signed proof before issuing KRK.

Each Planck template binds the total subsidy, the 95% miner portion, the 5% treasury portion, the treasury address, and the accumulated transaction-fee payout. Any payout change invalidates the template. Transaction fees are paid entirely to the successful miner.

## Proof algorithm

1. Decode the 32-byte hexadecimal `challenge`.
2. Encode `nonce` as one unsigned 32-bit big-endian integer.
3. Compute `SHA-256(challenge || nonce)`.
4. The digest must begin with `difficulty` zero hexadecimal characters.

Public test vector:

- challenge: `0000000000000000000000000000000000000000000000000000000000000000`
- nonce: `0`
- digest: `6db65fd59fd356f6729140571b5bcd6bb3b83492a16e1bf0a3884442fc3c8a0e`

## Wallet authentication

The reward account must be a wormhole account derived from the submitted Ed25519 public key.

Work request signature message:

`korek-miner-v3:work:<address>:<timestamp>:<requestNonce>`

Submission signature message:

`korek-miner-v3:submit:<templateId>:<nonce>:<powHash>:<timestamp>`

Timestamps have a 30-second acceptance window. Request nonces are single-use. A template is bound to one reward address and public key.

## HTTP endpoints

### POST /miner/v3/work

Request:

```json
{"address":"krk1...","publicKey":"PEM","timestamp":0,"requestNonce":"32 hex","signature":"base64"}
```

Response contains `templateId`, `challenge`, `height`, `previousHash`, `reward`, `difficulty`, `nonceStart`, `nonceEnd`, `issuedAt`, `notBefore`, and `expiresAt`.

### POST /miner/v3/submit

Request:

```json
{"templateId":"uuid","address":"krk1...","publicKey":"PEM","nonce":0,"powHash":"64 hex","timestamp":0,"signature":"base64","hashesTried":0,"device":"cpu|webgpu"}
```

A successful response contains `accepted: true`, the committed block, and the updated reward balance.

## Mandatory rejection rules

Nodes reject wrong wallet ownership, invalid signatures, expired timestamps, replayed work requests, unknown templates, duplicate submissions, stale chain tips, out-of-range nonces, incorrect hashes, insufficient difficulty, early submissions, and expired templates.

## Mainnet gate

Mainnet activation requires an independent consensus/security audit, GPU kernel validation on supported vendors, protocol fuzzing, sustained public load testing, difficulty-adjustment review, signed reproducible binaries, and a testnet reset/upgrade plan.
