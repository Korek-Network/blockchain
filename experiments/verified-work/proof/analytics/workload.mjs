// Exact sufficient statistics for a fixed sensor batch; no floating-point circuit.
export const VERSION = "korek-sensor-statistics-proof/1";
export const ROWS = 128;
export const CHANNELS = 8;
export const OFFSET = 32768;
export const SUM_OFFSET = ROWS * OFFSET;
export const CROSS_OFFSET = ROWS * OFFSET ** 2;
export const PAIRS = Array.from({ length: CHANNELS }, (_, a) =>
  Array.from({ length: CHANNELS - a }, (_, i) => [a, a + i])).flat();

function integers(values, length, low, high) {
  if (!Array.isArray(values) || values.length !== length) throw new Error("Invalid array shape");
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(values, i) || !Number.isSafeInteger(values[i]) || Object.is(values[i], -0) ||
        values[i] < low || values[i] > high) throw new Error("Invalid bounded integer");
  }
}

export function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== ROWS) throw new Error("Expected 128 sensor records");
  for (let r = 0; r < ROWS; r++) integers(rows[r], CHANNELS, -OFFSET, OFFSET - 1);
}

export function validateResult(result) {
  if (!result || Object.keys(result).sort().join() !== "crossProducts,sums") throw new Error("Invalid result");
  integers(result.sums, CHANNELS, -SUM_OFFSET, ROWS * (OFFSET - 1));
  integers(result.crossProducts, PAIRS.length, -CROSS_OFFSET, CROSS_OFFSET);
}

export function compute(rows) {
  validateRows(rows);
  const sums = Array(CHANNELS).fill(0), crossProducts = Array(PAIRS.length).fill(0);
  for (const row of rows) {
    for (let c = 0; c < CHANNELS; c++) sums[c] += row[c];
    for (let k = 0; k < PAIRS.length; k++) crossProducts[k] += row[PAIRS[k][0]] * row[PAIRS[k][1]];
  }
  return { sums, crossProducts };
}

// Independent, column-major BigInt oracle for tests; NOT the timed native baseline.
export function reference(rows) {
  validateRows(rows);
  return {
    sums: Array.from({ length: CHANNELS }, (_, c) => Number(rows.reduce((n, row) => n + BigInt(row[c]), 0n))),
    crossProducts: PAIRS.map(([a, b]) => Number(rows.reduce((n, row) => n + BigInt(row[a]) * BigInt(row[b]), 0n))),
  };
}

export function covarianceNumerators(result) {
  validateResult(result);
  // Divide by ROWS^2 for population covariance, ROWS*(ROWS-1) for sample covariance.
  return PAIRS.map(([a, b], k) => ROWS * result.crossProducts[k] - result.sums[a] * result.sums[b]);
}

export function fixture(seed = 1) {
  // Reproducible generated records, NOT customer measurements or a demand signal.
  let state = seed >>> 0;
  return Array.from({ length: ROWS }, () => Array.from({ length: CHANNELS }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) - OFFSET;
  }));
}
