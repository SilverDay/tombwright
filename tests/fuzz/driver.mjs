// Steering input driver for fuzz cases and driven golden vectors (tests/fuzz/gen.mjs, tests/golden/generate.mjs).
// It picks inputs while a case plays, from the case's own RNG and the state so far; the inputs are recorded.
import * as Sim from '../../public/js/sim/sim.js';
import { rngBelow } from '../../public/js/sim/rng.js';

/** Where an entity is, in mm (cell centre or pos), for steering; null for entities without a place. */
function placeOf(e) {
  if (Array.isArray(e.cell)) return [e.cell[0] * 2400 + 1200, e.cell[1] * 2400 + 1200];
  if (Array.isArray(e.pos)) return [e.pos[0], e.pos[1]];
  if (Array.isArray(e.cells)) return [e.cells[0][0] * 2400 + 1200, e.cells[0][1] * 2400 + 1200];
  if (Array.isArray(e.wall) && Array.isArray(e.wall[0])) return [e.wall[0][0] * 2400 + 1200, e.wall[0][1] * 2400 + 1200]; // wall buttons and levers
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
    // Dropped loot (R-THIEF-4) is a target too: 1000 + its index.
    if (seek === null && st.loot.length > 0 && rngBelow(r, 3) === 0) { const k = rngBelow(r, st.loot.length); seek = { n: 1000 + k, at: [st.loot[k].x, st.loot[k].z], left: 30 + rngBelow(r, 200) }; }
    if (seek === null && targets.length && rngBelow(r, 2) === 0) { const n = targets[rngBelow(r, targets.length)]; seek = { n, at: places[n - 1], left: 30 + rngBelow(r, 200) }; }
    if (seek !== null) {
      const [tx, tz] = seek.at, d = Math.hypot(tx - p.x, tz - p.z), yaw = yawTo(p.x, p.z, tx, tz);
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

