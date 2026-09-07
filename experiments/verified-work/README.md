# KOREK verified-work proof of concept

Status: local reference experiment, 7 September 2026. NOT a live blockchain,
production service, Rust engine, DAG implementation, or cryptographic computation
proof system. Do not connect it to funds, wallets, a public API, or Planck storage.

Update: the **separate optional [real-proof benchmark](proof/README.md)** now tests
Groth16 proofs for a fixed 4x4 version of this workload. The baseline commands and
escrow simulator below still use full recomputation and are unchanged. Proof-based
payments, consensus integration and production readiness are not implemented.

## What was built

A customer escrows fictional demo units for one bounded integer-matrix job.
Generated Ed25519 identities sign job creation, claims, results and refund triggers.
The local state machine independently recomputes the result before paying a worker.
Wrong results earn nothing, release the claim for another identity, and after three
wrong attempts cause a refund. Abandoned jobs can be refunded at their deadline.

This is a new standalone experiment, not a change to `src/compute-market.js`.
That existing Planck prototype stores output hashes and approval votes; it does not
itself recompute the matrix result. Approval votes alone are not computation proofs.

JavaScript with Node's built-in cryptography was chosen for this small behavioral
baseline. There are no added packages. A full Rust rewrite was deliberately not
part of this milestone: first establish the payment rules and verification costs.

## Run

From the repository root, using Node.js 22 or newer:

```bash
node --test experiments/verified-work/market.test.mjs
node experiments/verified-work/demo.mjs
npm test
```

The demo opens no ports, contacts no services, writes no keys or chain files, and
uses no real KRK. It prints JSON containing assertions, environment, latency
samples and explicit measurement exclusions. Keys are generated afresh each run.
Tests were run locally on Node v24.19.0: 24 experiment tests, 39 existing tests,
63 total passing. Tests are examples and regression checks, not a security audit.

## Demonstrated scenario

| Event | Result |
|---|---|
| Customer starts with 1,000 units and escrows 100 | Customer balance is 900 |
| First worker submits one incorrect output cell | No payment; job reopens |
| Different worker supplies the correct matrix | That worker receives 100 |
| Customer escrows another 200; assigned worker does not deliver | Funds stay in escrow until expiry |
| Another identity triggers the deadline refund | 200 returns to the original customer, not the caller |
| Signed event sequence is replayed from the same genesis | Identical state commitment |

Final balances: customer 900, correct worker 100, incorrect worker 0. The initial
1,000 units are conserved throughout; job creation never mints a subsidy.
All identities and execution are in ONE process on ONE machine. This is not a
demonstration involving independent operators or a deployed validator committee.

## Workload and protocol rules

- Profile `korek-matrix-integer-poc/1`: multiply two square matrices of dimension
  1 through 64, supplied as flat row-major arrays of signed integers in [-1000,1000].
  Output is a flat integer array. Maximum absolute intermediate sum is 64,000,000,
  so calculations are exactly representable; floating-point ML is excluded.
- Input and result dimensions, integer types and bounds are checked. No uploaded
  scripts, WASM, URLs, downloads, GPU kernels or arbitrary customer code run here.
- Signature domain `korek-verified-work-poc/1`, isolated chain ID
  `korek-isolated-work-demo-1`, and `kwp1...` addresses cannot be used as Planck
  transaction formats. Genesis funding is fictional and explicitly supplied.
- Signed payload: `[domain, chainId, action, nonce, publicKey, body]`. Strict
  canonical JSON, an Ed25519 SPKI public key, and a 64-byte signature are required.
  Nonces are per identity, start at zero, and must be consecutive.
- `create` body is `[input, reward, deadline]`; `claim`/`refund` is `[jobId]`;
  `submit` is `[jobId, result]`. Job ID is SHA-256 of the signed message bytes,
  excluding the signature itself. Input/output digests commit to canonical JSON.
- Rewards and balances are exact integers in [0, 2^64-1], serialized as canonical
  decimal strings; rewards must be positive and funded. Total genesis supply is
  bounded by the same maximum. No fees, staking, slashing or verifier rewards exist.
- `apply(request, orderedTime)` takes nondecreasing integer logical time from the
  trusted local caller, not wall-clock time. A job is live only before its deadline.
  Expiry refunds are available at or after it. Lifetime is at most 100,000 ticks.
- Unknown/malformed requests fail without changing balances, nonces, jobs or time.
  A correctly signed, well-shaped but incorrect result is a committed rejection:
  it consumes the sender's nonce, records the rejected identity, and reopens the job.
  Malformed results leave the claim unchanged; expiry is the eventual refund path.
- The same rejected identity cannot retry that job. Three distinct wrong-result
  attempts refund it early. This is an experimental anti-loop rule, NOT Sybil
  resistance: one person can generate many keys and deny service by consuming attempts.
- Refunds need an explicit authenticated trigger. There is no scheduler or background
  timer; in a future chain, ordering/time and trigger inclusion need consensus rules.
- A private full-state copy provides simple atomic updates. Maximum retained state:
  100 jobs, 128 accounts, and 128 KiB of signed message per action. Final jobs are
  retained. These limits bound the demo, not a production capacity strategy.

## What verification does and does not prove

The worker's answer is checked by an independently structured multiplication loop.
Both worker and verifier do O(n^3) arithmetic. A SHA-256 output hash or receipt hash
is only a commitment; anyone can hash a false statement. A signed result establishes
who submitted it, not that the calculation is correct. No zk proof is produced.

Replaying all authenticated inputs and transitions can reproduce this local state,
but the receipt is NOT standalone evidence of decentralized settlement. The caller
controls event ordering, logical time and genesis. There is no Byzantine consensus,
durable log, crash recovery, finality certificate, light-client verifier, data
availability protocol, remote worker transport or protection against a malicious
operator changing the software. Public inputs have no confidentiality guarantee.

The workload is synthetic. We have not demonstrated paid demand, profitability,
lower electricity use, independent worker participation, or a world-first invention.
Small matrix jobs are usually cheaper to compute locally than to distribute.

## Measurement and decision

See [the recorded run](results/local-demo.json) for raw results and
[the competitor comparison](RESEARCH.md) for prior art and the next decision gates.
The benchmark times warm local worker/verifier kernels, NOT finalized transactions.
It excludes network, disk, consensus, signatures and escrow from kernel timings.
The separate scenario duration includes local signing/escrow/verification, but still
does not measure network latency. RSS is sampled at the end, not a peak measurement.

The immediate conclusion is that correctness/payment behavior is demonstrated for
this bounded simulation, but cheaper verification is NOT demonstrated. Do not turn
these millisecond measurements into a blockchain TPS claim. Planck's live code,
mining rules, supply, releases and existing workflows are unchanged.
