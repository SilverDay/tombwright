// The builder's document model (M2 slice 1, decisions #79-#85). Pure data: no DOM, no storage, so node tests cover it.
// A tomb in the editor is the GDF object with its grid unpacked into a Uint8Array. Everything slice 1 does not edit
// (entities, links, meta, dressing, unknown keys) passes through untouched, so importing a real tomb and saving it
// loses nothing.
import { CELL, MAX_GRID, MAX_ZONES, MAX_CHECKPOINTS, MAX_GDF_BYTES, parseGdf, rleDecode, rleEncode, b64decode, b64encode } from '../sim/world.js';

export const MIN_GRID = 3;
export const CEIL_MIN = 3000, CEIL_MAX = 6500;     // R-GDF zone ceil
export const FLOOR = [CELL.ROOM, CELL.CORR];
export const isFloor = (c) => c === CELL.ROOM || c === CELL.CORR;

/** A small valid tomb: one room, one zone with a checkpoint, a start and an exit. */
export function newTomb(w = 16, h = 12) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 6 || h < 6 || w > MAX_GRID || h > MAX_GRID) throw new RangeError('grid size');
  const cells = new Uint8Array(w * h);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) cells[j * w + i] = CELL.ROOM;
  const mid = Math.floor(h / 2);
  return {
    gdf: {
      gdf: 1,
      meta: { title: 'Untitled tomb', lang: 'en', authorId: 0 },
      grid: { w, h, cells: '' },
      zones: [{ id: 'z1', name: 'The first chamber', rects: [[1, 1, w - 2, h - 2]], ceil: 4200, checkpoint: { cell: [2, mid], yaw: 1024 } }],
      start: { cell: [2, mid] },
      exit: { cell: [w - 3, mid] },
      entities: [],
      links: [],
    },
    w, h, cells,
  };
}

/** Parse GDF bytes into an editable document. Throws on anything that is not a readable GDF grid; semantic errors
 *  (a door on a wall, ...) are allowed here, so a half-built tomb can be saved and reopened. */
export function fromBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('GDF must be bytes');
  if (bytes.length > MAX_GDF_BYTES) throw new RangeError('GDF too large');
  const gdf = parseGdf(bytes);
  if (!gdf || typeof gdf !== 'object' || gdf.gdf !== 1) throw new RangeError('not a GDF file');
  const g = gdf.grid;
  if (!g || typeof g !== 'object' || !Number.isInteger(g.w) || !Number.isInteger(g.h) || g.w < MIN_GRID || g.h < MIN_GRID || g.w > MAX_GRID || g.h > MAX_GRID) throw new RangeError('grid size');
  const cells = rleDecode(b64decode(g.cells), g.w * g.h);
  return { gdf, w: g.w, h: g.h, cells };
}

export const fromText = (text) => fromBytes(new TextEncoder().encode(text));

/** The GDF object for the document (the grid packed again). The input is not changed. */
export function toGdf(doc) {
  const out = { ...doc.gdf, grid: { ...doc.gdf.grid, w: doc.w, h: doc.h, cells: b64encode(rleEncode(doc.cells)) } };
  return out;
}
export const toText = (doc) => JSON.stringify(toGdf(doc));
export const toBytes = (doc) => new TextEncoder().encode(toText(doc));

export const inGrid = (doc, i, j) => Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < doc.w && j < doc.h;
export const cellAt = (doc, i, j) => doc.cells[j * doc.w + i];
const interior = (doc, i, j) => i >= 1 && j >= 1 && i < doc.w - 1 && j < doc.h - 1;

/** Paint one cell with a cell code. The outer ring stays wall (the loader needs a closed grid). Returns true if it changed. */
export function paint(doc, i, j, code) {
  if (!inGrid(doc, i, j) || !interior(doc, i, j) || !Number.isInteger(code) || code < 0 || code > CELL.ALCOVE) return false;
  const k = j * doc.w + i;
  if (doc.cells[k] === code) return false;
  doc.cells[k] = code;
  return true;
}

/** Paint a filled rectangle (corners in any order). Returns how many cells changed. */
export function paintRect(doc, i0, j0, i1, j1, code) {
  let n = 0;
  for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) if (paint(doc, i, j, code)) n++;
  return n;
}

/** Which zone covers the cell (index into gdf.zones), or -1. */
export function zoneIndexAt(doc, i, j) {
  const zs = doc.gdf.zones ?? [];
  for (let n = 0; n < zs.length; n++) for (const [x, y, w, h] of zs[n].rects ?? []) if (i >= x && j >= y && i < x + w && j < y + h) return n;
  return -1;
}

const nextId = (list, prefix) => { const used = new Set(list.map((e) => e.id)); for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n; };

/** Add a zone over a rectangle (corners any order, clipped to the interior). Returns the zone, or null if there is no
 *  room (16 zones, or the rectangle touches another zone, which the loader refuses). */
export function addZone(doc, i0, j0, i1, j1) {
  const zs = (doc.gdf.zones ??= []);
  if (zs.length >= MAX_ZONES) return null;
  const x0 = Math.max(1, Math.min(i0, i1)), y0 = Math.max(1, Math.min(j0, j1));
  const x1 = Math.min(doc.w - 2, Math.max(i0, i1)), y1 = Math.min(doc.h - 2, Math.max(j0, j1));
  if (x1 < x0 || y1 < y0) return null;
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (zoneIndexAt(doc, i, j) >= 0) return null;
  const z = { id: nextId(zs, 'z'), name: 'Chamber ' + (zs.length + 1), rects: [[x0, y0, x1 - x0 + 1, y1 - y0 + 1]], ceil: 4200 };
  zs.push(z);
  return z;
}

/** Remove a zone. Links and entities that name it are the author's to fix (the validator will say). */
export function removeZone(doc, id) {
  const zs = doc.gdf.zones ?? [], n = zs.findIndex((z) => z.id === id);
  if (n < 0) return false;
  zs.splice(n, 1);
  return true;
}

/** Edit a zone's name, ceiling or checkpoint. `patch` may hold name, ceil (clamped), checkpoint (a cell + yaw, or null to remove). */
export function updateZone(doc, id, patch) {
  const z = (doc.gdf.zones ?? []).find((e) => e.id === id);
  if (!z) return false;
  if (typeof patch.name === 'string') z.name = patch.name.slice(0, 60);
  if (Number.isInteger(patch.ceil)) z.ceil = Math.min(CEIL_MAX, Math.max(CEIL_MIN, patch.ceil));
  if (patch.tint === null) delete z.tint;
  else if (patch.tint !== undefined) { if (!Array.isArray(patch.tint) || patch.tint.length !== 3 || !patch.tint.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) return false; z.tint = patch.tint.slice(); }
  if (patch.walls === null) delete z.walls;
  else if (patch.walls !== undefined) { if (patch.walls !== 'brick' && patch.walls !== 'shelves') return false; z.walls = patch.walls; }
  if (patch.reach !== undefined) {
    if (!z.checkpoint) return false;
    if (patch.reach === null) delete z.checkpoint.reach;
    else if (patch.reach === 'enter' || patch.reach === 'effect') z.checkpoint.reach = patch.reach;
    else return false;
  }
  if (patch.checkpoint === null) delete z.checkpoint;
  else if (patch.checkpoint) {
    const { cell, yaw = 0 } = patch.checkpoint;
    if (!Array.isArray(cell) || !inGrid(doc, cell[0], cell[1]) || !Number.isInteger(yaw)) return false;
    if (!z.checkpoint && (doc.gdf.zones ?? []).filter((e) => e.checkpoint).length >= MAX_CHECKPOINTS) return false;
    z.checkpoint = { ...(z.checkpoint ?? {}), cell: [cell[0], cell[1]], yaw: ((yaw % 4096) + 4096) % 4096 };
  }
  return true;
}

/** Place the start or the exit on a floor cell. Returns false if the cell is not floor. */
export function setStart(doc, i, j) {
  if (!inGrid(doc, i, j) || !isFloor(cellAt(doc, i, j))) return false;
  doc.gdf.start = { cell: [i, j] };
  return true;
}
export function setExit(doc, i, j) {
  if (!inGrid(doc, i, j) || !isFloor(cellAt(doc, i, j))) return false;
  doc.gdf.exit = { ...(doc.gdf.exit ?? {}), cell: [i, j] };   // keeps an existing `requires`
  return true;
}
export function clearExit(doc) { delete doc.gdf.exit; }
/** What the exit needs: null (nothing), 'bossDefeated' or the id of an item. */
export function setExitRequires(doc, value) {
  if (!doc.gdf.exit) return false;
  if (value === null || value === '') delete doc.gdf.exit.requires; else doc.gdf.exit.requires = String(value);
  return true;
}

export function setTitle(doc, title) { doc.gdf.meta = { ...(doc.gdf.meta ?? { lang: 'en', authorId: 0 }), title: String(title).slice(0, 60) }; }

/** Count of what the document holds, for the status line. */
export function summary(doc) {
  let floor = 0;
  for (const c of doc.cells) if (isFloor(c)) floor++;
  return { w: doc.w, h: doc.h, floor, zones: (doc.gdf.zones ?? []).length, entities: (doc.gdf.entities ?? []).length, links: (doc.gdf.links ?? []).length };
}
