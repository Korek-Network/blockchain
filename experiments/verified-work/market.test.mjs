import test from "node:test";
import assert from "node:assert/strict";
import { createIdentity, signedRequest, WorkMarket, LIMITS } from "./market.mjs";
import { PROFILE, sampleInput, solve, verifyResult, validateInput } from "./workload.mjs";

function setup() {
  const customer = createIdentity(), worker = createIdentity(), other = createIdentity();
  const genesis = [[customer.address, "1000"]];
  const market = new WorkMarket(genesis);
  const send = (who, kind, body, time = 1) => market.apply(
    signedRequest(who, kind, market.nonce(who.address), body), time);
  const create = (input = sampleInput(2), reward = "100", deadline = 50) =>
    send(customer, "create", [input, reward, deadline]).jobId;
  return { customer, worker, other, genesis, market, send, create };
}

function unchanged(market, action, pattern) {
  const before = market.digest();
  assert.throws(action, pattern);
  assert.equal(market.digest(), before, "Rejected action must not mutate state");
}

test("known signed integer matrix vector and independent verification", () => {
  const input = [PROFILE, 2, [1, -2, 3, 4], [5, 6, -7, 8]];
  assert.deepEqual(solve(input), [19, -10, -13, 50]);
  assert.equal(verifyResult(input, [19, -10, -13, 50]), true);
  assert.equal(verifyResult(input, [19, -10, -13, 49]), false);
});

test("maximum coefficients remain exact at the dimension bound", () => {
  const input = [PROFILE, 64, Array(4096).fill(1000), Array(4096).fill(-1000)];
  const result = solve(input);
  assert.ok(result.every(value => value === -64_000_000));
  assert.equal(verifyResult(input, result), true);
});

test("input shape, profile, integers, bounds and sparse arrays are enforced", () => {
  const bad = [
    ["arbitrary-code", 1, [1], [1]], [PROFILE, 65, [], []],
    [PROFILE, 0, [], []], [PROFILE, 1, [1.5], [1]],
    [PROFILE, 1, [1001], [1]], [PROFILE, 1, [NaN], [1]],
    [PROFILE, 1, [Infinity], [1]], [PROFILE, 1, [-0], [1]],
    [PROFILE, 1, Array(1), [1]], [PROFILE, 2, [1], [1]],
  ];
  for (const input of bad) assert.throws(() => validateInput(input));
  assert.throws(() => verifyResult(sampleInput(2), "a-hash-is-not-evidence"));
  assert.throws(() => verifyResult(sampleInput(1), [Number.MAX_SAFE_INTEGER]));
});

test("matrix identity property across several dimensions", () => {
  for (let n = 1; n <= 12; n++) {
    const input = sampleInput(n);
    input[3] = Array.from({ length: n * n }, (_, i) => Math.floor(i / n) === i % n ? 1 : 0);
    assert.deepEqual(solve(input), input[2]);
    assert.equal(verifyResult(input, input[2]), true);
  }
});

test("escrow pays exactly once for an actually verified result", () => {
  const { market, worker, customer, send, create } = setup();
  const id = create();
  assert.equal(market.balance(customer.address), "900");
  send(worker, "claim", [id], 2);
  const paid = send(worker, "submit", [id, solve(market.job(id).input)], 3);
  assert.equal(paid.status, "paid");
  assert.equal(paid.receipt.verification, "full-recomputation");
  assert.equal(market.balance(worker.address), "100");
  unchanged(market, () => send(worker, "submit", [id, solve(sampleInput(2))], 4), /already final/);
  unchanged(market, () => send(customer, "refund", [id], 50), /already final/);
});

test("false results earn nothing and permit a different worker to retry", () => {
  const { market, worker, other, customer, send, create } = setup();
  const id = create();
  send(worker, "claim", [id], 2);
  assert.equal(send(worker, "submit", [id, [0, 0, 0, 0]], 3).status, "invalid-result");
  assert.equal(market.balance(worker.address), "0");
  assert.equal(market.balance(customer.address), "900");
  assert.equal(market.job(id).status, "open");
  unchanged(market, () => send(worker, "claim", [id], 4), /cannot claim/);
  send(other, "claim", [id], 4);
  send(other, "submit", [id, solve(market.job(id).input)], 5);
  assert.equal(market.balance(other.address), "100");
});

test("three incorrect attempts refund the original customer", () => {
  const { market, customer, other, send, create } = setup();
  const id = create();
  for (let i = 0; i < LIMITS.attempts; i++) {
    const worker = createIdentity();
    send(worker, "claim", [id], 2 + 2 * i);
    send(worker, "submit", [id, [0, 0, 0, 0]], 3 + 2 * i);
  }
  assert.equal(market.job(id).status, "refunded");
  assert.equal(market.job(id).refundReason, "attempt-limit");
  assert.equal(market.balance(customer.address), "1000");
  unchanged(market, () => send(other, "claim", [id], 8), /already final/);
});

for (const claimed of [false, true]) {
  test(`deadline refunds ${claimed ? "claimed" : "unclaimed"} job once, even when triggered by stranger`, () => {
    const { market, worker, other, customer, send, create } = setup();
    const id = create();
    if (claimed) send(worker, "claim", [id], 2);
    unchanged(market, () => send(other, "refund", [id], 49), /not elapsed/);
    send(other, "refund", [id], 50);
    assert.equal(market.balance(customer.address), "1000");
    assert.equal(market.balance(other.address), "0");
    unchanged(market, () => send(other, "refund", [id], 51), /already final/);
  });
}

test("submission is too late at the exact deadline", () => {
  const { market, worker, send, create } = setup();
  const id = create();
  send(worker, "claim", [id], 2);
  unchanged(market, () => send(worker, "submit", [id, solve(sampleInput(2))], 50), /expired/);
});

test("customer cannot claim and unassigned worker cannot submit", () => {
  const { market, customer, worker, other, send, create } = setup();
  const id = create();
  unchanged(market, () => send(customer, "claim", [id], 2), /cannot claim/);
  send(worker, "claim", [id], 2);
  unchanged(market, () => send(other, "claim", [id], 3), /cannot claim/);
  unchanged(market, () => send(other, "submit", [id, solve(sampleInput(2))], 3), /assigned worker/);
});

test("nonces prevent replay and reject out-of-order requests atomically", () => {
  const { market, customer } = setup();
  const request = signedRequest(customer, "create", 0, [sampleInput(2), "100", 50]);
  market.apply(request, 1);
  unchanged(market, () => market.apply(request, 2), /nonce/);
  unchanged(market, () => market.apply(signedRequest(customer, "create", 3,
    [sampleInput(2), "100", 50]), 2), /nonce/);
});

test("signature binds reward, deadline, inputs, action and signer", () => {
  const { market, customer, worker } = setup();
  const original = signedRequest(customer, "create", 0, [sampleInput(2), "100", 50]);
  for (const mutate of [
    tuple => { tuple[5][1] = "99"; }, tuple => { tuple[5][2] = 51; },
    tuple => { tuple[5][0][2][0]++; }, tuple => { tuple[2] = "claim"; },
    tuple => { tuple[4] = worker.publicKey; },
  ]) {
    const tuple = JSON.parse(original.message);
    mutate(tuple);
    unchanged(market, () => market.apply({ ...original, message: JSON.stringify(tuple) }, 1), /signature/);
  }
});

test("result signature binds output cells and job ID", () => {
  const { market, worker, send, create } = setup();
  const id = create();
  send(worker, "claim", [id], 2);
  const original = signedRequest(worker, "submit", 1, [id, solve(sampleInput(2))]);
  for (const mutate of [tuple => { tuple[5][1][0]++; }, tuple => { tuple[5][0] = "f".repeat(64); }]) {
    const tuple = JSON.parse(original.message);
    mutate(tuple);
    unchanged(market, () => market.apply({ ...original, message: JSON.stringify(tuple) }, 3), /signature/);
  }
});

test("cross-network and cross-domain replays are rejected", () => {
  const { market, customer } = setup();
  const request = signedRequest(customer, "create", 0, [sampleInput(2), "100", 50], "another-demo");
  unchanged(market, () => market.apply(request, 1), /domain or network/);
  const tuple = JSON.parse(request.message);
  tuple[0] = "other-protocol";
  unchanged(market, () => market.apply({ ...request, message: JSON.stringify(tuple) }, 1), /domain or network/);
});

test("oversized, noncanonical and malformed requests do not change state", () => {
  const { market, customer } = setup();
  const request = signedRequest(customer, "create", 0, [sampleInput(2), "100", 50]);
  for (const bad of [null, { ...request, signature: "00" },
    { ...request, message: " ".repeat(LIMITS.bytes + 1) },
    { ...request, message: `${request.message} ` }, { ...request, message: "{" }]) {
    unchanged(market, () => market.apply(bad, 1));
  }
});

test("malformed result and unsupported workload fail closed", () => {
  const { market, worker, send, create } = setup();
  unchanged(market, () => create(["custom-script", 1, [1], [1]]), /profile/);
  const id = create();
  send(worker, "claim", [id], 2);
  for (const result of [[], "output-hash", [1.2, 0, 0, 0], [1e20, 0, 0, 0]]) {
    unchanged(market, () => send(worker, "submit", [id, result], 3), /Result/);
  }
});

test("amounts, funding and lifetimes are bounded", () => {
  const { market, create } = setup();
  for (const reward of ["0", "-1", "01", "1e2", "1.5", "1001", (LIMITS.money + 1n).toString()]) {
    unchanged(market, () => create(sampleInput(1), reward));
  }
  for (const deadline of [0, 1, 1.5, -1, 100_002]) {
    unchanged(market, () => create(sampleInput(1), "100", deadline));
  }
});

test("logical time is monotonic and invalid calls do not advance it", () => {
  const { market, worker, send, create } = setup();
  const id = create();
  send(worker, "claim", [id], 10);
  unchanged(market, () => send(worker, "submit", [id, solve(sampleInput(2))], 9), /backwards/);
  unchanged(market, () => send(worker, "submit", [id, solve(sampleInput(2))], NaN), /time/);
  send(worker, "submit", [id, solve(sampleInput(2))], 11);
});

test("snapshots, input objects and returned receipts cannot mutate private state", () => {
  const { market, worker, send, create } = setup();
  const input = sampleInput(2), id = create(input);
  input[2][0] = 999;
  market.job(id).input[2][0] = 999;
  market.state().jobs[0][1].reward = "999";
  assert.equal(market.job(id).reward, "100");
  assert.deepEqual(market.job(id).input, sampleInput(2));
  send(worker, "claim", [id], 2);
  const paid = send(worker, "submit", [id, solve(sampleInput(2))], 3);
  const digest = market.digest();
  paid.receipt.reward = "999";
  assert.equal(market.digest(), digest);
});

test("replaying the same signed events produces an identical state commitment", () => {
  const { market, genesis, customer, worker } = setup();
  const replica = new WorkMarket(genesis);
  const create = signedRequest(customer, "create", 0, [sampleInput(2), "100", 50]);
  const id = market.apply(create, 1).jobId;
  replica.apply(create, 1);
  const events = [signedRequest(worker, "claim", 0, [id]),
    signedRequest(worker, "submit", 1, [id, solve(sampleInput(2))])];
  events.forEach((event, index) => {
    assert.deepEqual(market.apply(event, index + 2), replica.apply(event, index + 2));
    assert.equal(market.digest(), replica.digest());
  });
});

test("genesis rejects duplicates and supply overflow", () => {
  const a = createIdentity(), b = createIdentity();
  assert.throws(() => new WorkMarket([[a.address, "1"], [a.address, "1"]]), /duplicate/);
  assert.throws(() => new WorkMarket([[a.address, LIMITS.money.toString()], [b.address, "1"]]), /overflow/);
});

test("job count bounds retained state and rejects the next creation atomically", () => {
  const { market, create } = setup();
  for (let i = 0; i < LIMITS.jobs; i++) create(sampleInput(1), "1");
  unchanged(market, () => create(sampleInput(1), "1"), /Job limit/);
});

test("account count bounds authenticated zero-balance identities", () => {
  const { market, customer, worker } = setup();
  const genesis = Array.from({ length: LIMITS.accounts }, () => [createIdentity().address, "0"]);
  genesis[0] = [customer.address, "1000"];
  const full = new WorkMarket(genesis);
  const id = full.apply(signedRequest(customer, "create", 0, [sampleInput(1), "1", 50]), 1).jobId;
  unchanged(full, () => full.apply(signedRequest(worker, "claim", 0, [id]), 2), /Account limit/);
  assert.equal(market.state().jobs.length, 0);
});
