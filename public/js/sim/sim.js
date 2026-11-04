// Tombwright sim core (JS). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
// Pure module: no DOM, no Math.random, no Date, no floats in state.
// Mirror: src/Sim/Sim.php. Any change here needs the same change there + golden vectors.
import { idiv, fdiv, isqrt, clamp } from './int.js';
import { isin, icos, TRIG_ONE } from './sine.js';
import { rngSeed } from './rng.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';
import {
  loadWorld, solidCell, assertWorld, worldProps, worldDoors, entityRef, cellCode, slabAt, ventAt, zoneAt, worldZones, startZone,
  CELL, DOOR_FULL, DOOR_STEP,
} from './world.js';

export const CORE_VERSION = 'm0.4';
export const TICK_HZ = 30;
export const CELL_MM = 2400;

// R-MOVE-1: speeds in mm/s, ported from Gloamhollow (3.2 / 5.4 m/s).
export const WALK_MM_S = 3200;
export const RUN_MM_S = 5400;
// R-OIL-1: 1 oil point = 30000 units, so Gloamhollow's burn rates are whole units per tick.
export const OIL_UNIT = 30000;
export const OIL_BURN_OPEN = 80;   // 0.08 points/s
export const OIL_BURN_HOODED = 25; // 0.025 points/s
// R-MOVE-4: the player is a circle of radius 360 mm (Gloamhollow RAD 0.36 m).
export const PLAYER_R_MM = 360;
// R-ACT-1: interact reach, mm (Gloamhollow ia r 2.6 m).
export const REACH_MM = 2600;
// R-TRAP-1: only the inner part of a cell is armed (Gloamhollow 0.12-0.88 of 2.4 m).
export const TRAP_LO = 288, TRAP_HI = 2112;
// R-RISE-1: rise is accepted from 51 ticks after the death (1.7 s, Gloamhollow's death card).
export const RISE_TICKS = 51;
// R-RISE-1: rising tops the lantern up to 50 points.
export const RISE_OIL = 50 * 30000;

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

/** Sim.load(bytes) -> world: the immutable map, built once per dungeon from the GDF file (R-GDF-0, R-WORLD-*). */
export const load = loadWorld;

/** Sim.init(world, seed, mode) -> state. */
export function init(world, seed, mode) {
  assertWorld(world);
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const { i: ci, j: cj } = world.start;
  const st = {
    v: 1,
    core: CORE_VERSION,
    world: world.id, // R-WORLD-3
    mode,
    tick: 0,
    rng: rngSeed(seed),
    player: {
      x: cellCentre(ci), z: cellCentre(cj),
      vx: 0, vz: 0, rx: 0, rz: 0,   // velocity mm/s; sub-mm remainders in 1/30 mm (R-MOVE-3)
      yaw: 0, pitch: 0,
      hp: 100, oil: 100 * OIL_UNIT, hooded: false,
    },
    doors: worldDoors(world).map(() => ({ open: false, t: 0 })), // R-DOOR-2
    deaths: 0,
    dead: null,             // R-DEATH-1: { cause, at } while dead
    sprung: [],             // R-CP-3 lessons: plates sprung during play, cell indices
    pits: [],               // R-CP-3 lessons: hidden pits found
    checkpoints: [],        // R-CP-1
    cp: 0,
    prevButtons: 0,
  };
  st.checkpoints.push({ zone: startZone(world), x: st.player.x, z: st.player.z, yaw: 0, life: lifeOf(st) });
  return st;
}

/** R-CP-3: what a death rolls back. */
function lifeOf(state) {
  const p = state.player;
  return { hp: p.hp, oil: p.oil, hooded: p.hooded, doors: state.doors.map((d) => d.open) };
}

/** Sim.step(world, state, input) -> events. Mutates state; advances exactly one tick. */
export function step(world, state, input) {
  assertWorld(world);
  if (state.world !== world.id) throw new Error('state belongs to another world');
  if (state.core !== CORE_VERSION) throw new Error('state from another core version'); // R-WORLD-3
  if (state.dead !== null && state.mode === 'ironman') throw new Error('the run is over'); // R-DEATH-3
  checkInput(input);
  const events = [];
  const pressed = input.buttons & ~state.prevButtons; // R-INPUT-2: rising edges

  if (state.dead !== null) {
    // R-DEATH-2: while dead only rising and the doors go on.
    if ((pressed & BTN.rise) && state.tick >= state.dead.at + RISE_TICKS) rise(world, state, input.target, events);
    moveDoors(state);
  } else live(world, state, input, pressed, events);

  state.prevButtons = input.buttons;
  state.tick += 1;
  return events;
}

/** R-DOOR-3: opening doors move on. */
function moveDoors(state) {
  for (const d of state.doors) if (d.open && d.t < DOOR_FULL) d.t = Math.min(DOOR_FULL, d.t + DOOR_STEP);
}

/** One tick of a living player. */
function live(world, state, input, pressed, events) {
  const p = state.player;
  p.yaw = input.yaw;
  p.pitch = input.pitch;

  // R-ACT-1: interact with the target entity, from where the player stood before moving.
  if ((pressed & BTN.interact) && input.target !== 0) interact(world, state, input.target, events);

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
  // R-MOVE-3: velocity eases toward target by 2/5 per tick (Gloamhollow's min(1, dt*12) at 30 Hz).
  p.vx += idiv((tx - p.vx) * 2, 5);
  p.vz += idiv((tz - p.vz) * 2, 5);
  // R-MOVE-3: integrate with an exact remainder so no distance is lost.
  const ax = p.vx + p.rx, az = p.vz + p.rz;
  const dx = idiv(ax, TICK_HZ), dz = idiv(az, TICK_HZ);
  p.rx = ax - dx * TICK_HZ; p.rz = az - dz * TICK_HZ;
  const ox = p.x, oz = p.z;
  p.x += dx; p.z += dz;
  pushOut(world, state, p, PLAYER_R_MM, ox, oz);
  moveDoors(state);
  checkpoint(world, state, events);
  const cause = trap(world, state);
  if (cause !== null) { die(state, cause, events); return; }

  // R-OIL-2: hood toggles on the press; refused with no oil.
  if (pressed & BTN.hood) {
    if (p.oil > 0) { p.hooded = !p.hooded; events.push({ e: 'hood', on: p.hooded }); }
    else events.push({ e: 'msg', k: 'lanternOut' });
  }
  if (p.oil > 0) {
    p.oil = Math.max(0, p.oil - (p.hooded ? OIL_BURN_HOODED : OIL_BURN_OPEN));
    if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); }
  }
}

/** R-CP-2: entering a zone whose checkpoint lies further on than the current one. */
function checkpoint(world, state, events) {
  const p = state.player;
  const z = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
  if (z < 0) return;
  const cp = worldZones(world)[z].cp;
  if (cp === null || !cp.enter || z <= state.checkpoints[state.cp].zone) return;
  const entry = { zone: z, x: cp.x, z: cp.z, yaw: cp.yaw, life: lifeOf(state) };
  let n = state.checkpoints.findIndex((c) => c.zone === z);
  if (n < 0) { n = state.checkpoints.length; state.checkpoints.push(entry); } else state.checkpoints[n] = entry;
  state.cp = n;
  events.push({ e: 'checkpoint', zone: worldZones(world)[z].id });
}

/** R-TRAP-1: the trap under the player, if armed: returns the cause of death or null. Records lessons. */
function trap(world, state) {
  const p = state.player, i = fdiv(p.x, CELL_MM), j = fdiv(p.z, CELL_MM);
  const lx = p.x - i * CELL_MM, lz = p.z - j * CELL_MM;
  if (lx <= TRAP_LO || lx >= TRAP_HI || lz <= TRAP_LO || lz >= TRAP_HI) return null;
  const k = j * world.w + i, code = cellCode(world, i, j);
  if (code === CELL.PLATE) {
    if (slabAt(world, k) || state.sprung.includes(k)) return null;
    state.sprung.push(k);
    return 'slab';
  }
  if (code === CELL.HPIT) { if (!state.pits.includes(k)) state.pits.push(k); return 'pit'; }
  if (code === CELL.VOID) return 'chasm';
  if (code === CELL.VENT && ventFiring(ventAt(world, k), state.tick)) return 'vent';
  return null;
}

/** R-VENT-2: is the vent firing on the step that starts at tick n? */
export function ventFiring(v, n) {
  const u = (n + v.phase) % v.period;
  return u >= v.warn && u < v.warn + v.fire;
}

/** R-DEATH-1 */
function die(state, cause, events) {
  const p = state.player;
  state.dead = { cause, at: state.tick };
  state.deaths += 1;
  p.vx = 0; p.vz = 0; p.rx = 0; p.rz = 0;
  events.push({ e: 'death', cause });
}

/** R-RISE-1: rise at the current checkpoint, or (practice) at a chosen one reached this run. */
function rise(world, state, target, events) {
  let n = state.cp;
  if (state.mode === 'practice' && target !== 0) {
    n = state.checkpoints.findIndex((c) => c.zone === target - 1);
    if (n < 0) return;
  }
  const c = state.checkpoints[n], p = state.player, life = c.life;
  state.cp = n;
  state.doors.forEach((d, k) => { d.open = life.doors[k]; d.t = d.open ? DOOR_FULL : 0; });
  p.hp = 100;
  p.oil = Math.max(life.oil, RISE_OIL);
  p.hooded = life.hooded;
  p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.rx = 0; p.rz = 0;
  state.dead = null;
  events.push({ e: 'rise', zone: c.zone >= 0 ? worldZones(world)[c.zone].id : null });
}

/** R-ACT-1: open an interact door within reach. Anything else does nothing. */
function interact(world, state, n, events) {
  const ref = entityRef(world, n);
  if (!ref || ref.type !== 'door') return;
  const def = worldDoors(world)[ref.door], d = state.doors[ref.door], p = state.player;
  if (!def.interact || d.open) return;
  const dx = p.x - def.cx, dz = p.z - def.cz; // |dx|, |dz| <= 64*2400, so the squares stay below 2^36
  if (dx * dx + dz * dz > REACH_MM * REACH_MM) return;
  d.open = true;
  events.push({ e: 'door', id: def.id, open: true });
}

/**
 * R-MOVE-4: push a circle out of solid cells, then out of props. Three passes; each looks at the
 * 3x3 cells around the centre (rows outer, columns inner) and moves the centre to exactly r from the
 * nearest point of each solid cell it overlaps. A centre inside a solid cell goes back to where it
 * was before the move. Then every prop, in entity order.
 * Bounds (R-INT-2): cells: |dx|, |dz| <= 2400 + r, so dx*r and d2 stay below 2^23. Props: |dx|, |dz|
 * <= 64*2400, so d2 < 2^36; a push needs d2 < R^2 <= 910^2, so dx*R < 2^20.
 */
function pushOut(world, state, e, r, ox, oz) {
  const props = worldProps(world);
  for (let pass = 0; pass < 3; pass++) {
    const ci = fdiv(e.x, CELL_MM), cj = fdiv(e.z, CELL_MM);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const gi = ci + di, gj = cj + dj;
      if (!solidCell(world, state, gi, gj)) continue;
      const minx = gi * CELL_MM, minz = gj * CELL_MM;
      const qx = clamp(e.x, minx, minx + CELL_MM), qz = clamp(e.z, minz, minz + CELL_MM);
      const dx = e.x - qx, dz = e.z - qz, d2 = dx * dx + dz * dz;
      if (d2 === 0) { e.x = ox; e.z = oz; }
      else if (d2 < r * r) { const d = isqrt(d2); e.x = qx + idiv(dx * r, d); e.z = qz + idiv(dz * r, d); }
    }
    for (const o of props) {
      if (o.circle) {
        const dx = e.x - o.x, dz = e.z - o.z, d2 = dx * dx + dz * dz, rr = r + o.r;
        if (d2 > 0 && d2 < rr * rr) { const d = isqrt(d2); e.x = o.x + idiv(dx * rr, d); e.z = o.z + idiv(dz * rr, d); }
      } else {
        const qx = clamp(e.x, o.x0, o.x1), qz = clamp(e.z, o.z0, o.z1);
        const dx = e.x - qx, dz = e.z - qz, d2 = dx * dx + dz * dz;
        if (d2 > 0 && d2 < r * r) { const d = isqrt(d2); e.x = qx + idiv(dx * r, d); e.z = qz + idiv(dz * r, d); }
      }
    }
  }
}

/** Sim.hash(state) -> 32 hex chars: SHA-256 of the canonical form, first 16 bytes (R-HASH-1). */
export function hash(state) {
  return toHex(sha256(canonicalBytes(state)).subarray(0, 16));
}

export { clamp };
