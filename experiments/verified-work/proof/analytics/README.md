# Verifiable sensor-batch statistics: bounded feasibility test

Isolated experiment on `research/verified-work-poc`. No Planck node, consensus,
mining, money supply, payouts, or live-network configuration is changed.

## What the job does

For 128 ordered records with eight signed 16-bit sensor channels, calculate eight
channel sums and 36 upper-triangular sums of cross-products. These are sufficient
statistics for means and covariance matrices used in batch telemetry analytics.
The job has 4,608 multiplications, versus 64 in the preceding matrix proof.
The fixture is deterministic generated data, **not actual customer measurements
or proof that someone will pay for this computation**.

For channels `a,b`, the exact covariance numerator is
`128 * crossProducts[a,b] - sums[a] * sums[b]`. Divide by `128^2` for population
covariance or `128*127` for sample covariance. The proof binds the exact sums and
cross-products; it does not perform floating-point standardization or claim an
anomaly-detection model. Every intermediate integer fits exactly within the host
Number safe-integer range; tests also use an independent BigInt oracle.

## Trust boundary

The requester must commit to a specific, ordered input batch **before** accepting
work. The worker cannot choose a substitute dataset root or verification key.
The proof binds that root, all 44 returned statistics, chain ID, job ID, worker,
reward label and deadline label. Changing even the public commitment alongside a
false output must still fail cryptographic verification.

The root authenticates identity of the committed batch, not sensor truth,
completeness relative to the outside world, source authorization or availability.
This script does not authenticate sensor devices. Whoever sets the expected job
and root remains trusted. Repeated verification succeeds: this stateless tool is
**not** a payment gate, replay defense, deadline enforcer or blockchain protocol.
All reward fields are labels only; no KRK is transferred.

## Circuit and implementation

- Real Groth16 proofs over BN254, using the existing pinned `snarkjs`/Circom dependencies.
- 28,703 constraints, 28,704 wires, one public output; fixed 128x8 profile.
- Each encoded sensor value has a 16-bit range constraint. Eight values pack
  injectively into a 128-bit row before hashing. Row and channel order are bound.
- Eight Poseidon-16 chunks plus a versioned Poseidon-9 root commit to the dataset.
- Three padded Poseidon-16 chunks commit to the 44 offset-encoded statistics.
- A Poseidon-6 commitment binds dataset root, statistics and two 128-bit context
  limbs derived from a versioned SHA-256 encoding. No lossy SHA-to-field reduction.
- The verifier validates and hashes the small result and trusted job. It does
  not receive or recompute the dataset. Native benchmarks receive that exact dataset.
- Source, dependency-lock and artifact hashes detect accidental setup mismatch.
  They do not protect against a malicious local administrator replacing them all.

The compiler's two CA02 diagnostics concern parent-unused bit outputs from the
context range-check components. `Num2Bits` constrains/recomposes them internally;
an oversized-context witness regression test exercises rejection. The full
compiler log is retained in the local setup directory. A first compile exposed
a WASM diagnostic-reporting panic when every sensor bit output was parent-unused.
The final circuit uses those bits directly for packed rows; inspection remains
enabled, with no suppressed diagnostics. This is not a compiler or circuit audit.
The setup dependency also emitted its previously observed garbage-collected
FileHandle warning; successful key checks do not resolve that resource-management issue.

## Reproduce

From `experiments/verified-work/proof`:

```sh
npm ci --ignore-scripts --no-fund
node --test analytics/workload.test.mjs
node analytics/setup.mjs
node --test --test-concurrency=1 analytics/proof-checks.mjs
node analytics/benchmark.mjs
node analytics/verify-example.mjs
```

Setup can take several minutes. It creates a fresh ignored `analytics/build/setup-*`
directory and publishes `analytics/build/current.json` only after setup checks
succeed. It never overwrites the earlier matrix circuit's setup. Benchmark output
goes under `analytics/build`; the committed `results/` snapshot is not silently
replaced on reruns. `verify-example.mjs` verifies the committed public example
without running setup or regenerating its proof, using the repository's trusted
fixture key. Fresh setup produces a different key and proof.

The root repository's `npm test` includes the six dependency-free arithmetic tests.
The proof suite is intentionally explicit, so ordinary Planck tests do not require
large proving artifacts or nested proof dependencies.

## Measurement rules

Three execution-plus-proof samples and ten verification samples on one machine
are reported individually in `results/benchmark.json`. Tiny native operations are
warmed and batched 100 per timed sample; every returned statistic is compared.
The ordinary Number implementation, not the BigInt oracle, is timed. There are
two direct baselines: already-trusted data rechecking, and recomputing the dataset
commitment plus rechecking when input arrives from an untrusted worker.

Initial dataset commitment and backend initialization are measured separately.
Proof generation includes data-root validation, calculation and witness/proof
generation. Verification includes parsing, shape/range checks, expected-result
commitment calculation and cryptographic verification. Setup is timed separately.
Peak memory includes workers; the setup parent-process metric excludes the
separately spawned circuit compiler. Network transfers, consensus, durable storage,
source authentication, fees, electricity and fiat cost are not measured.

The illustrative `P + N*V` versus `D + N*D` model compares one worker plus `N`
verifiers on the same measured workload. It is a serialized wall-time proxy, not
a monetary estimate or throughput forecast. If `V >= D`, adding verifiers cannot
produce a compute-time break-even under that model. Larger inputs and other
implementations may behave differently; no crossover is extrapolated.

## Security and dependency limits

Single-operator random contributions are **test-only trusted setup**, not a
multi-party ceremony. Assumptions include Groth16/BN254, Poseidon/SHA-256,
correct constraints, compiler and verifier. No production security or privacy
claim follows from passing tests. Cryptographic dependencies include GPL-licensed
components; do not treat the parent repository license as covering those packages.
The parent proof experiment's recorded dependency advisory and experimental
compiler limitations still apply; no dependency versions were changed here.

## Recorded outcome

Run: 2026-09-07, Node v24.19.0, Linux x64, AMD EPYC 9V74; nine visible logical CPUs.
See [benchmark.json](results/benchmark.json), [setup.json](results/setup.json) and
the independently re-verifiable [example.json](results/example.json).

| Operation | Measured median |
| --- | ---: |
| Direct recheck of already-trusted records | 0.02559 ms |
| Authenticate records against root and recheck | 4.62075 ms |
| Verify the proof and bound result | 14.34782 ms |
| Compute and generate the proof | 1,486.14579 ms |
| Initial dataset commitment, measured separately | 4.91806 ms |

Setup took 261.92 seconds. The proof was 723 JSON bytes; the full result/proof
bundle was 1,380 bytes versus 6,555 bytes of input JSON. Benchmark peak RSS was
1,074,393,088 bytes (about 1.00 GiB); setup parent-process peak was 1,129,402,368
bytes. Serialization sizes are not measured network savings or protocol payloads.

Proof verification was **560.6 times slower** than direct computation of trusted
records and **3.1 times slower** even when the direct path also rehashed the full
batch. Neither measured baseline yields a verifier-count break-even in the stated
wall-time model. The proof establishes correctness of a bounded analytics job;
it does not establish a compute-time or monetary advantage at this size.

Validation: all 69 root-repository tests, 23 existing matrix-proof tests and 21 new
analytics-proof tests passed (113 total, including six new arithmetic tests).
Negative witness tests intentionally print circuit errors while asserting rejection.

**Decision: do not integrate this workload into Planck or increase its batch size
on the assumption that a profitable crossover exists.** Keep it as a reproducible
negative feasibility result. A further proof-compute experiment should require a
specific customer workload with measured native runtime, a trusted input source,
and a cost budget. For the separate blockchain-speed goal, the next useful task
is an end-to-end signed-transaction benchmark that measures admission, execution,
persistence, multi-node confirmation/finality and failures independently. This
analytics result measures none of those and must not be reported as KOREK TPS.
