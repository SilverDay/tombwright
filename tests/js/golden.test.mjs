// Replays every golden vector through the JS core. The PHP core replays the same files
// in tests/php/SimParityTest.php; together they enforce the JS == PHP invariant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT, loadCore } from './lib/load.mjs';
import { replay, GLOAMHOLLOW, expand, trapRoom } from '../golden/generate.mjs';
import { solidCell, b64decode, worldProps, DOOR_FULL } from '../../public/js/sim/world.js';
const utf8 = (t) => new TextEncoder().encode(t);
import { fdiv } from '../../public/js/sim/int.js';
import * as Sim from '../../public/js/sim/sim.js';

loadCore();
const DIR = ROOT + 'tests/golden/vectors/';

for (const f of readdirSync(DIR).filter((n) => /^\d{4}-.*\.json$/.test(n))) {
  test(`golden ${f}`, () => {
    const v = JSON.parse(readFileSync(DIR + f, 'utf8'));
    assert.equal(v.core, Sim.CORE_VERSION, 'vector from another core version: regenerate deliberately');
    const r = replay(v.gdf, v.seed, v.mode, v.inputs);
    assert.equal(r.ticks, v.ticks);
    for (const [t, h] of Object.entries(v.hashes)) assert.equal(r.hashes[t], h, `hash at tick ${t}`);
    assert.equal(r.final, v.final);
  });
}

test('step rejects out-of-range input', () => {
  const world = Sim.load(utf8(GLOAMHOLLOW)), st = Sim.init(world, 1, 'delve');
  const ok = { move: [0, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 };
  for (const bad of [{ move: [128, 0] }, { move: [0] }, { yaw: 4096 }, { yaw: 1.5 }, { pitch: -128 }, { buttons: 65536 }, { target: -1 }]) {
    assert.throws(() => Sim.step(world, st, { ...ok, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.equal(st.tick, 0, 'a rejected input must not advance the sim');
});

test('walking speed matches Gloamhollow (3.2 m/s, within 1 %)', () => {
  // Due east along the trap room's middle row (no traps), from the start (2, 4) towards (12, 4): 24 m of floor.
  const world = Sim.load(utf8(trapRoom())), st = Sim.init(world, 1, 'delve');
  const inp = { move: [127, 0], yaw: 3072, pitch: 0, buttons: 0, target: 0 }; // yaw 3072 faces east (+x)
  for (let t = 0; t < 30; t++) Sim.step(world, st, inp);      // spin up
  const x0 = st.player.x;
  for (let t = 0; t < 150; t++) Sim.step(world, st, inp);     // 5 s
  assert.equal(st.dead, null);
  const metresPerSecond = (st.player.x - x0) / 1000 / 5;
  assert.ok(Math.abs(metresPerSecond - 3.2) < 0.032, `got ${metresPerSecond}`);
});

for (const name of ['0002-fuzz', '0005-props-fuzz', '0006-traps-fuzz', '0007-practice-fuzz']) {
  test(`collision (${name}): the player never ends a tick inside or within 359 mm of a solid cell or a prop`, () => {
    const v = JSON.parse(readFileSync(DIR + name + '.json', 'utf8'));
    let ticks = 0, props = 0;
    replay(v.gdf, v.seed, v.mode, v.inputs, (world, st) => {
      ticks++;
      if (st.dead !== null) return; // a body may lie on the plate it just sprang
      const { x, z } = st.player, ci = fdiv(x, Sim.CELL_MM), cj = fdiv(z, Sim.CELL_MM);
      assert.equal(solidCell(world, st, ci, cj), false, `inside a solid cell at tick ${st.tick}`);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const gi = ci + di, gj = cj + dj; if (!solidCell(world, st, gi, gj)) continue;
        const qx = Math.min(Math.max(x, gi * 2400), gi * 2400 + 2400), qz = Math.min(Math.max(z, gj * 2400), gj * 2400 + 2400);
        assert.ok((x - qx) ** 2 + (z - qz) ** 2 >= 359 ** 2, `overlaps solid cell (${gi}, ${gj}) at tick ${st.tick}`);
      }
      for (const o of worldProps(world)) {
        const qx = Math.min(Math.max(x, o.x0), o.x1), qz = Math.min(Math.max(z, o.z0), o.z1);
        const d2 = o.circle ? (x - o.x) ** 2 + (z - o.z) ** 2 : (x - qx) ** 2 + (z - qz) ** 2, min = Sim.PLAYER_R_MM + o.r - 1;
        if (d2 < (min + 200) ** 2) props++;
        assert.ok(d2 >= min ** 2, `overlaps a prop at (${o.x}, ${o.z}) at tick ${st.tick}`);
      }
    });
    assert.equal(ticks, v.ticks);
    if (name === '0005-props-fuzz') assert.ok(props > 100, `the fuzz rubs against props (${props} ticks close)`);
  });
}

test('doors: the Vestibule door blocks until 29 ticks after the press (R-DOOR-3, R-DOOR-4)', () => {
  const v = JSON.parse(readFileSync(DIR + '0004-doors.json', 'utf8'));
  const seen = [];
  replay(v.gdf, v.seed, v.mode, v.inputs, (world, st) => { seen.push({ t: st.doors[0].t, z: st.player.z, open: st.doors[0].open }); });
  const press = seen.findIndex((s) => s.open);
  assert.equal(press, 118, 'opens on the 119th tick, not at the stair or on a wrong target');
  // The press tick is n; the door holds the player through tick n + 28 and lets go on n + 29.
  for (let k = press; k <= press + 28; k++) assert.equal(seen[k].z, 134760, `still held by the door on tick n + ${k - press}`);
  assert.ok(seen[press + 29].z < 134760, 'walks on in tick n + 29');
  assert.equal(seen[press + 31].t, DOOR_FULL - 21, 'one step short after 32 ticks');
  assert.equal(seen[press + 32].t, DOOR_FULL, 'fully open after 33 ticks');
});

test('a state cannot be stepped in another world', () => {
  const a = Sim.load(utf8(GLOAMHOLLOW)), b = Sim.load(utf8(GLOAMHOLLOW.replace('"Gloamhollow"', '"Other"')));
  assert.notEqual(a.id, b.id);
  const st = Sim.init(a, 1, 'delve');
  assert.throws(() => Sim.step(b, st, expand([[1, { move: [0, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 }]])[0]), /another world/);
});

test('GDF loading accepts and rejects the shared cases', () => {
  const prim = JSON.parse(readFileSync(DIR + 'primitives.json', 'utf8'));
  for (const c of prim.gdf) {
    if (c.ok) assert.equal(Sim.load(b64decode(c.bytes)).id, c.id, c.name);
    else assert.throws(() => Sim.load(b64decode(c.bytes)), undefined, c.name);
  }
  assert.ok(prim.gdf.filter((c) => !c.ok).length >= 25);
});

test('the world is sealed after load', () => {
  const world = Sim.load(utf8(GLOAMHOLLOW));
  assert.ok(Object.isFrozen(world) && !('grid' in world));
  const fake = { ...world };
  assert.throws(() => Sim.init(fake, 1, 'delve'), /not a loaded world/);
});

// Step 3 (R-CP-*, R-TRAP-*, R-VENT-*, R-DEATH-*, R-RISE-1), on the trap room: zones a | b (5,4) | c (8,4) | d (11,4, effect).
function trapRun(mode, script) {
  const world = Sim.load(utf8(trapRoom())), st = Sim.init(world, 1, mode), log = [];
  for (const [n, inp] of script) for (let k = 0; k < n; k++) for (const e of Sim.step(world, st, { move: [0, 0], yaw: 0, pitch: 0, buttons: 0, target: 0, ...inp })) log.push({ t: st.tick - 1, ...e });
  return { world, st, log };
}
const E = 3072, W = 1024, N = 0, S = 2048, GO = [127, 0];

test('checkpoints: forward only, effect checkpoints never reached by walking', () => {
  // East through b and c into d, then back west into b: b and c are reached once each, d never, b not again.
  const { st, log } = trapRun('delve', [[200, { move: GO, yaw: E }], [150, { move: GO, yaw: W }]]);
  assert.deepEqual(log.filter((e) => e.e === 'checkpoint').map((e) => e.zone), ['b', 'c']);
  assert.equal(st.dead, null);
  assert.deepEqual(st.checkpoints.map((c) => c.zone), [0, 1, 2]);
  assert.equal(st.cp, 2);
});

test('death and rise: rise is refused before 51 ticks, then the player stands at the checkpoint with the life rolled back', () => {
  // To b (checkpoint), hood the lantern, then north onto the plate at (5, 2).
  const { st, log } = trapRun('delve', [[66, { move: GO, yaw: E }], [1, { buttons: Sim.BTN.hood }], [1, {}], [38, { move: GO, yaw: N }]]);
  const death = log.find((e) => e.e === 'death');
  assert.equal(death.cause, 'slab');
  assert.equal(st.deaths, 1);
  assert.deepEqual(st.dead, { cause: 'slab', at: death.t });
  const world = Sim.load(utf8(trapRoom()));
  const press = (buttons) => Sim.step(world, st, { move: [0, 0], yaw: 0, pitch: 0, buttons, target: 0 });
  assert.equal(st.player.hooded, true);
  let risenAt = -1;
  while (risenAt < 0) {                               // press and release, every other tick
    const n = st.tick;
    if (press(Sim.BTN.rise).some((e) => e.e === 'rise')) risenAt = n; else press(0);
  }
  assert.ok(risenAt - death.t >= Sim.RISE_TICKS && risenAt - death.t <= Sim.RISE_TICKS + 1, 'on the first allowed press, not before');
  assert.deepEqual([st.player.x, st.player.z, st.player.yaw], [13200, 10800, 3072]);
  assert.equal(st.player.hooded, false, 'the hood came back as it was at the checkpoint');
  assert.equal(st.player.oil, st.checkpoints[1].life.oil, 'oil as at the checkpoint (above 50 points)');
  assert.deepEqual(st.sprung, [2 * 14 + 5], 'the sprung plate is a lesson');
});

test('a sprung plate is solid', () => {
  // Die on (5, 2), rise at b, walk north again: the player stops below the plate instead of dying twice.
  const { st, log } = trapRun('delve', [[66, { move: GO, yaw: E }], [38, { move: GO, yaw: N }], [60, {}], [1, { buttons: Sim.BTN.rise }], [60, { move: GO, yaw: N }]]);
  assert.equal(log.filter((e) => e.e === 'death').length, 1);
  assert.equal(st.player.z, 3 * 2400 + Sim.PLAYER_R_MM);
});

test('vents fire on (n + phase) mod period in [warn, warn + fire)', () => {
  const v = { period: 60, phase: 10, warn: 15, fire: 20 };
  const on = []; for (let n = 0; n < 120; n++) if (Sim.ventFiring(v, n)) on.push(n);
  assert.deepEqual(on, [...Array.from({ length: 20 }, (_, k) => 5 + k), ...Array.from({ length: 20 }, (_, k) => 65 + k)]);
});

test('practice rises at a chosen checkpoint reached this run; delve ignores the target', () => {
  const route = [[140, { move: GO, yaw: E }], [40, { move: GO, yaw: N }], [60, {}]]; // to c, then die in the void (8, 2)
  const p = trapRun('practice', [...route, [1, { buttons: Sim.BTN.rise, target: 4 }], [1, {}], [1, { buttons: Sim.BTN.rise, target: 2 }]]);
  assert.equal(p.log.find((e) => e.e === 'death').cause, 'chasm');
  assert.deepEqual(p.log.filter((e) => e.e === 'rise').map((e) => e.zone), ['b'], 'd was never reached, so target 4 does nothing');
  assert.equal(p.st.cp, 1);
  const d = trapRun('delve', [...route, [1, { buttons: Sim.BTN.rise, target: 2 }]]);
  assert.deepEqual(d.log.filter((e) => e.e === 'rise').map((e) => e.zone), ['c']);
});

test('step refuses a state from another core version (R-WORLD-3)', () => {
  const world = Sim.load(utf8(GLOAMHOLLOW)), st = Sim.init(world, 1, 'delve');
  st.core = 'm0.3';
  assert.throws(() => Sim.step(world, st, { move: [127, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 }), /another core version/);
  assert.equal(st.tick, 0);
});

test('ironman: the run is over after a death', () => {
  const v = JSON.parse(readFileSync(DIR + '0009-ironman.json', 'utf8'));
  const world = Sim.load(utf8(v.gdf)), st = Sim.init(world, v.seed, v.mode);
  for (const inp of expand(v.inputs)) Sim.step(world, st, inp);
  assert.equal(st.dead.cause, 'slab');
  assert.throws(() => Sim.step(world, st, { move: [0, 0], yaw: 0, pitch: 0, buttons: Sim.BTN.rise, target: 0 }), /run is over/);
});
