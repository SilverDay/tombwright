// xoshiro128** (Blackman & Vigna), 32-bit, seeded from a 32-bit seed (R-RNG-*).
// State is a plain array of four uint32 numbers so it can live in sim state and the hash.

const M32 = 0xFFFFFFFF;

function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }
function mul32(a, b) { return Math.imul(a, b) >>> 0; }

/** R-RNG-2: murmur3 fmix32 finaliser. */
export function fmix32(h) {
  h >>>= 0;
  h = (h ^ (h >>> 16)) >>> 0; h = mul32(h, 0x85EBCA6B);
  h = (h ^ (h >>> 13)) >>> 0; h = mul32(h, 0xC2B2AE35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** R-RNG-2: state word i = fmix32(seed + (i+1) * 0x9E3779B9 mod 2^32). */
export function rngSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > M32) throw new RangeError('seed must be uint32');
  const s = [];
  let z = seed >>> 0;
  for (let i = 0; i < 4; i++) { z = (z + 0x9E3779B9) >>> 0; s.push(fmix32(z)); }
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1; // unreachable in practice; all-zero state is invalid
  return s;
}

/** R-RNG-1: advance state in place, return the next uint32. */
export function rngNext(s) {
  const result = mul32(rotl(mul32(s[1], 5), 7), 9);
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** R-RNG-3: integer in [0, n) for 1 <= n <= 65536, as floor(next * n / 2^32). */
export function rngBelow(s, n) {
  if (!Number.isInteger(n) || n < 1 || n > 65536) throw new RangeError('rngBelow: n out of range');
  return Math.floor((rngNext(s) * n) / 4294967296);
}
