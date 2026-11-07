// The M2 exit test (spec §16): Gloamhollow can be rebuilt in the editor, and the four §4.3.6 examples work.
// "Rebuilt" means: starting from an empty tomb and using only the builder's own operations (paint, zones, the palette,
// the inspector's field setter, ids, the wiring model), the result is the same tomb as dungeons/gloamhollow.gdf.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore, ROOT } from './lib/load.mjs';
import * as Sim from '../../public/js/sim/sim.js';
import { canonical } from '../../public/js/sim/canon.js';
import { rleDecode, b64decode } from '../../public/js/sim/world.js';
import * as M from '../../public/js/build/model.js';
import * as E from '../../public/js/build/entities.js';
import * as L from '../../public/js/build/links.js';
import { renameEntity, renameLink, renameZone as import_renameZone } from '../../public/js/build/rename.js';
import { validate } from '../../public/js/build/validate.js';

loadCore();
E.setBestiary(JSON.parse(readFileSync(ROOT + 'public/js/sim/data/bestiary.v1.json', 'utf8')));
const SRC = JSON.parse(readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', 'utf8'));
const must = (r, what) => assert.equal(r, true, `${what}: ${r}`);
const entry = (id) => E.PALETTE.find((p) => p.id === id);

// ------------------------------------------------------------------ Gloamhollow, rebuilt
const anyFloor = (doc) => { for (let k = 0; k < doc.cells.length; k++) if (M.isFloor(doc.cells[k])) return [k % doc.w, Math.floor(k / doc.w)]; };
function placeFor(doc, e) {
  const at = (cell) => [cell[0], cell[1]];
  switch (e.type) {
    case 'door': return E.place(doc, entry('door'), ...at(e.cell));
    case 'slab': return E.place(doc, entry('slab'), ...at(e.cell));
    case 'vent': return E.place(doc, entry('vent'), ...at(e.cells[0]));
    case 'alcove': return E.place(doc, entry('alcove'), ...at(e.cell));
    case 'item': return E.place(doc, entry(e.kind), ...(e.cell ?? anyFloor(doc)).slice(0, 2));   // one in a chest is set down anywhere first
    case 'chest': return E.place(doc, entry('chest'), ...at(e.cell));
    case 'torch': return E.place(doc, entry('torch'), ...at(e.cell));
    case 'brazier': return E.place(doc, entry('brazier'), ...at(e.cell));
    case 'lampHook': return E.place(doc, entry('lampHook'), ...at(e.cell));
    case 'mirror': return E.place(doc, entry('mirror'), ...at(e.cell));
    case 'crystal': return E.place(doc, entry('crystal'), ...at(e.cell));
    case 'foe': return E.place(doc, { ...entry('foe'), kind: e.kind }, ...at(e.cell));
    case 'boss': return E.place(doc, entry('boss'), Math.floor(e.pos[0] / 2400), Math.floor(e.pos[1] / 2400));
    case 'prop': return E.place(doc, entry('prop'), Math.floor(e.pos[0] / 2400), Math.floor(e.pos[1] / 2400));
    case 'decor': return E.place(doc, entry('decor'), Math.floor(e.pos[0] / 2400), Math.floor(e.pos[1] / 2400));
    case 'inscription': {
      const cell = e.wall ? e.wall[0] : e.pos ? [Math.floor(e.pos[0] / 2400), Math.floor(e.pos[1] / 2400)] : null;
      if (cell && E.wallSide(doc, ...cell)) return E.place(doc, entry('inscription'), ...cell);
      // one that is not on a wall: borrow a spot beside a wall anywhere, then move it with its placement field
      for (let j = 1; j < doc.h - 1; j++) for (let i = 1; i < doc.w - 1; i++) if (M.isFloor(M.cellAt(doc, i, j)) && E.wallSide(doc, i, j)) return E.place(doc, entry('inscription'), i, j);
      return 'no spot';
    }
    case 'marks': { let m; for (const c of e.cells) m = E.place(doc, entry('marks'), ...c); return m; }
    default: return `unhandled ${e.type}`;
  }
}

function rebuildEntity(doc, e, byOld) {
  if (e.type === 'bellSet') return;                          // made with its bells
  if (e.type === 'eyes') { must(E.setEyes(doc, e.zone, e.wake), 'eyes'); byOld.set(e.id, E.entities(doc).find((x) => x.type === 'eyes' && x.zone === e.zone)); return; }
  let made;
  if (e.type === 'bell') {
    const set = SRC.entities.find((s) => s.type === 'bellSet' && s.bells.includes(e.id));
    const first = byOld.get(set.bells[0]);
    made = E.place(doc, { ...entry('bell'), selected: first?.id }, ...e.cell);
  } else made = placeFor(doc, e);
  assert.equal(typeof made, 'object', `${e.id}: ${made}`);
  byOld.set(e.id, made);
  const set = (k, v) => must(E.setField(doc, made, k, v), `${e.id}.${k}`);
  switch (e.type) {
    case 'door': set('style', e.style); if (e.face) set('face', e.face); if (e.opens !== 'key') set('opens', e.opens); break;   // a key door waits for its key
    case 'vent': for (const k of ['period', 'phase', 'warn', 'fire']) set(k, e[k]); assert.deepEqual(made.cells, e.cells, 'the vent took its own cells'); break;
    case 'alcove': set('kind', e.kind); break;
    case 'item': set('kind', e.kind); if (e.value !== undefined) set('value', e.value); if (e.hidden) set('hidden', true); break;
    case 'chest': set('style', e.style); set('trap', e.trap); set('wall', e.wall); break;
    case 'torch': set('wall', e.wall); break;
    case 'brazier': set('lit', e.lit); break;
    case 'lampHook': set('dir', e.dir); break;
    case 'mirror': set('start', e.start); break;
    case 'crystal': set('wall', e.wall); break;
    case 'foe': set('start', e.start); set('group', e.group); break;
    case 'boss': set('kind', e.kind); set('zone', e.zone); set('posX', e.pos[0]); set('posZ', e.pos[1]); break;
    case 'prop': case 'decor': set('kind', e.kind); set('posX', e.pos[0]); set('posZ', e.pos[1]); set('yaw', e.yaw); break;
    case 'bell': set('size', e.size); set('patina', e.patina); set('note', e.note); break;
    case 'inscription':
      set('style', e.style); set('title', e.title); if (e.caption) set('caption', e.caption); if (e.sig) set('sig', e.sig); set('pages', e.pages);
      if (e.wall) set('side', e.wall[1]);
      else if (e.pos) { set('where', 'pos'); set('posX', e.pos[0]); set('posZ', e.pos[1]); }
      break;
    default:
  }
}

function rebuildLinks(doc) {
  const build = (link, path, term) => {
    const g = L.gateKey(term);
    if (!g) { const key = Object.keys(term)[0]; must(L.setTrigger(doc, link, path, key, link.id), 'trigger ' + key); must(L.setArg(doc, link, path, term[key]), 'arg ' + key); return; }
    must(L.setGate(doc, link, path, g, link.id), 'gate ' + g);
    const kids = L.children(term)[1];
    while (L.children(L.termAt(link, path))[1].length < kids.length) must(L.addChild(doc, link, path, link.id), 'child');
    kids.forEach((k, i) => build(link, [...path, i], k));
    if (term.within !== undefined) must(L.setGateOption(link, path, 'within', term.within), 'within');
    if (term.k !== undefined) must(L.setGateOption(link, path, 'k', term.k), 'k');
    if (term.strict) must(L.setGateOption(link, path, 'strict', true), 'strict');
    if (term.onWrong) effects(link, 'onWrong', path, term.onWrong);
  };
  const effects = (link, which, path, list) => {
    const have = () => (L.listOf(link, which, path) ?? []).length;
    list.forEach((fx, i) => {
      if (i >= have()) must(L.addEffect(doc, link, which, path), 'add effect');
      const key = Object.keys(fx)[0];
      must(L.setEffect(doc, link, which, path, i, key), 'effect ' + key); must(L.setEffectArg(link, which, path, i, fx[key]), 'effect arg ' + key);
    });
  };
  for (const src of SRC.links) {
    const link = L.addLink(doc);
    assert.equal(typeof link, 'object', String(link));
    build(link, [], src.when);
    effects(link, 'do', [], src.do);
    if (src.undo) { must(L.setUndo(doc, link, true), 'undo'); effects(link, 'undo', [], src.undo); }
    must(L.setRepeat(link, src.repeat === true), 'repeat'); must(L.setDelay(link, src.delay ?? 0), 'delay');
  }
  // the links were numbered 1, 2, 3...; Gloamhollow's own numbers (some have gaps) go back, highest first so none collides
  const mine = [...doc.gdf.links];
  mine.forEach((l, n) => must(renameLink(doc, l.id, 40000 + n), 'park link ' + l.id));
  mine.forEach((l, n) => must(renameLink(doc, l.id, SRC.links[n].id), 'link ' + SRC.links[n].id));
}

test('Gloamhollow can be rebuilt in the editor, piece by piece, and comes out the same', () => {
  const w = SRC.grid.w, h = SRC.grid.h, grid = rleDecode(b64decode(SRC.grid.cells), w * h);
  const doc = M.newTomb(w, h);
  doc.gdf.zones = []; doc.gdf.entities = []; doc.gdf.links = []; delete doc.gdf.exit;
  M.setTitle(doc, SRC.meta.title);
  // 1. the plan, cell by cell
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) M.paint(doc, i, j, grid[j * w + i]);
  assert.deepEqual([...doc.cells], [...grid]);
  // 2. the chambers, in order, then their look and checkpoints
  for (const z of SRC.zones) {
    const [x, y, zw, zh] = z.rects[0];
    const made = M.addZone(doc, x, y, x + zw - 1, y + zh - 1);
    assert.ok(made, z.id);
    must(renameZoneTo(doc, made.id, z.id), 'zone id');
    M.updateZone(doc, z.id, { name: z.name, ceil: z.ceil });
    if (z.tint) must(M.updateZone(doc, z.id, { tint: z.tint }), 'tint');
    if (z.walls) must(M.updateZone(doc, z.id, { walls: z.walls }), 'walls');
    if (z.checkpoint) { must(M.updateZone(doc, z.id, { checkpoint: { cell: z.checkpoint.cell, yaw: z.checkpoint.yaw } }), 'checkpoint'); if (z.checkpoint.reach) must(M.updateZone(doc, z.id, { reach: z.checkpoint.reach }), 'reach'); }
  }
  must(M.setStart(doc, ...SRC.start.cell), 'start');
  must(M.setExit(doc, ...SRC.exit.cell), 'exit');
  // 3. the things, doors first (an alcove names one, and so does a key door); entity order is put right at the end
  const byOld = new Map();
  const rank = (e) => (e.type === 'door' ? 0 : e.type === 'chest' ? 1 : 2);
  for (const e of [...SRC.entities].sort((a, b) => rank(a) - rank(b))) rebuildEntity(doc, e, byOld);
  // second pass: what points at something that did not exist yet
  for (const e of SRC.entities) {
    const made = byOld.get(e.id);
    if (!made) continue;
    if (e.type === 'door' && e.opens === 'key') { /* its key may not be named yet */ }
  }
  // the ids, so references and links can name them: temporary names first (no clashes), then the real ones
  const order = SRC.entities.filter((e) => byOld.has(e.id));
  order.forEach((e, n) => must(renameEntity(doc, byOld.get(e.id).id, `tmp${n}`), 'tmp id'));
  order.forEach((e, n) => must(renameEntity(doc, `tmp${n}`, e.id), 'id ' + e.id));
  // references that need both ends to exist: key doors, alcoves, chests holding items, inscriptions at chests, bell sets
  for (const e of SRC.entities) {
    const made = E.byId(doc, e.id);
    if (e.type === 'door' && e.opens === 'key') { must(E.setField(doc, made, 'opens', 'key'), 'opens key'); must(E.setField(doc, made, 'key', e.key), 'key'); }
    if (e.type === 'alcove') must(E.setField(doc, made, 'door', e.door), 'alcove door');
    if (e.type === 'item' && e.in) must(E.setField(doc, made, 'in', e.in), 'item in');
    if (e.type === 'inscription' && e.on) must(E.setField(doc, made, 'where', 'on'), 'where on'), must(E.setField(doc, made, 'on', e.on), 'on');
    if (e.type === 'bellSet') { const set = E.byId(doc, E.entities(doc).find((x) => x.type === 'bellSet' && x.bells.includes(e.bells[0])).id); must(renameEntity(doc, set.id, e.id), 'set id'); must(E.setField(doc, set, 'order', e.order), 'order'); }
    if (e.type === 'foe' && e.group === undefined) { /* ungrouped foes would have no group */ }
  }
  // the exit's requirement, the wiring, and the order things were listed in
  must(M.setExitRequires(doc, SRC.exit.requires), 'exit requires');
  rebuildLinks(doc);
  const index = new Map(SRC.entities.map((e, n) => [e.id, n]));
  doc.gdf.entities.sort((a, b) => index.get(a.id) - index.get(b.id));
  // the same tomb
  const v = validate(doc);
  assert.equal(v.ok, true, v.error);
  const got = JSON.parse(M.toText(doc));
  assert.equal(canonical(got.zones), canonical(SRC.zones), 'zones');
  assert.equal(canonical(got.start), canonical(SRC.start)); assert.equal(canonical(got.exit), canonical(SRC.exit));
  const byId = (list) => Object.fromEntries(list.map((e) => [e.id, e]));
  const mine = byId(got.entities), theirs = byId(SRC.entities);
  for (const id of Object.keys(theirs)) assert.equal(canonical(mine[id]), canonical(theirs[id]), 'entity ' + id);
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort());
  assert.equal(canonical(got.entities), canonical(SRC.entities), 'entities in order');
  // the shipped file lists its links out of numeric order (17 before 4); the builder keeps them numbered, as the core visits them
  const sorted = { ...SRC, links: [...SRC.links].sort((a, b) => a.id - b.id) };
  assert.equal(canonical(got.links), canonical(sorted.links), 'links');
  assert.equal(canonical(got), canonical(sorted), 'the whole tomb');
});
function renameZoneTo(doc, from, to) { return import_renameZone(doc, from, to); }

// ------------------------------------------------------------------ the four examples of spec §4.3.6, built with the editor's operations and played in the sim
const I = (move = [0, 0], yaw = 0, buttons = 0, pitch = 0, target = 0) => ({ move, yaw, pitch, buttons, target });
const BTN = Sim.BTN;
const num = (doc, id) => 1 + E.entities(doc).findIndex((e) => e.id === id);
const ok = (doc) => { const v = validate(doc); assert.equal(v.ok, true, v.error); };
function game(doc, mode = 'practice') {
  ok(doc);
  const world = Sim.load(M.toBytes(doc)), st = Sim.init(world, 7, mode), events = [];
  const run = (n, inp = I()) => { for (let k = 0; k < n; k++) events.push(...Sim.step(world, st, inp)); };
  const use = (id, yaw = 0) => run(1, I([0, 0], yaw, BTN.interact, 0, num(doc, id)));
  const open = (n) => st.doors[n].open;
  const at = (x, z) => { st.player.x = x; st.player.z = z; run(2); };      // stand somewhere (a test shortcut, not an editor operation)
  return { world, st, events, run, use, open, at };
}
/** Put a thing down with the palette and set its fields; fails the test with the reason otherwise. */
function put(doc, id, i, j, fields = {}, rename = null) {
  const e = E.place(doc, entry(id), i, j);
  assert.equal(typeof e, 'object', `${id}: ${e}`);
  for (const [k, v] of Object.entries(fields)) must(E.setField(doc, e, k, v), `${id}.${k}`);
  if (rename) must(renameEntity(doc, e.id, rename), 'rename ' + rename);
  return E.byId(doc, rename ?? e.id);
}
function link(doc, when, doList, { undo, repeat, delay } = {}) {
  const l = L.addLink(doc);
  assert.equal(typeof l, 'object', String(l));
  l.when = when; l.do = doList;
  if (undo) l.undo = undo; if (repeat) l.repeat = true; if (delay) l.delay = delay;
  return l;
}

test('example 1, out of reach: ALL(buttonPressed(near), pebbleHit(far)) within 120 opens the grate', () => {
  const doc = M.newTomb(6, 7);
  M.paintRect(doc, 3, 1, 3, 5, 5);                                   // a chasm between the player and the far wall
  M.clearExit(doc);
  put(doc, 'pedestal', 2, 2, { glyph: 'moon', pressedBy: 'hand' }, 'near');
  put(doc, 'button', 4, 3, { glyph: 'eye', pressedBy: 'pebble', behaviour: 'latch' }, 'far');
  put(doc, 'door', 1, 5, { style: 'grate', opens: 'trigger' }, 'grate');
  const l = link(doc, { all: [{ buttonPressed: 'near' }, { pebbleHit: 'far' }], within: 120 }, [{ openDoor: 'grate' }, { message: 'The grate rises.' }]);
  assert.equal(L.describeLink(l).includes('pebble hits'), true);
  // in time: press by hand, throw east across the chasm within 4 s
  let g = game(doc);
  g.at(2 * 2400 + 1200, 2 * 2400 + 1200 + 1700);                   // just south of the pedestal
  g.use('near'); g.run(30);
  g.run(1, I([0, 0], 3072, BTN.pebble, 0)); g.run(40);
  assert.equal(g.st.buttons[1].down, true, 'the far button was hit by the pebble');
  assert.equal(g.open(0), true, 'the grate is open');
  // too late: 5 seconds between the press and the pebble
  g = game(doc);
  g.at(2 * 2400 + 1200, 2 * 2400 + 1200 + 1700);
  g.use('near'); g.run(150);
  g.run(1, I([0, 0], 3072, BTN.pebble, 0)); g.run(40);
  assert.equal(g.st.buttons[1].down, true);
  assert.equal(g.open(0), false, 'not within 120 ticks: the grate stays shut');
});

test('example 2, held open: ALL(leverOn(L1), lightLit(brazier2)) with an undo', () => {
  const doc = M.newTomb(8, 7);
  put(doc, 'lever', 2, 1, { mode: 'toggle', on: false }, 'L1');
  put(doc, 'brazier', 5, 4, { lit: true }, 'brazier2');
  put(doc, 'door', 6, 5, { opens: 'trigger' }, 'd7');
  link(doc, { all: [{ leverOn: 'L1' }, { lightLit: 'brazier2' }] }, [{ openDoor: 'd7' }], { undo: [{ closeDoor: 'd7' }], repeat: true });
  put(doc, 'lever', 5, 1, { mode: 'toggle', on: false }, 'drinker');
  link(doc, { interact: 'drinker' }, [{ lightOff: 'brazier2' }]);        // stands in for the Candle-Eater drinking the flame
  const g = game(doc);
  g.at(2 * 2400 + 1200, 1 * 2400 + 1200);
  g.use('L1'); g.run(60);
  assert.equal(g.st.levers[0].on, true); assert.equal(g.open(0), true, 'lever up and brazier burning: open');
  g.use('L1'); g.run(60);
  assert.equal(g.open(0), false, 'lever down: the undo shuts it');
  g.use('L1'); g.run(60);
  assert.equal(g.open(0), true);
  g.at(5 * 2400 + 1200, 1 * 2400 + 1200);
  g.use('drinker'); g.run(60);
  assert.equal(g.st.braziers[0], false);
  assert.equal(g.open(0), false, 'the flame is drunk: the door slams shut');
  // brazier dark from the start: the lever alone opens nothing
  const dark = structuredClone(doc.gdf); dark.entities.find((e) => e.id === 'brazier2').lit = false;
  const g2 = game({ ...doc, gdf: dark });
  g2.at(2 * 2400 + 1200, 1 * 2400 + 1200);
  g2.use('L1'); g2.run(60);
  assert.equal(g2.st.levers[0].on, true); assert.equal(g2.open(0), false);
});

test('example 3, rune lock: a strict SEQUENCE of glyph buttons, onWrong damage', () => {
  const doc = M.newTomb(10, 6);
  put(doc, 'button', 2, 1, { glyph: 'moon', behaviour: 'press' }, 'moon');
  put(doc, 'button', 4, 1, { glyph: 'eye', behaviour: 'press' }, 'eye');
  put(doc, 'button', 6, 1, { glyph: 'key', behaviour: 'press' }, 'rune');
  put(doc, 'door', 8, 3, { opens: 'trigger' }, 'lock');
  link(doc, { sequence: [{ buttonPressed: 'moon' }, { buttonPressed: 'eye' }, { buttonPressed: 'eye' }, { buttonPressed: 'rune' }], strict: true, within: 300, onWrong: [{ damage: 20 }] }, [{ openDoor: 'lock' }]);
  const walkTo = (g, x) => { const n = Math.round(Math.abs(x - g.st.player.x) / 107); g.run(n, I([127, 0], x > g.st.player.x ? 3072 : 1024)); g.run(6); };
  const standAt = (g, x) => walkTo(g, x);
  // the right order: moon, eye, eye, key
  let g = game(doc);
  g.run(1, I());
  g.st.player.x = 2 * 2400 + 1200; g.st.player.z = 1 * 2400 + 1200;           // start at the first rune (a test shortcut, not an editor operation)
  g.use('moon'); g.run(20); standAt(g, 4 * 2400 + 1200);
  g.use('eye'); g.run(20); g.use('eye'); g.run(20); standAt(g, 6 * 2400 + 1200);
  g.use('rune'); g.run(30);
  assert.equal(g.open(0), true, 'the lock opens');
  assert.equal(g.st.player.hp, 3000, 'no damage for the right order');
  // the wrong order: the key first, then the moon
  g = game(doc);
  g.st.player.x = 6 * 2400 + 1200; g.st.player.z = 1 * 2400 + 1200;
  g.use('rune'); g.run(20); standAt(g, 2 * 2400 + 1200);
  g.use('moon'); g.run(20); standAt(g, 4 * 2400 + 1200);
  g.use('eye'); g.run(30);
  assert.equal(g.open(0), false);
  assert.ok(g.st.player.hp < 3000, 'a wrong step hurts: ' + g.st.player.hp);
});

test('example 4, two of three: AT LEAST 2(hasItem(silverKey), hasItem(ironKey), leverOn(L3)) reveals the alcove', () => {
  const doc = M.newTomb(10, 6);
  put(doc, 'key', 2, 2, {}, 'silverKey');
  put(doc, 'key', 4, 2, {}, 'ironKey');
  put(doc, 'lever', 6, 1, { mode: 'toggle', on: false }, 'L3');
  put(doc, 'treasure', 8, 3, { hidden: true, value: 40 }, 'alcoveGem');
  link(doc, { atLeast: [{ hasItem: 'silverKey' }, { hasItem: 'ironKey' }, { leverOn: 'L3' }], k: 2 }, [{ reveal: 'alcoveGem' }]);
  const gem = num(doc, 'alcoveGem');
  const take = (g, id) => { const e = E.byId(doc, id); g.st.player.x = e.cell[0] * 2400 + 1200; g.st.player.z = e.cell[1] * 2400 + 1200; g.run(2); g.use(id); g.run(4); };
  // one of the three is not enough; the second, whichever it is, is
  let g = game(doc);
  take(g, 'silverKey'); g.run(20);
  assert.equal(g.st.revealed.includes(gem), false);
  g.st.player.x = 6 * 2400 + 1200; g.st.player.z = 1 * 2400 + 1200; g.run(2); g.use('L3'); g.run(20);
  assert.equal(g.st.revealed.includes(gem), true, 'a key and the lever');
  g = game(doc);
  take(g, 'silverKey'); take(g, 'ironKey'); g.run(20);
  assert.equal(g.st.revealed.includes(gem), true, 'both keys');
  g = game(doc);
  g.st.player.x = 6 * 2400 + 1200; g.st.player.z = 1 * 2400 + 1200; g.run(2); g.use('L3'); g.run(30);
  assert.equal(g.st.revealed.includes(gem), false, 'the lever alone is not enough');
});

test('renames follow the exit and survive hand-edited junk', () => {
  const doc = M.newTomb();
  const gem = put(doc, 'treasure', 4, 4, {}, 'gem');
  M.setExitRequires(doc, 'gem');
  doc.gdf.entities.push(null, 7);
  doc.gdf.links = [null, { id: 1, when: { sequence: [{ interact: 'gem' }, { interact: 'gem' }], strict: true, onWrong: [null, { damage: 3 }] }, do: [{ message: 'x' }] }];
  must(renameEntity(doc, 'gem', 'jewel'), 'rename');
  assert.equal(doc.gdf.exit.requires, 'jewel');
  assert.equal(doc.gdf.links[1].when.sequence[0].interact, 'jewel');
  must(renameLink(doc, 1, 2), 'renumber');
  assert.equal(gem.id, 'jewel');
});
