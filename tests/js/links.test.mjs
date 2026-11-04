// The link engine on its own (R-LINK-4..8), against a fake host: windows, gates, sequences, the delay queue,
// undo, repeat, linkFired chains and the 8-pass limit. The cores are compared on the same engine by the golden
// vectors (0015-0019); these pin down what it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileLinks, runLinks, initLinkState } from '../../public/js/sim/links.js';

// Entities: door d (n 1, door 0), items t (n 2), bells a, b, c (n 3, 4, 5), bell set s (set 0). Zones z0, z1.
const ctx = {
  ents: new Map([
    ['d', { type: 'door', door: 0, n: 1 }], ['t', { type: 'item', item: 0, n: 2, kind: 'treasure' }],
    ['a', { type: 'bell', bell: 0, n: 3 }], ['b', { type: 'bell', bell: 1, n: 4 }], ['c', { type: 'bell', bell: 2, n: 5 }],
    ['s', { type: 'bellSet', set: 0, n: 6 }],
  ]),
  zones: new Map([['z0', 0], ['z1', 1]]),
};

/** A tiny world: conditions from `world`, effects logged; feed(tick, events) runs one living tick. */
function rig(links) {
  const L = compileLinks(links, ctx), st = initLinkState(L), log = [], world = { open: false, hooded: false, dead: false };
  const feed = (tick, evs = []) => runLinks(L, st, evs, {
    tick,
    dead: () => world.dead,
    fired: (id) => log.push([tick, 'fired', id]),
    cond: (kind, arg) => (kind === 'doorOpen' ? world.open : kind === 'lanternHooded' ? world.hooded === arg
      : kind === 'linkActive' ? st[L.findIndex((l) => l.id === arg)].active : false),
    apply: (list) => { for (const fx of list) log.push([tick, fx.kind, fx.text ?? fx.n ?? fx.door]); return list.some((fx) => fx.kind !== 'message'); },
  });
  const run = (ticks, events = {}) => { for (let t = 0; t < ticks; t++) feed(t, events[t] ?? []); };
  return { st, log, world, feed, run, msgs: () => log.filter((x) => x[1] === 'message').map((x) => [x[0], x[2]]) };
}
const ring = (n) => ['interact', n];
const M = (text) => [{ message: text }];

test('a top-level event is true on its tick only; repeat fires on every separate one', () => {
  const r = rig([{ id: 1, when: { interact: 'a' }, repeat: true, do: M('x') }]);
  r.run(10, { 2: [ring(3)], 3: [ring(3)], 7: [ring(3)] });
  assert.deepEqual(r.msgs(), [[2, 'x'], [7, 'x']], 'ticks 2 and 3 are one rising edge');
});

test('all: events count for `within` ticks', () => {
  const near = rig([{ id: 1, when: { all: [{ interact: 'a' }, { interact: 'b' }], within: 30 }, do: M('x') }]);
  near.run(60, { 5: [ring(3)], 34: [ring(4)] });
  assert.deepEqual(near.msgs(), [[34, 'x']], 'a at 5 still counts at 34 (29 ticks later)');
  const far = rig([{ id: 1, when: { all: [{ interact: 'a' }, { interact: 'b' }], within: 30 }, do: M('x') }]);
  far.run(60, { 5: [ring(3)], 35: [ring(4)] });
  assert.deepEqual(far.msgs(), [], 'at 35 it is 30 ticks old: gone');
});

test('atLeast k of n, and not', () => {
  const r = rig([
    { id: 1, when: { atLeast: [{ interact: 'a' }, { interact: 'b' }, { interact: 'c' }], k: 2, within: 10 }, do: M('two') },
    { id: 2, when: { not: { doorOpen: 'd' } }, do: M('shut'), undo: M('open') },
  ]);
  r.run(3, { 1: [ring(3)], 2: [ring(5)] });
  r.world.open = true; r.feed(3);
  assert.deepEqual(r.msgs(), [[0, 'shut'], [2, 'two'], [3, 'open']]);
});

test('sequence: out of order is ignored unless strict; strict resets and fires onWrong; within resets quietly', () => {
  const loose = rig([{ id: 1, when: { sequence: [{ interact: 'a' }, { interact: 'b' }] }, do: M('ok') }]);
  loose.run(10, { 1: [ring(3)], 2: [ring(5)], 3: [ring(4)] });
  assert.deepEqual(loose.msgs(), [[3, 'ok']]);
  const strict = rig([{ id: 1, when: { sequence: [{ interact: 'a' }, { interact: 'b' }], strict: true, onWrong: M('wrong') }, repeat: true, do: M('ok') }]);
  strict.run(10, { 1: [ring(3)], 2: [ring(3)], 3: [ring(4)], 5: [ring(3)], 6: [ring(4)] });
  assert.deepEqual(strict.msgs(), [[2, 'wrong'], [3, 'wrong'], [6, 'ok']], 'the second a is out of order, and so is b with no a before it');
  const timed = rig([{ id: 1, when: { sequence: [{ interact: 'a' }, { interact: 'b' }], within: 5 }, do: M('ok') }]);
  timed.run(20, { 1: [ring(3)], 7: [ring(4)], 9: [ring(3)], 14: [ring(4)] });
  assert.deepEqual(timed.msgs(), [[14, 'ok']], '6 ticks is too slow, 5 is in time');
});

test("sequence: one tick's events satisfy steps in listed order, whatever order they happened in", () => {
  const r = rig([{ id: 1, when: { sequence: [{ interact: 'a' }, { interact: 'b' }], strict: true, onWrong: M('wrong') }, do: M('ok') }]);
  r.run(3, { 1: [ring(4), ring(3)] });
  assert.deepEqual(r.msgs(), [[1, 'ok']]);
});

test('delays queue: each firing lands, oldest first; an event-valued link keeps them (decision #31)', () => {
  const r = rig([{ id: 1, when: { interact: 'a' }, repeat: true, delay: 20, do: M('dart') }]);
  r.run(40, { 2: [ring(3)], 7: [ring(3)] });
  assert.deepEqual(r.msgs(), [[22, 'dart'], [27, 'dart']]);
});

test('a condition-valued link drops its pending do when it falls; undo is delayed too, and dropped by a new rise', () => {
  const r = rig([{ id: 1, when: { doorOpen: 'd' }, repeat: true, delay: 10, do: M('do'), undo: M('undo') }]);
  r.world.open = true; r.run(5);
  r.world.open = false; r.feed(5);
  r.world.open = true; for (let t = 6; t < 20; t++) r.feed(t);
  r.world.open = false; for (let t = 20; t < 25; t++) r.feed(t);
  r.world.open = true; for (let t = 25; t < 40; t++) r.feed(t);
  assert.deepEqual(r.msgs(), [[16, 'do']], 'the first do was dropped at 5; the undo queued at 20 was dropped at 25');
  assert.equal(r.st[0].active, true);
});

test('repeat: false fires once; linkFired chains within one tick; linkActive', () => {
  const r = rig([
    { id: 1, when: { interact: 'a' }, do: M('one') },
    { id: 2, when: { linkFired: 1 }, do: M('two') },
    { id: 3, when: { linkActive: 2 }, do: M('three') },
  ]);
  r.run(10, { 1: [ring(3)], 4: [ring(3)] });
  assert.deepEqual(r.msgs(), [[1, 'one'], [1, 'two'], [1, 'three']]);
});

test('at most 8 passes a tick: the ninth link of a linkFired chain never hears it', () => {
  const links = [{ id: 1, when: { interact: 'a' }, do: M('1') }];
  for (let k = 2; k <= 9; k++) links.push({ id: k, when: { linkFired: k - 1 }, do: M(String(k)) });
  const r = rig(links);
  r.run(5, { 1: [ring(3)] });
  assert.deepEqual(r.msgs().map((x) => x[1]), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('an effect that kills stops the evaluation', () => {
  const r = rig([{ id: 1, when: { interact: 'a' }, do: [{ damage: 5 }] }, { id: 2, when: { interact: 'a' }, do: M('late') }]);
  const L = compileLinks([{ id: 1, when: { interact: 'a' }, do: [{ damage: 5 }] }, { id: 2, when: { interact: 'a' }, do: M('late') }], ctx);
  const st = initLinkState(L), seen = [];
  runLinks(L, st, [ring(3)], { tick: 0, dead: () => seen.length > 0, fired: () => {}, cond: () => false, apply: (l) => { seen.push(l[0].kind); return true; } });
  assert.deepEqual(seen, ['damage']);
  assert.equal(st[1].val, false, 'link 2 was never reached');
  assert.ok(r);
});
