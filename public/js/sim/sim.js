// Tombwright sim core (JS). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
// Pure module: no DOM, no Math.random, no Date, no floats in state.
// Mirror: src/Sim/Sim.php. Any change here needs the same change there + golden vectors.
import { assertInt, idiv, isqrt, clamp } from './int.js';
import { isin, icos, TRIG_ONE } from './sine.js';
import { rngSeed } from './rng.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';

export const CORE_VERSION = 'm0.1';
export const TICK_HZ = 30;
export const CELL_MM = 2400;

// R-MOVE-1: speeds in mm/s, ported from Gloamhollow (3.2 / 5.4 m/s).
export const WALK_MM_S = 3200;
export const RUN_MM_S = 5400;
// R-OIL-1: 1 oil point = 30000 units, so Gloamhollow's burn rates are whole units per tick.
export const OIL_UNIT = 30000;
export const OIL_BURN_OPEN = 80;   // 0.08 points/s
export const OIL_BURN_HOODED = 25; // 0.025 points/s

export const BTN = Object.freeze({
  strike: 1 << 0, hood: 1 << 1, probe: 1 << 2, pebble: 1 << 3,
  oil: 1 << 4, interact: 1 << 5, run: 1 << 6, rise: 1 << 7,
});
const MODES = ['delve', 'ironman', 'practice'];

/** R-INPUT-1: validate one tick of input; throws on anything out of range. */
export function checkInput(input) {
  const { move, yaw, pitch, buttons, target } = input ?? {};
  if (!Array.isArray(move) || move.length !== 2) throw new RangeError('input.move');
  for (const v of move) if (!Number.isInteger(v) || v < -127 || v > 127) throw new RangeError('input.move range');
  if (!Number.isInteger(yaw) || yaw < 0 || yaw > 4095) throw new RangeError('input.yaw');
  if (!Number.isInteger(pitch) || pitch < -127 || pitch > 127) throw new RangeError('input.pitch');
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > 0xFFFF) throw new RangeError('input.buttons');
  if (!Number.isInteger(target) || target < 0 || target > 0xFFFF) throw new RangeError('input.target');
}

function cellCentre(c) { return c * CELL_MM + CELL_MM / 2; }

/** Sim.init(gdf, seed, mode) -> state. */
export function init(gdf, seed, mode) {
  if (!gdf || gdf.gdf !== 1) throw new Error('unsupported GDF');
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const [ci, cj] = gdf.start.cell;
  assertInt(ci); assertInt(cj);
  return {
    v: 1,
    core: CORE_VERSION,
    mode,
    tick: 0,
    rng: rngSeed(seed),
    player: {
      x: cellCentre(ci), z: cellCentre(cj),
      vx: 0, vz: 0, rx: 0, rz: 0,   // velocity mm/s; sub-mm remainders in 1/30 mm (R-MOVE-3)
      yaw: 0, pitch: 0,
      hp: 100, oil: 100 * OIL_UNIT, hooded: false,
    },
    prevButtons: 0,
  };
}

/** Sim.step(state, input) -> events. Mutates state; advances exactly one tick. */
export function step(state, input) {
  checkInput(input);
  const p = state.player;
  const events = [];
  const pressed = input.buttons & ~state.prevButtons; // R-INPUT-2: rising edges

  p.yaw = input.yaw;
  p.pitch = input.pitch;

  // R-MOVE-2: normalise the move vector to length <= 127.
  let [fw, st] = input.move;
  const m2 = fw * fw + st * st;
  if (m2 > 127 * 127) { const len = isqrt(m2); fw = idiv(fw * 127, len); st = idiv(st * 127, len); }
  const speed = (input.buttons & BTN.run) ? RUN_MM_S : WALK_MM_S;
  const sy = isin(p.yaw), cy = icos(p.yaw);
  // Gloamhollow: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
  const den = 127 * TRIG_ONE;
  const tx = idiv(speed * (-sy * fw + cy * st), den);
  const tz = idiv(speed * (-cy * fw - sy * st), den);
  // R-MOVE-4: velocity eases toward target by 2/5 per tick (Gloamhollow's min(1, dt*12) at 30 Hz).
  p.vx += idiv((tx - p.vx) * 2, 5);
  p.vz += idiv((tz - p.vz) * 2, 5);
  // R-MOVE-3: integrate with an exact remainder so no distance is lost.
  const ax = p.vx + p.rx, az = p.vz + p.rz;
  const dx = idiv(ax, TICK_HZ), dz = idiv(az, TICK_HZ);
  p.rx = ax - dx * TICK_HZ; p.rz = az - dz * TICK_HZ;
  p.x += dx; p.z += dz;
  // TODO(M0): collision against cells, doors and props (Gloamhollow pushCircle, RAD 0.36 m).

  // R-OIL-2: hood toggles on the press; refused with no oil.
  if (pressed & BTN.hood) {
    if (p.oil > 0) { p.hooded = !p.hooded; events.push({ e: 'hood', on: p.hooded }); }
    else events.push({ e: 'msg', k: 'lanternOut' });
  }
  if (p.oil > 0) {
    p.oil = Math.max(0, p.oil - (p.hooded ? OIL_BURN_HOODED : OIL_BURN_OPEN));
    if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); }
  }

  state.prevButtons = input.buttons;
  state.tick += 1;
  return events;
}

/** Sim.hash(state) -> 32 hex chars: SHA-256 of the canonical form, first 16 bytes (R-HASH-1). */
export function hash(state) {
  return toHex(sha256(canonicalBytes(state)).subarray(0, 16));
}

export { clamp };
