// The builder's link model (M2 slice 4): every trigger and effect it can make loads, gates convert and collapse the way
// the core wants, the sentences cover every Gloamhollow link, and the live panel's slot map matches the core's memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore, ROOT } from './lib/load.mjs';
import * as Sim from '../../public/js/sim/sim.js';
import * as M from '../../public/js/build/model.js';
import * as E from '../../public/js/build/entities.js';
import * as L from '../../public/js/build/links.js';
import { validate } from '../../public/js/build/validate.js';

loadCore();
E.setBestiary(JSON.parse(readFileSync(ROOT + 'public/js/sim/data/bestiary.v1.json', 'utf8')));
const gloam = () => M.fromBytes(new Uint8Array(readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json')));
const ok = (doc) => { const v = validate(doc); assert.equal(v.ok, true, v.error); };
/** Gloamhollow with its own links cleared, so a test adds just the one it studies. */
function bare() { const doc = gloam(); doc.gdf.links = []; return doc; }

test('every trigger the builder can make loads', () => {
  const doc = bare();
  for (const key of Object.keys(L.TRIGGERS)) {
    doc.gdf.links = [];
    const link = L.addLink(doc);
    assert.equal(typeof link, 'object', String(link));
    assert.equal(typeof L.addLink(doc), 'object');          // a second link, for linkFired and linkActive to point at
    assert.equal(L.setTrigger(doc, link, [], key), true, key);
    ok(doc);
    assert.equal(L.isEventValued(link.when), L.TRIGGERS[key].kind === 'event', key);
    assert.ok(L.describeLink(link).length > 10);
  }
});

test('every effect the builder can make loads', () => {
  const doc = bare();
  const link = L.addLink(doc);
  for (const key of Object.keys(L.EFFECTS)) {
    assert.equal(L.setEffect(doc, link, 'do', [], 0, key), true, key);
    ok(doc);
  }
  assert.equal(L.setEffectArg(link, 'do', [], 0, 'Stone grinds.'), true);
  assert.match(L.setEffectArg(link, 'do', [], 0, ''), /empty/);
  assert.match(L.setEffectArg(link, 'do', [], 0, 'x'.repeat(1001)), /1000/);
  L.setEffect(doc, link, 'do', [], 0, 'damage');
  assert.equal(L.setEffectArg(link, 'do', [], 0, 40), true);
  assert.match(L.setEffectArg(link, 'do', [], 0, 0), /1 to 1000/);
  assert.match(L.removeEffect(link, 'do', [], 0), /at least one/);
  assert.equal(L.addEffect(doc, link, 'do'), true); assert.equal(L.removeEffect(link, 'do', [], 0), true); ok(doc);
});

test('gates: build, convert, add, remove, collapse', () => {
  const doc = bare();
  const link = L.addLink(doc);
  for (const kind of ['all', 'any', 'atLeast', 'sequence']) {
    assert.equal(L.setGate(doc, link, [], kind), true, kind);
    assert.equal(L.gateKey(link.when), kind); ok(doc);
  }
  assert.equal(L.isEventValued(link.when), true, 'a sequence is event-valued');
  assert.equal(L.setUndo(doc, link, true).toString().includes('condition'), true, 'no undo on an event-valued link');
  // a sequence takes events only
  assert.match(L.setTrigger(doc, link, [0], 'doorOpen'), /events only/);
  assert.equal(L.setTrigger(doc, link, [0], 'enterZone'), true);
  assert.equal(L.setGateOption(link, [], 'strict', true), true);
  assert.equal(L.addEffect(doc, link, 'onWrong', []), true); assert.equal(link.when.onWrong.length, 1); ok(doc);
  assert.equal(L.setGateOption(link, [], 'strict', false), true); assert.equal('onWrong' in link.when, false); ok(doc);
  assert.equal(L.setGateOption(link, [], 'within', 300), true); ok(doc);
  assert.match(L.setGateOption(link, [], 'within', 5000), /1800/);
  // ALL over conditions, then AT LEAST with a k, then NOT
  assert.equal(L.setGate(doc, link, [], 'all'), true);
  assert.equal(L.setTrigger(doc, link, [0], 'doorOpen'), true);
  assert.equal(L.addChild(doc, link, []), true); assert.equal(link.when.all.length, 3); ok(doc);
  assert.equal(L.setGate(doc, link, [], 'atLeast'), true); assert.equal(link.when.k, 2); ok(doc);
  assert.match(L.setGateOption(link, [], 'k', 9), /Between 1 and 3/);
  assert.equal(L.setGateOption(link, [], 'k', 3), true);
  assert.equal(L.removeChild(link, [2]), true); assert.equal(link.when.k, 2); assert.equal(link.when.atLeast.length, 2); ok(doc);
  assert.equal(L.removeChild(link, [1]), true);
  assert.equal(L.gateKey(link.when), null, 'a gate left with one term gives way to it'); ok(doc);
  assert.equal(L.setGate(doc, link, [], 'not'), true); assert.equal(L.gateKey(link.when), 'not'); ok(doc);
  assert.match(L.removeChild(link, [0]), /NOT/);
  assert.match(L.setTrigger(doc, link, [0], 'itemTaken'), /condition/);
  assert.equal(L.setTrigger(doc, link, [0], 'lightLit'), true); ok(doc);
  // undo is allowed once the link is condition-valued, and goes away when it turns into an event
  assert.equal(L.setUndo(doc, link, true), true); assert.equal(link.undo.length, 1); ok(doc);
  assert.equal(L.setGate(doc, link, [], 'all'), true);
  assert.equal(L.setTrigger(doc, link, [], 'enterZone'), true); assert.equal('undo' in link, false); ok(doc);
});

test('limits: eight terms, sixteen triggers, four levels', () => {
  const doc = bare();
  const link = L.addLink(doc);
  L.setGate(doc, link, [], 'any');
  while (link.when.any.length < 8) assert.equal(L.addChild(doc, link, []), true);
  assert.match(L.addChild(doc, link, []), /8 terms/);
  ok(doc);
  // nest: ANY(ALL(ANY(ALL(...)))) is four deep; a fifth is refused
  let path = [];
  for (let d = 0; d < 3; d++) { assert.equal(L.setGate(doc, link, [...path, 0], d % 2 ? 'any' : 'all'), true); path = [...path, 0]; }
  ok(doc);
  assert.match(L.setGate(doc, link, [...path, 0], 'all'), /nest at most/);
  assert.equal(L.addLink(doc).id, 2);
});

test('links: ids, repeat, delay, removing', () => {
  const doc = bare();
  const a = L.addLink(doc), b = L.addLink(doc);
  assert.deepEqual([a.id, b.id], [1, 2]);
  L.removeLink(doc, 1); assert.equal(L.addLink(doc).id, 1); assert.deepEqual(doc.gdf.links.map((l) => l.id), [1, 2]);
  assert.equal(L.setRepeat(a, true), true); assert.equal(a.repeat, true); assert.equal(L.setRepeat(a, false), true); assert.equal('repeat' in a, false);
  assert.equal(L.setDelay(a, 45), true); assert.equal(a.delay, 45); assert.match(L.setDelay(a, 601), /600/); assert.equal(L.setDelay(a, 0), true); assert.equal('delay' in a, false);
  L.setTrigger(doc, b, [], 'linkFired'); assert.equal(b.when.linkFired, 1); ok(doc);
  assert.equal(L.removeLink(doc, 99), false);
});

test('a tomb with little to point at says so', () => {
  const doc = M.newTomb();
  doc.gdf.zones = [];
  const first = L.addLink(doc);                                 // the lantern triggers and 'hurt you' need nothing to point at
  assert.equal(typeof first, 'object'); assert.deepEqual(Object.keys(first.when), ['lanternHooded']); ok(doc);
  assert.match(String(L.newTrigger(doc, 'enterZone')), /Nothing to point/);
  assert.match(String(L.setGate(doc, first, [], 'sequence')), /nothing to put|events/i);
  assert.match(String(L.newTrigger(doc, 'bossDefeated')), /no boss/);
  assert.match(String(L.newTrigger(doc, 'doorOpen')), /Nothing to point/);
});

test('Gloamhollow: every link has a sentence, no-op edits change nothing, and the slot map matches the core', () => {
  const doc = gloam(), before = M.toText(doc);
  const world = Sim.load(M.toBytes(doc)), st = Sim.init(world, 1, 'practice');
  assert.equal(doc.gdf.links.length, st.links.length);
  [...doc.gdf.links].sort((a, b) => a.id - b.id).forEach((link, n) => {      // the core visits links in ascending id order
    assert.ok(L.describeLink(link).length > 10, String(link.id));
    const map = L.slotMap(link);
    const slots = map.reduce((a, x) => a + (x.seq ? 3 : x.slot >= 0 ? 1 : 0), 0);
    assert.equal(slots, st.links[n].m.length, 'link ' + link.id);
  });
  const link = doc.gdf.links[0];
  L.setRepeat(link, Boolean(link.repeat)); L.setDelay(link, link.delay ?? 0);
  assert.equal(M.toText(doc), before);
});

test('hand-edited links do not break the model: inherited names, wrong shapes, runaway nesting', () => {
  const doc = bare();
  const odd = [
    { id: 1, when: { constructor: 1 }, do: [{ toString: 1 }] },
    { id: 2, when: { doorOpen: 'x' }, do: 'nope' },
    { id: 3, when: null, do: [] },
    { id: 4, when: { all: 5 }, do: [{ message: 'x' }] },
    { id: 5, when: { __proto__: 1, valueOf: 2 }, do: [{ hasOwnProperty: 1 }], undo: 7 },
  ];
  let deep = { doorOpen: 'x' };
  for (let n = 0; n < 5000; n++) deep = { not: deep };
  odd.push({ id: 6, when: deep, do: [{ message: 'x' }] });
  for (const link of odd) {
    assert.doesNotThrow(() => L.describeLink(link), String(link.id));
    assert.equal(L.wellFormed(link), link.id === 1 || link.id === 5 ? link.id === 5 ? false : true : false, 'link ' + link.id);
  }
  assert.equal(L.describeTerm({ constructor: 1 }), '(unknown trigger)');
  assert.equal(L.describeEffect({ toString: 1 }), '(unknown effect)');
  assert.equal(L.triggerInfo('constructor'), undefined); assert.equal(L.effectInfo('valueOf'), undefined);
  assert.match(String(L.newTrigger(doc, 'constructor')), /Unknown/);
  assert.equal(L.isEventKey('hasOwnProperty'), false);
});
