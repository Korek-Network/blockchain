# Real computation-proof benchmark

**Result: real proofs work for this circuit, but this tiny workload is much cheaper
to recompute. Do not deploy this as a KOREK speed upgrade.**

This optional experiment generates and verifies actual Groth16/BN254 proofs, not
mock receipts or development-mode attestations. It uses the same bounded integer
matrix multiplication as the parent demo, restricted to 4x4 matrices. No Rust/DAG
engine, network consensus, real payments or wallet integration is added.

## Recorded result — 7 September 2026

| Measurement | Recorded value |
|---|---:|
| Native 4x4 multiplication, median | 0.000527 ms |
| Full recomputation/check, median | 0.000622 ms |
| Execution plus proof generation, median | 369.811 ms |
| Proof verification including job/result binding, median | 12.163 ms |
| Proof JSON only | 725 bytes |
| Proof, public commitment and result bundle JSON | 967 bytes |
| Whole benchmark process peak RSS | about 448 MiB |
| Fresh local setup including compilation and checks | 64.387 seconds |

The verifier hashes the inputs/output/context and checks a pairing equation; it
does NOT repeat matrix multiplication. Nevertheless, its fixed overhead dominates
this small job: application verification was about 19,560 times slower than local
recomputation in this one run. This is not an argument that proofs are never useful;
it is evidence against using this particular tiny workload as an efficiency claim.

The [raw measurement](results/benchmark.json) includes all samples and exclusions.
Three proofs and ten verifier samples were measured on Node v24.19.0, Linux x64,
AMD EPYC 9V74, with nine logical CPUs visible and default snarkjs worker threading.
Native kernels use ten batches of 1,000 operations after warmup. Native solve
results feed a checked checksum; recomputation includes an equality assertion.
These tiny warm-loop measurements are indicative, not a consumer-hardware survey.

Setup and backend initialization are reported separately, not amortized into the
proof median. Peak RSS covers the entire benchmark process (including prover,
verifier and initialization), not each stage; setup-process peak memory was not
measured. Electricity, fiat cost, network, blockchain fees and durable settlement
were NOT measured. No TPS, TTF, paid demand or profitability conclusion follows.

## Reproduce

Use Node.js 22 or newer. Commands below run **inside this directory**:

```bash
npm ci --ignore-scripts --no-fund
npm run setup
npm test
npm run benchmark
npm run verify:example
```

`setup` creates a new uniquely named directory under ignored `build/`; old runs
are retained. It updates a local manifest only after ceremony/circuit checks pass.
Fresh setup keys/proofs vary, so timings and artifact hashes will differ each run.
`benchmark` writes generated results into `build/`; it does not overwrite recorded
files in `results/`. Keys and large build artifacts are not committed.

To re-verify the recorded public proof without generating a new setup, run only
`npm ci --ignore-scripts --no-fund` and `npm run verify:example`. The checked-in
[example](results/example.json) contains its test job, proof and verification key.
The script checks the key against the recorded artifact digest and re-derives the
job commitment. These repository files are example trust configuration, not a
mechanism for accepting arbitrary prover-supplied keys.

The main repository's `npm test` remains dependency-free and runs its original
63 checks. The optional proof suite is explicitly invoked here and passes 23
additional checks: **86 checks in total across the two suites**. Expected circuit
assertion messages appear during negative witness tests; those tests pass when
invalid witnesses are rejected. These tests do not replace an independent audit.

## Proof statement and acceptance boundary

- Circuit: `matrix4.circom`, Circom 2.2.3 with `--O2 --inspect`; 3,172 R1CS
  constraints, 50 private input signals, one public output commitment.
- Inputs represent signed coefficients in [-1000,1000] by adding 1000. Both the
  encoded coefficient and `2000 - coefficient` are constrained to 11 bits.
  Therefore negative field aliases and coefficients above the limit fail.
- All 16 output cells satisfy the 4x4 matrix product. Each output is offset by
  4,000,000. Bounds on the inputs imply the full calculation is exact integer
  arithmetic without wrapping around the much larger scalar field.
- Job context is SHA-256 of a fixed ordered tuple containing protocol version,
  chain ID, job ID, worker/recipient, reward, deadline, workload profile and size.
  Its full 256 bits are encoded as two separately range-checked 128-bit limbs.
- Circomlib Poseidon hashes the two matrices, result and context limbs into the
  public commitment. The application derives that commitment from its EXPECTED
  job record and the submitted result; it does not trust the prover's root alone.
- The locally configured verification key is artifact-hash checked. Incoming
  proof bundles cannot supply or replace it. Circuit and dependency-lock changes
  require a regenerated/reviewed setup in this harness.
- `ReplayGate` rejects repeated or concurrent acceptance of a job, snapshots
  caller-owned objects across asynchronous verification, and rejects expiry.
  It has a 100-job in-memory bound. Invalid proofs do not consume a slot.

A cryptographic proof remains mathematically verifiable more than once. Preventing
double payment needs durable application state and atomic settlement; this gate
has neither and does not move money. Expected job/recipient and logical time must
come from trusted application state, eventually consensus. A proof does not
authenticate who physically did the computation, provide Sybil resistance, or
prove decentralized finality. The parent escrow demo still uses recomputation.

## Security, compiler and dependency limitations

**Trusted setup is single-operator and TEST-ONLY.** Fresh randomness is supplied
in-process for both phases; it is not embedded in source, command arguments or
recorded output. Powers-of-tau and circuit-specific transcript checks pass, but
transcript consistency is not proof of independent contribution or erased secrets.
Production requires separately reviewed parameter generation and trust assumptions.
The sample key must never be used to protect money.

The Circom WASM distribution describes itself as experimental and inadequately
tested. Compilation emits 66 CA02 diagnostics about unused parent-level outputs
of Num2Bits range-check components. They are retained in each run's compiler log:
the bits ARE constrained inside Num2Bits and recompose to its constrained input,
while this parent only needs the range assertion. Out-of-range/field-alias witness
tests exercise those constraints. This review is not a formal circuit audit.
snarkjs also emitted a file-descriptor garbage-collection deprecation warning
during setup; no clean-resource-management claim is made for the dependency.

Pinned dependencies: snarkjs 0.7.6, circom2 0.2.23, circomlib 2.0.5 and circomlibjs
0.1.7, with an integrity-locked npm dependency graph. Overrides to underscore
1.13.8 and ws 8.21.3 address the observed high/moderate transitive advisories.
The [dependency audit snapshot](results/dependency-audit.json) still reports 15
low-severity package entries tracing to an elliptic advisory through ethers.
The harness does not intentionally use Ethereum wallets or networking, but this
is NOT a clean dependency audit or clearance to expose a public service. A forced
breaking downgrade was not applied. Review licenses, including the GPL-licensed
dependencies, before redistributing or integrating this experimental stack.

No custom elliptic-curve arithmetic or proof scheme was invented here. Correctness
depends on Groth16/BN254 assumptions, trusted setup, SHA-256/Poseidon, the circuit,
compiler and verifier implementations. The application already has job inputs and
results; there is no confidentiality-service or zero-knowledge privacy claim.

## Decision and next gate

Keep this branch experimental. The proof milestone is complete, but an economic
advantage has not been demonstrated. Before a multi-machine service or consensus
rewrite, select a genuinely expensive useful customer task, then compare native
execution, proof generation, verification, batching and transport costs at matching
security guarantees. Use a reviewed prover/compiler and resolve dependencies and
setup assumptions before any deployment. This result does not justify changing
Planck's mining, supply, live code or performance claims.

## Primary references

- [snarkjs implementation and trusted-setup workflow](https://github.com/iden3/snarkjs).
- [Circom compiler](https://github.com/iden3/circom) and
  [circuit inspection](https://docs.circom.io/circom-language/code-quality/inspect/).
- [Circom WASM package and experimental warning](https://www.npmjs.com/package/circom2).
- [Circomlib circuits](https://github.com/iden3/circomlib) and
  [Circomlib JavaScript helpers](https://github.com/iden3/circomlibjs).
- [RISC Zero quick start](https://dev.risczero.com/api/zkvm/quickstart): an earlier
  candidate, not the backend implemented here. Its Rust/zkVM toolchain was absent;
  this bounded experiment used the available Node/WASM path instead.
