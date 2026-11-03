// Regenerates golden vectors from the JS core. Run after an INTENTIONAL rules change:
//   node tests/golden/generate.mjs
// Then bump CORE_VERSION in both cores and say why in the commit. CI fails if PHP disagrees.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { loadCore, ROOT } from '../js/lib/load.mjs';
import * as Sim from '../../public/js/sim/sim.js';
import { idiv, isqrt } from '../../public/js/sim/int.js';
import { rngSeed, rngNext, rngBelow, fmix32 } from '../../public/js/sim/rng.js';
import { canonical } from '../../public/js/sim/canon.js';
import { sha256Hex } from '../../public/js/sim/sha256.js';
import { isin } from '../../public/js/sim/sine.js';

loadCore();
const DIR = ROOT + 'tests/golden/vectors/';
export const HASH_EVERY = 300;

/** Expand [[count, input], ...] into one input per tick. */
export function expand(rle) {
  const out = [];
  for (const [n, inp] of rle) for (let k = 0; k < n; k++) out.push(inp);
  return out;
}

const I = (move = [0, 0], yaw = 0, buttons = 0, pitch = 0) => ({ move, yaw, pitch, buttons, target: 0 });
const B = Sim.BTN;

// Scripted walk: covers walking, running, turning, diagonal normalisation, hood presses.
const walk = [
  [60, I()], [120, I([127, 0])], [30, I([127, 0], 1024)], [90, I([127, 0], 1024, B.run)],
  [1, I([0, 0], 1024, B.hood)], [40, I([0, 0], 1024)], [1, I([0, 0], 1024, B.hood)],
  [150, I([127, 127], 3000)], [60, I([-127, 40], 512, B.run)], [348, I([0, -90], 2048)],
];

// Fuzz: random inputs from the sim's own RNG (seeded), so the vector itself is reproducible.
function fuzz(seed, ticks) {
  const r = rngSeed(seed), rle = [];
  while (rle.reduce((a, [n]) => a + n, 0) < ticks) {
    const n = 1 + rngBelow(r, 40);
    const inp = I([rngBelow(r, 255) - 127, rngBelow(r, 255) - 127], rngBelow(r, 4096), rngBelow(r, 256), rngBelow(r, 255) - 127);
    rle.push([n, inp]);
  }
  return rle;
}

const FIXTURE_GDF = { gdf: 1, meta: { title: 'M0 fixture', lang: 'en', authorId: 0 }, start: { cell: [34, 61] } };
const VECTORS = {
  '0001-walk': { gdf: FIXTURE_GDF, seed: 1, mode: 'delve', inputs: walk },
  '0002-fuzz': { gdf: FIXTURE_GDF, seed: 0xC0FFEE, mode: 'ironman', inputs: fuzz(0xBADC0DE, 3000) },
};

export function replay(gdf, seed, mode, rle) {
  const st = Sim.init(gdf, seed, mode), hashes = { 0: Sim.hash(st) };
  const inputs = expand(rle);
  inputs.forEach((inp, t) => { Sim.step(st, inp); if ((t + 1) % HASH_EVERY === 0) hashes[t + 1] = Sim.hash(st); });
  return { ticks: inputs.length, hashes, final: Sim.hash(st), state: st };
}

function writeVectors() {
  for (const [name, v] of Object.entries(VECTORS)) {
    const r = replay(v.gdf, v.seed, v.mode, v.inputs);
    const out = { name, core: Sim.CORE_VERSION, seed: v.seed, mode: v.mode, gdf: v.gdf, inputs: v.inputs,
      ticks: r.ticks, hashEvery: HASH_EVERY, hashes: r.hashes, final: r.final, finalState: r.state };
    writeFileSync(DIR + name + '.json', JSON.stringify(out, null, 1) + '\n');
    console.log(name, r.ticks, 'ticks', r.final);
  }
}

// Primitive vectors: PHP must reproduce every one of these exactly.
function writePrimitives() {
  const r = rngSeed(12345), seeds = [0, 1, 0xFFFFFFFF, 0x9E3779B9, 42];
  const idivCases = [[7, 2], [-7, 2], [7, -2], [-7, -2], [0, 5], [2 ** 53 - 1, 3], [-(2 ** 53 - 1), 7], [5400 * 127 * 16384, 127 * 16384], [-1, 30], [-29, 30], [-30, 30], [-31, 30]];
  for (let k = 0; k < 200; k++) idivCases.push([rngNext(r) * rngNext(r) % (2 ** 52) * (rngBelow(r, 2) ? 1 : -1), (1 + rngNext(r)) * (rngBelow(r, 2) ? 1 : -1)]);
  const isqrtCases = [0, 1, 2, 3, 4, 15, 16, 17, 2 ** 52, 2 ** 53 - 1, 4503599761588224, 4503599761588223];
  for (let k = 0; k < 200; k++) isqrtCases.push((rngNext(r) * 2097152 + rngNext(r)) % (2 ** 53));
  const rngSeq = seeds.map((s) => { const st = rngSeed(s); const xs = []; for (let k = 0; k < 64; k++) xs.push(rngNext(st)); return { seed: s, state0: rngSeed(s), out: xs }; });
  const below = (() => { const st = rngSeed(7), xs = []; for (const n of [1, 2, 3, 6, 100, 4096, 65536]) for (let k = 0; k < 20; k++) xs.push([n, rngBelow(st, n)]); return xs; })();
  const canonCases = [null, true, false, 0, -1, 2 ** 53 - 1, '', 'a"b\\c', 'tab\tnl\ncr\r\u0001\u001f', 'ÄÖü €', '🜂 lantern', [], [1, [2, [3]]],
    { b: 1, a: [true, null], _z: { y: 'x' } }, { Z: 1, a: 2, A: 3, z: 4, _: 5 }];
  const prim = {
    fmix32: [0, 1, 0xDEADBEEF, 0xFFFFFFFF].map((x) => [x, fmix32(x)]),
    idiv: idivCases.map(([a, b]) => [a, b, idiv(a, b)]),
    isqrt: isqrtCases.map((n) => [n, isqrt(n)]),
    rng: rngSeq, below,
    canon: canonCases.map((v) => ({ value: v, text: canonical(v), sha256: sha256Hex(new TextEncoder().encode(canonical(v))) })),
    sine: [0, 1, 512, 1023, 1024, 1025, 2048, 3072, 4095, -1, 4096, 5000].map((a) => [a, isin(a)]),
  };
  writeFileSync(DIR + 'primitives.json', JSON.stringify(prim, null, 1) + '\n');
  console.log('primitives.json written');
}

if (import.meta.url === `file://${process.argv[1]}`) { writePrimitives(); writeVectors(); }
