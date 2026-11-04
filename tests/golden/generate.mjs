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
  [1, I([127, 0], 0, X, 0, 2)], [1, I([127, 0])], [1, I([127, 0], 0, X, 0, 25)], [1, I([127, 0])],
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

// Traps, checkpoints, death and rising (R-ZONE-*, R-CP-*, R-TRAP-*, R-VENT-*, R-DEATH-*, R-RISE-1). A 14x9 room in
// four zones side by side: a (start, no checkpoint of its own), b (checkpoint 5,4), c (checkpoint 8,4) and d
// (checkpoint 11,4, reached only by an effect). One trap of each kind, an old slab on a plate, a bridge, an alcove.
export function trapRoom() {
  const w = 14, h = 9, cells = new Uint8Array(w * h), set = (i, j, c) => { cells[j * w + i] = c; };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) set(i, j, 1);
  set(5, 2, 3); set(2, 2, 3); set(5, 6, 4); set(8, 2, 5); set(8, 6, 7); set(8, 7, 7); set(11, 2, 6); set(11, 6, 8);
  return JSON.stringify({
    gdf: 1, grid: { w, h, cells: b64encode(rleEncode(cells)) }, start: { cell: [2, 4] },
    zones: [
      { id: 'a', name: 'A', rects: [[1, 1, 3, 7]], ceil: 4200 },
      { id: 'b', name: 'B', rects: [[4, 1, 3, 7]], ceil: 4200, checkpoint: { cell: [5, 4], yaw: 3072 } },
      { id: 'c', name: 'C', rects: [[7, 1, 3, 4], [7, 5, 3, 3]], ceil: 6500, checkpoint: { cell: [8, 4], yaw: 3072, reach: 'enter' } },
      { id: 'd', name: 'D', rects: [[10, 1, 3, 7]], ceil: 3000, checkpoint: { cell: [11, 4], yaw: 1024, reach: 'effect' } },
    ],
    entities: [
      { id: 's1', type: 'slab', cell: [2, 2] },
      { id: 'v1', type: 'vent', cells: [[8, 6], [8, 7]], period: 60, phase: 10, warn: 15, fire: 20 },
    ],
  });
}

// Gloamhollow's Hall: open the door, reach the Hall checkpoint, step on the plate at (33, 51) and die; press
// rise too early (ignored), rise, then walk back into the sprung plate, which is solid now.
const hall = [
  [110, I([127, 0])], [1, I([0, 0], 0, X, 0, 1)], [40, I()], [95, I([127, 0])],
  [12, I([127, 0], 1024)], [20, I([127, 0], 512)],
  [30, I()], [1, I([0, 0], 0, B.rise)], [25, I()], [1, I([0, 0], 0, B.rise)], [10, I()],
  [30, I([127, 0], 512)], [30, I([127, 0], 1024)], [20, I([127, 0], 0, B.run)],
];
// Ironman: walk from the start through b's checkpoint, north onto the plate at (5, 2), and die. The log ends
// on the death tick: step refuses the state afterwards (R-DEATH-3).
const ironman = [[66, I([127, 0], 3072)], [38, I([127, 0], 0)]];

// Tools and items (R-TOOL-*, R-PROBE-*, R-PEB-*, R-OIL-3, R-ITEM-*, R-LOS-1, R-EYES-*). A 14x9 room split by a wall
// at i = 6 with an interact door at (6, 4). West, zone a (start 2, 4): plate (4, 2), pit (4, 6), a flask, rubble and
// a treasure. East, zone g (checkpoint 7, 4) watched by eyes (wake 18): bridge, void, vent, alcove, pit, a plate,
// an old slab on a plate, a treasure.
export function toolRoom(start = [2, 4], eyes = true) {
  const w = 14, h = 9, cells = new Uint8Array(w * h), set = (i, j, c) => { cells[j * w + i] = c; };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) set(i, j, 1);
  for (let j = 1; j < h - 1; j++) set(6, j, 0);
  set(6, 4, 2); set(4, 2, 3); set(4, 6, 4);
  set(8, 2, 6); set(9, 2, 5); set(10, 6, 7); set(12, 6, 8); set(8, 6, 4); set(11, 2, 3); set(12, 2, 3);
  return JSON.stringify({
    gdf: 1, grid: { w, h, cells: b64encode(rleEncode(cells)) }, start: { cell: start },
    zones: [
      { id: 'a', name: 'A', rects: [[1, 1, 5, 7]], ceil: 4200 },
      { id: 'g', name: 'G', rects: [[7, 1, 6, 7]], ceil: 3600, checkpoint: { cell: [7, 4], yaw: 3072 } },
    ],
    entities: [
      { id: 'd1', type: 'door', cell: [6, 4], style: 'stone', opens: 'interact' },
      { id: 'f1', type: 'item', kind: 'flask', cell: [3, 3] },
      { id: 'r1', type: 'item', kind: 'rubble', cell: [2, 6] },
      { id: 't1', type: 'item', kind: 'treasure', cell: [1, 1], value: 100 },
      { id: 't2', type: 'item', kind: 'treasure', cell: [12, 4], value: 250 },
      { id: 'b1', type: 'item', kind: 'treasure', cell: [8, 2], value: 7 },
      ...(eyes ? [{ id: 'e1', type: 'eyes', zone: 'g', wake: 18 }] : []),
      { id: 'v1', type: 'vent', cells: [[10, 6]], period: 90, phase: 0, warn: 20, fire: 30 },
      { id: 's1', type: 'slab', cell: [12, 2] },
    ],
  });
}

// The tool room by hand: take the flask, throw a pebble onto the plate (4, 2) (it springs, nobody dies), refill
// at the rubble, probe the pit (4, 6) and walk into it anyway (flask, pebbles and taken roll back), rise, open the
// door, hood, cross into the eyes' room (checkpoint g, still hooded), probe, un-hood and burn (18 ticks), rise at g.
const tools = [
  [25, I([127,0], 3584, 0, 0, 0)],
  [1, I([0,0], 3584, X, 0, 2)],
  [1, I([0,0], 3584, 0, 0, 0)],
  [1, I([0,0], 3584, B.pebble, -60, 0)],
  [20, I([0,0], 3584, 0, 0, 0)],
  [60, I([127,0], 2048, 0, 0, 0)],
  [12, I([127,0], 1024, 0, 0, 0)],
  [10, I([0,0], 1024, 0, 0, 0)],
  [1, I([0,0], 1024, X, 0, 3)],
  [1, I([0,0], 1024, 0, 0, 0)],
  [15, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 3072, B.probe, 0, 0)],
  [5, I([0,0], 3072, 0, 0, 0)],
  [30, I([127,0], 3072, 0, 0, 0)],
  [55, I([0,0], 0, 0, 0, 0)],
  [1, I([0,0], 0, B.rise, 0, 0)],
  [1, I([0,0], 0, 0, 0, 0)],
  [75, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 3072, X, 0, 1)],
  [1, I([0,0], 3072, B.hood, 0, 0)],
  [40, I([0,0], 3072, 0, 0, 0)],
  [60, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 3072, X, 0, 5)],
  [1, I([0,0], 0, B.probe, 0, 0)],
  [20, I([0,0], 0, 0, 0, 0)],
  [1, I([0,0], 0, B.hood, 0, 0)],
  [30, I([0,0], 0, 0, 0, 0)],
  [55, I([0,0], 0, 0, 0, 0)],
  [1, I([0,0], 0, B.rise, 0, 0)],
  [3, I([0,0], 0, 0, 0, 0)],
];

// Bells and links (R-BELL-*, R-LINK-*, R-HP-*, R-DOOR-3/5). A 12x8 room: zone w (start 2, 4) holds three
// bells on row 2 (sizes 1, 2, 3; order 2, 0, 1), zone e lies behind a grate (8, 4) in a wall at i = 8.
// Links: solved -> grate opens after 27 ticks; wrong -> 28 damage after 20 (repeat); two wrongs -> a message;
// entering e seals the grate behind you after 30 ticks.
export function bellRoom() {
  const w = 12, h = 8, cells = new Uint8Array(w * h), set = (i, j, c) => { cells[j * w + i] = c; };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) set(i, j, 1);
  for (let j = 1; j < h - 1; j++) set(8, j, 0);
  set(8, 4, 2);
  return JSON.stringify({
    gdf: 1, grid: { w, h, cells: b64encode(rleEncode(cells)) }, start: { cell: [2, 4] },
    zones: [{ id: 'w', name: 'W', rects: [[1, 1, 7, 6]], ceil: 5400 }, { id: 'e', name: 'E', rects: [[9, 1, 2, 6]], ceil: 4200, checkpoint: { cell: [9, 4], yaw: 3072 } }],
    entities: [
      { id: 'grate', type: 'door', cell: [8, 4], style: 'grate', opens: 'trigger' },
      { id: 'b1', type: 'bell', cell: [3, 2], size: 1, patina: 2, note: 330 },
      { id: 'b2', type: 'bell', cell: [5, 2], size: 2, patina: 1, note: 196 },
      { id: 'b3', type: 'bell', cell: [7, 2], size: 3, patina: 0, note: 98 },
      { id: 'set', type: 'bellSet', bells: ['b1', 'b2', 'b3'], order: [2, 0, 1] },
    ],
    links: [
      { id: 1, when: { bellsSolved: 'set' }, delay: 27, do: [{ openDoor: 'grate' }, { message: 'The grate rises.' }] },
      { id: 2, when: { bellsWrong: 'set' }, repeat: true, delay: 20, do: [{ damage: 28 }] },
      { id: 3, when: { sequence: [{ bellsWrong: 'set' }, { bellsWrong: 'set' }] }, do: [{ message: 'Two wrongs.' }] },
      { id: 4, when: { enterZone: 'e' }, delay: 30, do: [{ sealDoor: 'grate' }] },
      { id: 5, when: { interact: 'grate' }, repeat: true, do: [{ message: 'It will not move.' }] },
    ],
  });
}

// Random link graphs (R-LINK-*) over a room with every link-able component, built from the sim's own RNG so the
// vector is reproducible: 3 zones, 3 doors, 3 items, 3 bells in a set, and 12 links with random gates and effects.
export function linkRoom(seed) {
  const r = rngSeed(seed), pick = (a) => a[rngBelow(r, a.length)], chance = (n) => rngBelow(r, 100) < n;
  const w = 14, h = 9, cells = new Uint8Array(w * h), set = (i, j, c) => { cells[j * w + i] = c; };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) set(i, j, 1);
  for (const i of [5, 9]) { for (let j = 1; j < h - 1; j++) set(i, j, 0); set(i, 4, 2); set(i, 6, 2); }
  const doors = ['d1', 'd2', 'd3'], items = ['f1', 't1', 't2'], zones = ['z1', 'z2', 'z3'], ids = Array.from({ length: 12 }, (_, k) => 10 + 3 * k);
  const evs = () => {
    const k = pick(['interact', 'itemTaken', 'enterZone', 'leaveZone', 'bellsWrong', 'linkFired']);
    if (k === 'interact') return { interact: pick([...doors, ...items, 'b1', 'b2', 'b3']) };
    if (k === 'itemTaken') return { itemTaken: pick(items) };
    if (k === 'enterZone' || k === 'leaveZone') return { [k]: pick(zones) };
    if (k === 'bellsWrong') return { bellsWrong: 'set' };
    return { linkFired: pick(ids) };
  };
  const cond = () => {
    const k = pick(['doorOpen', 'inZone', 'hasItem', 'lanternHooded', 'bellsSolved', 'linkActive']);
    if (k === 'doorOpen') return { doorOpen: pick(doors) };
    if (k === 'inZone') return { inZone: pick(zones) };
    if (k === 'hasItem') return { hasItem: pick(items) };
    if (k === 'lanternHooded') return { lanternHooded: chance(50) };
    if (k === 'bellsSolved') return { bellsSolved: 'set' };
    return { linkActive: pick(ids) };
  };
  const effects = () => Array.from({ length: 1 + rngBelow(r, 3) }, () => {
    const k = pick(['openDoor', 'openDoor', 'closeDoor', 'sealDoor', 'damage', 'message']);
    if (k === 'damage') return { damage: 1 + rngBelow(r, 12) };
    if (k === 'message') return { message: 'm' + rngBelow(r, 100) };
    return { [k]: pick(doors) };
  });
  const term = (depth, condOnly) => {
    const g = depth >= 3 ? 'leaf' : pick(['leaf', 'leaf', 'all', 'any', 'atLeast', 'sequence', 'not']);
    if (g === 'leaf' || (condOnly && g === 'sequence')) return condOnly || chance(50) ? cond() : evs();
    if (g === 'not') return { not: term(depth + 1, true) };
    const n = 2 + rngBelow(r, 3);
    if (g === 'sequence') {
      const t = { sequence: Array.from({ length: n }, evs) };
      if (chance(50)) t.within = 30 + rngBelow(r, 300);
      if (chance(50)) { t.strict = true; if (chance(60)) t.onWrong = effects(); }
      return t;
    }
    const t = { [g]: Array.from({ length: n }, () => term(depth + 1, false)) };
    if (g === 'atLeast') t.k = 1 + rngBelow(r, n);
    if (chance(50)) t.within = 10 + rngBelow(r, 200);
    return t;
  };
  const links = ids.map((id) => {
    const l = { id, when: term(1, false), do: effects() };
    // linkFired / linkActive must name another link (R-LINK-2).
    const fix = (t) => { for (const k of Object.keys(t)) { if ((k === 'linkFired' || k === 'linkActive') && t[k] === id) t[k] = ids[(ids.indexOf(id) + 1) % ids.length]; else if (typeof t[k] === 'object' && t[k] !== null) fix(t[k]); } };
    fix(l.when);
    const evValued = ['interact', 'itemTaken', 'enterZone', 'leaveZone', 'bellsWrong', 'linkFired', 'sequence'].some((k) => Object.hasOwn(l.when, k));
    if (chance(40) && !evValued) l.undo = effects(); // no undo on event-valued whens (decision #31)
    if (chance(60)) l.repeat = true;
    if (chance(40)) l.delay = rngBelow(r, 60);
    return l;
  });
  return JSON.stringify({
    gdf: 1, grid: { w, h, cells: b64encode(rleEncode(cells)) }, start: { cell: [2, 4] },
    zones: [{ id: 'z1', name: '1', rects: [[1, 1, 4, 7]], ceil: 4200 }, { id: 'z2', name: '2', rects: [[6, 1, 3, 7]], ceil: 4200, checkpoint: { cell: [7, 3], yaw: 0 } },
      { id: 'z3', name: '3', rects: [[10, 1, 3, 7]], ceil: 4200, checkpoint: { cell: [11, 3], yaw: 0 } }],
    entities: [
      { id: 'd1', type: 'door', cell: [5, 4], style: 'stone', opens: 'interact' },
      { id: 'd2', type: 'door', cell: [9, 4], style: 'stone', opens: 'trigger' },
      { id: 'd3', type: 'door', cell: [9, 6], style: 'mask', opens: 'interact', face: 'blank' },
      { id: 'f1', type: 'item', kind: 'flask', cell: [2, 2] }, { id: 't1', type: 'item', kind: 'treasure', cell: [7, 6], value: 10 },
      { id: 't2', type: 'item', kind: 'treasure', cell: [11, 6], value: 20 },
      { id: 'b1', type: 'bell', cell: [3, 6], size: 1, patina: 0, note: 300 }, { id: 'b2', type: 'bell', cell: [7, 1], size: 2, patina: 1, note: 200 },
      { id: 'b3', type: 'bell', cell: [11, 1], size: 1, patina: 2, note: 100 },
      { id: 'set', type: 'bellSet', bells: ['b1', 'b2', 'b3'], order: [0, 1, 2] },
    ],
    links,
  });
}

// The bell room by hand: ring the small bell twice (two wrongs: two delayed darts, the two-wrongs message), then
// great, small, middle (solved: the grate rises 27 ticks later), walk through into e (checkpoint; the grate seals
// 30 ticks later), come back and try it (sealed: the message link).
const bells = [
  [24, I([127,0], 0, 0, 0, 0)],
  [25, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 2)],
  [1, I([0,0], 0, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 2)],
  [30, I([0,0], 0, 0, 0, 0)],
  [80, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 4)],
  [1, I([0,0], 0, 0, 0, 0)],
  [80, I([127,0], 1024, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 2)],
  [1, I([0,0], 0, 0, 0, 0)],
  [45, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 3)],
  [60, I([0,0], 0, 0, 0, 0)],
  [25, I([127,0], 2048, 0, 0, 0)],
  [100, I([127,0], 3072, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 1)],
  [60, I([0,0], 0, 0, 0, 0)],
  [1, I([127,0], 1024, 0, 0, 0)],
  [40, I([127,0], 1024, 0, 0, 0)],
  [1, I([0,0], 0, X, 0, 1)],
  [20, I([0,0], 0, 0, 0, 0)],
];

// Vectors carry the GDF as its exact text: Sim.load takes bytes (R-GDF-0).
export const GLOAMHOLLOW = readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', 'utf8');
const utf8 = (s) => new TextEncoder().encode(s);
const VECTORS = {
  '0001-walk': { gdf: GLOAMHOLLOW, seed: 1, mode: 'delve', inputs: walk },
  '0002-fuzz': { gdf: GLOAMHOLLOW, seed: 0xC0FFEE, mode: 'delve', inputs: fuzz(0xBADC0DE, 3000) },
  '0003-walls': { gdf: GLOAMHOLLOW, seed: 7, mode: 'practice', inputs: walls },
  '0004-doors': { gdf: GLOAMHOLLOW, seed: 3, mode: 'delve', inputs: doors },
  '0005-props-fuzz': { gdf: propRoom(), seed: 11, mode: 'practice', inputs: fuzz(0x5EED, 6000, 14) },
  '0006-traps-fuzz': { gdf: trapRoom(), seed: 5, mode: 'delve', inputs: fuzz(0x7EA9, 9000, 6) },
  '0007-practice-fuzz': { gdf: trapRoom(), seed: 6, mode: 'practice', inputs: fuzz(0xC4EC, 9000, 6) },
  '0008-hall-plate': { gdf: GLOAMHOLLOW, seed: 8, mode: 'delve', inputs: hall },
  '0009-ironman': { gdf: trapRoom(), seed: 9, mode: 'ironman', inputs: ironman },
  '0010-tools': { gdf: toolRoom(), seed: 10, mode: 'delve', inputs: tools },
  '0011-tools-fuzz': { gdf: toolRoom(), seed: 11, mode: 'delve', inputs: fuzz(0x7001, 9000, 11) },
  '0012-tools-practice-fuzz': { gdf: toolRoom(), seed: 12, mode: 'practice', inputs: fuzz(0x51DE, 9000, 11) },
  '0013-eyes-fuzz': { gdf: toolRoom([10, 4]), seed: 13, mode: 'delve', inputs: fuzz(0xE7E5, 9000, 11) },
  '0014-east-fuzz': { gdf: toolRoom([10, 4], false), seed: 14, mode: 'practice', inputs: fuzz(0xEA57, 12000, 11) },
  '0015-bells': { gdf: bellRoom(), seed: 15, mode: 'delve', inputs: bells },
  '0016-links-fuzz-1': { gdf: linkRoom(1), seed: 16, mode: 'delve', inputs: fuzz(0x1111, 8000, 12) },
  '0017-links-fuzz-2': { gdf: linkRoom(2), seed: 17, mode: 'practice', inputs: fuzz(0x2222, 8000, 12) },
  '0018-links-fuzz-3': { gdf: linkRoom(3), seed: 18, mode: 'delve', inputs: fuzz(0x3333, 8000, 12) },
  '0019-links-fuzz-4': { gdf: linkRoom(4), seed: 19, mode: 'practice', inputs: fuzz(0x4444, 8000, 12) },
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
  cases.push(...entityCases(raw), ...zoneCases(raw), ...itemCases(raw), ...linkCases(raw));
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

// Zones, checkpoints and vents (R-ZONE-*, R-VENT-1): edits of the trap room, which loads as it stands.
function zoneCases(raw) {
  const base = JSON.parse(trapRoom());
  const one = (name, f) => { const g = structuredClone(base); f(g); return raw(name, utf8(JSON.stringify(g))); };
  const z = (n) => (g) => g.zones[n], vent = (g) => g.entities[1];
  const zone = (n, o) => (g) => Object.assign(g.zones[n], o), cp = (n, o) => (g) => Object.assign(g.zones[n].checkpoint, o);
  const many = (n) => Array.from({ length: n }, (_, k) => ({ id: 'q' + k, name: '', rects: [[12, 7, 1, 1]], ceil: 3000 }));
  const vt = (o) => (g) => Object.assign(vent(g), o);
  return [
    one('zones: trap room', () => {}), one('zones: none', (g) => { delete g.zones; }), one('zones: empty', (g) => { g.zones = []; }),
    one('zones: 16', (g) => { g.zones = many(16).map((q, k) => ({ ...q, rects: [[1 + (k % 12), 1 + ((k / 12) | 0), 1, 1]] })); }),
    one('zones: 17', (g) => { g.zones = many(17).map((q, k) => ({ ...q, rects: [[1 + (k % 12), 1 + ((k / 12) | 0), 1, 1]] })); }),
    one('zones: object', (g) => { g.zones = { a: 1 }; }), one('zones: zone is list', (g) => { g.zones[0] = [1]; }),
    one('zones: duplicate id', zone(1, { id: 'a' })), one('zones: id clash with entity ok', zone(0, { id: 's1' })), one('zones: bad id', zone(0, { id: '9a' })),
    one('zones: name number', zone(0, { name: 3 })), one('zones: extra key', zone(0, { tint: 1 })), one('zones: no ceil', (g) => { delete z(0)(g).ceil; }),
    one('zones: ceil 2999', zone(0, { ceil: 2999 })), one('zones: ceil 6501', zone(0, { ceil: 6501 })),
    one('zones: no rects', zone(0, { rects: [] })), one('zones: 9 rects', zone(0, { rects: Array.from({ length: 9 }, (_, k) => [1 + (k % 3), 1 + ((k / 3) | 0), 1, 1]) })),
    one('zones: 9 cells in 8 rects ok', zone(0, { rects: Array.from({ length: 8 }, (_, k) => [1 + (k % 3), 1 + ((k / 3) | 0), k === 7 ? 2 : 1, 1]) })),
    one('zones: 8 rects', zone(0, { rects: Array.from({ length: 7 }, (_, k) => [1, 1 + k, 3, 1]).concat([[13, 0, 1, 1]]) })),
    one('zones: rect 3 numbers', zone(0, { rects: [[1, 1, 3]] })), one('zones: rect zero width', zone(0, { rects: [[1, 1, 0, 7]] })),
    one('zones: rect past edge', zone(0, { rects: [[1, 1, 3, 9]] })), one('zones: rect negative', zone(0, { rects: [[-1, 1, 3, 7]] })),
    one('zones: rect on border ok', zone(0, { rects: [[0, 0, 4, 9]] })), one('zones: overlap', zone(0, { rects: [[1, 1, 4, 7]] })),
    one('zones: overlap inside one zone', zone(0, { rects: [[1, 1, 3, 7], [2, 2, 1, 1]] })),
    one('zones: checkpoint null', zone(1, { checkpoint: null })), one('zones: checkpoint list', zone(1, { checkpoint: [5, 4] })),
    one('zones: checkpoint extra key', cp(1, { zone: 'b' })), one('zones: checkpoint no yaw', (g) => { delete z(1)(g).checkpoint.yaw; }),
    one('zones: checkpoint yaw 4096', cp(1, { yaw: 4096 })), one('zones: reach bad', cp(1, { reach: 'touch' })), one('zones: reach null', cp(1, { reach: null })),
    one('zones: checkpoint in other zone', cp(1, { cell: [8, 4] })), one('zones: checkpoint on plate', cp(1, { cell: [5, 2] })),
    one('zones: checkpoint outside zones', (g) => { z(1)(g).rects = [[4, 1, 3, 6]]; z(1)(g).checkpoint.cell = [5, 7]; }),
    one('zones: checkpoint on wall', (g) => { z(0)(g).rects = [[0, 0, 4, 9]]; z(0)(g).checkpoint = { cell: [0, 4], yaw: 0 }; }),
    one('zones: checkpoint on start', (g) => { z(0)(g).checkpoint = { cell: [2, 4], yaw: 0 }; }),
    one('zones: checkpoint under prop', (g) => { g.entities.push({ id: 'p1', type: 'prop', kind: 'post', pos: [13200, 10800], yaw: 0 }); }),
    one('zones: prop next to checkpoint', (g) => { g.entities.push({ id: 'p1', type: 'prop', kind: 'post', pos: [13200, 12500], yaw: 0 }); }),
    one('zones: checkpoint on door', (g) => { g.entities.push({ id: 'd1', type: 'door', cell: [5, 4], style: 'stone', opens: 'interact' }); }),
    one('zones: 13 checkpoints', (g) => { g.zones = many(13).map((q, k) => ({ ...q, rects: [[1 + (k % 12), 3 + ((k / 12) | 0), 1, 1]], checkpoint: { cell: [1 + (k % 12), 3 + ((k / 12) | 0)], yaw: 0 } })); }),
    one('zones: 12 checkpoints', (g) => { g.zones = many(12).map((q, k) => ({ ...q, rects: [[1 + k, 3, 1, 1]], checkpoint: { cell: [1 + k, 3], yaw: 0 } })); }),
    one('vents: missing vent', (g) => { g.entities.pop(); }), one('vents: cell not a vent', vt({ cells: [[8, 6], [8, 7], [8, 5]] })),
    one('vents: half covered', vt({ cells: [[8, 6]] })), one('vents: two vents', (g) => { vent(g).cells = [[8, 6]]; g.entities.push({ ...vent(g), id: 'v2', cells: [[8, 7]] }); }),
    one('vents: shared cell', (g) => { g.entities.push({ ...vent(g), id: 'v2', cells: [[8, 7]] }); }), one('vents: same cell twice', vt({ cells: [[8, 6], [8, 7], [8, 6]] })),
    one('vents: no cells', vt({ cells: [] })), one('vents: extra key', vt({ name: 'x' })), one('vents: no warn', (g) => { delete vent(g).warn; }),
    one('vents: period 1', vt({ period: 1, phase: 0, warn: 0, fire: 1 })), one('vents: period 1800', vt({ period: 1800 })), one('vents: period 1801', vt({ period: 1801 })),
    one('vents: phase = period', vt({ phase: 60 })), one('vents: phase -1', vt({ phase: -1 })), one('vents: warn 0', vt({ warn: 0 })),
    one('vents: fire 0', vt({ fire: 0 })), one('vents: fire 60 %', vt({ period: 60, warn: 0, fire: 36 })), one('vents: fire over 60 %', vt({ period: 60, warn: 0, fire: 37 })),
    one('vents: warn + fire > period', vt({ period: 10, warn: 5, fire: 6 })), one('vents: timing string', vt({ fire: '20' })),
  ];
}

// Items and eyes (R-ITEM-1, R-EYES-1): edits of the tool room, which loads as it stands.
function itemCases(raw) {
  const base = JSON.parse(toolRoom());
  const one = (name, f) => { const g = structuredClone(base); f(g); return raw(name, utf8(JSON.stringify(g))); };
  const ent = (id) => (g) => g.entities.find((e) => e.id === id);
  const set = (id, o) => (g) => Object.assign(ent(id)(g), o);
  const add = (e) => (g) => { g.entities.push(e); };
  return [
    one('items: tool room', () => {}),
    one('items: flask with value', set('f1', { value: 5 })), one('items: treasure without value', (g) => { delete ent('t1')(g).value; }),
    one('items: value 0', set('t1', { value: 0 })), one('items: value 100000', set('t1', { value: 100000 })), one('items: value 100001', set('t1', { value: 100001 })),
    one('items: value string', set('t1', { value: '100' })), one('items: kind key', set('f1', { kind: 'key' })), one('items: kind number', set('f1', { kind: 1 })),
    one('items: no kind', (g) => { delete ent('f1')(g).kind; }), one('items: extra key', set('f1', { name: 'oil' })),
    one('items: on wall', set('f1', { cell: [6, 2] })), one('items: on plate', set('f1', { cell: [4, 2] })), one('items: on pit', set('f1', { cell: [4, 6] })),
    one('items: on void', set('f1', { cell: [9, 2] })), one('items: on vent', set('f1', { cell: [10, 6] })), one('items: on alcove', set('f1', { cell: [12, 6] })),
    one('items: on bridge ok', set('f1', { cell: [8, 2] })), one('items: on corridor door', set('f1', { cell: [6, 4] })),
    one('items: on start ok', set('f1', { cell: [2, 4] })), one('items: on checkpoint ok', set('f1', { cell: [7, 4] })),
    one('items: two on one cell ok', set('r1', { cell: [3, 3] })), // f1 lies on (3, 3)
    one('items: rubble with value', set('r1', { value: 1 })),
    one('eyes: no zone', (g) => { delete ent('e1')(g).zone; }), one('eyes: unknown zone', set('e1', { zone: 'x' })), one('eyes: zone number', set('e1', { zone: 1 })),
    one('eyes: second on zone', add({ id: 'e2', type: 'eyes', zone: 'g', wake: 30 })), one('eyes: second zone ok', add({ id: 'e2', type: 'eyes', zone: 'a', wake: 30 })),
    one('eyes: wake 17', set('e1', { wake: 17 })), one('eyes: wake 1800', set('e1', { wake: 1800 })), one('eyes: wake 1801', set('e1', { wake: 1801 })),
    one('eyes: extra key', set('e1', { glow: true })), one('eyes: zone before zones listed ok', (g) => { g.entities.unshift(g.entities.splice(g.entities.findIndex((e) => e.id === 'e1'), 1)[0]); }),
    one('eyes: no zones', (g) => { delete g.zones; }),
  ];
}

// Links and bells (R-LINK-1..3, R-BELL-1/2): edits of the bell room, which loads as it stands.
function linkCases(raw) {
  const base = JSON.parse(bellRoom());
  const one = (name, f) => { const g = structuredClone(base); f(g); return raw(name, utf8(JSON.stringify(g))); };
  const L = (o) => (g) => { g.links = [{ id: 9, do: [{ message: 'x' }], ...o }]; };
  const W = (when, o = {}) => L({ when, ...o });
  const ent = (id) => (g) => g.entities.find((e) => e.id === id);
  const set = (id, o) => (g) => Object.assign(ent(id)(g), o);
  const deep = (n) => { let t = { doorOpen: 'grate' }; for (let k = 0; k < n; k++) t = { all: [t, { doorOpen: 'grate' }] }; return t; };
  const many = (n, f) => Array.from({ length: n }, (_, k) => f(k));
  return [
    one('links: bell room', () => {}), one('links: none', (g) => { delete g.links; }), one('links: empty', (g) => { g.links = []; }),
    one('links: object', (g) => { g.links = { a: 1 }; }), one('links: 64', (g) => { g.links = many(64, (k) => ({ id: k + 1, when: { doorOpen: 'grate' }, do: [{ message: 'x' }] })); }),
    one('links: 65', (g) => { g.links = many(65, (k) => ({ id: k + 1, when: { doorOpen: 'grate' }, do: [{ message: 'x' }] })); }),
    one('links: id 0', L({ id: 0, when: { doorOpen: 'grate' } })), one('links: id 65535', L({ id: 65535, when: { doorOpen: 'grate' } })),
    one('links: id 65536', L({ id: 65536, when: { doorOpen: 'grate' } })), one('links: id string', L({ id: '9', when: { doorOpen: 'grate' } })),
    one('links: duplicate id', (g) => { g.links[1].id = 1; }), one('links: extra key', W({ doorOpen: 'grate' }, { name: 'x' })),
    one('links: no when', L({})), one('links: no do', (g) => { g.links = [{ id: 9, when: { doorOpen: 'grate' } }]; }),
    one('links: do empty', W({ doorOpen: 'grate' }, { do: [] })), one('links: 16 effects', W({ doorOpen: 'grate' }, { do: many(16, () => ({ message: 'x' })) })),
    one('links: 17 effects', W({ doorOpen: 'grate' }, { do: many(17, () => ({ message: 'x' })) })),
    one('links: repeat string', W({ doorOpen: 'grate' }, { repeat: 'yes' })), one('links: delay 600', W({ doorOpen: 'grate' }, { delay: 600 })),
    one('links: delay 601', W({ doorOpen: 'grate' }, { delay: 601 })), one('links: delay -1', W({ doorOpen: 'grate' }, { delay: -1 })),
    one('links: when list', W([{ doorOpen: 'grate' }])), one('links: two triggers', W({ doorOpen: 'grate', inZone: 'w' })),
    one('links: unknown trigger', W({ leverOn: 'grate' })), one('links: interact zone', W({ interact: 'w' })), one('links: interact bellSet', W({ interact: 'set' })),
    one('links: interact bell ok', W({ interact: 'b1' })), one('links: itemTaken door', W({ itemTaken: 'grate' })), one('links: enterZone unknown', W({ enterZone: 'x' })),
    one('links: enterZone entity', W({ enterZone: 'grate' })), one('links: bellsWrong bell', W({ bellsWrong: 'b1' })), one('links: linkFired self', W({ linkFired: 9 })),
    one('links: linkFired missing', W({ linkFired: 99 })), one('links: linkFired string', W({ linkFired: '1' })),
    one('links: linkFired other ok', (g) => { g.links.push({ id: 9, when: { linkFired: 1 }, do: [{ message: 'x' }] }); }),
    one('links: lanternHooded string', W({ lanternHooded: 'yes' })), one('links: lanternHooded false ok', W({ lanternHooded: false })),
    one('links: doorOpen bell', W({ doorOpen: 'b1' })), one('links: two gates', W({ all: [{ doorOpen: 'grate' }, { inZone: 'w' }], any: [{ doorOpen: 'grate' }, { inZone: 'w' }] })),
    one('links: gate bad option', W({ all: [{ doorOpen: 'grate' }, { inZone: 'w' }], k: 1 })), one('links: all 1 term', W({ all: [{ doorOpen: 'grate' }] })),
    one('links: all 8 terms', W({ all: many(8, () => ({ doorOpen: 'grate' })) })), one('links: all 9 terms', W({ all: many(9, () => ({ doorOpen: 'grate' })) })),
    one('links: atLeast no k', W({ atLeast: [{ doorOpen: 'grate' }, { inZone: 'w' }] })), one('links: atLeast k 0', W({ atLeast: [{ doorOpen: 'grate' }, { inZone: 'w' }], k: 0 })),
    one('links: atLeast k 3 of 2', W({ atLeast: [{ doorOpen: 'grate' }, { inZone: 'w' }], k: 3 })), one('links: atLeast k 2 ok', W({ atLeast: [{ doorOpen: 'grate' }, { inZone: 'w' }], k: 2 })),
    one('links: within 0', W({ any: [{ interact: 'b1' }, { inZone: 'w' }], within: 0 })), one('links: within 1800', W({ any: [{ interact: 'b1' }, { inZone: 'w' }], within: 1800 })),
    one('links: within 1801', W({ any: [{ interact: 'b1' }, { inZone: 'w' }], within: 1801 })),
    one('links: sequence condition step', W({ sequence: [{ interact: 'b1' }, { doorOpen: 'grate' }] })), one('links: sequence gate step', W({ sequence: [{ interact: 'b1' }, { all: [{ interact: 'b2' }, { interact: 'b3' }] }] })),
    one('links: sequence ok', W({ sequence: [{ interact: 'b1' }, { interact: 'b2' }], within: 60, strict: true, onWrong: [{ damage: 1 }] })),
    one('links: onWrong without strict', W({ sequence: [{ interact: 'b1' }, { interact: 'b2' }], onWrong: [{ damage: 1 }] })),
    one('links: onWrong strict false', W({ sequence: [{ interact: 'b1' }, { interact: 'b2' }], strict: false, onWrong: [{ damage: 1 }] })),
    one('links: strict string', W({ sequence: [{ interact: 'b1' }, { interact: 'b2' }], strict: 'yes' })),
    one('links: not list', W({ not: [{ doorOpen: 'grate' }] })), one('links: not event', W({ not: { interact: 'b1' } })),
    one('links: not sequence', W({ not: { sequence: [{ interact: 'b1' }, { interact: 'b2' }] } })), one('links: not all of events ok', W({ not: { all: [{ interact: 'b1' }, { interact: 'b2' }] } })),
    one('links: not with option', W({ not: { doorOpen: 'grate' }, within: 5 })),
    one('links: depth 4 ok', W(deep(4))), one('links: depth 5', W(deep(5))),
    one('links: 16 triggers ok', W({ all: many(8, () => ({ any: [{ doorOpen: 'grate' }, { inZone: 'w' }] })) })),
    one('links: 17 triggers', W({ all: [...many(7, () => ({ any: [{ doorOpen: 'grate' }, { inZone: 'w' }] })), { any: [{ doorOpen: 'grate' }, { inZone: 'w' }, { inZone: 'e' }] }] })),
    one('links: undo on event', W({ interact: 'b1' }, { undo: [{ message: 'y' }] })), one('links: undo on sequence', W({ sequence: [{ interact: 'b1' }, { interact: 'b2' }] }, { undo: [{ message: 'y' }] })),
    one('links: undo on condition ok', W({ doorOpen: 'grate' }, { undo: [{ message: 'y' }] })), one('links: undo on all of events ok', W({ all: [{ interact: 'b1' }, { interact: 'b2' }] }, { undo: [{ message: 'y' }] })),
    one('links: undo empty', W({ doorOpen: 'grate' }, { undo: [] })),
    one('links: effect two keys', W({ doorOpen: 'grate' }, { do: [{ message: 'x', damage: 1 }] })), one('links: effect unknown', W({ doorOpen: 'grate' }, { do: [{ spawnFoes: 'g' }] })),
    one('links: damage 0', W({ doorOpen: 'grate' }, { do: [{ damage: 0 }] })), one('links: damage 1000', W({ doorOpen: 'grate' }, { do: [{ damage: 1000 }] })),
    one('links: damage 1001', W({ doorOpen: 'grate' }, { do: [{ damage: 1001 }] })), one('links: message number', W({ doorOpen: 'grate' }, { do: [{ message: 3 }] })),
    one('links: message 1000 bytes', W({ doorOpen: 'grate' }, { do: [{ message: '\u00e4'.repeat(500) }] })), one('links: message 1002 bytes', W({ doorOpen: 'grate' }, { do: [{ message: '\u00e4'.repeat(501) }] })),
    one('links: openDoor bell', W({ doorOpen: 'grate' }, { do: [{ openDoor: 'b1' }] })), one('links: sealDoor ok', W({ doorOpen: 'grate' }, { do: [{ sealDoor: 'grate' }] })),
    one('links: closeDoor unknown', W({ doorOpen: 'grate' }, { do: [{ closeDoor: 'nope' }] })),
    one('bells: size 0', set('b1', { size: 0 })), one('bells: size 4', set('b1', { size: 4 })), one('bells: patina 3', set('b1', { patina: 3 })),
    one('bells: note 19', set('b1', { note: 19 })), one('bells: note 20000 ok', set('b1', { note: 20000 })), one('bells: extra key', set('b1', { name: 'x' })),
    one('bells: on wall', set('b1', { cell: [8, 2] })), one('bells: on door', set('b1', { cell: [8, 4] })), one('bells: on start', set('b1', { cell: [2, 4] })),
    one('bells: on checkpoint', set('b1', { cell: [9, 4] })), one('bells: no set', (g) => { g.entities.push({ id: 'b4', type: 'bell', cell: [4, 5], size: 1, patina: 0, note: 100 }); }),
    one('bells: two sets', (g) => { g.entities.push({ id: 'set2', type: 'bellSet', bells: ['b1', 'b2'], order: [0, 1] }); }),
    one('bells: unknown bell', set('set', { bells: ['b1', 'b2', 'zz'] })), one('bells: set names door', set('set', { bells: ['b1', 'b2', 'grate'] })),
    one('bells: same bell twice', set('set', { bells: ['b1', 'b1', 'b2'] })), one('bells: order not permutation', set('set', { order: [0, 0, 1] })),
    one('bells: order short', set('set', { order: [0, 1] })), one('bells: order 3', set('set', { order: [0, 1, 3] })), one('bells: one bell', set('set', { bells: ['b1'], order: [0] })),
    one('bells: bell id number', set('set', { bells: ['b1', 'b2', 3] })), one('bells: set before bells ok', (g) => { g.entities.unshift(g.entities.pop()); }),
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
