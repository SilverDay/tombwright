// The builder's entity layer (M2 slice 2): every palette entry places something the sim core's loader accepts, option
// changes keep key sets exact, and Gloamhollow's own entities can be selected and edited without loss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore, ROOT } from './lib/load.mjs';
import { CELL } from '../../public/js/sim/world.js';
import * as M from '../../public/js/build/model.js';
import * as E from '../../public/js/build/entities.js';
import { validate } from '../../public/js/build/validate.js';

loadCore();
/** A tomb with a plate, an alcove cell and room to build in. Start (2, 6), exit (13, 6). */
function workshop() {
  const doc = M.newTomb(20, 12);
  M.paint(doc, 8, 3, CELL.PLATE); M.paint(doc, 12, 3, CELL.ALCOVE);
  M.paint(doc, 15, 3, CELL.BRIDGE);
  return doc;
}
const entry = (id) => E.PALETTE.find((p) => p.id === id);
const ok = (doc) => { const v = validate(doc); assert.equal(v.ok, true, v.error); return v; };

test('every palette entry places an entity the loader accepts', () => {
  const doc = workshop();
  ok(doc);
  const spots = { door: [5, 5], slab: [8, 3], vent: [10, 3], alcove: [12, 3], flask: [4, 7], rubble: [5, 7], treasure: [6, 7], key: [7, 7], chest: [3, 1], inscription: [6, 1], torch: [9, 1], marks: [4, 4], prop: [9, 8], decor: [11, 8], brazier: [14, 8], bell: [15, 7], lampHook: [1, 9], mirror: [16, 9], crystal: [13, 1], foe: [14, 5], boss: [10, 9] };
  // the alcove wants a door and a key door wants a key: place doors first (palette order does that)
  for (const p of E.PALETTE) {
    const [i, j] = spots[p.id];
    if (p.id === 'vent') { M.paint(doc, 10, 3, CELL.VENT); M.paint(doc, 11, 3, CELL.VENT); assert.match(validate(doc).error, /vent cell/); }   // a vent cell needs its vent
    const r = E.place(doc, p, i, j);
    assert.equal(typeof r, 'object', `${p.id}: ${r}`);
    if (p.id === 'bell') { assert.equal(validate(doc).ok, false, 'one bell is not a set'); E.place(doc, { ...p, selected: r.id }, 15, 9); }   // the second bell joins
    ok(doc);
  }
  assert.equal(E.entities(doc).length, E.PALETTE.length + 2, 'a bell set and a second bell came with the bell');
  assert.deepEqual(E.byId(doc, 'vent1').cells, [[10, 3], [11, 3]], 'a vent takes its connected vent cells');
});

test('placing is refused where it cannot work, with a reason', () => {
  const doc = workshop();
  assert.match(E.place(doc, entry('door'), 0, 0), /room or corridor/);
  assert.match(E.place(doc, entry('door'), 2, 6), /start/);
  assert.match(E.place(doc, entry('slab'), 5, 5), /plate/);
  assert.match(E.place(doc, entry('alcove'), 12, 3), /door first/);
  assert.match(E.place(doc, entry('chest'), 8, 6), /wall/);
  M.paint(doc, 10, 3, CELL.VENT);
  assert.match(E.place(doc, entry('vent'), 5, 5), /vent/);
  E.place(doc, entry('door'), 5, 5);
  assert.match(E.place(doc, entry('door'), 5, 5), /already/);
});

test('door options add and drop their keys', () => {
  const doc = workshop();
  const d = E.place(doc, entry('door'), 5, 5);
  assert.match(E.setField(doc, d, 'opens', 'key'), /key item first/);
  const k = E.place(doc, entry('key'), 6, 5);
  assert.equal(E.setField(doc, d, 'opens', 'key'), true); assert.equal(d.key, k.id); ok(doc);
  assert.equal(E.setField(doc, d, 'style', 'mask'), true); assert.equal(d.face, 'blank'); ok(doc);
  assert.equal(E.setField(doc, d, 'face', 'weep'), true); ok(doc);
  assert.equal(E.setField(doc, d, 'style', 'grate'), true); assert.equal('face' in d, false); ok(doc);
  assert.equal(E.setField(doc, d, 'opens', 'trigger'), true); assert.equal('key' in d, false); ok(doc);
  assert.match(E.setField(doc, d, 'key', 'nope'), /not a key/);
});

test('items: kind, chest and hidden transitions keep exact key sets', () => {
  const doc = workshop();
  const c = E.place(doc, entry('chest'), 3, 1);
  const t = E.place(doc, entry('treasure'), 6, 7);
  assert.equal(t.value, 50);
  assert.equal(E.setField(doc, t, 'name', 'a silver lamp-chain'), true); ok(doc);
  assert.equal(E.setField(doc, t, 'hidden', true), true); ok(doc);
  assert.equal(E.setField(doc, t, 'in', c.id), true);
  assert.equal('cell' in t || 'hidden' in t, false); assert.equal(t.in, c.id); ok(doc);
  assert.match(E.setField(doc, t, 'hidden', true), /floor/);
  assert.equal(E.setField(doc, t, 'in', ''), true); assert.deepEqual(t.cell, c.cell); assert.equal('in' in t, false); ok(doc);
  assert.equal(E.setField(doc, t, 'kind', 'flask'), true);
  assert.equal('value' in t || 'name' in t, false); ok(doc);
  assert.equal(E.setField(doc, t, 'kind', 'treasure'), true); assert.equal(t.value, 50); ok(doc);
  assert.equal(E.setField(doc, t, 'in', c.id), true);
  assert.equal(E.setField(doc, t, 'kind', 'rubble'), true);
  assert.equal('in' in t || 'hidden' in t, false); assert.ok(t.cell); ok(doc);
  assert.match(E.setField(doc, t, 'in', c.id), /rubble/i);
  assert.match(E.setField(doc, t, 'name', 'x'.repeat(41)), /At most/);
});

test('inscriptions: exactly one placement, pages and text limits', () => {
  const doc = workshop();
  const c = E.place(doc, entry('chest'), 3, 1);
  const n = E.place(doc, entry('inscription'), 6, 1);
  assert.equal(E.getField(n, 'where'), 'wall'); ok(doc);
  assert.equal(E.setField(doc, n, 'where', 'pos'), true);
  assert.deepEqual(Object.keys(n).filter((k) => ['wall', 'pos', 'on'].includes(k)), ['pos']); ok(doc);
  assert.equal(E.setField(doc, n, 'where', 'on'), true);
  assert.deepEqual(Object.keys(n).filter((k) => ['wall', 'pos', 'on'].includes(k)), ['on']); assert.equal(n.on, c.id); ok(doc);
  assert.equal(E.setField(doc, n, 'where', 'wall'), true); assert.deepEqual(n.wall[0], [3, 1]); ok(doc);
  assert.equal(E.setField(doc, n, 'pages', ['one', 'two\nlines']), true); ok(doc);
  assert.match(E.setField(doc, n, 'pages', []), /One to eight/);
  assert.match(E.setField(doc, n, 'pages', ['x'.repeat(1501)]), /1500/);
  assert.match(E.setField(doc, n, 'title', ''), /empty/);
  assert.match(E.setField(doc, n, 'title', 'a\u0000b'), /control/);
  assert.equal(E.setField(doc, n, 'caption', 'Over the door'), true); assert.equal(n.caption, 'Over the door'); ok(doc);
  assert.equal(E.setField(doc, n, 'caption', ''), true); assert.equal('caption' in n, false);
  assert.match(E.setField(doc, n, 'side', 's'), /no wall/);
});

test('props and decor: the sarcophagus snaps to a quarter turn', () => {
  const doc = workshop();
  const p = E.place(doc, entry('prop'), 9, 8);
  E.setField(doc, p, 'yaw', 700); assert.equal(p.yaw, 700); ok(doc);
  E.setField(doc, p, 'kind', 'sarcophagus'); assert.equal(p.yaw % 1024, 0); ok(doc);
  E.setField(doc, p, 'yaw', 1500); assert.equal(p.yaw, 1024); ok(doc);
});

test('move, remove, hit-test and marks', () => {
  const doc = workshop();
  const d = E.place(doc, entry('door'), 5, 5);
  assert.equal(E.move(doc, d, 6, 5), true); assert.deepEqual(d.cell, [6, 5]);
  assert.match(E.move(doc, d, 0, 0), /room or corridor/);
  assert.deepEqual(E.entitiesAt(doc, 6, 5).map((e) => e.id), [d.id]);
  assert.deepEqual(E.entitiesAt(doc, 5, 5), []);
  const t = E.place(doc, entry('torch'), 9, 1);
  assert.equal(E.move(doc, t, 3, 1), true); assert.equal(E.sideOf(t), 'n'); ok(doc);
  E.place(doc, entry('marks'), 4, 4); E.place(doc, entry('marks'), 5, 4);
  assert.equal(E.entities(doc).filter((e) => e.type === 'marks').length, 1);
  assert.equal(E.entitiesAt(doc, 5, 4)[0].type, 'marks');
  E.place(doc, entry('marks'), 4, 4); E.place(doc, entry('marks'), 5, 4);   // toggled off: the entity goes
  assert.equal(E.entities(doc).filter((e) => e.type === 'marks').length, 0);
  assert.equal(E.removeEntity(doc, d.id), true); assert.equal(E.removeEntity(doc, d.id), false);
});

test('waking eyes per chamber', () => {
  const doc = workshop();
  assert.equal(E.setEyes(doc, 'z1', 30), true); ok(doc);
  assert.equal(E.eyesOf(doc, 'z1').wake, 30);
  assert.equal(E.setEyes(doc, 'z1', 60), true); assert.equal(E.entities(doc).filter((e) => e.type === 'eyes').length, 1);
  assert.match(E.setEyes(doc, 'z1', 5), /18/);
  assert.equal(E.setEyes(doc, 'z1', null), true); assert.equal(E.eyesOf(doc, 'z1'), undefined);
});

test('ids never collide with entities or chambers', () => {
  const doc = workshop();
  doc.gdf.zones[0].id = 'door1';
  const d = E.place(doc, entry('door'), 5, 5);
  assert.equal(d.id, 'door2');
});

test('Gloamhollow: every entity can be found by its cell, and each type has an editor', () => {
  const doc = M.fromBytes(new Uint8Array(readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json')));
  let found = 0;
  for (const e of E.entities(doc)) {
    const p = E.entityPoint(e);
    if (p === null) continue;
    assert.ok(E.entitiesAt(doc, Math.floor(p[0]), Math.floor(p[1])).includes(e), e.id);
    found++;
  }
  assert.ok(found > 50);
  // changing and restoring a value leaves the canonical tomb as it was
  const before = M.toText(doc);
  const chest = E.entities(doc).find((e) => e.type === 'chest');
  E.setField(doc, chest, 'style', chest.style === 'plain' ? 'gilded' : 'plain'); E.setField(doc, chest, 'style', chest.style === 'plain' ? 'gilded' : 'plain');
  assert.equal(M.toText(doc), before);
});

test('malformed entities from an imported file do not break placing', () => {
  const doc = workshop();
  doc.gdf.entities.push({ id: 'bad1', type: 'door' }, { id: 'bad2', type: 'alcove' }, { id: 'bad3', type: 'slab', cell: 5 });
  assert.equal(typeof E.place(doc, entry('door'), 5, 5), 'object');
  assert.equal(typeof E.place(doc, entry('slab'), 8, 3), 'object');
  E.place(doc, entry('door'), 6, 5);
  assert.match(String(E.place(doc, entry('alcove'), 12, 3)), /./);
  assert.deepEqual(E.entitiesAt(doc, 0, 0), []);
});

// ------------------------------------------------------------------ slice 3: light, bells, mirrors, foes, the boss
import { readFileSync as readBest } from 'node:fs';
E.setBestiary(JSON.parse(readBest(ROOT + 'public/js/sim/data/bestiary.v1.json', 'utf8')));

test('light and puzzle pieces place and load', () => {
  const doc = workshop();
  E.place(doc, entry('brazier'), 4, 4); ok(doc);
  E.place(doc, entry('mirror'), 6, 4); ok(doc);
  assert.match(E.place(doc, entry('mirror'), 6, 4), /already/);
  const hook = E.place(doc, entry('lampHook'), 1, 6);
  assert.equal(hook.dir, 'e', 'the hook hangs on the west wall and shines east'); ok(doc);
  E.place(doc, entry('crystal'), 13, 1); ok(doc);
  assert.match(E.place(doc, entry('crystal'), 8, 6), /wall/);
  const m = E.byId(doc, 'mirror1');
  E.setField(doc, m, 'start', '\\'); assert.equal(m.start, '\\'); ok(doc);
  E.setField(doc, E.byId(doc, 'brazier1'), 'lit', true); ok(doc);
  E.setField(doc, hook, 'dir', 'n'); ok(doc);
});

test('bells: the first makes a set that needs a second; the set follows the selection; removing keeps sets whole', () => {
  const doc = workshop();
  const b1 = E.place(doc, entry('bell'), 5, 4);
  const set = E.byId(doc, 'bells1');
  assert.deepEqual(set.bells, [b1.id]); assert.equal(validate(doc).ok, false);
  const b2 = E.place(doc, { ...entry('bell'), selected: set.id }, 7, 4);       // joins the selected set
  assert.deepEqual(set.bells, [b1.id, b2.id]); ok(doc);
  const b3 = E.place(doc, { ...entry('bell'), selected: b1.id }, 9, 4);        // a selected bell names its set
  assert.deepEqual(set.bells, [b1.id, b2.id, b3.id]); ok(doc);
  assert.equal(E.setField(doc, set, 'order', [2, 0, 1]), true); ok(doc);
  assert.match(E.setField(doc, set, 'order', [0, 0, 1]), /exactly once/);
  assert.equal(E.setField(doc, b2, 'size', 3), true); assert.equal(E.setField(doc, b2, 'patina', 2), true); assert.equal(E.setField(doc, b2, 'note', 98), true);
  assert.match(E.setField(doc, b2, 'note', 5), /20/); ok(doc);
  // clicking a bell offers the bell, then its set
  assert.deepEqual(E.entitiesAt(doc, 7, 4).map((e) => e.type), ['bell', 'bellSet']);
  // remove the middle-ringing bell: order is renumbered and stays a permutation
  E.removeEntity(doc, b1.id);
  assert.deepEqual(set.bells, [b2.id, b3.id]); assert.deepEqual([...set.order].sort(), [0, 1]); ok(doc);
  // a new set when nothing is selected, and removing a set takes its bells
  const c1 = E.place(doc, entry('bell'), 11, 4);
  assert.equal(E.byId(doc, 'bells2').bells[0], c1.id);
  E.removeEntity(doc, 'bells1');
  assert.equal(E.byId(doc, b2.id), undefined); assert.equal(E.byId(doc, b3.id), undefined);
  E.removeEntity(doc, c1.id); assert.equal(E.byId(doc, 'bells2'), undefined); ok(doc);
  const first = E.place(doc, entry('bell'), 3, 8), mine = E.entities(doc).find((e) => e.type === 'bellSet' && e.bells.includes(first.id));
  for (let n = 1; n < 5; n++) E.place(doc, { ...entry('bell'), selected: mine.id }, 3 + n, 8);
  assert.equal(mine.bells.length, 5);
  assert.match(E.place(doc, { ...entry('bell'), selected: mine.id }, 9, 8), /at most 5/);
});

test('foes: kinds, starts, groups, disguise and the threat counter', () => {
  const doc = workshop();
  const f = E.place(doc, { ...entry('foe'), kind: 'dragon' }, 6, 4);
  assert.equal(f.kind, 'dragon'); ok(doc);
  assert.deepEqual(E.threat(doc), { points: 25, foes: 1, awake: 0, over: false });
  for (const [i, kind] of [[8, 'dragon'], [10, 'dragon'], [12, 'dragon']]) E.place(doc, { ...entry('foe'), kind }, i, 4);
  assert.equal(E.threat(doc).points, 100); ok(doc);
  E.place(doc, { ...entry('foe'), kind: 'bat' }, 14, 4);
  assert.equal(E.threat(doc).over, true); assert.match(validate(doc).error, /foe limits/);
  assert.equal(E.setField(doc, E.byId(doc, 'foe5'), 'kind', 'warden'), true);   // a bone gardener costs 4, still too many
  E.removeEntity(doc, 'foe5'); ok(doc);
  assert.equal(E.setField(doc, f, 'start', 'hunting'), true); ok(doc); assert.equal(E.threat(doc).awake, 1);
  assert.equal(E.setField(doc, f, 'group', 'guards'), true); assert.deepEqual(E.groupIds(doc).includes('guards'), true); ok(doc);
  assert.match(E.setField(doc, f, 'group', '9bad'), /group id/);
  assert.equal(E.setField(doc, f, 'group', ''), true); assert.equal('group' in f, false);
  // a xeroc can be disguised (which makes it start asleep); anything else cannot
  E.removeEntity(doc, 'foe4');                                  // make room in the budget
  const x = E.place(doc, { ...entry('foe'), kind: 'xeroc' }, 6, 7);
  assert.match(E.setField(doc, f, 'disguise', 'chest'), /xeroc/);
  assert.equal(E.setField(doc, x, 'start', 'idle'), true);
  assert.equal(E.setField(doc, x, 'disguise', 'chest'), true); assert.equal(x.start, 'asleep'); ok(doc);
  assert.equal(E.setField(doc, x, 'start', 'hunting'), true); assert.equal('disguise' in x, false);
  assert.equal(E.setField(doc, x, 'disguise', 'treasure'), true);
  assert.equal(E.setField(doc, x, 'kind', 'zombie'), true); assert.equal('disguise' in x, false); ok(doc);
  assert.match(E.place(doc, { ...entry('foe'), kind: 'bat' }, 0, 0), /free room/);
});

test('the boss: one per tomb, inside a chamber, the Warden calls a group', () => {
  const doc = workshop();
  assert.match(E.place(doc, entry('boss'), 0, 0), /chamber/);
  const b = E.place(doc, entry('boss'), 9, 6);
  assert.equal(b.zone, 'z1'); ok(doc);
  assert.match(E.place(doc, entry('boss'), 10, 6), /at most one/);
  assert.equal(E.setField(doc, b, 'kind', 'deepWarden'), true); ok(doc);
  E.place(doc, { ...entry('foe'), kind: 'zombie' }, 5, 7);
  E.setField(doc, E.byId(doc, 'foe1'), 'group', 'crypt'); E.setField(doc, E.byId(doc, 'foe1'), 'start', 'dormant');
  assert.equal(E.setField(doc, b, 'summons', 'crypt'), true); ok(doc);
  assert.equal(E.setField(doc, b, 'kind', 'eater'), true); assert.equal('summons' in b, false); ok(doc);
  assert.match(E.setField(doc, b, 'kind', 'nope'), /Unknown/);
  assert.equal(E.move(doc, b, 12, 4), true); assert.deepEqual(b.pos, [12 * 2400 + 1200, 4 * 2400 + 1200]); ok(doc);
  // a second chamber: moving her zone puts her in its middle
  M.removeZone(doc, "z1");
  const a = M.addZone(doc, 1, 1, 8, 10), c = M.addZone(doc, 9, 1, 18, 10);
  M.updateZone(doc, a.id, { checkpoint: { cell: [2, 6], yaw: 0 } });
  b.zone = a.id; b.pos = [3 * 2400 + 1200, 6 * 2400 + 1200];
  assert.equal(E.setField(doc, b, 'zone', c.id), true); assert.equal(b.zone, c.id); ok(doc);
  assert.match(E.move(doc, b, 3, 6), /inside her chamber/);
  assert.match(E.setField(doc, b, 'zone', 'nope'), /No such/);
});

test('Gloamhollow: every bell, mirror, brazier, foe and the boss can be found and the tomb is unchanged by a no-op edit', () => {
  const doc = M.fromBytes(new Uint8Array(readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json')));
  const before = M.toText(doc);
  const types = new Set(E.entities(doc).map((e) => e.type));
  for (const t of ['bell', 'bellSet', 'mirror', 'lampHook', 'crystal', 'brazier', 'foe', 'boss']) assert.ok(types.has(t), t);
  assert.equal(E.threat(doc).over, false);
  const boss = E.entities(doc).find((e) => e.type === 'boss');
  E.setField(doc, boss, 'kind', 'eater');
  const set = E.entities(doc).find((e) => e.type === 'bellSet');
  E.setField(doc, set, 'order', [...set.order]);
  assert.equal(M.toText(doc), before);
});

test('malformed bell sets from an imported file do not break removing', () => {
  const doc = workshop();
  doc.gdf.entities.push({ id: 'bellsX', type: 'bellSet', bells: 'oops', order: 7 }, { id: 'bellY', type: 'bell', cell: [5, 5], size: 2, patina: 0, note: 330 }, { id: 'bellsZ', type: 'bellSet', bells: ['bellY'], order: 'x' });
  assert.equal(E.removeEntity(doc, 'bellY'), true);
  assert.equal(E.removeEntity(doc, 'bellsX'), true);
  assert.equal(E.byId(doc, 'bellsZ'), undefined, 'an emptied set goes');
});
