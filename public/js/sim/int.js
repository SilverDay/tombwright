// Integer helpers for the sim core. Normative rules: docs/sim-rules.md (R-INT-*).
// No floating-point value may ever be stored in sim state.

export const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1, the shared range of JS and PHP

/** R-INT-1: throw unless v is an integer in [-(2^53-1), 2^53-1]. */
export function assertInt(v, what = 'value') {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${what} is not a safe integer: ${v}`);
  return v;
}

/** R-INT-3: integer division truncating toward zero (PHP intdiv semantics). */
export function idiv(a, b) {
  assertInt(a, 'idiv a'); assertInt(b, 'idiv b');
  if (b === 0) throw new RangeError('idiv by zero');
  let q = Math.trunc(a / b);
  // Correct any rounding in the float quotient so the result is exact.
  let r = a - q * b;
  const sb = b > 0 ? 1 : -1;
  while (r !== 0 && (Math.sign(r) !== Math.sign(a) || Math.abs(r) >= Math.abs(b))) {
    if (Math.abs(r) >= Math.abs(b)) { q += Math.sign(r) * sb; r = a - q * b; }
    else { q -= Math.sign(r) * sb; r = a - q * b; }
  }
  return q === 0 ? 0 : q; // never -0
}

/** R-INT-4: floor(sqrt(n)) for 0 <= n <= 2^53-1, exact. */
export function isqrt(n) {
  assertInt(n, 'isqrt n');
  if (n < 0) throw new RangeError('isqrt of negative');
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
