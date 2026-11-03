// Regenerates golden vectors from the JS core. Run after an INTENTIONAL rules change:
//   node tests/golden/generate.mjs
// Then bump CORE_VERSION in both cores and say why in the commit. CI fails if PHP disagrees.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { loadCore, ROOT } from '../js/lib/load.mjs';
import * as Sim from '../../public/js/sim/sim.js';
import { idiv, fdiv, isqrt } from '../../public/js/sim/int.js';
import { b64encode, b64decode as b64decodeBytes, rleEncode } from '../../public/js/sim/world.js';
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

// Wall contact (R-MOVE-4): run into the Vestibule's east wall, rub along it, wedge into the
// north-east corner, then back out west at a slant and scrape the south wall by the stair.
const walls = [
  [90, I([127, 0], 3072, B.run)], [60, I([127, 60], 3584)], [90, I([127, 0], 0, B.run)],
  [45, I([127, 127], 3800, B.run)], [120, I([127, 0], 1024, B.run)], [90, I([127, -50], 2048)],
  [60, I([0, 127], 2048, B.run)], [45, I([-127, 0], 0)],
];

// Vectors carry the GDF as its exact text: Sim.load takes bytes (R-GDF-0).
export const GLOAMHOLLOW = readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', 'utf8');
const utf8 = (s) => new TextEncoder().encode(s);
const VECTORS = {
  '0001-walk': { gdf: GLOAMHOLLOW, seed: 1, mode: 'delve', inputs: walk },
  '0002-fuzz': { gdf: GLOAMHOLLOW, seed: 0xC0FFEE, mode: 'ironman', inputs: fuzz(0xBADC0DE, 3000) },
  '0003-walls': { gdf: GLOAMHOLLOW, seed: 7, mode: 'practice', inputs: walls },
};

export function replay(gdf, seed, mode, rle, each) {
  const world = Sim.load(utf8(gdf)), st = Sim.init(world, seed, mode), hashes = { 0: Sim.hash(st) };
  const inputs = expand(rle);
  inputs.forEach((inp, t) => { Sim.step(world, st, inp); if (each) each(world, st); if ((t + 1) % HASH_EVERY === 0) hashes[t + 1] = Sim.hash(st); });
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

// World loading (R-GDF-*, R-WORLD-*): both cores must accept and reject the same GDFs, with the same id.
// Cases are raw bytes (base64) so they can hold BOMs, bad UTF-8 and number spellings JSON.stringify never writes.
function gdfCases() {
  const room = (w, h, extra = {}) => { const c = new Uint8Array(w * h); for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) c[j * w + i] = 1; return { cells: c, w, h, ...extra }; };
  const text = ({ w, h, cells, b64, start = [1, 1] }) => JSON.stringify({ gdf: 1, grid: { w, h, cells: b64 ?? b64encode(rleEncode(cells)) }, start: { cell: start } });
  const raw = (name, bytes) => ({ name, bytes: b64encode(bytes) });
  const mk = (name, o) => raw(name, utf8(text(o)));
  const edit = (name, from, to) => { const t = text(room(5, 4)); if (!t.includes(from)) throw new Error(name); return raw(name, utf8(t.replace(from, to))); };
  const r = room(5, 4), pairs = (bytes) => b64encode(Uint8Array.from(bytes));
  const open = Uint8Array.from(r.cells); open[1] = 1;
  const cases = [
    mk('ok 5x4', r), mk('ok 3x3', room(3, 3)), mk('ok 64x64', room(64, 64, { start: [62, 62] })),
    mk('start on wall', { ...r, start: [0, 0] }), mk('start outside', { ...r, start: [5, 1] }),
    mk('open border', { ...r, cells: open }), mk('too wide', room(65, 3)), mk('too small', room(2, 3)),
    mk('odd base64 length', { ...r, b64: 'AAA' }), mk('bad base64 char', { ...r, b64: 'AA*A' }),
    mk('non-canonical padding', { ...r, b64: 'BQB=' }), mk('zero-length run', { ...r, b64: pairs([0, 0, 20, 0]) }),
    mk('unknown code', { ...r, b64: pairs([20, 9]) }), mk('runs overflow', { ...r, b64: pairs([21, 0]) }),
    mk('runs short', { ...r, b64: pairs([19, 0]) }), mk('odd rle length', { ...r, b64: pairs([20, 0, 1]) }),
    mk('empty cells', { ...r, b64: '' }), mk('padding with bits', { ...r, b64: 'AB==' }), mk('all padding', { ...r, b64: '====' }),
    edit('version 1.0', '"gdf":1', '"gdf":1.0'), edit('width 5e0', '"w":5', '"w":5e0'), edit('cell -0', '"cell":[1,1]', '"cell":[1,-0]'),
    edit('extra float', '"gdf":1', '"gdf":1,"x":0.5'), edit('huge int', '"gdf":1', '"gdf":1,"x":9007199254740993'),
    edit('safe max int', '"gdf":1', '"gdf":1,"x":9007199254740991'), edit('empty object', '"gdf":1', '"gdf":1,"meta":{}'),
    edit('numeric keys', '"gdf":1', '"gdf":1,"meta":{"0":"a","1":"b"}'), edit('cell as object', '"cell":[1,1]', '"cell":{"0":1,"1":1}'),
    edit('list meta ok', '"gdf":1', '"gdf":1,"meta":["a","b"]'), edit('empty list ok', '"gdf":1', '"gdf":1,"links":[]'),
    edit('depth 12 ok', '"gdf":1', '"gdf":1,"x":' + '['.repeat(11) + ']'.repeat(11)),
    edit('depth 13', '"gdf":1', '"gdf":1,"x":' + '['.repeat(12) + ']'.repeat(12)),
    edit('unicode ok', '"gdf":1', '"gdf":1,"t":"Grabkammer \u00e4 \u{1F702}"'),
    raw('bom', Uint8Array.from([0xEF, 0xBB, 0xBF, ...utf8(text(r))])),
    raw('bad utf-8', Uint8Array.from([...utf8(text(r)).slice(0, -1), 0xFF, 0x7D])),
    raw('not an object', utf8('[1,2]')), raw('null', utf8('null')), raw('trailing garbage', utf8(text(r) + 'x')),
    raw('too large', utf8(text(r).replace('"gdf":1', '"gdf":1,"pad":"' + 'a'.repeat(262144) + '"'))),
  ];
  return cases.map((c) => { try { return { ...c, ok: true, id: Sim.load(b64decodeBytes(c.bytes)).id }; } catch { return { ...c, ok: false }; } });
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
    fdiv: [[7, 2], [-7, 2], [7, -2], [-7, -2], [0, 3], [-1, 2400], [-2400, 2400], [-2401, 2400], [2399, 2400], [2400, 2400]].map(([a, b]) => [a, b, fdiv(a, b)]),
    gdf: gdfCases(),
  };
  writeFileSync(DIR + 'primitives.json', JSON.stringify(prim, null, 1) + '\n');
  console.log('primitives.json written');
}

if (import.meta.url === `file://${process.argv[1]}`) { writePrimitives(); writeVectors(); }
