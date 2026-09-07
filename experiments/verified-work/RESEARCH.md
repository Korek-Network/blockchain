# Verified work: prior art and next experiment

Reviewed 7 September 2026. This is a focused comparison of project documentation,
not an exhaustive novelty/patent search or independent audit of competitor systems.
No competitors' code was incorporated in this experiment. External capabilities
below are described by their projects, not independently benchmarked here.

## Existing work overlaps substantially

| Project | Relevant existing capability | Consequence for KOREK |
|---|---|---|
| [Golem](https://docs.golem.network/docs/golem/overview) | Providers share computer resources, including laptops/desktops; requestors pay for resource usage. | Ordinary-PC participation and a compute marketplace are not new inventions. |
| [Gensyn / Verde](https://www.gensyn.ai/research/verde-a-verification-system-for-machine-learning-over-untrusted-nodes) | Research on reproducible ML execution across hardware and dispute-based verification of untrusted suppliers. | Verified distributed AI and deterministic execution are established research areas; not a safe first workload to promise. |
| [Boundless / RISC Zero](https://dev.risczero.com/api/generating-proofs/remote-proving) | Permissionless provers generate proofs for requested R0VM programs and inputs through a proving marketplace. | Buying provable results is already being pursued; an established proof backend is a candidate to evaluate. |
| [iExec PoCo](https://docs.iex.ec/protocol/proof-of-contribution) | The documented default workflow combines TEE-based execution, access rules, escrow/payment and penalties. | Escrow, attestation, result delivery and automatic payment do not establish novelty. Hardware attestation and computation proofs have different trust assumptions. |

Potential differentiation is a HYPOTHESIS: substantially better end-user access,
verification cost, or reliability for a specific useful workload. This demo proves
none of those comparative advantages. Changing the implementation language or
adding a DAG does not by itself create a novel product or proof system.

## Baseline evidence

The [recorded run](results/local-demo.json) used Node v24.19.0 on Linux x64 with
an AMD EPYC 9V74 host, nine logical CPUs visible and one JS application thread.
Numbers below are one short run: five warmups and 25 samples for each size.
They are neither representative consumer-PC results nor controlled competitor tests.

| Matrix dimension | Worker p50 (ms) | Full verifier p50 (ms) | Verifier/worker p50 |
|---|---:|---:|---:|
| 8 | 0.023615 | 0.028252 | 1.196 |
| 16 | 0.023345 | 0.033891 | 1.452 |
| 32 | 0.130476 | 0.145849 | 1.118 |
| 64 | 1.092622 | 0.721394 | 0.660 |

The 64x64 verifier's lower time reflects a different loop layout/runtime effects,
not succinct verification: it still repeats the multiplication. Kernel latency is
no evidence of end-to-end jobs/s, blockchain TPS, TTF, cheap proofs or lower costs.
The recorded local payment/rejection/refund scenario took about 6.15 ms; that also
excludes networking, consensus and durability. No fiat or electricity costs were
measured. Inputs/results are small and synthetic; market demand is untested.

**Decision: continue a bounded verification-cost investigation; do not deploy this
market, change consensus, advertise a TPS figure, or claim a world first.**

## Next gates, in order

1. **Find a useful benchmark.** Specify one real customer task and public or
   authorized dataset. Establish local execution cost and whether remote execution
   has value. Do not assume arbitrary AI truth/quality can be proven. No outreach
   to customers or project contributors has been performed.
2. **Evaluate an existing proof backend.** Candidate: a maintained RISC Zero zkVM
   release. Pin its release and dependencies, review assumptions, and generate a
   REAL proof (development/fake receipts must be rejected). Bind program ID,
   input commitment, result, chain ID, job ID and payment recipient. Test proof
   tampering, wrong inputs/programs, replay and malformed proofs. This integration
   is not implemented and may require a suitable Rust toolchain/prover machine.
3. **Measure economics before claiming speed.** Publish native compute time,
   execution-plus-proof time, proof size, verification time, peak RAM, hardware,
   transport/storage cost and electricity if measured. A proof may make checking
   cheaper while making producing the answer much more expensive. Retain the
   full-reexecution baseline and require a convincing end-to-end trade-off.
4. **Separate processes, then operators.** Add authenticated bounded transport,
   deterministic job data, durable event replay, retries and fault injection.
   Multi-process simulation is not decentralization. A real multi-machine test
   should document who operates each machine and what trust remains.
5. **Only then integrate a reviewed consensus engine on a separate devnet.**
   Define validator membership, quorum evidence, deterministic execution, agreed
   logical time, data availability, recovery and reconfiguration. Do not count work
   approval votes as a BFT proof. Keep settlement consensus independent of job demand.
   Rust/DAG-BFT is an architecture candidate, not an integration completed here.
6. **Revisit product positioning and migration.** Compare matching workloads,
   verification guarantees, customer cost and hardware entry requirements. Resolve
   Sybil/griefing costs, verifier incentives, mining's future role and any wallet
   migration explicitly before touching Planck or economic rules. 50,000 finalized
   transfer TPS remains a separate, unverified target, not a compute-job rate.

## Security and liveness questions still open

This demo has no fee or bond and cannot distinguish one person from many keys.
Malicious identities can occupy claims, consume retry slots or fill account limits.
Re-execution is O(n^3), so exposing it as an unauthenticated service would invite
resource abuse even with per-message limits. Admission fees, quotas, fair scheduling
and worker incentives need a threat model, not just a higher limit.

An honest local verifier rejecting a wrong matrix does not show that a malicious
consensus quorum cannot steal funds. Likewise, a payment receipt hash does not
prove finality. Network consensus, computation evidence, and incentive/security
assumptions must each be implemented and evaluated separately.
