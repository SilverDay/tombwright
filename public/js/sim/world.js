// The static world, built once from a GDF (rules R-GDF-*, R-WORLD-*). Immutable and never part of
// sim state: the state only carries the world id, so a state can't be replayed against another tomb.
// Mirror: src/Sim/World.php.
import { assertInt } from './int.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';

// GDF cell codes (spec §7.1).
export const CELL = Object.freeze({ WALL: 0, ROOM: 1, CORR: 2, PLATE: 3, HPIT: 4, VOID: 5, BRIDGE: 6, VENT: 7, ALCOVE: 8 });
export const MAX_CELL_CODE = 8;
export const MAX_GRID = 64;
export const MAX_GDF_BYTES = 262144; // spec §7.2: 256 KiB
export const MAX_GDF_DEPTH = 12;     // spec §7.2: JSON nesting depth

// The decoded grid of each genuine world. Kept out of the frozen world object so nothing can edit it
// after load; doors, slabs and the like change state, never the world (R-WORLD-4).
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
  // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
  const id = toHex(sha256(canonicalBytes(gdf)).subarray(0, 16));
  const world = Object.freeze({ id, w, h, start: Object.freeze({ i: si, j: sj }) });
  GRIDS.set(world, grid);
  return world;
}

/** Throws unless world came from loadWorld (not a look-alike object). */
export function assertWorld(world) {
  if (!GRIDS.has(world)) throw new TypeError('not a loaded world');
}

/** R-MOVE-4: solid for collision. Outside the grid counts as solid. */
export function solidCell(world, i, j) {
  if (i < 0 || j < 0 || i >= world.w || j >= world.h) return true;
  return GRIDS.get(world)[j * world.w + i] === CELL.WALL;
}
