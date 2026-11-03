// Replays every golden vector through the JS core. The PHP core replays the same files
// in tests/php/SimParityTest.php; together they enforce the JS == PHP invariant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT, loadCore } from './lib/load.mjs';
import { replay, GLOAMHOLLOW, expand } from '../golden/generate.mjs';
import { solidCell, b64decode } from '../../public/js/sim/world.js';
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
  // Straight north up column 34: Vestibule, corridor, hall, corridor, the Mouth (66 m of floor).
  const world = Sim.load(utf8(GLOAMHOLLOW)), st = Sim.init(world, 1, 'delve');
  const inp = { move: [127, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 };
  for (let t = 0; t < 30; t++) Sim.step(world, st, inp);      // spin up
  const z0 = st.player.z;
  for (let t = 0; t < 300; t++) Sim.step(world, st, inp);     // 10 s
  const metresPerSecond = (z0 - st.player.z) / 1000 / 10; // yaw 0 faces north (-z)
  assert.ok(Math.abs(metresPerSecond - 3.2) < 0.032, `got ${metresPerSecond}`);
});

test('collision: the player never ends a tick inside or within 359 mm of a wall', () => {
  const v = JSON.parse(readFileSync(DIR + '0002-fuzz.json', 'utf8'));
  let ticks = 0;
  replay(v.gdf, v.seed, v.mode, v.inputs, (world, st) => {
    const { x, z } = st.player, ci = fdiv(x, Sim.CELL_MM), cj = fdiv(z, Sim.CELL_MM);
    assert.equal(solidCell(world, ci, cj), false, `inside a wall at tick ${st.tick}`);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const gi = ci + di, gj = cj + dj; if (!solidCell(world, gi, gj)) continue;
      const qx = Math.min(Math.max(x, gi * 2400), gi * 2400 + 2400), qz = Math.min(Math.max(z, gj * 2400), gj * 2400 + 2400);
      assert.ok((x - qx) ** 2 + (z - qz) ** 2 >= 359 ** 2, `overlaps wall (${gi}, ${gj}) at tick ${st.tick}`);
    }
    ticks++;
  });
  assert.equal(ticks, v.ticks);
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
