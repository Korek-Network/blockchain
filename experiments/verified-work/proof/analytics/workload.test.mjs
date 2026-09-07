import test from "node:test";
import assert from "node:assert/strict";
import { ROWS, CHANNELS, PAIRS, fixture, compute, reference, validateRows, validateResult, covarianceNumerators } from "./workload.mjs";

test("statistics agree with an independent BigInt oracle across fixture seeds", () => {
  for (const seed of [0, 1, 2, 42, 123456, 0xffffffff]) assert.deepEqual(compute(fixture(seed)), reference(fixture(seed)));
});
test("all pairs are unique and include each diagonal", () => {
  assert.equal(PAIRS.length, 36);
  assert.equal(new Set(PAIRS.map(x => x.join())).size, 36);
  assert.equal(PAIRS.filter(([a, b]) => a === b).length, CHANNELS);
});
test("constant signed extreme channels have zero covariance", () => {
  const rows = Array.from({ length: ROWS }, () => Array.from({ length: CHANNELS }, (_, c) => c % 2 ? 32767 : -32768));
  assert.deepEqual(compute(rows), reference(rows));
  assert.deepEqual(covarianceNumerators(compute(rows)), Array(36).fill(0));
});
test("alternating signs give exact population variance", () => {
  const rows = Array.from({ length: ROWS }, (_, r) => Array(CHANNELS).fill(r % 2 ? 1 : -1));
  assert.deepEqual(compute(rows).sums, Array(8).fill(0));
  assert.deepEqual(covarianceNumerators(compute(rows)), Array(36).fill(ROWS ** 2));
});
test("dataset shape, holes, fractions and noncanonical integers fail", () => {
  assert.throws(() => validateRows(fixture().slice(1)));
  for (const value of [32768, -32769, -0, 0.5, NaN, Infinity, "1", null]) {
    const rows = fixture(); rows[0][0] = value; assert.throws(() => validateRows(rows));
  }
  const rows = fixture(); delete rows[1][2]; assert.throws(() => validateRows(rows));
});
test("malformed or unsafe results fail", () => {
  const good = compute(fixture());
  for (const result of [null, {}, { ...good, extra: 1 }, { ...good, sums: [] }, { ...good, crossProducts: [] }]) {
    assert.throws(() => validateResult(result));
  }
  for (const value of [2 ** 53, -0, 137438953473, -137438953473]) {
    const bad = structuredClone(good); bad.crossProducts[0] = value; assert.throws(() => validateResult(bad));
  }
});
