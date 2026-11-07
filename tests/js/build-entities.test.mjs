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
  const spots = { door: [5, 5], slab: [8, 3], vent: [10, 3], alcove: [12, 3], flask: [4, 7], rubble: [5, 7], treasure: [6, 7], key: [7, 7], chest: [3, 1], inscription: [6, 1], torch: [9, 1], marks: [4, 4], prop: [9, 8], decor: [11, 8] };
  // the alcove wants a door and a key door wants a key: place doors first (palette order does that)
  for (const p of E.PALETTE) {
    const [i, j] = spots[p.id];
    if (p.id === 'vent') { M.paint(doc, 10, 3, CELL.VENT); M.paint(doc, 11, 3, CELL.VENT); assert.match(validate(doc).error, /vent cell/); }   // a vent cell needs its vent
    const r = E.place(doc, p, i, j);
    assert.equal(typeof r, 'object', `${p.id}: ${r}`);
    ok(doc);
  }
  assert.equal(E.entities(doc).length, E.PALETTE.length);
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
