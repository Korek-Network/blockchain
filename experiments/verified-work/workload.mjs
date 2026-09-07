// A bounded reference workload, not a zkVM, AI model or general code runner.
export const PROFILE = "korek-matrix-integer-poc/1";
export const MAX_DIMENSION = 64;
export const MAX_COEFFICIENT = 1_000;

function vector(values, length, bound, name) {
  if (!Array.isArray(values) || values.length !== length) {
    throw new Error(`${name}: wrong array length`);
  }
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(values, i) || !Number.isSafeInteger(values[i]) ||
        Object.is(values[i], -0) || Math.abs(values[i]) > bound) {
      throw new Error(`${name}: invalid integer`);
    }
  }
}

export function validateInput(input) {
  if (!Array.isArray(input) || input.length !== 4 || input[0] !== PROFILE) {
    throw new Error("Unsupported workload profile");
  }
  const [, n, a, b] = input;
  if (!Number.isInteger(n) || n < 1 || n > MAX_DIMENSION) {
    throw new Error("Invalid matrix dimension");
  }
  vector(a, n * n, MAX_COEFFICIENT, "Matrix A");
  vector(b, n * n, MAX_COEFFICIENT, "Matrix B");
  return input;
}

export function solve(input) {
  const [, n, a, b] = validateInput(input);
  const result = Array(n * n).fill(0);
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      for (let k = 0; k < n; k++) {
        result[row * n + column] += a[row * n + k] * b[k * n + column];
      }
    }
  }
  return result;
}

export function verifyResult(input, result) {
  const [, n, a, b] = validateInput(input);
  // Maximum absolute sum: 64 * 1000 * 1000. Every intermediate is exact
  // in JS integer arithmetic; floating-point/non-deterministic ML is excluded.
  vector(result, n * n, n * MAX_COEFFICIENT ** 2, "Result");
  // Deliberately independent loop layout. This is FULL RECOMPUTATION,
  // with O(n^3) work, not a succinct or zero-knowledge proof.
  const expected = Array(n * n).fill(0);
  for (let k = 0; k < n; k++) {
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) {
        expected[row * n + column] += a[row * n + k] * b[k * n + column];
      }
    }
  }
  return expected.every((value, index) => value === result[index]);
}

export function sampleInput(n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_DIMENSION) {
    throw new Error("Invalid matrix dimension");
  }
  return [PROFILE, n,
    Array.from({ length: n * n }, (_, i) => (i * 17 + 3) % 101 - 50),
    Array.from({ length: n * n }, (_, i) => (i * 29 + 7) % 103 - 51)];
}
