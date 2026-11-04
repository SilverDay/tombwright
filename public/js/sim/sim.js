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
  worldItems, worldEyes, sightBlocked, worldBells, worldBellSets, worldLinks, worldHooks, worldMirrors, worldCrystals,
  CELL, DOOR_FULL, DOOR_STEP, DOOR_CLOSE_STEP,
} from './world.js';
import { runLinks, initLinkState, copyLinkState } from './links.js';

export const CORE_VERSION = 'm0.7';
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
// R-TOOL-2 cooldowns in ticks (Gloamhollow 0.7 s and 0.5 s). R-PEB-1: pouch. R-PEB-4: pick-up radius.
export const PROBE_CD = 21, PEBBLE_CD = 15, PEBBLE_MAX = 12, PICKUP_MM = 750;
// R-HP-1: hp in 1/30-hp units; regeneration +4 a tick once calm > 150 (Gloamhollow 4 hp/s after 5 s).
export const HP_UNIT = 30, HP_FULL = 100 * HP_UNIT, HP_REGEN = 4, CALM_MAX = 151;

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
      hp: HP_FULL, calm: CALM_MAX, oil: 100 * OIL_UNIT, hooded: false, hung: -1, // R-HP-1, R-HOOK-1
      flasks: 1, pebbles: 10, probeCd: 0, pebbleCd: 0, // R-OIL-3, R-PEB-1, R-TOOL-2
    },
    doors: worldDoors(world).map(() => ({ open: false, t: 0 })), // R-DOOR-2
    deaths: 0,
    dead: null,             // R-DEATH-1: { cause, at } while dead
    sprung: [],             // R-CP-3 lessons: plates sprung during play, cell indices
    pits: [],               // R-CP-3 lessons: hidden pits found
    marked: [],             // R-CP-3 lessons: plates found with the probe
    bridge: [],             // R-CP-3 lessons: bridge cells found
    floor: [],              // R-PEB-3: pebbles lying on the floor, { x, z }
    flying: [],             // R-PEB-2: pebbles in flight, { x, z, at }
    taken: [],              // R-ITEM-2: entity numbers of items taken
    eyes: worldEyes(world).map(() => 0), // R-EYES-1
    zone: startZone(world),  // R-ZONE-3
    sealed: [],              // R-DOOR-5 (a lesson)
    revealed: [],            // R-LINK-8: hidden items revealed, by entity number
    mirrors: worldMirrors(world).map((m) => m.start), // R-MIRROR-1
    bellSets: worldBellSets(world).map(() => ({ seq: [], solved: false })), // R-BELL-2
    links: initLinkState(worldLinks(world)),                               // R-LINK-4
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
  return {
    hp: p.hp, oil: p.oil, hooded: p.hooded, hung: p.hung, flasks: p.flasks, pebbles: p.pebbles,
    revealed: state.revealed.slice(), mirrors: state.mirrors.slice(),
    doors: state.doors.map((d) => d.open), floor: state.floor.map((f) => ({ x: f.x, z: f.z })), taken: state.taken.slice(),
    bellSets: copyBellSets(state.bellSets), links: copyLinkState(state.links),
  };
}

function copyBellSets(b) { return b.map((x) => ({ seq: x.seq.slice(), solved: x.solved })); }

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
    landPebbles(world, state, events);
  } else {
    const batch = [];                                 // R-LINK-5: batch 0
    live(world, state, input, pressed, events, batch);
    landPebbles(world, state, events);
    if (state.dead === null) links(world, state, batch, events); // R-LINK-7
    if (state.dead === null) regenerate(state.player);             // R-HP-1
  }

  state.prevButtons = input.buttons;
  state.tick += 1;
  return events;
}

/** R-DOOR-3: opening doors move on, closing ones move back (33 a tick: 0.7 s). */
function moveDoors(state) {
  for (const d of state.doors) {
    if (d.open && d.t < DOOR_FULL) d.t = Math.min(DOOR_FULL, d.t + DOOR_STEP);
    else if (!d.open && d.t > 0) d.t = Math.max(0, d.t - DOOR_CLOSE_STEP);
  }
}

/** R-LINK-7, R-LINK-8: run the links with the sim's conditions and effects. */
function links(world, state, batch, events) {
  const doors = worldDoors(world);
  runLinks(worldLinks(world), state.links, batch, {
    tick: state.tick,
    dead: () => state.dead !== null,
    fired: (id) => events.push({ e: 'link', id }),
    cond: (kind, arg) => {
      const p = state.player;
      switch (kind) {
        case 'doorOpen': return state.doors[arg].open;
        case 'inZone': return zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM)) === arg;
        case 'hasItem': return state.taken.includes(arg);
        case 'lanternHooded': return p.hooded === arg;
        case 'bellsSolved': return state.bellSets[arg].solved;
        case 'beamHits': return beamHits(world, state, arg);
        case 'linkActive': return state.links[worldLinks(world).findIndex((l) => l.id === arg)].active;
      }
      throw new Error('cond');
    },
    apply: (list) => {
      let changed = false;
      for (const fx of list) {
        if (fx.kind === 'message') { events.push({ e: 'message', text: fx.text }); continue; }
        if (fx.kind === 'damage') { hurt(state, fx.n, events); changed = true; if (state.dead !== null) return true; continue; }
        if (fx.kind === 'reveal') { if (!state.revealed.includes(fx.item)) { state.revealed.push(fx.item); changed = true; } continue; }
        if (fx.kind === 'hide') { const at = state.revealed.indexOf(fx.item); if (at >= 0) { state.revealed.splice(at, 1); changed = true; } continue; }
        const d = state.doors[fx.door], id = doors[fx.door].id, sealed = state.sealed.includes(fx.door);
        if (fx.kind === 'openDoor') {
          if (!sealed && !d.open) { d.open = true; changed = true; events.push({ e: 'door', id, open: true }); }
        } else if (fx.kind === 'closeDoor') {
          if (d.open) { d.open = false; changed = true; events.push({ e: 'door', id, open: false }); }
        } else if (!sealed) {           // sealDoor
          state.sealed.push(fx.door); d.open = false; changed = true;
          events.push({ e: 'door', id, open: false, sealed: true });
        }
      }
      return changed;
    },
  });
}

/** R-HP-1: regeneration once calm, then calm counts on (after the links, so a hurt tick doesn't heal). */
function regenerate(p) {
  if (p.hp < HP_FULL && p.calm > 150) p.hp = Math.min(HP_FULL, p.hp + HP_REGEN);
  p.calm = Math.min(CALM_MAX, p.calm + 1);
}

/** R-HP-2 */
function hurt(state, n, events) {
  const p = state.player;
  p.hp = Math.max(0, p.hp - HP_UNIT * n);
  p.calm = 0;
  events.push({ e: 'hurt', hp: idiv(p.hp, HP_UNIT) });
  if (p.hp === 0) die(state, 'damage', events);
}

/** One tick of a living player. */
function live(world, state, input, pressed, events, batch) {
  const p = state.player;
  p.yaw = input.yaw;
  p.pitch = input.pitch;

  // R-TOOL-1: tool presses, in button order, from where the player stood before moving.
  if (pressed & BTN.hood) {
    if (p.hung >= 0) events.push({ e: 'msg', k: 'lanternHung' });                     // R-HOOK-2
    else if (p.oil > 0) { p.hooded = !p.hooded; events.push({ e: 'hood', on: p.hooded }); } // R-OIL-2
    else events.push({ e: 'msg', k: 'lanternOut' });
  }
  if (pressed & BTN.probe) probe(world, state, events);
  if (pressed & BTN.pebble) throwPebble(world, state, events);
  if (pressed & BTN.oil) pourOil(p, events);
  if ((pressed & BTN.interact) && input.target !== 0) interact(world, state, input.target, events, batch); // R-ACT-1

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
  if (p.hung >= 0) {                                    // R-HOOK-3: the lantern holds you to its zone
    const hz = zoneAt(world, worldHooks(world)[p.hung].k);
    if (zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM)) !== hz) {
      p.x = ox; p.z = oz; p.vx = 0; p.vz = 0; p.rx = 0; p.rz = 0;
      events.push({ e: 'msg', k: 'lanternHung' });
    }
  }
  moveDoors(state);
  checkpoint(world, state, events);
  const zNow = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM)); // R-ZONE-3
  if (zNow !== state.zone) {
    if (state.zone >= 0) batch.push(['leaveZone', state.zone]);
    if (zNow >= 0) batch.push(['enterZone', zNow]);
    state.zone = zNow;
  }
  const cause = trap(world, state);
  if (cause !== null) { die(state, cause, events); return; }
  if (wakeEyes(world, state, events)) { die(state, 'eyes', events); return; }
  pickPebbles(state);

  // R-OIL-1/2: the lantern burns; at 0 it goes out and un-hoods.
  if (p.oil > 0) {
    p.oil = Math.max(0, p.oil - (p.hooded ? OIL_BURN_HOODED : OIL_BURN_OPEN));
    if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); }
  }
  // R-TOOL-2: cooldowns.
  if (p.probeCd > 0) p.probeCd -= 1;
  if (p.pebbleCd > 0) p.pebbleCd -= 1;
}

/** R-TOOL-1: the point at distance d (mm) ahead of the player, for yaw sine/cosine sy, cy. */
function ahead(p, sy, cy, d) { // |sy·d| <= 2^14 · 8600 < 2^28 (R-INT-2)
  return [p.x + idiv(-sy * d, TRIG_ONE), p.z + idiv(-cy * d, TRIG_ONE)];
}

/** A slab from the GDF or a plate sprung during play, at (i, j); false outside the grid. */
function slabOrSprung(world, state, i, j) {
  if (i < 0 || j < 0 || i >= world.w || j >= world.h) return false;
  const k = j * world.w + i;
  return slabAt(world, k) || state.sprung.includes(k);
}

/** R-PROBE-1, R-PROBE-2 */
function probe(world, state, events) {
  const p = state.player;
  if (p.probeCd > 0) return;
  p.probeCd = PROBE_CD;
  const sy = isin(p.yaw), cy = icos(p.yaw), pi = fdiv(p.x, CELL_MM), pj = fdiv(p.z, CELL_MM);
  let r = 2050, [tx, tz] = ahead(p, sy, cy, r);
  if (fdiv(tx, CELL_MM) === pi && fdiv(tz, CELL_MM) === pj) { r = 2600; [tx, tz] = ahead(p, sy, cy, r); }
  for (let s = 1; s <= 8; s++) {
    // r·s <= 2600·8
    const [qx, qz] = ahead(p, sy, cy, idiv(r * s, 8)), a = fdiv(qx, CELL_MM), b = fdiv(qz, CELL_MM);
    if (solidCell(world, state, a, b) && !slabOrSprung(world, state, a, b)) { events.push({ e: 'probe', k: 'wall' }); return; }
  }
  const i = fdiv(tx, CELL_MM), j = fdiv(tz, CELL_MM), k = j * world.w + i, code = cellCode(world, i, j);
  let what = 'stone';
  if (code === CELL.PLATE) {
    if (slabOrSprung(world, state, i, j)) what = 'slab';
    else if (state.marked.includes(k)) what = 'plateKnown';
    else { state.marked.push(k); what = 'plate'; }
  } else if (code === CELL.HPIT) {
    if (state.pits.includes(k)) what = 'pitKnown'; else { state.pits.push(k); what = 'pit'; }
  } else if (code === CELL.VOID) what = 'void';
  else if (code === CELL.BRIDGE) { if (!state.bridge.includes(k)) state.bridge.push(k); what = 'bridge'; }
  else if (code === CELL.VENT) what = 'vent';
  else if (code === CELL.ALCOVE) what = 'alcove';
  events.push({ e: 'probe', k: what });
}

/** R-PEB-1, R-PEB-2 */
function throwPebble(world, state, events) {
  const p = state.player;
  if (p.pebbleCd > 0) return;
  if (p.pebbles <= 0) { events.push({ e: 'msg', k: 'pouchEmpty' }); return; }
  p.pebbles -= 1;
  p.pebbleCd = PEBBLE_CD;
  const want = clamp(6200 + idiv(6000 * p.pitch, 127), 1600, 8500);
  const sy = isin(p.yaw), cy = icos(p.yaw);
  let d = 400, lx = p.x, lz = p.z;
  while (d < want) {
    const [nx, nz] = ahead(p, sy, cy, d), i = fdiv(nx, CELL_MM), j = fdiv(nz, CELL_MM);
    if (slabOrSprung(world, state, i, j)) { lx = nx; lz = nz; break; }
    if (solidCell(world, state, i, j)) break;
    lx = nx; lz = nz; d += 120;
  }
  const flight = idiv(21000 + 3 * d + 1999, 2000);
  state.flying.push({ x: lx, z: lz, at: state.tick + flight - 1 });
  events.push({ e: 'throw' });
}

/** R-PEB-3: pebbles due this tick land, in list order. */
function landPebbles(world, state, events) {
  if (state.flying.length === 0) return;
  const keep = [];
  for (const f of state.flying) {
    if (f.at !== state.tick) { keep.push(f); continue; }
    const i = fdiv(f.x, CELL_MM), j = fdiv(f.z, CELL_MM), k = j * world.w + i, code = cellCode(world, i, j);
    let what = 'floor', rests = true;
    if (slabOrSprung(world, state, i, j)) what = 'slab';
    else if (code === CELL.PLATE) { state.sprung.push(k); what = 'plate'; rests = false; }
    else if (code === CELL.HPIT) { if (!state.pits.includes(k)) state.pits.push(k); what = 'pit'; rests = false; }
    else if (code === CELL.VOID) { what = 'void'; rests = false; }
    else if (code === CELL.BRIDGE) { if (!state.bridge.includes(k)) state.bridge.push(k); what = 'bridge'; }
    if (rests) state.floor.push({ x: f.x, z: f.z });
    events.push({ e: 'land', k: what });
  }
  state.flying = keep;
}

/** R-PEB-4 */
function pickPebbles(state) {
  const p = state.player;
  for (let n = state.floor.length - 1; n >= 0; n--) {
    const f = state.floor[n], dx = f.x - p.x, dz = f.z - p.z; // |dx|, |dz| <= 64*2400: squares < 2^36
    if (p.pebbles >= PEBBLE_MAX || dx * dx + dz * dz > PICKUP_MM * PICKUP_MM) continue;
    state.floor.splice(n, 1);
    p.pebbles += 1;
  }
}

/** R-OIL-3 */
function pourOil(p, events) {
  if (p.flasks <= 0) { events.push({ e: 'msg', k: 'noFlasks' }); return; }
  if (p.oil >= 96 * OIL_UNIT) { events.push({ e: 'msg', k: 'lanternFull' }); return; }
  const relit = p.oil === 0;
  p.flasks -= 1;
  p.oil = Math.min(100 * OIL_UNIT, p.oil + 60 * OIL_UNIT);
  events.push({ e: 'oil', relit });
}

/** R-EYES-2: returns true if any eyes meter reached its wake time. */
function wakeEyes(world, state, events) {
  const eyes = worldEyes(world);
  if (eyes.length === 0) return false;
  const p = state.player, z = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
  const lit = p.oil > 0 && !p.hooded && p.hung < 0;
  let woke = false;
  eyes.forEach((ey, n) => {
    if (z === ey.zone && lit) {
      if (state.eyes[n] === 0) events.push({ e: 'eyes', id: ey.id });
      state.eyes[n] += 5;
    } else state.eyes[n] = Math.max(0, state.eyes[n] - 7);
  });
  eyes.forEach((ey, n) => { if (state.eyes[n] >= 5 * ey.wake) woke = true; });
  return woke;
}

/** R-LOS-1 */
function lineOfSight(world, state, ix, iz) {
  // R-INT-2: every coordinate lies in the 64·2400 mm grid, so |ex|, |vx| < 2^18: squares < 2^36; |v·s| < 2^18 · n.
  const p = state.player, ex = ix - p.x, ez = iz - p.z, e = isqrt(ex * ex + ez * ez);
  const ax = e > 0 ? ix - idiv(ex * 300, e) : ix, az = e > 0 ? iz - idiv(ez * 300, e) : iz;
  const vx = ax - p.x, vz = az - p.z, n = idiv(isqrt(vx * vx + vz * vz) + 599, 600);
  for (let s = 1; s < n; s++) {
    if (sightBlocked(world, state, fdiv(p.x + idiv(vx * s, n), CELL_MM), fdiv(p.z + idiv(vz * s, n), CELL_MM))) return false;
  }
  return true;
}

/** R-ITEM-2 */
function takeItem(world, state, n, it, events, batch) {
  const p = state.player;
  if (it.kind === 'rubble' ? p.pebbles >= PEBBLE_MAX : state.taken.includes(n)) return;
  if (it.hidden && !state.revealed.includes(n)) return; // R-ITEM-1
  const dx = p.x - it.x, dz = p.z - it.z; // squares < 2^36
  if (dx * dx + dz * dz > it.reach * it.reach || !lineOfSight(world, state, it.x, it.z)) return;
  batch.push(['interact', n]);
  if (it.kind === 'rubble') p.pebbles = PEBBLE_MAX;
  else { state.taken.push(n); if (it.kind === 'flask') p.flasks += 1; batch.push(['itemTaken', n]); }
  events.push({ e: 'item', id: it.id, kind: it.kind });
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
  state.doors.forEach((d, k) => { d.open = life.doors[k] && !state.sealed.includes(k); d.t = d.open ? DOOR_FULL : 0; });
  p.hp = HP_FULL;
  p.calm = CALM_MAX;
  state.bellSets = copyBellSets(life.bellSets);
  state.links = copyLinkState(life.links);
  p.oil = Math.max(life.oil, RISE_OIL);
  p.hooded = life.hooded;
  p.hung = life.hung;
  state.revealed = life.revealed.slice();
  state.mirrors = life.mirrors.slice();
  p.flasks = life.flasks;
  p.pebbles = life.pebbles;
  state.floor = life.floor.map((f) => ({ x: f.x, z: f.z }));
  state.taken = life.taken.slice();
  state.flying = [];
  state.eyes = state.eyes.map(() => 0);
  p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.rx = 0; p.rz = 0;
  state.zone = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
  state.dead = null;
  events.push({ e: 'rise', zone: c.zone >= 0 ? worldZones(world)[c.zone].id : null });
}

/** R-ACT-1: interact with a door, item or bell within reach. Anything else does nothing. */
function interact(world, state, n, events, batch) {
  const ref = entityRef(world, n);
  if (ref && ref.type === 'item') { takeItem(world, state, n, worldItems(world)[ref.item], events, batch); return; }
  if (ref && ref.type === 'bell') { ringBell(world, state, n, worldBells(world)[ref.bell], events, batch); return; }
  if (ref && ref.type === 'lampHook') { useHook(world, state, n, ref.hook, events, batch); return; }
  if (ref && ref.type === 'mirror') { turnMirror(world, state, n, ref.mirror, events, batch); return; }
  if (!ref || ref.type !== 'door') return;
  const def = worldDoors(world)[ref.door], d = state.doors[ref.door], p = state.player;
  if (d.open) return;
  const dx = p.x - def.cx, dz = p.z - def.cz; // |dx|, |dz| <= 64*2400, so the squares stay below 2^36
  if (dx * dx + dz * dz > REACH_MM * REACH_MM) return;
  batch.push(['interact', n]);
  if (!def.interact || state.sealed.includes(ref.door)) return;
  d.open = true;
  events.push({ e: 'door', id: def.id, open: true });
}

/** R-HOOK-2 */
function useHook(world, state, n, h, events, batch) {
  const p = state.player, hook = worldHooks(world)[h], dx = p.x - hook.x, dz = p.z - hook.z; // squares < 2^36
  if (dx * dx + dz * dz > hook.reach * hook.reach || !lineOfSight(world, state, hook.x, hook.z)) return;
  batch.push(['interact', n]);
  if (p.hung === h) p.hung = -1;
  else if (p.hung >= 0) return;
  else if (p.oil > 0) { p.hung = h; p.hooded = false; }
  else { events.push({ e: 'msg', k: 'lanternOut' }); return; }
  events.push({ e: 'hook', id: hook.id, hung: p.hung === h });
}

/** R-MIRROR-2 */
function turnMirror(world, state, n, mi, events, batch) {
  const p = state.player, m = worldMirrors(world)[mi], dx = p.x - m.x, dz = p.z - m.z; // squares < 2^36
  if (dx * dx + dz * dz > m.reach * m.reach || !lineOfSight(world, state, m.x, m.z)) return;
  batch.push(['interact', n]);
  state.mirrors[mi] = 1 - state.mirrors[mi];
  events.push({ e: 'mirror', id: m.id, turn: state.mirrors[mi] });
}

/** R-BEAM-1, R-BEAM-2: does the hung lantern's beam end on crystal c? */
function beamHits(world, state, c) {
  const h = state.player.hung;
  if (h < 0) return false;
  const hook = worldHooks(world)[h], mirrors = worldMirrors(world), cr = worldCrystals(world)[c];
  let i = hook.i, j = hook.j, di = hook.di, dj = hook.dj;
  for (let n = 0; n < 80; n++) {
    if (solidCell(world, state, i + di, j + dj)) return j * world.w + i === cr.k && di === cr.di && dj === cr.dj;
    i += di; j += dj;
    const k = j * world.w + i, m = mirrors.findIndex((x) => x.k === k);
    if (m >= 0) [di, dj] = state.mirrors[m] === 0 ? [-dj, -di] : [dj, di];
  }
  return false;
}

/** R-BELL-3 */
function ringBell(world, state, n, b, events, batch) {
  const p = state.player, dx = p.x - b.x, dz = p.z - b.z; // squares < 2^36
  if (dx * dx + dz * dz > b.reach * b.reach || !lineOfSight(world, state, b.x, b.z)) return;
  batch.push(['interact', n]);
  events.push({ e: 'bell', id: b.id });
  const set = worldBellSets(world)[b.set], st = state.bellSets[b.set];
  if (st.solved) return;
  st.seq.push(b.index);
  if (st.seq.some((x, k) => x !== set.order[k])) {
    st.seq = [];
    batch.push(['bellsWrong', b.set]);
    events.push({ e: 'bellsWrong', id: set.id });
  } else if (st.seq.length === set.order.length) {
    st.solved = true;
    events.push({ e: 'bellsSolved', id: set.id });
  }
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
