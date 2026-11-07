// Placing and editing entities in the builder (M2 slice 2, decisions #86-#87). Pure data, no DOM.
// One table describes how each type is anchored and which fields the inspector shows; select, move, delete and the
// field editor are written once over it. The table is UI metadata only: `Sim.load` decides what is valid, and the
// loader needs exact key sets, so every option change here adds or drops the keys that go with it.
import { CELL } from '../sim/world.js';
import { cellAt, isFloor, inGrid } from './model.js';

export const CELL_MM = 2400;
export const SIDES = ['n', 'e', 's', 'w'];
const D = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export const DOOR_STYLES = ['stone', 'grate', 'mask'], DOOR_OPENS = ['interact', 'trigger', 'key'], MASK_FACES = ['weep', 'laugh', 'sleep', 'blank'];
export const PROP_KINDS = ['statue', 'stele', 'tree', 'post', 'plinth', 'lectern', 'sarcophagus'];
export const DECOR_KINDS = ['bones', 'burnt', 'scorch', 'candles', 'stair'];
export const INSCRIPTION_STYLES = ['plaque', 'carving', 'scrawl', 'stele', 'book', 'look'];
export const ITEM_KINDS = ['flask', 'rubble', 'treasure', 'key'];
const MAX_PAGES = 8;

/** What the palette offers. `type` is the entity type, `kind` a preset for it. */
export const PALETTE = [
  { id: 'door', label: 'Door', type: 'door', group: 'Doors' },
  { id: 'slab', label: 'Falling slab (on a plate)', type: 'slab', group: 'Hazards' },
  { id: 'vent', label: 'Fire vent (on vent cells)', type: 'vent', group: 'Hazards' },
  { id: 'alcove', label: 'Alcove trap (on an alcove cell)', type: 'alcove', group: 'Hazards' },
  { id: 'flask', label: 'Oil flask', type: 'item', kind: 'flask', group: 'Items' },
  { id: 'rubble', label: 'Pebble rubble', type: 'item', kind: 'rubble', group: 'Items' },
  { id: 'treasure', label: 'Treasure', type: 'item', kind: 'treasure', group: 'Items' },
  { id: 'key', label: 'Key', type: 'item', kind: 'key', group: 'Items' },
  { id: 'chest', label: 'Chest', type: 'chest', group: 'Items' },
  { id: 'inscription', label: 'Inscription', type: 'inscription', group: 'Text and dressing' },
  { id: 'torch', label: 'Torch', type: 'torch', group: 'Text and dressing' },
  { id: 'marks', label: "Masons' marks (click cells)", type: 'marks', group: 'Text and dressing' },
  { id: 'prop', label: 'Statue, stele, tree…', type: 'prop', group: 'Text and dressing' },
  { id: 'decor', label: 'Bones, scorch…', type: 'decor', group: 'Text and dressing' },
];

// ------------------------------------------------------------------ small helpers
export const entities = (doc) => (doc.gdf.entities ??= []);
export const byId = (doc, id) => entities(doc).find((e) => e.id === id);
const ofType = (doc, type) => entities(doc).filter((e) => e.type === type);

/** An id no entity or zone uses yet. */
export function freeId(doc, prefix) {
  const used = new Set([...entities(doc).map((e) => e.id), ...(doc.gdf.zones ?? []).map((z) => z.id)]);
  for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n;
}

/** The first side of a floor cell that faces a wall (preferring `prefer`), or null. */
export function wallSide(doc, i, j, prefer) {
  const order = prefer && SIDES.includes(prefer) ? [prefer, ...SIDES.filter((s) => s !== prefer)] : SIDES;
  for (const s of order) { const [di, dj] = D[s]; if (inGrid(doc, i + di, j + dj) && cellAt(doc, i + di, j + dj) === CELL.WALL) return s; }
  return null;
}

const cellTaken = (doc, i, j) => entities(doc).some((e) => (e.type === 'door' || e.type === 'slab') && Array.isArray(e.cell) && e.cell[0] === i && e.cell[1] === j);
const center = (i) => i * CELL_MM + CELL_MM / 2;

/** Where an entity sits on the plan, in cells (floats), or null. */
export function entityPoint(e) {
  if (Array.isArray(e.cell)) return [e.cell[0] + 0.5, e.cell[1] + 0.5];
  if (Array.isArray(e.pos)) return [e.pos[0] / CELL_MM, e.pos[1] / CELL_MM];
  if (Array.isArray(e.wall) && Array.isArray(e.wall[0])) return [e.wall[0][0] + 0.5, e.wall[0][1] + 0.5];
  if (Array.isArray(e.cells) && Array.isArray(e.cells[0])) return [e.cells[0][0] + 0.5, e.cells[0][1] + 0.5];
  if (Array.isArray(e.bells) && e.bells[0] && Array.isArray(e.bells[0].cell)) return [e.bells[0].cell[0] + 0.5, e.bells[0].cell[1] + 0.5];
  return null;
}

/** The wall side an entity faces (torch, chest, wall inscription), or null. */
export function sideOf(e) {
  if (typeof e.wall === 'string') return e.wall;
  if (Array.isArray(e.wall) && typeof e.wall[1] === 'string') return e.wall[1];
  return null;
}

/** Every entity that occupies cell (i, j), in entity order. */
export function entitiesAt(doc, i, j) {
  return entities(doc).filter((e) => {
    if (Array.isArray(e.cells)) return e.cells.some((c) => Array.isArray(c) && c[0] === i && c[1] === j);
    const p = entityPoint(e);
    return p !== null && Math.floor(p[0]) === i && Math.floor(p[1]) === j;
  });
}

// ------------------------------------------------------------------ placing
const FLOOR_ITEM = (c) => isFloor(c) || c === CELL.BRIDGE;

/**
 * Place a palette entry at cell (i, j). Returns the new entity, or a string saying why not (shown to the author).
 * Marks are the one exception: they toggle a cell in the marks entity (the entity is created on the first click).
 */
export function place(doc, entry, i, j) {
  if (!inGrid(doc, i, j)) return 'Outside the grid.';
  const code = cellAt(doc, i, j), t = entry.type, list = entities(doc);
  const add = (e) => { list.push(e); return e; };
  switch (t) {
    case 'door':
      if (!isFloor(code)) return 'A door goes on a room or corridor cell.';
      if (doc.gdf.start?.cell?.[0] === i && doc.gdf.start?.cell?.[1] === j) return 'A door cannot stand on the start.';
      if (cellTaken(doc, i, j)) return 'That cell already holds a door or a slab.';
      return add({ id: freeId(doc, 'door'), type: 'door', cell: [i, j], style: 'stone', opens: 'interact' });
    case 'slab':
      if (code !== CELL.PLATE) return 'A slab goes on a pressure plate cell.';
      if (cellTaken(doc, i, j)) return 'That cell already holds a door or a slab.';
      return add({ id: freeId(doc, 'slab'), type: 'slab', cell: [i, j] });
    case 'vent': {
      if (code !== CELL.VENT) return 'A fire vent goes on fire-vent cells.';
      const taken = new Set(ofType(doc, 'vent').flatMap((v) => (v.cells ?? []).map((c) => c[1] * doc.w + c[0])));
      if (taken.has(j * doc.w + i)) return 'That vent cell already belongs to a vent.';
      const cells = [], seen = new Set([j * doc.w + i]), queue = [[i, j]];     // the connected unassigned vent cells
      while (queue.length && cells.length < 64) {
        const [ci, cj] = queue.shift(); cells.push([ci, cj]);
        for (const s of SIDES) {
          const ni = ci + D[s][0], nj = cj + D[s][1], k = nj * doc.w + ni;
          if (inGrid(doc, ni, nj) && cellAt(doc, ni, nj) === CELL.VENT && !taken.has(k) && !seen.has(k)) { seen.add(k); queue.push([ni, nj]); }
        }
      }
      return add({ id: freeId(doc, 'vent'), type: 'vent', cells, period: 108, phase: 0, warn: 27, fire: 33 });
    }
    case 'alcove': {
      if (code !== CELL.ALCOVE) return 'An alcove trap goes on an alcove cell.';
      if (ofType(doc, 'alcove').some((a) => Array.isArray(a.cell) && a.cell[0] === i && a.cell[1] === j)) return 'That alcove already has a trap.';
      const door = ofType(doc, 'door')[0];
      if (!door) return 'Place a door first: the alcove resets by sealing one.';
      return add({ id: freeId(doc, 'alcove'), type: 'alcove', cell: [i, j], kind: 'drown', door: door.id });
    }
    case 'item': {
      if (!FLOOR_ITEM(code)) return 'An item goes on a room, corridor or bridge cell.';
      const k = entry.kind, e = { id: freeId(doc, k === 'treasure' ? 'gem' : k === 'key' ? 'key' : k), type: 'item', kind: k, cell: [i, j] };
      if (k === 'treasure') e.value = 50;
      return add(e);
    }
    case 'chest': {
      if (!isFloor(code)) return 'A chest goes on a room or corridor cell.';
      const side = wallSide(doc, i, j);
      if (!side) return 'A chest stands against a wall: pick a cell next to one.';
      return add({ id: freeId(doc, 'chest'), type: 'chest', cell: [i, j], wall: side, style: 'plain', trap: 'none' });
    }
    case 'torch': {
      if (!isFloor(code)) return 'A torch goes on a room or corridor cell.';
      const side = wallSide(doc, i, j);
      if (!side) return 'A torch hangs on a wall: pick a cell next to one.';
      return add({ id: freeId(doc, 'torch'), type: 'torch', cell: [i, j], wall: side });
    }
    case 'inscription': {
      if (!isFloor(code)) return 'An inscription goes on a room or corridor cell, facing a wall.';
      const side = wallSide(doc, i, j);
      if (!side) return 'An inscription is cut into a wall: pick a cell next to one.';
      if (ofType(doc, 'inscription').length >= 24) return 'At most 24 inscriptions.';
      return add({ id: freeId(doc, 'text'), type: 'inscription', style: 'plaque', wall: [[i, j], side], title: 'Untitled', pages: ['Words worn almost smooth.'] });
    }
    case 'marks': {
      if (code === CELL.WALL) return 'Marks go on the floor.';
      let m = ofType(doc, 'marks')[0];
      if (!m) m = add({ id: freeId(doc, 'marks'), type: 'marks', cells: [] });
      const n = m.cells.findIndex((c) => c[0] === i && c[1] === j);
      if (n >= 0) { m.cells.splice(n, 1); if (m.cells.length === 0) removeEntity(doc, m.id); return m.cells.length === 0 ? 'Marks removed.' : m; }
      if (m.cells.length >= 256) return 'At most 256 marked cells.';
      m.cells.push([i, j]);
      return m;
    }
    case 'prop':
      return add({ id: freeId(doc, 'prop'), type: 'prop', kind: 'statue', pos: [center(i), center(j)], yaw: 0 });
    case 'decor':
      return add({ id: freeId(doc, 'decor'), type: 'decor', kind: 'bones', pos: [center(i), center(j)], yaw: 0 });
    default:
      return 'Not placeable yet.';
  }
}

export function removeEntity(doc, id) {
  const list = entities(doc), n = list.findIndex((e) => e.id === id);
  if (n < 0) return false;
  list.splice(n, 1);
  return true;
}

/** Move an entity to cell (i, j) if its type allows and the cell suits it. Returns true or a reason string. */
export function move(doc, e, i, j) {
  if (!inGrid(doc, i, j)) return 'Outside the grid.';
  const code = cellAt(doc, i, j);
  switch (e.type) {
    case 'door':
      if (!isFloor(code)) return 'A door goes on a room or corridor cell.';
      if (doc.gdf.start?.cell?.[0] === i && doc.gdf.start?.cell?.[1] === j) return 'A door cannot stand on the start.';
      if (cellTaken(doc, i, j)) return 'That cell already holds a door or a slab.';
      e.cell = [i, j]; return true;
    case 'slab':
      if (code !== CELL.PLATE || cellTaken(doc, i, j)) return 'A slab goes on a free pressure plate.';
      e.cell = [i, j]; return true;
    case 'alcove':
      if (code !== CELL.ALCOVE) return 'An alcove trap goes on an alcove cell.';
      e.cell = [i, j]; return true;
    case 'item':
      if ('in' in e) return 'Take it out of the chest first.';
      if (!FLOOR_ITEM(code)) return 'An item goes on a room, corridor or bridge cell.';
      e.cell = [i, j]; return true;
    case 'chest': case 'torch': {
      if (!isFloor(code)) return 'This goes on a room or corridor cell.';
      const side = wallSide(doc, i, j, e.wall);
      if (!side) return 'This stands against a wall: pick a cell next to one.';
      e.cell = [i, j]; e.wall = side; return true;
    }
    case 'inscription': {
      if ('wall' in e) {
        if (!isFloor(code)) return 'This goes on a room or corridor cell.';
        const side = wallSide(doc, i, j, sideOf(e));
        if (!side) return 'This is cut into a wall: pick a cell next to one.';
        e.wall = [[i, j], side]; return true;
      }
      if ('pos' in e) { e.pos = [center(i), center(j)]; return true; }
      return 'It is tied to a chest: move the chest.';
    }
    case 'prop': case 'decor':
      e.pos = [center(i), center(j)]; return true;
    default:
      return 'This cannot be moved; remove it and place it again.';
  }
}

// ------------------------------------------------------------------ the inspector: fields and their transitions
/** Field descriptors per type. t: select | int | text | bool | ref | pages. `show` hides a field that does not apply. */
export const FIELDS = {
  door: [
    { k: 'style', label: 'Style', t: 'select', o: DOOR_STYLES },
    { k: 'face', label: 'Face', t: 'select', o: MASK_FACES, show: (e) => e.style === 'mask' },
    { k: 'opens', label: 'Opens on', t: 'select', o: DOOR_OPENS },
    { k: 'key', label: 'Key', t: 'ref', refs: (doc) => ofType(doc, 'item').filter((x) => x.kind === 'key'), show: (e) => e.opens === 'key' },
  ],
  slab: [],
  vent: [
    { k: 'period', label: 'Period (ticks)', t: 'int', min: 2, max: 1800 }, { k: 'phase', label: 'Phase', t: 'int', min: 0, max: 1799 },
    { k: 'warn', label: 'Warning', t: 'int', min: 0, max: 1800 }, { k: 'fire', label: 'Fire', t: 'int', min: 1, max: 1800 },
  ],
  alcove: [
    { k: 'kind', label: 'Trap', t: 'select', o: ['drown', 'tip'] },
    { k: 'door', label: 'Resets by sealing', t: 'ref', refs: (doc) => ofType(doc, 'door') },
  ],
  item: [
    { k: 'kind', label: 'Kind', t: 'select', o: ITEM_KINDS },
    { k: 'value', label: 'Value', t: 'int', min: 1, max: 100000, show: (e) => e.kind === 'treasure' },
    { k: 'name', label: 'Name (optional)', t: 'text', max: 40, show: (e) => e.kind === 'treasure' || e.kind === 'key', optional: true },
    { k: 'in', label: 'Lies in', t: 'ref', refs: (doc) => ofType(doc, 'chest'), none: '(on the floor)', show: (e) => e.kind !== 'rubble' },
    { k: 'hidden', label: 'Hidden until revealed', t: 'bool', show: (e) => e.kind !== 'rubble' && !('in' in e) },
  ],
  chest: [
    { k: 'style', label: 'Style', t: 'select', o: ['plain', 'gilded'] }, { k: 'trap', label: 'Trap', t: 'select', o: ['none', 'needles'] },
    { k: 'wall', label: 'Against the wall to the', t: 'select', o: SIDES },
  ],
  torch: [{ k: 'wall', label: 'On the wall to the', t: 'select', o: SIDES }],
  inscription: [
    { k: 'style', label: 'Style', t: 'select', o: INSCRIPTION_STYLES },
    { k: 'where', label: 'Placed', t: 'select', o: ['wall', 'pos', 'on'] },
    { k: 'side', label: 'On the wall to the', t: 'select', o: SIDES, show: (e) => 'wall' in e },
    { k: 'on', label: 'Shown at chest', t: 'ref', refs: (doc) => ofType(doc, 'chest'), show: (e) => 'on' in e },
    { k: 'caption', label: 'Caption (optional)', t: 'text', max: 80, optional: true },
    { k: 'title', label: 'Title', t: 'text', max: 80 },
    { k: 'sig', label: 'Signed (optional)', t: 'text', max: 80, optional: true },
    { k: 'pages', label: 'Pages', t: 'pages' },
  ],
  marks: [],
  prop: [{ k: 'kind', label: 'Kind', t: 'select', o: PROP_KINDS }, { k: 'yaw', label: 'Facing (0-4095)', t: 'int', min: 0, max: 4095 }],
  decor: [{ k: 'kind', label: 'Kind', t: 'select', o: DECOR_KINDS }, { k: 'yaw', label: 'Facing (0-4095)', t: 'int', min: 0, max: 4095 }],
};

/** The current value of a field for the inspector (derived ones included). */
export function getField(e, k) {
  if (e.type === 'inscription') {
    if (k === 'where') return 'wall' in e ? 'wall' : 'pos' in e ? 'pos' : 'on';
    if (k === 'side') return sideOf(e);
  }
  if (e.type === 'item' && k === 'in') return 'in' in e ? e.in : '';
  if (e.type === 'item' && k === 'hidden') return e.hidden === true;
  return e[k];
}

const dropKey = (e, ...ks) => { for (const k of ks) delete e[k]; };

/**
 * Change one field, adding or dropping the keys that go with it (the loader wants exact key sets).
 * Returns true, or a string saying why not.
 */
export function setField(doc, e, k, v) {
  switch (e.type) {
    case 'door':
      if (k === 'style') {
        if (!DOOR_STYLES.includes(v)) return 'Unknown style.';
        e.style = v; if (v === 'mask') e.face ??= 'blank'; else dropKey(e, 'face'); return true;
      }
      if (k === 'face') { if (!MASK_FACES.includes(v)) return 'Unknown face.'; e.face = v; return true; }
      if (k === 'opens') {
        if (!DOOR_OPENS.includes(v)) return 'Unknown way of opening.';
        if (v === 'key') {
          const key = ofType(doc, 'item').find((x) => x.kind === 'key');
          if (!key) return 'Place a key item first: a key door needs one to name.';
          e.key = typeof e.key === 'string' && byId(doc, e.key)?.kind === 'key' ? e.key : key.id;
        } else dropKey(e, 'key');
        e.opens = v; return true;
      }
      if (k === 'key') { if (byId(doc, v)?.kind !== 'key') return 'That is not a key item.'; e.key = v; return true; }
      break;
    case 'alcove':
      if (k === 'kind') { if (v !== 'drown' && v !== 'tip') return 'Unknown trap.'; e.kind = v; return true; }
      if (k === 'door') { if (byId(doc, v)?.type !== 'door') return 'That is not a door.'; e.door = v; return true; }
      break;
    case 'vent':
      if (!Number.isInteger(v)) return 'A whole number, please.';
      if (['period', 'phase', 'warn', 'fire'].includes(k)) { e[k] = v; return true; }
      break;
    case 'item':
      if (k === 'kind') {
        if (!ITEM_KINDS.includes(v)) return 'Unknown kind.';
        e.kind = v;
        if (v === 'treasure') e.value = Number.isInteger(e.value) ? e.value : 50; else dropKey(e, 'value');
        if (v !== 'treasure' && v !== 'key') dropKey(e, 'name');
        if (v === 'rubble') {                                  // rubble lies on the floor, never hidden, never in a chest
          if ('in' in e) { const c = byId(doc, e.in); e.cell = c?.cell ? [...c.cell] : [1, 1]; dropKey(e, 'in'); }
          dropKey(e, 'hidden');
        }
        return true;
      }
      if (k === 'value') { if (!Number.isInteger(v) || v < 1 || v > 100000) return 'A value from 1 to 100000.'; e.value = v; return true; }
      if (k === 'name') { return setText(e, 'name', v, 40, true); }
      if (k === 'in') {
        if (v === '' || v === null) {
          if (!('in' in e)) return true;
          const c = byId(doc, e.in); e.cell = c?.cell ? [...c.cell] : [1, 1]; dropKey(e, 'in'); return true;
        }
        if (e.kind === 'rubble') return 'Rubble cannot lie in a chest.';
        if (byId(doc, v)?.type !== 'chest') return 'That is not a chest.';
        dropKey(e, 'cell', 'hidden'); e.in = v; return true;
      }
      if (k === 'hidden') {
        if (!v) { dropKey(e, 'hidden'); return true; }
        if (e.kind === 'rubble' || 'in' in e) return 'Only an item lying on the floor can be hidden (and not rubble).';
        e.hidden = true; return true;
      }
      break;
    case 'chest':
      if (k === 'style' && (v === 'plain' || v === 'gilded')) { e.style = v; return true; }
      if (k === 'trap' && (v === 'none' || v === 'needles')) { e.trap = v; return true; }
      if (k === 'wall') return setSide(doc, e, v);
      break;
    case 'torch':
      if (k === 'wall') return setSide(doc, e, v);
      break;
    case 'inscription':
      if (k === 'style') { if (!INSCRIPTION_STYLES.includes(v)) return 'Unknown style.'; e.style = v; return true; }
      if (k === 'title') return setText(e, 'title', v, 80, false);
      if (k === 'caption' || k === 'sig') return setText(e, k, v, 80, true);
      if (k === 'pages') return setPages(e, v);
      if (k === 'side') return setSide(doc, e, v);
      if (k === 'on') { if (byId(doc, v)?.type !== 'chest') return 'That is not a chest.'; e.on = v; return true; }
      if (k === 'where') return setPlacement(doc, e, v);
      break;
    case 'prop': case 'decor':
      if (k === 'kind') {
        if (!(e.type === 'prop' ? PROP_KINDS : DECOR_KINDS).includes(v)) return 'Unknown kind.';
        e.kind = v; if (v === 'sarcophagus') e.yaw = snapBox(e.yaw); return true;
      }
      if (k === 'yaw') {
        if (!Number.isInteger(v)) return 'A whole number, please.';
        e.yaw = e.kind === 'sarcophagus' ? snapBox(v) : Math.min(4095, Math.max(0, v)); return true;
      }
      break;
    default:
  }
  return 'That cannot be changed here.';
}
const snapBox = (yaw) => ((Math.round((Number.isInteger(yaw) ? yaw : 0) / 1024) * 1024) % 4096 + 4096) % 4096;

function setText(e, k, v, max, optional) {
  const s = String(v ?? '');
  if (s === '') { if (!optional) return 'This cannot be empty.'; dropKey(e, k); return true; }
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(s)) return 'No control characters, please.';
  if ([...s].length > max) return `At most ${max} characters.`;
  e[k] = s; return true;
}
function setPages(e, v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PAGES) return 'One to eight pages.';
  let total = 0;
  for (const p of v) {
    if (typeof p !== 'string' || p === '' || /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u.test(p)) return 'Each page needs some text, without control characters.';
    total += [...p].length;
  }
  if (total > 1500) return 'At most 1500 characters over all pages.';
  e.pages = v.slice(); return true;
}
function setSide(doc, e, side) {
  if (!SIDES.includes(side)) return 'Unknown side.';
  const [i, j] = Array.isArray(e.wall) ? e.wall[0] : e.cell, [di, dj] = D[side];
  if (!inGrid(doc, i + di, j + dj) || cellAt(doc, i + di, j + dj) !== CELL.WALL) return 'There is no wall on that side of the cell.';
  if (Array.isArray(e.wall)) e.wall = [[i, j], side]; else e.wall = side;
  return true;
}
/** An inscription has exactly one placement: wall, pos (mm) or on (a chest). Switch it, keeping the others out. */
function setPlacement(doc, e, where) {
  const cur = getField(e, 'where');
  if (where === cur) return true;
  let i = 1, j = 1;
  if ('wall' in e) [i, j] = e.wall[0];
  else if ('pos' in e) { i = Math.floor(e.pos[0] / CELL_MM); j = Math.floor(e.pos[1] / CELL_MM); }
  else { const c = byId(doc, e.on); if (c?.cell) [i, j] = c.cell; }
  if (where === 'wall') {
    const side = wallSide(doc, i, j);
    if (!side || !isFloor(cellAt(doc, i, j))) return 'There is no wall beside this spot; move it next to one first.';
    dropKey(e, 'pos', 'on'); e.wall = [[i, j], side]; return true;
  }
  if (where === 'pos') { dropKey(e, 'wall', 'on'); e.pos = [center(i), center(j)]; return true; }
  if (where === 'on') {
    const c = ofType(doc, 'chest')[0];
    if (!c) return 'Place a chest first: the text is shown when it is looked at.';
    dropKey(e, 'wall', 'pos'); e.on = c.id; return true;
  }
  return 'Unknown placement.';
}

// ------------------------------------------------------------------ waking eyes belong to a chamber
/** The waking-eyes entity of a zone, or undefined. */
export const eyesOf = (doc, zoneId) => ofType(doc, 'eyes').find((x) => x.zone === zoneId);
/** Turn a chamber's waking eyes on (with `wake` ticks, 18-1800) or off (null). */
export function setEyes(doc, zoneId, wake) {
  const cur = eyesOf(doc, zoneId);
  if (wake === null) { if (cur) removeEntity(doc, cur.id); return true; }
  if (!Number.isInteger(wake) || wake < 18 || wake > 1800) return 'Between 18 and 1800 ticks (0.6 to 60 s).';
  if (!(doc.gdf.zones ?? []).some((z) => z.id === zoneId)) return 'No such chamber.';
  if (cur) cur.wake = wake; else entities(doc).push({ id: freeId(doc, 'eyes'), type: 'eyes', zone: zoneId, wake });
  return true;
}
