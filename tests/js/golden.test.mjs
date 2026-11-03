// Replays every golden vector through the JS core. The PHP core replays the same files
// in tests/php/SimParityTest.php; together they enforce the JS == PHP invariant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT, loadCore } from './lib/load.mjs';
import { replay } from '../golden/generate.mjs';
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
  const st = Sim.init({ gdf: 1, start: { cell: [1, 1] } }, 1, 'delve');
  const ok = { move: [0, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 };
  for (const bad of [{ move: [128, 0] }, { move: [0] }, { yaw: 4096 }, { yaw: 1.5 }, { pitch: -128 }, { buttons: 65536 }, { target: -1 }]) {
    assert.throws(() => Sim.step(st, { ...ok, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.equal(st.tick, 0, 'a rejected input must not advance the sim');
});

test('walking speed matches Gloamhollow (3.2 m/s, within 1 %)', () => {
  const st = Sim.init({ gdf: 1, start: { cell: [10, 10] } }, 1, 'delve');
  const inp = { move: [127, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 };
  for (let t = 0; t < 30; t++) Sim.step(st, inp);      // spin up
  const z0 = st.player.z;
  for (let t = 0; t < 300; t++) Sim.step(st, inp);     // 10 s
  const metresPerSecond = (z0 - st.player.z) / 1000 / 10; // yaw 0 faces north (-z)
  assert.ok(Math.abs(metresPerSecond - 3.2) < 0.032, `got ${metresPerSecond}`);
});
