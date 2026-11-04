// Differential fuzz cases (spec §6.4 point 2, §15): random small tombs and random input streams.
// A case is fully determined by its number, so any mismatch can be regenerated: node tests/fuzz/run.mjs --case N.
// Everything here is drawn from the sim's own xoshiro128** (R-RNG-*), never Math.random.
import * as Sim from '../../public/js/sim/sim.js';
import { rngSeed, rngBelow } from '../../public/js/sim/rng.js';
import { b64encode, rleEncode, CELL } from '../../public/js/sim/world.js';
import {
  GLOAMHOLLOW, trapRoom, toolRoom, bellRoom, linkRoom, mirrorRoom, maskRoom, foeRoom, propRoom, crowdRoom,
} from '../golden/generate.mjs';

const utf8 = (s) => new TextEncoder().encode(s);
const loads = (text) => { try { Sim.load(utf8(text)); return true; } catch { return false; } };
const MODES = ['delve', 'practice', 'ironman'];

/** Where an entity is, in mm (cell centre or pos), for steering; null for entities without a place. */
function placeOf(e) {
  if (Array.isArray(e.cell)) return [e.cell[0] * 2400 + 1200, e.cell[1] * 2400 + 1200];
  if (Array.isArray(e.pos)) return [e.pos[0], e.pos[1]];
  if (Array.isArray(e.cells)) return [e.cells[0][0] * 2400 + 1200, e.cells[0][1] * 2400 + 1200];
  return null;
}
/** The yaw (R-TRIG-1: 0 north, counter-clockwise) that faces from (x, z) towards (tx, tz). Test-side float, then a whole unit. */
const yawTo = (x, z, tx, tz) => ((Math.round(Math.atan2(-(tx - x), -(tz - z)) * 4096 / (2 * Math.PI)) % 4096) + 4096) % 4096;

/**
 * Inputs (R-INPUT-1) chosen while the case plays, from the case's own RNG and the state so far: random runs
 * (any move, yaw, pitch, buttons, target), and seeking runs that walk towards an entity and press interact on
 * it, so items, doors, bells, mirrors, chests and braziers actually get used. The chosen inputs are recorded
 * and replayed verbatim by the other core.
 */
export function makeDriver(r, gdf) {
  const ents = JSON.parse(gdf).entities ?? [], places = ents.map(placeOf);
  const targets = ents.map((_, n) => n + 1).filter((n) => places[n - 1] !== null);
  let seek = null;
  return (st) => {
    const p = st.player;
    if (st.dead !== null) return [1 + rngBelow(r, 60), { move: [0, 0], yaw: p.yaw, pitch: 0, buttons: rngBelow(r, 3) === 0 ? Sim.BTN.rise : 0, target: rngBelow(r, 3) }];
    if (seek === null && targets.length && rngBelow(r, 2) === 0) seek = { n: targets[rngBelow(r, targets.length)], left: 30 + rngBelow(r, 200) };
    if (seek !== null) {
      const [tx, tz] = places[seek.n - 1], d = Math.hypot(tx - p.x, tz - p.z), yaw = yawTo(p.x, p.z, tx, tz);
      seek.left -= 1;
      if (d < 1600 || seek.left <= 0) { const n = seek.n; seek = null; return [1, { move: [0, 0], yaw, pitch: 0, buttons: Sim.BTN.interact, target: n }]; }
      // Swing at anything awake that comes close on the way (R-STRIKE-1), facing it.
      const near = [...st.foes.filter((f) => f.st !== 'dead' && f.st !== 'dormant'), ...(st.boss && st.boss.st !== 'dead' && st.boss.st !== 'asleep' ? [st.boss] : [])]
        .find((f) => Math.hypot(f.x - p.x, f.z - p.z) < 2300);
      if (near && rngBelow(r, 3) > 0) return [1 + rngBelow(r, 4), { move: [0, 0], yaw: yawTo(p.x, p.z, near.x, near.z), pitch: 0, buttons: Sim.BTN.strike, target: 0 }];
      return [1 + rngBelow(r, 6), { move: [127, rngBelow(r, 41) - 20], yaw, pitch: 0, buttons: rngBelow(r, 4) === 0 ? Sim.BTN.run : 0, target: 0 }];
    }
    const n = 1 + rngBelow(r, 40), yaw = (p.yaw + rngBelow(r, 1025) - 512 + 4096) % 4096;
    const speed = rngBelow(r, 3) === 0 ? 127 : 1 + rngBelow(r, 127);
    const move = rngBelow(r, 5) === 0 ? [0, 0] : [rngBelow(r, 2 * speed + 1) - speed, rngBelow(r, 2 * speed + 1) - speed];
    const pick = rngBelow(r, 10), buttons = pick < 4 ? 0 : pick < 8 ? 1 << rngBelow(r, 8) : rngBelow(r, 65536);
    return [n, { move, yaw, pitch: rngBelow(r, 255) - 127, buttons, target: rngBelow(r, ents.length + 3) }];
  };
}

/** A random tomb: a walled grid with random cell codes, zones, and entities kept only if the tomb still loads. */
function randomTomb(r) {
  const below = (n) => rngBelow(r, n), chance = (p) => below(100) < p, pick = (a) => (a.length ? a[below(a.length)] : undefined);
  const w = 6 + below(15), h = 6 + below(15), cells = new Uint8Array(w * h);
  const at = (i, j) => cells[j * w + i];
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const x = below(100);
    cells[j * w + i] = x < 8 ? CELL.WALL : x < 18 ? CELL.CORR : x < 24 ? CELL.PLATE : x < 28 ? CELL.HPIT : x < 31 ? CELL.VOID
      : x < 34 ? CELL.BRIDGE : x < 38 ? CELL.VENT : x < 40 ? CELL.ALCOVE : CELL.ROOM;
  }
  const si = 1 + below(w - 2), sj = 1 + below(h - 2); cells[sj * w + si] = CELL.ROOM;
  const g = { gdf: 1, bestiary: 1, grid: { w, h, cells: '' }, start: { cell: [si, sj] }, zones: [], entities: [], links: [] };
  const floor = () => { for (let t = 0; t < 50; t++) { const i = 1 + below(w - 2), j = 1 + below(h - 2); if (at(i, j) === CELL.ROOM || at(i, j) === CELL.CORR) return [i, j]; } return [si, sj]; };
  const text = () => { g.grid.cells = b64encode(rleEncode(cells)); return JSON.stringify(g); };
  const keep = (add, undo) => { add(); if (!loads(text())) undo(); };
  // Vents: every vent cell must belong to exactly one vent (R-VENT-1), so they are made before anything else.
  const ventCells = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (at(i, j) === CELL.VENT) ventCells.push([i, j]);
  for (let v = 0; v * 64 < ventCells.length; v++) {
    const period = 10 + below(200), fire = 1 + below(Math.floor(period * 3 / 5)), warn = below(period - fire + 1);
    g.entities.push({ id: 'v' + v, type: 'vent', cells: ventCells.slice(v * 64, v * 64 + 64), period, phase: below(period), warn, fire });
  }
  // Zones: up to 4 non-overlapping rectangles, some with checkpoints.
  for (let z = 0, tries = 0; z < 1 + below(4) && tries < 30; tries++) {
    const zw = 1 + below(Math.max(1, w - 2)), zh = 1 + below(Math.max(1, h - 2)), x = below(w - zw + 1), y = below(h - zh + 1);
    const zone = { id: 'z' + z, name: 'Zone ' + z, rects: [[x, y, zw, zh]], ceil: 3000 + below(3501) };
    if (chance(60)) { const c = [x + below(zw), y + below(zh)]; zone.checkpoint = { cell: c, yaw: below(4096), ...(chance(20) ? { reach: 'effect' } : {}) }; }
    g.zones.push(zone);
    if (loads(text())) z++; else g.zones.pop();
  }
  const zoneIds = () => g.zones.map((z) => z.id);
  const ents = g.entities, add = (e) => keep(() => ents.push(e), () => ents.pop());
  let k = 0; const id = (p) => p + (k++);
  // Doors, slabs, props, items.
  const doorIds = [], itemIds = [], keyIds = [];
  for (let n = below(6); n > 0; n--) {
    const style = pick(['stone', 'grate', 'mask']), opens = pick(['interact', 'trigger', 'key', 'interact']);
    const e = { id: id('d'), type: 'door', cell: floor(), style, opens };
    if (opens === 'key') { const kid = id('k'); keyIds.push(kid); e.key = kid; }
    if (style === 'mask') e.face = pick(['weep', 'laugh', 'sleep', 'blank']);
    if (opens === 'key') { const before = ents.length; ents.push({ id: e.key, type: 'item', kind: 'key', cell: floor() }); add(e); if (ents.length === before + 1) ents.pop(); }
    else add(e);
    if (ents.at(-1)?.id === e.id) doorIds.push(e.id);
  }
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) if (at(i, j) === CELL.PLATE && chance(25)) add({ id: id('s'), type: 'slab', cell: [i, j] });
  for (let n = below(6); n > 0; n--) {
    const kind = pick(['statue', 'stele', 'tree', 'post', 'plinth', 'lectern', 'sarcophagus']);
    add({ id: id('p'), type: 'prop', kind, pos: [below(w * 2400), below(h * 2400)], yaw: kind === 'sarcophagus' ? 1024 * below(4) : below(4096) });
  }
  for (let n = below(8); n > 0; n--) {
    const kind = pick(['flask', 'rubble', 'treasure', 'treasure']), e = { id: id('i'), type: 'item', kind, cell: floor() };
    if (kind === 'treasure') { e.value = 1 + below(1000); if (chance(30)) e.hidden = true; }
    add(e); if (ents.at(-1)?.id === e.id) itemIds.push(e.id);
  }
  // Puzzles: eyes, bells, the lamp hook with mirrors and a crystal, chests, alcoves, braziers.
  if (g.zones.length && chance(40)) add({ id: id('e'), type: 'eyes', zone: pick(zoneIds()), wake: 18 + below(120) });
  if (chance(50)) {
    // A bell set and its bells go in together: a bell outside a set is rejected (R-BELL-2).
    const bells = Array.from({ length: 2 + below(3) }, () => ({ id: id('b'), type: 'bell', cell: floor(), size: 1 + below(3), patina: below(3), note: 100 + below(800) }));
    const order = bells.map((_, n) => n); for (let n = order.length - 1; n > 0; n--) { const m = below(n + 1); [order[n], order[m]] = [order[m], order[n]]; }
    const set = { id: id('bs'), type: 'bellSet', bells: bells.map((b) => b.id), order };
    keep(() => ents.push(...bells, set), () => ents.splice(ents.length - bells.length - 1));
  }
  let crystal = null, chest = null;
  if (chance(40)) {
    add({ id: id('h'), type: 'lampHook', cell: floor(), dir: pick(['n', 'e', 's', 'w']) });
    for (let n = 1 + below(4); n > 0; n--) add({ id: id('m'), type: 'mirror', cell: floor(), start: pick(['/', '\\']) });
    for (let t = 0; t < 20 && !crystal; t++) {
      const [i, j] = floor(), D = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }, side = pick(Object.keys(D).filter((q) => at(i + D[q][0], j + D[q][1]) === CELL.WALL));
      if (!side) continue;
      const c = { id: id('c'), type: 'crystal', cell: [i, j], wall: side }; add(c); if (ents.at(-1)?.id === c.id) crystal = c.id;
    }
  }
  for (let n = below(3); n > 0; n--) {
    const c = { id: id('ch'), type: 'chest', cell: floor(), wall: pick(['n', 'e', 's', 'w']), style: pick(['plain', 'gilded']), trap: pick(['none', 'needles']) };
    add(c);
    if (ents.at(-1)?.id === c.id) { chest = c.id; for (let m = below(3); m > 0; m--) add({ id: id('ci'), type: 'item', kind: pick(['flask', 'treasure', 'key']), in: c.id, ...(chance(50) ? {} : {}) }); }
  }
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) if (at(i, j) === CELL.ALCOVE && doorIds.length && chance(60)) add({ id: id('a'), type: 'alcove', cell: [i, j], kind: pick(['drown', 'tip']), door: pick(doorIds) });
  for (let n = below(4); n > 0; n--) add({ id: id('br'), type: 'brazier', cell: floor(), lit: chance(30) });
  // Foes and at most one boss.
  const groups = [];
  for (let n = below(7); n > 0; n--) {
    const e = { id: id('f'), type: 'foe', kind: pick(['warden', 'crawler']), cell: floor(), start: pick(['asleep', 'idle', 'hunting', 'dormant']) };
    if (chance(70)) { e.group = pick(['g1', 'g2', 'g3']); }
    add(e); if (ents.at(-1)?.id === e.id && e.group && !groups.includes(e.group)) groups.push(e.group);
  }
  let boss = null;
  if (g.zones.length && chance(30)) {
    const z = pick(g.zones), [x, y, zw, zh] = z.rects[0];
    const b = { id: id('boss'), type: 'boss', kind: 'eater', pos: [x * 2400 + below(zw * 2400 + 1), y * 2400 + below(zh * 2400 + 1)], zone: z.id };
    add(b); if (ents.at(-1)?.id === b.id) boss = b.id;
  }
  if (chance(50)) { const ex = { cell: floor(), ...(chance(50) && itemIds.length ? { requires: pick(itemIds) } : boss && chance(50) ? { requires: 'bossDefeated' } : {}) }; keep(() => { g.exit = ex; }, () => { delete g.exit; }); }
  // Dressing (R-DRESS-*), inert but part of the world id.
  if (chance(30)) add({ id: id('t'), type: 'inscription', style: 'book', title: 'A note', pages: ['Fuzz ' + below(1000)], pos: [below(w * 2400), below(h * 2400)] });
  // Links over what exists (R-LINK-*), each kept only if it compiles.
  const brz = ents.filter((e) => e.type === 'brazier').map((e) => e.id), bs = ents.find((e) => e.type === 'bellSet')?.id;
  const evs = () => {
    const opts = [
      () => ({ interact: pick([...doorIds, ...itemIds]) }), () => ({ itemTaken: pick(itemIds) }),
      () => ({ enterZone: pick(zoneIds()) }), () => ({ leaveZone: pick(zoneIds()) }), () => ({ bellsWrong: bs }),
      () => ({ foesDefeated: pick(groups) }), () => ({ bossDefeated: true }), () => ({ linkFired: 1 + below(8) }),
    ];
    return pick(opts)();
  };
  const conds = () => pick([
    () => ({ doorOpen: pick(doorIds) }), () => ({ inZone: pick(zoneIds()) }), () => ({ hasItem: pick(itemIds) }), () => ({ lanternHooded: true }),
    () => ({ bellsSolved: bs }), () => ({ beamHits: crystal }), () => ({ lightLit: pick(brz) }), () => ({ foesAlive: pick(groups) }), () => ({ lanternHung: true }), () => ({ bossAwake: true }),
  ])();
  const effect = () => pick([
    () => ({ openDoor: pick(doorIds) }), () => ({ closeDoor: pick(doorIds) }), () => ({ sealDoor: pick(doorIds) }), () => ({ damage: 1 + below(40) }),
    () => ({ message: 'm' + below(100) }), () => ({ reveal: pick(itemIds) }), () => ({ hide: pick(itemIds) }), () => ({ spawnFoes: pick(groups) }),
    () => ({ lightOn: pick(brz) }), () => ({ lightOff: pick(brz) }), () => ({ wakeBoss: boss }), () => ({ setCheckpoint: pick(zoneIds()) }),
  ])();
  for (let n = 1; n <= 8; n++) {
    const kind = below(4);
    const when = kind === 0 ? evs() : kind === 1 ? conds() : kind === 2 ? { all: [conds(), conds()], within: 1 + below(200) } : { sequence: [evs(), evs()], ...(chance(50) ? { within: 1 + below(300) } : {}) };
    const link = { id: n, when, do: [effect(), ...(chance(40) ? [effect()] : [])], ...(chance(50) ? { repeat: true } : {}), ...(chance(40) ? { delay: below(60) } : {}) };
    if (kind === 1 && chance(40)) link.undo = [effect()];
    keep(() => g.links.push(link), () => g.links.pop());
  }
  void chest;
  return text();
}

/** Gloamhollow with the start moved to a random floor cell (start.cell must be room or corridor, R-WORLD-2). */
function gloamhollowFrom(r) {
  const g = JSON.parse(GLOAMHOLLOW);
  for (let t = 0; t < 100; t++) {
    g.start = { cell: [1 + rngBelow(r, 42), 1 + rngBelow(r, 61)] };
    const s = JSON.stringify(g);
    if (loads(s)) return s;
  }
  return GLOAMHOLLOW;
}

const BASES = [
  (r) => randomTomb(r), (r) => randomTomb(r), (r) => randomTomb(r), (r) => randomTomb(r),
  (r) => gloamhollowFrom(r), (r) => gloamhollowFrom(r), (r) => linkRoom(1 + rngBelow(r, 65536) * 16384 + rngBelow(r, 16384)),
  () => trapRoom(), () => toolRoom([2, 4]), () => toolRoom([10, 4], false), () => bellRoom(), () => mirrorRoom(),
  () => maskRoom(), () => maskRoom([6, 5], true), () => foeRoom(), () => crowdRoom(), () => propRoom(),
];

/** Case n: { n, gdf (exact text, R-GDF-0), seed, mode, ticks, driver } — the driver picks inputs while it plays. */
export function makeCase(n) {
  const r = rngSeed((n * 2654435761) >>> 0);
  const gdf = BASES[rngBelow(r, BASES.length)](r);
  const seed = rngBelow(r, 65536) * 65536 + rngBelow(r, 65536), mode = MODES[rngBelow(r, MODES.length)], ticks = 200 + rngBelow(r, 1300);
  return { n, gdf, seed, mode, ticks, driver: makeDriver(r, gdf) };
}
