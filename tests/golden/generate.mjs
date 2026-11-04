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

const I = (move = [0, 0], yaw = 0, buttons = 0, pitch = 0, target = 0) => ({ move, yaw, pitch, buttons, target });
const B = Sim.BTN;

// Scripted walk: covers walking, running, turning, diagonal normalisation, hood presses.
const walk = [
  [60, I()], [120, I([127, 0])], [30, I([127, 0], 1024)], [90, I([127, 0], 1024, B.run)],
  [1, I([0, 0], 1024, B.hood)], [40, I([0, 0], 1024)], [1, I([0, 0], 1024, B.hood)],
  [150, I([127, 127], 3000)], [60, I([-127, 40], 512, B.run)], [348, I([0, -90], 2048)],
];

// Fuzz: random inputs from the sim's own RNG (seeded), so the vector itself is reproducible.
// Targets run past the end of the entity list on purpose (R-ENT-3: unknown numbers do nothing).
function fuzz(seed, ticks, targets = 32) {
  const r = rngSeed(seed), rle = [];
  while (rle.reduce((a, [n]) => a + n, 0) < ticks) {
    const n = 1 + rngBelow(r, 40);
    const inp = I([rngBelow(r, 255) - 127, rngBelow(r, 255) - 127], rngBelow(r, 4096), rngBelow(r, 256), rngBelow(r, 255) - 127, rngBelow(r, targets));
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

// Doors and props (R-ACT-1, R-DOOR-*, R-MOVE-4) in Gloamhollow: try the Vestibule door from the stair
// (out of reach), walk into it while shut, try the wrong entities (a trigger grate, a statue, a number
// past the end), open it and hold the button, walk through as it sinks, then slide round the stele,
// into the old slab at (32, 51) and along the east kneeler at (36, 51). Entity 1 is the door.
const X = B.interact;
const doors = [
  [1, I([0, 0], 0, X, 0, 1)], [1, I()], [110, I([127, 0])],
  [1, I([127, 0], 0, X, 0, 2)], [1, I([127, 0])], [1, I([127, 0], 0, X, 0, 10)], [1, I([127, 0])],
  [1, I([127, 0], 0, X, 0, 999)], [1, I([127, 0])], [6, I([127, 0], 0, X, 0, 1)], [100, I([127, 0])],
  [60, I([127, 0], 3072)], [25, I([127, 0])], [75, I([127, 0], 1024, B.run)], [80, I([127, 0], 3072, B.run)],
];

// A small closed room full of entities for the props fuzz: every prop kind (the sarcophagus turned),
// an interact door and a trigger door on the north row, and an old slab on a plate.
function propRoom() {
  const w = 12, h = 10, cells = new Uint8Array(w * h);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) cells[j * w + i] = 1;
  cells[1 * w + 3] = 2; cells[1 * w + 8] = 2;   // door cells (corridor)
  cells[6 * w + 9] = 3;                         // plate under the slab
  const c = (i) => i * 2400 + 1200;
  return JSON.stringify({
    gdf: 1, grid: { w, h, cells: b64encode(rleEncode(cells)) }, start: { cell: [5, 7] },
    entities: [
      { id: 'd1', type: 'door', cell: [3, 1], style: 'stone', opens: 'interact' },
      { id: 'd2', type: 'door', cell: [8, 1], style: 'mask', opens: 'trigger', face: 'blank' },
      { id: 's1', type: 'slab', cell: [9, 6] },
      { id: 'p1', type: 'prop', kind: 'statue', pos: [c(2), c(4)], yaw: 1024 },
      { id: 'p2', type: 'prop', kind: 'stele', pos: [c(4) + 300, c(3) + 200], yaw: 3770 },
      { id: 'p3', type: 'prop', kind: 'tree', pos: [c(6), c(4)], yaw: 0 },
      { id: 'p4', type: 'prop', kind: 'post', pos: [c(7) - 900, c(2)], yaw: 0 },
      { id: 'p5', type: 'prop', kind: 'plinth', pos: [c(9), c(3)], yaw: 0 },
      { id: 'p6', type: 'prop', kind: 'lectern', pos: [c(3), c(6)], yaw: 2048 },
      { id: 'p7', type: 'prop', kind: 'sarcophagus', pos: [c(7), c(6)], yaw: 1024 },
      { id: 'p8', type: 'prop', kind: 'sarcophagus', pos: [c(9) + 1200, c(8) - 400], yaw: 0 },
    ],
  });
}

// Vectors carry the GDF as its exact text: Sim.load takes bytes (R-GDF-0).
export const GLOAMHOLLOW = readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', 'utf8');
const utf8 = (s) => new TextEncoder().encode(s);
const VECTORS = {
  '0001-walk': { gdf: GLOAMHOLLOW, seed: 1, mode: 'delve', inputs: walk },
  '0002-fuzz': { gdf: GLOAMHOLLOW, seed: 0xC0FFEE, mode: 'ironman', inputs: fuzz(0xBADC0DE, 3000) },
  '0003-walls': { gdf: GLOAMHOLLOW, seed: 7, mode: 'practice', inputs: walls },
  '0004-doors': { gdf: GLOAMHOLLOW, seed: 3, mode: 'delve', inputs: doors },
  '0005-props-fuzz': { gdf: propRoom(), seed: 11, mode: 'practice', inputs: fuzz(0x5EED, 6000, 14) },
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
  cases.push(...entityCases(raw));
  return cases.map((c) => { try { return { ...c, ok: true, id: Sim.load(b64decodeBytes(c.bytes)).id }; } catch { return { ...c, ok: false }; } });
}

// Entities (R-ENT-*, R-DOOR-1, R-SLAB-1, R-PROP-*): a 7x5 room, start (1, 1), corridor (5, 1), plate (5, 3).
function entityCases(raw) {
  const w = 7, h = 5, cells = new Uint8Array(w * h);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) cells[j * w + i] = 1;
  cells[1 * w + 5] = 2; cells[3 * w + 5] = 3;
  const b64 = b64encode(rleEncode(cells));
  const one = (name, ents, extra = '') => raw(name, utf8(JSON.stringify({ gdf: 1, grid: { w, h, cells: b64 }, start: { cell: [1, 1] }, entities: ents }) .replace(/}$/, extra + '}')));
  const door = (o = {}) => ({ id: 'd1', type: 'door', cell: [3, 2], style: 'stone', opens: 'interact', ...o });
  const slab = (o = {}) => ({ id: 's1', type: 'slab', cell: [5, 3], ...o });
  const prop = (o = {}) => ({ id: 'p1', type: 'prop', kind: 'post', pos: [9000, 9000], yaw: 0, ...o });
  const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
  const edit = (name, ents, from, to) => { const c = one(name, ents), t = new TextDecoder().decode(b64decodeBytes(c.bytes)); if (!t.includes(from)) throw new Error(name); return raw(name, utf8(t.replace(from, to))); };
  const many = (n) => Array.from({ length: n }, (_, k) => prop({ id: 'p' + k }));
  return [
    one('ents: none', []), one('ents: door', [door()]), one('ents: corridor door', [door({ cell: [5, 1] })]),
    one('ents: mask door', [door({ style: 'mask', opens: 'trigger', face: 'weep' })]), one('ents: grate door', [door({ style: 'grate', opens: 'trigger' })]),
    one('ents: slab', [slab()]), one('ents: all kinds', ['statue', 'stele', 'tree', 'post', 'plinth', 'lectern'].map((kind, k) => prop({ id: 'k' + k, kind, yaw: 77 * k }))),
    one('ents: sarcophagus', [prop({ kind: 'sarcophagus', pos: [7200, 8400] })]), one('ents: sarcophagus turned', [prop({ kind: 'sarcophagus', pos: [8400, 7200], yaw: 3072 })]),
    one('ents: 400', many(400)), one('ents: 401', many(401)),
    one('ents: object', { a: 1 }), one('ents: null', null), one('ents: entity is list', [[1]]), one('ents: entity is string', ['d1']),
    one('ents: duplicate id', [door(), slab({ id: 'd1' })]), one('ents: id digit', [door({ id: '1d' })]), one('ents: id 32', [door({ id: 'a'.repeat(32) })]),
    one('ents: id 33', [door({ id: 'a'.repeat(33) })]), one('ents: id number', [door({ id: 1 })]), one('ents: no id', [without(door(), 'id')]),
    one('ents: unknown type', [door({ type: 'bell' })]), one('ents: no type', [without(door(), 'type')]),
    one('ents: door on wall', [door({ cell: [0, 2] })]), one('ents: door on start', [door({ cell: [1, 1] })]), one('ents: door on plate', [door({ cell: [5, 3] })]),
    one('ents: door outside', [door({ cell: [7, 2] })]), one('ents: door cell 3', [door({ cell: [3, 2, 0] })]), one('ents: door no opens', [without(door(), 'opens')]),
    one('ents: door extra key', [door({ name: 'x' })]), one('ents: door bad style', [door({ style: 'wood' })]), one('ents: door bad opens', [door({ opens: 'key' })]),
    one('ents: mask no face', [door({ style: 'mask' })]), one('ents: mask bad face', [door({ style: 'mask', face: 'grin' })]), one('ents: stone with face', [door({ face: 'weep' })]),
    one('ents: two doors one cell', [door(), door({ id: 'd2' })]), one('ents: slab on door', [door({ cell: [5, 3] }), slab()]),
    one('ents: slab off plate', [slab({ cell: [4, 3] })]), one('ents: slab extra key', [slab({ yaw: 0 })]), one('ents: two slabs', [slab(), slab({ id: 's2' })]),
    one('ents: kind toString', [prop({ kind: 'toString' })]), one('ents: kind __proto__', [prop({ kind: '__proto__' })]), one('ents: kind number', [prop({ kind: 3 })]),
    one('ents: pos 3', [prop({ pos: [9000, 9000, 0] })]), one('ents: pos negative', [prop({ pos: [-1, 9000] })]), one('ents: pos far', [prop({ pos: [9007199254740991, 9000] })]),
    one('ents: yaw 4096', [prop({ yaw: 4096 })]), one('ents: yaw -1', [prop({ yaw: -1 })]), one('ents: circle yaw 512', [prop({ yaw: 512 })]),
    one('ents: box yaw 512', [prop({ kind: 'sarcophagus', pos: [7200, 8400], yaw: 512 })]),
    one('ents: sarcophagus turned 1024', [prop({ kind: 'sarcophagus', pos: [7200, 8400], yaw: 1024 })]),
    one('ents: turned sarcophagus over wall', [prop({ kind: 'sarcophagus', pos: [3000, 8400], yaw: 1024 })]),
    one('ents: sarcophagus over wall', [prop({ kind: 'sarcophagus', pos: [3000, 8400], yaw: 2048 })]),
    one('ents: post touches wall edge', [prop({ pos: [2400 + 160, 9000] })]), one('ents: post over wall', [prop({ pos: [2400 + 159, 9000] })]),
    one('ents: post east edge', [prop({ pos: [6 * 2400 - 160, 9000] })]), one('ents: post over east wall', [prop({ pos: [6 * 2400 - 159, 9000] })]),
    one('ents: prop on start', [prop({ pos: [3600, 3600] })]), one('ents: prop on door', [door(), prop({ pos: [8400, 6000] })]),
    one('ents: prop before door', [prop({ pos: [8400, 6000] }), door()]), one('ents: prop on slab', [slab(), prop({ pos: [13200, 8400] })]),
    one('ents: prop on corridor', [prop({ pos: [13200, 3600] })]), one('ents: prop on plate', [prop({ pos: [13200, 8400] })]),
    one('ents: cell as object', [slab({ cell: { i: 5, j: 3 } })]),
    // Raw spellings JSON.stringify never writes: a __proto__ key, a "0" key, a duplicate key, a literal past 2^53.
    edit('ents: __proto__ for cell', [slab()], '"cell":[5,3]', '"__proto__":[5,3]'),
    edit('ents: key 0', [slab()], '"cell":[5,3]', '"cell":[5,3],"0":1'),
    edit('ents: duplicate key', [slab()], '"cell":[5,3]', '"cell":[4,3],"cell":[5,3]'),
    edit('ents: pos past 2^53', [prop()], '"pos":[9000,9000]', '"pos":[9007199254740993,9000]'),
  ];
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
