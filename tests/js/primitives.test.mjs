// Primitive checks against INDEPENDENT references (BigInt, node:crypto), so the JS core
// is tested for correctness, not just against itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadCore, ROOT } from './lib/load.mjs';
import { idiv, isqrt } from '../../public/js/sim/int.js';
import { sha256Hex } from '../../public/js/sim/sha256.js';
import { rngSeed, rngNext, fmix32 } from '../../public/js/sim/rng.js';
import { isin, icos, loadSineTable, SINE_SHA256 } from '../../public/js/sim/sine.js';
import { canonical } from '../../public/js/sim/canon.js';

loadCore();
const M = (1n << 32n) - 1n;

test('idiv matches BigInt truncating division', () => {
  const cases = [[7, 2], [-7, 2], [7, -2], [-7, -2], [0, 3], [2 ** 53 - 1, 3], [-(2 ** 53 - 1), 2 ** 26 + 1], [-1, 30], [-29, 30]];
  for (let k = 0; k < 5000; k++) {
    const a = Math.floor((Math.random() * 2 - 1) * (2 ** 53 - 1));
    let b = Math.floor((Math.random() * 2 - 1) * 2 ** (1 + Math.floor(Math.random() * 40)));
    if (b === 0) b = 1;
    cases.push([a, b]);
  }
  for (const [a, b] of cases) assert.equal(idiv(a, b), Number(BigInt(a) / BigInt(b)), `idiv(${a},${b})`);
  assert.throws(() => idiv(1, 0));
  assert.throws(() => idiv(0.5, 1));
  assert.ok(Object.is(idiv(-1, 30), 0), 'never -0');
});

test('isqrt is exact floor(sqrt)', () => {
  const ns = [0, 1, 2, 3, 4, 8, 9, 2 ** 52, 2 ** 53 - 1];
  for (let k = 0; k < 5000; k++) ns.push(Math.floor(Math.random() * (2 ** 53 - 1)));
  for (const n of ns) {
    const r = BigInt(isqrt(n)), N = BigInt(n);
    assert.ok(r * r <= N && (r + 1n) * (r + 1n) > N, `isqrt(${n})`);
  }
  assert.throws(() => isqrt(-1));
});

test('sha256 matches node:crypto', () => {
  for (let len = 0; len < 300; len++) {
    const b = randomBytes(len);
    assert.equal(sha256Hex(new Uint8Array(b)), createHash('sha256').update(b).digest('hex'));
  }
  const big = randomBytes(100000);
  assert.equal(sha256Hex(new Uint8Array(big)), createHash('sha256').update(big).digest('hex'));
});

// Independent BigInt reference of xoshiro128** and the fmix32 seeder.
function refMul(a, b) { return (a * b) & M; }
function refRotl(x, k) { return ((x << BigInt(k)) | (x >> BigInt(32 - k))) & M; }
function refFmix(h) {
  h &= M; h ^= h >> 16n; h = refMul(h, 0x85EBCA6Bn); h ^= h >> 13n; h = refMul(h, 0xC2B2AE35n); h ^= h >> 16n; return h;
}
function refSeed(seed) { let z = BigInt(seed); const s = []; for (let i = 0; i < 4; i++) { z = (z + 0x9E3779B9n) & M; s.push(refFmix(z)); } return s; }
function refNext(s) {
  const r = refMul(refRotl(refMul(s[1], 5n), 7), 9n), t = (s[1] << 9n) & M;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = refRotl(s[3], 11);
  return r;
}

test('xoshiro128** matches the BigInt reference', () => {
  for (const seed of [0, 1, 2, 0xFFFFFFFF, 0x12345678, 0x9E3779B9]) {
    const a = rngSeed(seed), b = refSeed(seed);
    assert.deepEqual(a.map(BigInt), b);
    for (let k = 0; k < 2000; k++) assert.equal(BigInt(rngNext(a)), refNext(b));
  }
  for (const x of [0, 1, 0xDEADBEEF, 0xFFFFFFFF]) assert.equal(BigInt(fmix32(x)), refFmix(BigInt(x)));
  assert.throws(() => rngSeed(-1));
  assert.throws(() => rngSeed(2 ** 32));
});

test('sine table: pinned hash, exact quarter points, symmetry', () => {
  for (let a = 0; a < 4096; a++) {
    assert.equal(isin(a + 2048), 0 - isin(a) + 0, `odd symmetry at ${a}`);
    assert.equal(isin(2048 - a), isin(a), `mirror symmetry at ${a}`);
  }
  assert.equal(isin(0), 0); assert.equal(isin(1024), 16384); assert.equal(icos(0), 16384); assert.equal(isin(-1), isin(4095));
  const bytes = new Uint8Array(readFileSync(ROOT + 'public/js/sim/data/sine4096.bin'));
  bytes[10] ^= 1;
  assert.throws(() => loadSineTable(bytes), /SHA-256 mismatch/);
  assert.match(SINE_SHA256, /^[0-9a-f]{64}$/);
  loadCore();
});

test('canonical form', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonical('a"\\\n\u0001'), '"a\\"\\\\\\u000a\\u0001"');
  assert.equal(canonical(-0), '0');
  assert.equal(canonical('€🜂'), '"€🜂"');
  assert.throws(() => canonical(1.5));
  assert.throws(() => canonical({}));
  assert.throws(() => canonical({ '1a': 1 }));
  assert.throws(() => canonical('\uD800'));
  assert.throws(() => canonical(2 ** 53));
});
