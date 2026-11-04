// The static world, built once from a GDF (rules R-GDF-*, R-WORLD-*). Immutable and never part of
// sim state: the state only carries the world id, so a state can't be replayed against another tomb.
// Mirror: src/Sim/World.php.
import { assertInt, fdiv } from './int.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';

// GDF cell codes (spec §7.1).
export const CELL = Object.freeze({ WALL: 0, ROOM: 1, CORR: 2, PLATE: 3, HPIT: 4, VOID: 5, BRIDGE: 6, VENT: 7, ALCOVE: 8 });
export const MAX_CELL_CODE = 8;
export const MAX_GRID = 64;
export const MAX_GDF_BYTES = 262144; // spec §7.2: 256 KiB
export const MAX_GDF_DEPTH = 12;     // spec §7.2: JSON nesting depth
export const MAX_ENTITIES = 400;     // spec §7.2
const CELL_MM = 2400;
// R-DOOR-2..4: door travel t in [0, DOOR_FULL]; +DOOR_STEP per tick while opening (33 ticks, Gloamhollow 1.1 s);
// solid while 20*t < 17*DOOR_FULL (Gloamhollow anim < 0.85).
export const DOOR_FULL = 693;
export const DOOR_STEP = 21;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// R-PROP-1: footprints per kind, in mm. Circles: r. Boxes: half-extents at yaw 0 (swap at 1024/3072).
const PROP_KINDS = new Map([
  ['statue', { r: 500 }], ['stele', { r: 550 }], ['tree', { r: 450 }], ['post', { r: 160 }],
  ['plinth', { r: 500 }], ['lectern', { r: 500 }], ['sarcophagus', { hx: 750, hz: 1150 }],
]);
const KEYS = {
  door: ['id', 'type', 'cell', 'style', 'opens'], doorMask: ['id', 'type', 'cell', 'style', 'opens', 'face'],
  slab: ['id', 'type', 'cell'], prop: ['id', 'type', 'kind', 'pos', 'yaw'],
};
const DOOR_STYLES = ['stone', 'grate', 'mask'], DOOR_OPENS = ['interact', 'trigger'], MASK_FACES = ['weep', 'laugh', 'sleep', 'blank'];

// The decoded grid and entity tables of each genuine world. Kept out of the frozen world object so
// nothing can edit them after load; doors, slabs and the like change state, never the world (R-WORLD-4).
const GRIDS = new WeakMap();

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, k) => [c, k]));

/** R-GDF-2: strict standard base64 (RFC 4648 §4): length a multiple of 4, '=' only as final padding. */
export function b64decode(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0) throw new RangeError('base64: bad length');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let k = 0; k < s.length; k += 4) {
    let v = 0;
    for (let c = 0; c < 4; c++) {
      const ch = s[k + c];
      const last = k + 4 === s.length;
      if (ch === '=' && last && c >= 4 - pad) { v <<= 6; continue; }
      const d = B64_INDEX.get(ch);
      if (d === undefined) throw new RangeError('base64: bad character');
      v = (v << 6) | d;
    }
    if (k + 4 === s.length && pad && (v & (pad === 1 ? 0xFF : 0xFFFF)) !== 0) throw new RangeError('base64: non-canonical padding');
    for (let b = 2; b >= 0 && o < out.length; b--) out[o++] = (v >> (8 * b)) & 0xFF;
  }
  return out;
}

export function b64encode(bytes) {
  let s = '';
  for (let k = 0; k < bytes.length; k += 3) {
    const n = bytes.length - k, v = (bytes[k] << 16) | ((bytes[k + 1] ?? 0) << 8) | (bytes[k + 2] ?? 0);
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (n > 1 ? B64[(v >> 6) & 63] : '=') + (n > 2 ? B64[v & 63] : '=');
  }
  return s;
}

/** R-GDF-3: run-length pairs [count 1..255, code 0..8] that cover exactly n cells. */
export function rleDecode(bytes, n) {
  if (bytes.length % 2 !== 0) throw new RangeError('cells: odd RLE length');
  const out = new Uint8Array(n);
  let o = 0;
  for (let k = 0; k < bytes.length; k += 2) {
    const count = bytes[k], code = bytes[k + 1];
    if (count < 1) throw new RangeError('cells: zero-length run');
    if (code > MAX_CELL_CODE) throw new RangeError('cells: unknown cell code');
    if (o + count > n) throw new RangeError('cells: runs overflow the grid');
    out.fill(code, o, o + count); o += count;
  }
  if (o !== n) throw new RangeError('cells: runs do not fill the grid');
  return out;
}

export function rleEncode(cells) {
  const out = [];
  for (let k = 0; k < cells.length;) {
    let n = 1;
    while (n < 255 && k + n < cells.length && cells[k + n] === cells[k]) n++;
    out.push(n, cells[k]); k += n;
  }
  return Uint8Array.from(out);
}

/**
 * R-GDF-0: the only way in. GDF text must be UTF-8 without a BOM, at most 256 KiB, nested at most
 * 12 deep, and every number must be a plain integer literal (no '.', 'e', 'E', no '-0'), so JS and
 * PHP read exactly the same values. The JSON parser then checks the syntax.
 */
export function parseGdf(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('GDF must be bytes');
  if (bytes.length > MAX_GDF_BYTES) throw new RangeError('GDF too large');
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) throw new RangeError('GDF has a BOM');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new RangeError('GDF is not UTF-8'); }
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === '"') { for (k++; k < text.length && text[k] !== '"'; k++) if (text[k] === '\\') k++; continue; }
    if (c === '{' || c === '[') { if (++depth > MAX_GDF_DEPTH) throw new RangeError('GDF nested too deep'); }
    else if (c === '}' || c === ']') depth--;
    else if (c === '-' || (c >= '0' && c <= '9')) {
      let e = k + 1;
      while (e < text.length && /[0-9.eE+-]/.test(text[e])) e++;
      const tok = text.slice(k, e);
      if (!/^-?(0|[1-9][0-9]*)$/.test(tok) || tok === '-0') throw new RangeError('GDF number is not a plain integer');
      k = e - 1;
    }
  }
  return JSON.parse(text);
}

/** Sim.load(bytes) -> world. Throws on anything the sim cannot run safely. */
export function loadWorld(bytes) {
  return worldFrom(parseGdf(bytes));
}

function worldFrom(gdf) {
  if (!gdf || gdf.gdf !== 1) throw new Error('unsupported GDF');
  const g = gdf.grid;
  if (!g || typeof g !== 'object') throw new RangeError('grid missing');
  const { w, h } = g;
  // R-GDF-1: 3 <= w, h <= 64
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || w > MAX_GRID || h > MAX_GRID) throw new RangeError('grid size');
  const grid = rleDecode(b64decode(g.cells), w * h);
  // R-WORLD-1: the border is wall, so every position the sim can reach is inside the grid.
  for (let i = 0; i < w; i++) if (grid[i] !== CELL.WALL || grid[(h - 1) * w + i] !== CELL.WALL) throw new RangeError('grid not closed');
  for (let j = 0; j < h; j++) if (grid[j * w] !== CELL.WALL || grid[j * w + w - 1] !== CELL.WALL) throw new RangeError('grid not closed');
  // R-WORLD-2: the player spawns at the centre of start.cell, which must be room or corridor.
  const sc = gdf.start?.cell;
  if (!Array.isArray(sc) || sc.length !== 2) throw new RangeError('start.cell');
  const [si, sj] = sc;
  assertInt(si); assertInt(sj);
  if (si < 0 || sj < 0 || si >= w || sj >= h) throw new RangeError('start.cell outside grid');
  const sk = grid[sj * w + si];
  if (sk !== CELL.ROOM && sk !== CELL.CORR) throw new RangeError('start.cell is not floor');
  const ents = loadEntities(gdf.entities, grid, w, h, sj * w + si);
  // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
  const id = toHex(sha256(canonicalBytes(gdf)).subarray(0, 16));
  const world = Object.freeze({ id, w, h, start: Object.freeze({ i: si, j: sj }) });
  GRIDS.set(world, { grid, ...ents });
  return world;
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v);

function hasExactKeys(e, keys) {
  const own = Object.keys(e);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(e, k));
}

/** R-ENT-2: [i, j] inside the grid -> cell index. */
function cellIndex(v, w, h) {
  if (!Array.isArray(v) || v.length !== 2 || !isInt(v[0]) || !isInt(v[1])) throw new RangeError('entity cell');
  const [i, j] = v;
  if (i < 0 || j < 0 || i >= w || j >= h) throw new RangeError('entity cell outside grid');
  return j * w + i;
}

/** R-ENT-*, R-DOOR-1, R-SLAB-1, R-PROP-*: validate the entity list and build the collision tables. */
function loadEntities(list, grid, w, h, startK) {
  if (list === undefined) list = [];
  if (!Array.isArray(list) || list.length > MAX_ENTITIES) throw new RangeError('entities');
  const ids = new Set(), doorAt = new Int16Array(w * h).fill(-1), slab = new Uint8Array(w * h);
  const doors = [], props = [], refs = [];
  for (const e of list) {
    if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) throw new RangeError('entity id');
    if (ids.has(e.id)) throw new RangeError('duplicate entity id');
    ids.add(e.id);
    if (e.type === 'door') {
      if (!hasExactKeys(e, e.style === 'mask' ? KEYS.doorMask : KEYS.door)) throw new RangeError('door keys');
      if (!DOOR_STYLES.includes(e.style) || !DOOR_OPENS.includes(e.opens)) throw new RangeError('door style/opens');
      if (e.style === 'mask' && !MASK_FACES.includes(e.face)) throw new RangeError('door face');
      const k = cellIndex(e.cell, w, h);
      if ((grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR) || k === startK) throw new RangeError('door cell');
      if (doorAt[k] >= 0 || slab[k]) throw new RangeError('cell already taken');
      doorAt[k] = doors.length;
      refs.push({ type: 'door', door: doors.length });
      const [ci, cj] = e.cell;
      doors.push(Object.freeze({ id: e.id, k, cx: ci * CELL_MM + CELL_MM / 2, cz: cj * CELL_MM + CELL_MM / 2, interact: e.opens === 'interact' }));
    } else if (e.type === 'slab') {
      if (!hasExactKeys(e, KEYS.slab)) throw new RangeError('slab keys');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.PLATE) throw new RangeError('slab not on a plate');
      if (doorAt[k] >= 0 || slab[k]) throw new RangeError('cell already taken');
      slab[k] = 1;
      refs.push({ type: 'slab' });
    } else if (e.type === 'prop') {
      if (!hasExactKeys(e, KEYS.prop)) throw new RangeError('prop keys');
      const fp = typeof e.kind === 'string' ? PROP_KINDS.get(e.kind) : undefined;
      if (!fp) throw new RangeError('prop kind');
      const pos = e.pos;
      if (!Array.isArray(pos) || pos.length !== 2 || !isInt(pos[0]) || !isInt(pos[1])) throw new RangeError('prop pos');
      if (!isInt(e.yaw) || e.yaw < 0 || e.yaw > 4095) throw new RangeError('prop yaw');
      const [x, z] = pos;
      if (x < 0 || z < 0 || x > w * CELL_MM || z > h * CELL_MM) throw new RangeError('prop pos outside grid');
      let p;
      if (fp.r !== undefined) p = { circle: true, x, z, r: fp.r, x0: x - fp.r, x1: x + fp.r, z0: z - fp.r, z1: z + fp.r };
      else {
        if (e.yaw % 1024 !== 0) throw new RangeError('box prop yaw');
        const turned = e.yaw === 1024 || e.yaw === 3072, hx = turned ? fp.hz : fp.hx, hz = turned ? fp.hx : fp.hz;
        p = { circle: false, x, z, r: 0, x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
      }
      props.push(Object.freeze(p));
      refs.push({ type: 'prop' });
    } else throw new RangeError('unknown entity type');
  }
  // R-PROP-2: every cell under the footprint's bounds is inside the grid and free floor.
  // Checked after the loop, so a prop can't overlap a door or slab listed after it.
  for (const p of props) {
    const i0 = fdiv(p.x0, CELL_MM), i1 = fdiv(p.x1 - 1, CELL_MM), j0 = fdiv(p.z0, CELL_MM), j1 = fdiv(p.z1 - 1, CELL_MM);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) throw new RangeError('prop outside grid');
      const k = j * w + i;
      if (grid[k] === CELL.WALL || doorAt[k] >= 0 || slab[k] || k === startK) throw new RangeError('prop footprint blocked');
    }
  }
  return { doorAt, slab, doors: Object.freeze(doors), props: Object.freeze(props), refs: Object.freeze(refs.map(Object.freeze)) };
}

/** Throws unless world came from loadWorld (not a look-alike object). */
export function assertWorld(world) {
  if (!GRIDS.has(world)) throw new TypeError('not a loaded world');
}

/**
 * R-MOVE-4: solid for collision. Outside the grid, wall, a door cell while R-DOOR-4 holds, a slab.
 * doors = state.doors.
 */
export function solidCell(world, doors, i, j) {
  if (i < 0 || j < 0 || i >= world.w || j >= world.h) return true;
  const W = GRIDS.get(world), k = j * world.w + i;
  if (W.grid[k] === CELL.WALL || W.slab[k]) return true;
  const d = W.doorAt[k];
  return d >= 0 && 20 * doors[d].t < 17 * DOOR_FULL;
}

/** R-MOVE-4: the props, in entity order (frozen). */
export function worldProps(world) { return GRIDS.get(world).props; }

/** The doors, in entity order (frozen): { id, k, cx, cz, interact }. */
export function worldDoors(world) { return GRIDS.get(world).doors; }

/** R-ENT-3: the entity with number n (1-based), or undefined. */
export function entityRef(world, n) { return n >= 1 ? GRIDS.get(world).refs[n - 1] : undefined; }
