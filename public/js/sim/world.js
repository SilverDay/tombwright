// The static world, built once from a GDF (rules R-GDF-*, R-WORLD-*). Immutable and never part of
// sim state: the state only carries the world id, so a state can't be replayed against another tomb.
// Mirror: src/Sim/World.php.
import { assertInt, fdiv } from './int.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';
import { compileLinks } from './links.js';
import { foeKind, BESTIARY_VERSION } from './bestiary.js';

// GDF cell codes (spec §7.1).
export const CELL = Object.freeze({ WALL: 0, ROOM: 1, CORR: 2, PLATE: 3, HPIT: 4, VOID: 5, BRIDGE: 6, VENT: 7, ALCOVE: 8 });
export const MAX_CELL_CODE = 8;
export const MAX_GRID = 64;
export const MAX_GDF_BYTES = 262144; // spec §7.2: 256 KiB
export const MAX_GDF_DEPTH = 12;     // spec §7.2: JSON nesting depth
export const MAX_ENTITIES = 400;     // spec §7.2
export const MAX_ZONES = 16;         // spec §7.2
export const MAX_CHECKPOINTS = 12;   // spec §7.2
const CELL_MM = 2400;
// R-DOOR-2..4: door travel t in [0, DOOR_FULL]; +DOOR_STEP per tick while opening (33 ticks, Gloamhollow 1.1 s);
// solid while 20*t < 17*DOOR_FULL (Gloamhollow anim < 0.85).
export const DOOR_FULL = 693;
export const DOOR_STEP = 21;
export const DOOR_CLOSE_STEP = 33; // R-DOOR-3: 693 / 33 = 21 ticks (Gloamhollow 0.7 s)
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// R-PROP-1: footprints per kind, in mm. Circles: r. Boxes: half-extents at yaw 0 (swap at 1024/3072).
const PROP_KINDS = new Map([
  ['statue', { r: 500 }], ['stele', { r: 550 }], ['tree', { r: 450 }], ['post', { r: 160 }],
  ['plinth', { r: 500 }], ['lectern', { r: 500 }], ['sarcophagus', { hx: 750, hz: 1150 }],
]);
const KEYS = {
  door: ['id', 'type', 'cell', 'style', 'opens'], doorMask: ['id', 'type', 'cell', 'style', 'opens', 'face'],
  chest: ['id', 'type', 'cell', 'wall', 'style', 'trap'], alcove: ['id', 'type', 'cell', 'kind', 'door'],
  foe: ['id', 'type', 'kind', 'cell', 'start'],
  slab: ['id', 'type', 'cell'], prop: ['id', 'type', 'kind', 'pos', 'yaw'],
  vent: ['id', 'type', 'cells', 'period', 'phase', 'warn', 'fire'],
  item: ['id', 'type', 'kind', 'cell'], treasure: ['id', 'type', 'kind', 'cell', 'value'],
  lampHook: ['id', 'type', 'cell', 'dir'], mirror: ['id', 'type', 'cell', 'start'], crystal: ['id', 'type', 'cell', 'wall'],
  eyes: ['id', 'type', 'zone', 'wake'],
  bell: ['id', 'type', 'cell', 'size', 'patina', 'note'], bellSet: ['id', 'type', 'bells', 'order'],
  zone: ['id', 'name', 'rects', 'ceil'], zoneCp: ['id', 'name', 'rects', 'ceil', 'checkpoint'],
  cp: ['cell', 'yaw'], cpReach: ['cell', 'yaw', 'reach'],
};
const ITEM_KINDS = ['flask', 'rubble', 'treasure', 'key'];
const FOE_STARTS = ['asleep', 'idle', 'hunting', 'dormant'];
export const MAX_FOES = 24, MAX_AWAKE = 8, THREAT_BUDGET = 100; // spec §7.2, §4.9.2
// R-BELL-1, R-BELL-3: by size 1..3, the footprint radius and the extra reach (Gloamhollow r + 0.05 m and 2 m + r).
const BELL_R = [470, 650, 830], BELL_REACH = [2420, 2600, 2780];
// R-BEAM-1: directions n, e, s, w as (di, dj).
export const DIRS = Object.freeze({ n: Object.freeze([0, -1]), e: Object.freeze([1, 0]), s: Object.freeze([0, 1]), w: Object.freeze([-1, 0]) });
const dirOf = (v) => (typeof v === 'string' && Object.hasOwn(DIRS, v) ? DIRS[v] : undefined);
const DOOR_STYLES = ['stone', 'grate', 'mask'], DOOR_OPENS = ['interact', 'trigger', 'key'], MASK_FACES = ['weep', 'laugh', 'sleep', 'blank'];

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
  const startK = sj * w + si;
  const zs = loadZones(gdf.zones, grid, w, h);
  const ents = loadEntities(gdf.entities, grid, w, h, startK, zs.cpCells, zs.zoneIds);
  // R-ZONE-2: checkpoint cells hold no door or slab (props were checked in loadEntities).
  for (const k of zs.cpCells) if (ents.doorAt[k] >= 0 || ents.slab[k]) throw new RangeError('checkpoint cell taken');
  // R-LINK-*: compile the links against the entity and zone ids.
  // R-FOE-2: a GDF with foes names its bestiary version.
  if ((ents.foes.length > 0 || Object.hasOwn(gdf, 'bestiary')) && gdf.bestiary !== BESTIARY_VERSION) throw new RangeError('bestiary version');
  const links = compileLinks(gdf.links, { ents: ents.byId, zones: new Map(zs.zoneIds.map((id, n) => [id, n])), groups: ents.groupIds });
  // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
  const id = toHex(sha256(canonicalBytes(gdf)).subarray(0, 16));
  const world = Object.freeze({ id, w, h, start: Object.freeze({ i: si, j: sj }) });
  GRIDS.set(world, { grid, zoneOf: zs.zoneOf, zones: zs.zones, startZone: zs.zoneOf[startK], ...ents, links });
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

/** R-ZONE-1, R-ZONE-2: zones, their cells and checkpoints (door/slab/prop checks follow the entities). */
function loadZones(list, grid, w, h) {
  if (list === undefined) list = [];
  if (!Array.isArray(list) || list.length > MAX_ZONES) throw new RangeError('zones');
  const zoneOf = new Int8Array(w * h).fill(-1), ids = new Set(), zones = [], cpCells = [];
  list.forEach((z, zi) => {
    if (!isObj(z) || typeof z.id !== 'string' || !ID_RE.test(z.id)) throw new RangeError('zone id');
    if (ids.has(z.id)) throw new RangeError('duplicate zone id');
    ids.add(z.id);
    if (!hasExactKeys(z, Object.hasOwn(z, 'checkpoint') ? KEYS.zoneCp : KEYS.zone)) throw new RangeError('zone keys');
    if (typeof z.name !== 'string') throw new RangeError('zone name');
    if (!isInt(z.ceil) || z.ceil < 3000 || z.ceil > 6500) throw new RangeError('zone ceil');
    if (!Array.isArray(z.rects) || z.rects.length < 1 || z.rects.length > 8) throw new RangeError('zone rects');
    for (const r of z.rects) {
      if (!Array.isArray(r) || r.length !== 4 || !r.every(isInt)) throw new RangeError('zone rect');
      const [x, y, rw, rh] = r;
      if (rw < 1 || rh < 1 || x < 0 || y < 0 || x > w - rw || y > h - rh) throw new RangeError('zone rect outside grid');
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) {
        if (zoneOf[j * w + i] >= 0) throw new RangeError('zones overlap');
        zoneOf[j * w + i] = zi;
      }
    }
    let cp = null;
    if (Object.hasOwn(z, 'checkpoint')) {
      const c = z.checkpoint;
      if (!isObj(c) || !hasExactKeys(c, Object.hasOwn(c, 'reach') ? KEYS.cpReach : KEYS.cp)) throw new RangeError('checkpoint keys');
      if (!isInt(c.yaw) || c.yaw < 0 || c.yaw > 4095) throw new RangeError('checkpoint yaw');
      if (Object.hasOwn(c, 'reach') && c.reach !== 'enter' && c.reach !== 'effect') throw new RangeError('checkpoint reach');
      const k = cellIndex(c.cell, w, h);
      if (zoneOf[k] !== zi || (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR)) throw new RangeError('checkpoint cell');
      if (cpCells.length >= MAX_CHECKPOINTS) throw new RangeError('too many checkpoints');
      cpCells.push(k);
      const [ci, cj] = c.cell;
      cp = Object.freeze({ x: ci * CELL_MM + CELL_MM / 2, z: cj * CELL_MM + CELL_MM / 2, yaw: c.yaw, enter: c.reach !== 'effect' });
    }
    zones.push(Object.freeze({ id: z.id, cp }));
  });
  return { zoneOf, zones: Object.freeze(zones), cpCells, zoneIds: zones.map((z) => z.id) };
}

/** R-ENT-*, R-DOOR-1, R-SLAB-1, R-PROP-*, R-VENT-1: validate the entity list and build the collision tables. */
function loadEntities(list, grid, w, h, startK, cpCells, zoneIds) {
  if (list === undefined) list = [];
  if (!Array.isArray(list) || list.length > MAX_ENTITIES) throw new RangeError('entities');
  const ids = new Set(), doorAt = new Int16Array(w * h).fill(-1), slab = new Uint8Array(w * h);
  const doors = [], props = [], refs = [], vents = [], ventAt = new Int16Array(w * h).fill(-1), items = [], eyes = [];
  const bells = [], bellSets = [], byId = new Map(), hooks = [], mirrors = [], crystals = [];
  const chests = [], alcoves = [], alcoveAt = new Int16Array(w * h).fill(-1), foes = [], groups = [], groupIds = new Map();
  for (const e of list) {
    if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) throw new RangeError('entity id');
    if (ids.has(e.id)) throw new RangeError('duplicate entity id');
    ids.add(e.id);
    if (e.type === 'door') {
      const dk = (e.style === 'mask' ? KEYS.doorMask : KEYS.door).concat(e.opens === 'key' ? ['key'] : []);
      if (!hasExactKeys(e, dk)) throw new RangeError('door keys');
      if (!DOOR_STYLES.includes(e.style) || !DOOR_OPENS.includes(e.opens)) throw new RangeError('door style/opens');
      if (e.style === 'mask' && !MASK_FACES.includes(e.face)) throw new RangeError('door face');
      const k = cellIndex(e.cell, w, h);
      if ((grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR) || k === startK) throw new RangeError('door cell');
      if (doorAt[k] >= 0 || slab[k]) throw new RangeError('cell already taken');
      doorAt[k] = doors.length;
      refs.push({ type: 'door', door: doors.length });
      const [ci, cj] = e.cell;
      doors.push({ id: e.id, k, cx: ci * CELL_MM + CELL_MM / 2, cz: cj * CELL_MM + CELL_MM / 2, interact: e.opens === 'interact', keyName: e.opens === 'key' ? e.key : null, key: -1 });
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
    } else if (e.type === 'vent') {
      if (!hasExactKeys(e, KEYS.vent)) throw new RangeError('vent keys');
      const { period, phase, warn, fire, cells } = e;
      if (![period, phase, warn, fire].every(isInt)) throw new RangeError('vent timing');
      if (period < 2 || period > 1800 || phase < 0 || phase >= period || warn < 0 || fire < 1 || warn + fire > period || 5 * fire > 3 * period) throw new RangeError('vent timing');
      if (!Array.isArray(cells) || cells.length < 1 || cells.length > 64) throw new RangeError('vent cells');
      for (const c of cells) {
        const k = cellIndex(c, w, h);
        if (grid[k] !== CELL.VENT || ventAt[k] >= 0) throw new RangeError('vent cell');
        ventAt[k] = vents.length;
      }
      vents.push(Object.freeze({ period, phase, warn, fire }));
      refs.push({ type: 'vent' });
    } else if (e.type === 'item') {
      const hidden = Object.hasOwn(e, 'hidden'), inChest = Object.hasOwn(e, 'in');
      const keys = (e.kind === 'treasure' ? KEYS.treasure : KEYS.item).filter((x) => !inChest || x !== 'cell')
        .concat(hidden ? ['hidden'] : [], inChest ? ['in'] : []);
      if (!hasExactKeys(e, keys)) throw new RangeError('item keys');
      if (!ITEM_KINDS.includes(e.kind)) throw new RangeError('item kind');
      if (hidden && (e.hidden !== true || e.kind === 'rubble' || inChest)) throw new RangeError('item hidden');
      if (inChest && (typeof e.in !== 'string' || e.kind === 'rubble')) throw new RangeError('item in');
      if (e.kind === 'treasure' && (!isInt(e.value) || e.value < 1 || e.value > 100000)) throw new RangeError('item value');
      let k = -1, x = 0, z = 0;
      if (!inChest) {
        k = cellIndex(e.cell, w, h);
        if (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR && grid[k] !== CELL.BRIDGE) throw new RangeError('item cell');
        const [ci, cj] = e.cell, off = e.kind === 'rubble' ? 300 : 0;
        x = ci * CELL_MM + CELL_MM / 2 - off; z = cj * CELL_MM + CELL_MM / 2 - off;
      }
      refs.push({ type: 'item', item: items.length });
      items.push({ id: e.id, n: refs.length, kind: e.kind, hidden, k, x, z, reach: e.kind === 'rubble' ? 1600 : 1700, chestName: inChest ? e.in : null });
    } else if (e.type === 'eyes') {
      if (!hasExactKeys(e, KEYS.eyes)) throw new RangeError('eyes keys');
      const zi = typeof e.zone === 'string' ? zoneIds.indexOf(e.zone) : -1;
      if (zi < 0 || eyes.some((x) => x.zone === zi)) throw new RangeError('eyes zone');
      if (!isInt(e.wake) || e.wake < 18 || e.wake > 1800) throw new RangeError('eyes wake');
      refs.push({ type: 'eyes' });
      eyes.push(Object.freeze({ id: e.id, zone: zi, wake: e.wake }));
    } else if (e.type === 'bell') {
      if (!hasExactKeys(e, KEYS.bell)) throw new RangeError('bell keys');
      if (!isInt(e.size) || e.size < 1 || e.size > 3) throw new RangeError('bell size');
      if (!isInt(e.patina) || e.patina < 0 || e.patina > 2) throw new RangeError('bell patina');
      if (!isInt(e.note) || e.note < 20 || e.note > 20000) throw new RangeError('bell note');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR) throw new RangeError('bell cell');
      const [ci, cj] = e.cell, x = ci * CELL_MM + CELL_MM / 2, z = cj * CELL_MM + CELL_MM / 2, r = BELL_R[e.size - 1];
      props.push(Object.freeze({ circle: true, x, z, r, x0: x - r, x1: x + r, z0: z - r, z1: z + r }));
      refs.push({ type: 'bell', bell: bells.length });
      bells.push({ id: e.id, k, x, z, reach: BELL_REACH[e.size - 1], set: -1, index: -1 });
    } else if (e.type === 'chest') {
      if (!hasExactKeys(e, KEYS.chest)) throw new RangeError('chest keys');
      const d = dirOf(e.wall);
      if (d === undefined || (e.style !== 'plain' && e.style !== 'gilded') || (e.trap !== 'none' && e.trap !== 'needles')) throw new RangeError('chest wall/style/trap');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR) throw new RangeError('chest cell');
      const [ci, cj] = e.cell, x = ci * CELL_MM + CELL_MM / 2, z = cj * CELL_MM + CELL_MM / 2, [di, dj] = d;
      // R-CHEST-1: 600 along the wall, 650 towards it, 150 away from it.
      const x0 = di === 0 ? x - 600 : di > 0 ? x - 150 : x - 650, x1 = di === 0 ? x + 600 : di > 0 ? x + 650 : x + 150;
      const z0 = dj === 0 ? z - 600 : dj > 0 ? z - 150 : z - 650, z1 = dj === 0 ? z + 600 : dj > 0 ? z + 650 : z + 150;
      props.push(Object.freeze({ circle: false, x, z, r: 0, x0, x1, z0, z1 }));
      refs.push({ type: 'chest', chest: chests.length });
      chests.push({ id: e.id, k, x: x + 250 * di, z: z + 250 * dj, reach: 2200, needles: e.trap === 'needles', contents: [] });
    } else if (e.type === 'foe') {
      const grouped = Object.hasOwn(e, 'group');
      if (!hasExactKeys(e, grouped ? [...KEYS.foe, 'group'] : KEYS.foe)) throw new RangeError('foe keys');
      const kind = foeKind(e.kind);
      if (kind === undefined) throw new RangeError('foe kind');
      if (!FOE_STARTS.includes(e.start)) throw new RangeError('foe start');
      if (grouped && (typeof e.group !== 'string' || !ID_RE.test(e.group))) throw new RangeError('foe group');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR && grid[k] !== CELL.BRIDGE) throw new RangeError('foe cell');
      const gname = grouped ? e.group : e.id;
      if (!groupIds.has(gname)) { groupIds.set(gname, groups.length); groups.push({ id: gname, foes: [], dormant: true }); }
      const g = groupIds.get(gname);
      groups[g].foes.push(foes.length);
      if (e.start !== 'dormant') groups[g].dormant = false;
      const [ci, cj] = e.cell;
      refs.push({ type: 'foe', foe: foes.length });
      foes.push({ id: e.id, k, x: ci * CELL_MM + CELL_MM / 2, z: cj * CELL_MM + CELL_MM / 2, kind, start: e.start, group: g });
    } else if (e.type === 'alcove') {
      if (!hasExactKeys(e, KEYS.alcove)) throw new RangeError('alcove keys');
      if (e.kind !== 'drown' && e.kind !== 'tip') throw new RangeError('alcove kind');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.ALCOVE || alcoveAt[k] >= 0) throw new RangeError('alcove cell');
      alcoveAt[k] = alcoves.length;
      refs.push({ type: 'alcove', alcove: alcoves.length });
      alcoves.push({ id: e.id, k, drown: e.kind === 'drown', doorName: e.door, door: -1 });
    } else if (e.type === 'lampHook' || e.type === 'mirror' || e.type === 'crystal') {
      if (!hasExactKeys(e, KEYS[e.type])) throw new RangeError(e.type + ' keys');
      const k = cellIndex(e.cell, w, h);
      if (grid[k] !== CELL.ROOM && grid[k] !== CELL.CORR) throw new RangeError(e.type + ' cell');
      const [ci, cj] = e.cell, x = ci * CELL_MM + CELL_MM / 2, z = cj * CELL_MM + CELL_MM / 2;
      if (e.type === 'lampHook') {
        const d = dirOf(e.dir);
        if (d === undefined) throw new RangeError('lampHook dir');
        refs.push({ type: 'lampHook', hook: hooks.length });
        hooks.push(Object.freeze({ id: e.id, k, i: ci, j: cj, di: d[0], dj: d[1], x: x - 900 * d[0], z: z - 900 * d[1], reach: 2200 }));
      } else if (e.type === 'mirror') {
        if (e.start !== '/' && e.start !== '\\') throw new RangeError('mirror start');
        if (mirrors.some((m) => m.k === k)) throw new RangeError('two mirrors on one cell');
        props.push(Object.freeze({ circle: true, x, z, r: 420, x0: x - 420, x1: x + 420, z0: z - 420, z1: z + 420 }));
        refs.push({ type: 'mirror', mirror: mirrors.length });
        mirrors.push(Object.freeze({ id: e.id, k, x, z, reach: 2150, start: e.start === '/' ? 0 : 1 }));
      } else {
        const d = dirOf(e.wall);
        if (d === undefined) throw new RangeError('crystal wall');
        if (grid[(cj + d[1]) * w + ci + d[0]] !== CELL.WALL) throw new RangeError('crystal not on a wall');
        refs.push({ type: 'crystal', crystal: crystals.length });
        crystals.push(Object.freeze({ id: e.id, k, di: d[0], dj: d[1] }));
      }
    } else if (e.type === 'bellSet') {
      if (!hasExactKeys(e, KEYS.bellSet)) throw new RangeError('bellSet keys');
      if (!Array.isArray(e.bells) || e.bells.length < 2 || e.bells.length > 5 || !e.bells.every((b) => typeof b === 'string')) throw new RangeError('bellSet bells');
      if (!Array.isArray(e.order) || e.order.length !== e.bells.length || !e.order.every(isInt)) throw new RangeError('bellSet order');
      for (let x = 0; x < e.order.length; x++) if (!e.order.includes(x)) throw new RangeError('bellSet order');
      refs.push({ type: 'bellSet', set: bellSets.length });
      bellSets.push({ id: e.id, names: e.bells.slice(), order: Object.freeze(e.order.slice()) });
    } else throw new RangeError('unknown entity type');
    byId.set(e.id, { ...refs[refs.length - 1], n: refs.length, kind: e.type === 'item' ? e.kind : undefined, hidden: e.type === 'item' && Object.hasOwn(e, 'hidden') });
  }
  // R-BELL-1, R-BELL-2: bells on free cells; every bell in exactly one set, named by bell id.
  for (const b of bells) if (doorAt[b.k] >= 0 || slab[b.k]) throw new RangeError('bell cell taken');
  // R-HOOK-1, R-MIRROR-1: hooks and mirrors on free cells.
  for (const x of [...hooks, ...mirrors]) if (doorAt[x.k] >= 0 || slab[x.k]) throw new RangeError('hook or mirror cell taken');
  bellSets.forEach((set, si) => {
    set.bells = set.names.map((name, i) => {
      const r = byId.get(name);
      if (r === undefined || r.type !== 'bell' || bells[r.bell].set >= 0) throw new RangeError('bellSet bell');
      bells[r.bell].set = si; bells[r.bell].index = i;
      return r.bell;
    });
  });
  if (bells.some((b) => b.set < 0)) throw new RangeError('bell without a set');
  // R-ITEM-1: no item on a door or slab cell (checked after the loop, whatever the order); `in` names a chest.
  items.forEach((it, n) => {
    if (it.chestName === null) { if (doorAt[it.k] >= 0 || slab[it.k]) throw new RangeError('item cell taken'); return; }
    const r = byId.get(it.chestName);
    if (r === undefined || r.type !== 'chest') throw new RangeError('item in: not a chest');
    chests[r.chest].contents.push(n);
  });
  // R-DOOR-1: a key door names a key item. R-ALCOVE-1: an alcove names a door. R-CHEST-1: chests on free cells.
  for (const d of doors) if (d.keyName !== null) {
    const r = typeof d.keyName === 'string' ? byId.get(d.keyName) : undefined;
    if (r === undefined || r.type !== 'item' || r.kind !== 'key') throw new RangeError('door key');
    d.key = r.n;
  }
  for (const a of alcoves) {
    const r = typeof a.doorName === 'string' ? byId.get(a.doorName) : undefined;
    if (r === undefined || r.type !== 'door') throw new RangeError('alcove door');
    a.door = r.door;
  }
  for (const c of chests) if (doorAt[c.k] >= 0 || slab[c.k]) throw new RangeError('chest cell taken');
  // R-FOE-2: foes on free cells (walkers not on lethal ones), the caps and the threat budget.
  let threat = 0, awake = 0;
  for (const f of foes) {
    if (doorAt[f.k] >= 0 || slab[f.k]) throw new RangeError('foe cell taken');
    const code = grid[f.k], armed = alcoveAt[f.k] >= 0;
    if (!f.kind.fly && (code === CELL.PLATE || code === CELL.HPIT || code === CELL.VOID || code === CELL.VENT || (code === CELL.ALCOVE && armed))) throw new RangeError('foe on a lethal cell');
    threat += f.kind.tier * f.kind.tier;
    if (f.start === 'idle' || f.start === 'hunting') awake += 1;
  }
  if (foes.length > MAX_FOES || awake > MAX_AWAKE || threat > THREAT_BUDGET) throw new RangeError('foe limits');
  // R-VENT-1: every vent cell belongs to a vent.
  for (let k = 0; k < w * h; k++) if (grid[k] === CELL.VENT && ventAt[k] < 0) throw new RangeError('vent cell without a vent');
  // R-PROP-2: every cell under the footprint's bounds is inside the grid and free floor.
  // Checked after the loop, so a prop can't overlap a door or slab listed after it.
  for (const p of props) {
    const i0 = fdiv(p.x0, CELL_MM), i1 = fdiv(p.x1 - 1, CELL_MM), j0 = fdiv(p.z0, CELL_MM), j1 = fdiv(p.z1 - 1, CELL_MM);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) throw new RangeError('prop outside grid');
      const k = j * w + i;
      if (grid[k] === CELL.WALL || doorAt[k] >= 0 || slab[k] || k === startK || cpCells.includes(k)) throw new RangeError('prop footprint blocked');
    }
  }
  return {
    byId, bells: Object.freeze(bells.map(Object.freeze)),
    hooks: Object.freeze(hooks), mirrors: Object.freeze(mirrors), crystals: Object.freeze(crystals),
    chests: Object.freeze(chests.map((c) => Object.freeze({ ...c, contents: Object.freeze(c.contents) }))),
    alcoves: Object.freeze(alcoves.map((a) => Object.freeze({ id: a.id, k: a.k, drown: a.drown, door: a.door }))), alcoveAt,
    foes: Object.freeze(foes.map(Object.freeze)), groups: Object.freeze(groups.map((g) => Object.freeze({ id: g.id, foes: Object.freeze(g.foes), dormant: g.dormant }))), groupIds,
    bellSets: Object.freeze(bellSets.map((b) => Object.freeze({ id: b.id, bells: Object.freeze(b.bells), order: b.order }))),
    doorAt, slab, ventAt, vents: Object.freeze(vents), items: Object.freeze(items.map(Object.freeze)), eyes: Object.freeze(eyes), doors: Object.freeze(doors.map((d) => Object.freeze({ id: d.id, k: d.k, cx: d.cx, cz: d.cz, interact: d.interact, key: d.key }))), props: Object.freeze(props), refs: Object.freeze(refs.map(Object.freeze)) };
}

/** Throws unless world came from loadWorld (not a look-alike object). */
export function assertWorld(world) {
  if (!GRIDS.has(world)) throw new TypeError('not a loaded world');
}

/**
 * R-MOVE-4: solid for collision. Outside the grid, wall, a door cell while R-DOOR-4 holds, a slab,
 * a plate sprung during play (state.sprung).
 */
export function solidCell(world, state, i, j) {
  if (i < 0 || j < 0 || i >= world.w || j >= world.h) return true;
  const W = GRIDS.get(world), k = j * world.w + i;
  if (W.grid[k] === CELL.WALL || W.slab[k] || state.sprung.includes(k)) return true; // R-TRAP-2
  const doors = state.doors;
  const d = W.doorAt[k];
  return d >= 0 && 20 * doors[d].t < 17 * DOOR_FULL;
}

/** R-MOVE-4: the props, in entity order (frozen). */
export function worldProps(world) { return GRIDS.get(world).props; }

/** The doors, in entity order (frozen): { id, k, cx, cz, interact }. */
export function worldDoors(world) { return GRIDS.get(world).doors; }

/** The cell code at (i, j), which must be inside the grid. */
export function cellCode(world, i, j) { return GRIDS.get(world).grid[j * world.w + i]; }

/** True if cell index k holds a slab from the GDF (R-SLAB-1). */
export function slabAt(world, k) { return GRIDS.get(world).slab[k] === 1; }

/** R-VENT-*: the vent covering cell index k, or undefined. */
export function ventAt(world, k) { const W = GRIDS.get(world), v = W.ventAt[k]; return v >= 0 ? W.vents[v] : undefined; }

/** R-ZONE-1: zone index of cell k (−1 for none), the zones ({ id, cp }), and the start cell's zone. */
export function zoneAt(world, k) { return GRIDS.get(world).zoneOf[k]; }
export function worldZones(world) { return GRIDS.get(world).zones; }
export function startZone(world) { return GRIDS.get(world).startZone; }

/** R-FOE-*: the foes and groups, in entity order / order of first appearance (frozen). */
export function worldFoes(world) { return GRIDS.get(world).foes; }
export function worldGroups(world) { return GRIDS.get(world).groups; }

/** R-CHEST-*, R-ALCOVE-*: chests and alcoves (frozen); the alcove on cell k, or undefined. */
export function worldChests(world) { return GRIDS.get(world).chests; }
export function worldAlcoves(world) { return GRIDS.get(world).alcoves; }
export function alcoveAt(world, k) { const W = GRIDS.get(world), a = W.alcoveAt[k]; return a >= 0 ? W.alcoves[a] : undefined; }

/** R-HOOK-*, R-MIRROR-*, R-CRYSTAL-1: lamp hooks, mirrors and crystals, in entity order (frozen). */
export function worldHooks(world) { return GRIDS.get(world).hooks; }
export function worldMirrors(world) { return GRIDS.get(world).mirrors; }
export function worldCrystals(world) { return GRIDS.get(world).crystals; }

/** R-BELL-*, R-LINK-*: bells, bell sets and the compiled links (frozen). */
export function worldBells(world) { return GRIDS.get(world).bells; }
export function worldBellSets(world) { return GRIDS.get(world).bellSets; }
export function worldLinks(world) { return GRIDS.get(world).links; }

/** R-ITEM-*, R-EYES-*: the items and eyes, in entity order (frozen). */
export function worldItems(world) { return GRIDS.get(world).items; }
export function worldEyes(world) { return GRIDS.get(world).eyes; }

/** R-LOS-1: blocks sight: wall, or a door cell while R-DOOR-4 holds. Outside the grid blocks. */
export function sightBlocked(world, state, i, j) {
  if (i < 0 || j < 0 || i >= world.w || j >= world.h) return true;
  const W = GRIDS.get(world), k = j * world.w + i;
  if (W.grid[k] === CELL.WALL) return true;
  const d = W.doorAt[k];
  return d >= 0 && 20 * state.doors[d].t < 17 * DOOR_FULL;
}

/** R-ENT-3: the entity with number n (1-based), or undefined. */
export function entityRef(world, n) { return n >= 1 ? GRIDS.get(world).refs[n - 1] : undefined; }
