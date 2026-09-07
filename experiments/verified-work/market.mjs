import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { validateInput, verifyResult } from "./workload.mjs";

export const DOMAIN = "korek-verified-work-poc/1";
export const CHAIN_ID = "korek-isolated-work-demo-1";
export const LIMITS = Object.freeze({
  bytes: 131_072, jobs: 100, accounts: 128, attempts: 3,
  lifetime: 100_000, money: (1n << 64n) - 1n,
});
const encode = value => JSON.stringify(value, (_, item) =>
  typeof item === "bigint" ? item.toString() : item);
const hash = value => createHash("sha256").update(value).digest("hex");
const amount = value => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
      BigInt(value) > LIMITS.money) throw new Error("Invalid amount");
  return BigInt(value);
};
const tick = value => {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new Error("Invalid logical time");
  }
};
const addressOf = publicKey => `kwp1${hash(Buffer.from(publicKey, "hex"))}`;

export function createIdentity() {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { address: addressOf(publicKey), publicKey, privateKey: keys.privateKey };
}

// Body tuples: create=[input, reward, deadline], claim/refund=[jobId],
// submit=[jobId, result]. The exact serialized tuple is signed, including
// network, action, nonce, public key, job, result and all payment conditions.
export function signedRequest(identity, kind, nonce, body, chainId = CHAIN_ID) {
  const message = JSON.stringify([DOMAIN, chainId, kind, nonce, identity.publicKey, body]);
  return { message, signature: sign(null, Buffer.from(message), identity.privateKey).toString("hex") };
}

function authenticate(envelope, chainId) {
  if (!envelope || typeof envelope.message !== "string" ||
      Buffer.byteLength(envelope.message) > LIMITS.bytes ||
      typeof envelope.signature !== "string" || !/^[0-9a-f]{128}$/.test(envelope.signature)) {
    throw new Error("Invalid or oversized signed request");
  }
  const tuple = JSON.parse(envelope.message);
  if (!Array.isArray(tuple) || tuple.length !== 6 || JSON.stringify(tuple) !== envelope.message) {
    throw new Error("Noncanonical request");
  }
  const [domain, network, kind, nonce, publicKey, body] = tuple;
  if (domain !== DOMAIN || network !== chainId) throw new Error("Wrong domain or network");
  if (!["create", "claim", "submit", "refund"].includes(kind)) throw new Error("Unknown action");
  if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid nonce");
  }
  // Require canonical 44-byte Ed25519 SubjectPublicKeyInfo, no RSA/EC fallback.
  if (typeof publicKey !== "string" ||
      !/^302a300506032b6570032100[0-9a-f]{64}$/.test(publicKey)) throw new Error("Invalid public key");
  const key = createPublicKey({ key: Buffer.from(publicKey, "hex"), type: "spki", format: "der" });
  if (!verify(null, Buffer.from(envelope.message), key, Buffer.from(envelope.signature, "hex"))) {
    throw new Error("Invalid signature");
  }
  const length = kind === "create" ? 3 : kind === "submit" ? 2 : 1;
  if (!Array.isArray(body) || body.length !== length) throw new Error("Invalid action body");
  return { kind, nonce, body, actor: addressOf(publicKey) };
}

function conserved(state, supply) {
  let total = 0n;
  for (const balance of state.balances.values()) {
    if (balance < 0n || balance > LIMITS.money) throw new Error("Invalid account balance");
    total += balance;
  }
  for (const job of state.jobs.values()) {
    if (job.status === "open" || job.status === "claimed") total += BigInt(job.reward);
  }
  if (total !== supply) throw new Error("Conservation invariant failed");
}

function publicState(state, chainId, supply) {
  const sort = map => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return JSON.parse(encode({ domain: DOMAIN, chainId, supply,
    time: state.time, balances: sort(state.balances), nonces: sort(state.nonces), jobs: sort(state.jobs) }));
}

export class WorkMarket {
  #state;
  #supply = 0n;
  #chainId;

  constructor(genesis, chainId = CHAIN_ID) {
    if (!Array.isArray(genesis) || genesis.length > LIMITS.accounts ||
        typeof chainId !== "string" || !/^[a-z0-9-]{1,64}$/.test(chainId)) {
      throw new Error("Invalid demo genesis");
    }
    this.#chainId = chainId;
    this.#state = { time: 0, balances: new Map(), nonces: new Map(), jobs: new Map() };
    for (const entry of genesis) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid genesis entry");
      const [address, value] = entry;
      if (typeof address !== "string" || !/^kwp1[0-9a-f]{64}$/.test(address) ||
          this.#state.balances.has(address)) throw new Error("Invalid or duplicate genesis account");
      const balance = amount(value);
      this.#state.balances.set(address, balance);
      this.#state.nonces.set(address, 0);
      this.#supply += balance;
    }
    if (this.#supply > LIMITS.money) throw new Error("Demo supply overflow");
  }

  balance(address) { return (this.#state.balances.get(address) ?? 0n).toString(); }
  nonce(address) { return this.#state.nonces.get(address) ?? 0; }
  state() { return publicState(this.#state, this.#chainId, this.#supply); }
  digest() { return hash(encode(this.state())); }
  job(id) { return structuredClone(this.#state.jobs.get(id) ?? null); }

  apply(envelope, orderedTime) {
    tick(orderedTime);
    if (orderedTime < this.#state.time) throw new Error("Logical time cannot go backwards");
    const { kind, nonce, body, actor } = authenticate(envelope, this.#chainId);
    if (nonce !== this.nonce(actor)) throw new Error("Replay or out-of-order nonce");
    // Simple atomic reference implementation: discard the draft on any error.
    // This full copy is deliberately NOT a high-throughput storage design.
    const state = structuredClone(this.#state);
    if (!state.balances.has(actor)) {
      if (state.balances.size >= LIMITS.accounts) throw new Error("Account limit reached");
      state.balances.set(actor, 0n);
    }
    let outcome;
    if (kind === "create") {
      if (state.jobs.size >= LIMITS.jobs) throw new Error("Job limit reached");
      const [input, reward, deadline] = body;
      validateInput(input);
      const payment = amount(reward);
      tick(deadline);
      if (deadline <= orderedTime || deadline - orderedTime > LIMITS.lifetime) {
        throw new Error("Invalid deadline");
      }
      if (payment === 0n || state.balances.get(actor) < payment) throw new Error("Insufficient escrow");
      const id = hash(envelope.message);
      state.balances.set(actor, state.balances.get(actor) - payment);
      state.jobs.set(id, { id, creator: actor, input, inputHash: hash(encode(input)), reward,
        deadline, createdAt: orderedTime, status: "open", worker: null, rejectedWorkers: [], receipt: null });
      outcome = { status: "created", jobId: id };
    } else {
      const id = body[0];
      if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new Error("Invalid job ID");
      const job = state.jobs.get(id);
      if (!job) throw new Error("Unknown job");
      if (!["open", "claimed"].includes(job.status)) throw new Error("Job is already final");
      if (kind === "refund") {
        // Permissionless trigger, but funds ALWAYS go to the recorded customer.
        if (orderedTime < job.deadline) throw new Error("Deadline has not elapsed");
        this.#refund(state, job, orderedTime, "deadline");
        outcome = { status: "refunded", jobId: id };
      } else {
        if (orderedTime >= job.deadline) throw new Error("Job expired");
        if (kind === "claim") {
          if (job.status !== "open" || job.creator === actor || job.rejectedWorkers.includes(actor)) {
            throw new Error("Worker cannot claim this job");
          }
          job.status = "claimed";
          job.worker = actor;
          outcome = { status: "claimed", jobId: id };
        } else {
          if (job.status !== "claimed" || job.worker !== actor) throw new Error("Only assigned worker can submit");
          const result = body[1];
          if (verifyResult(job.input, result)) {
            state.balances.set(actor, state.balances.get(actor) + BigInt(job.reward));
            job.status = "paid";
            const receipt = { version: DOMAIN, chainId: this.#chainId, jobId: id,
              verification: "full-recomputation", inputHash: job.inputHash,
              outputHash: hash(encode(result)), worker: actor, reward: job.reward, settledAt: orderedTime };
            job.receipt = { ...receipt, digest: hash(encode(receipt)) };
            outcome = { status: "paid", jobId: id, receipt: job.receipt };
          } else {
            job.rejectedWorkers.push(actor);
            job.worker = null;
            job.status = "open";
            if (job.rejectedWorkers.length >= LIMITS.attempts) {
              this.#refund(state, job, orderedTime, "attempt-limit");
            }
            outcome = { status: "invalid-result", jobId: id, jobStatus: job.status };
          }
        }
      }
    }
    state.time = orderedTime;
    state.nonces.set(actor, nonce + 1);
    conserved(state, this.#supply);
    this.#state = state;
    return structuredClone(outcome);
  }

  #refund(state, job, time, reason) {
    state.balances.set(job.creator, state.balances.get(job.creator) + BigInt(job.reward));
    job.status = "refunded";
    job.refundedAt = time;
    job.refundReason = reason;
  }
}
