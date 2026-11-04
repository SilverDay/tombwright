// Tombwright sim core (JS). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
// Pure module: no DOM, no Math.random, no Date, no floats in state.
// Mirror: src/Sim/Sim.php. Any change here needs the same change there + golden vectors.
import { idiv, fdiv, isqrt, clamp } from './int.js';
import { isin, icos, TRIG_ONE } from './sine.js';
import { rngSeed, rngBelow } from './rng.js';
import { canonicalBytes } from './canon.js';
import { sha256, toHex } from './sha256.js';
import {
  loadWorld, solidCell, assertWorld, worldProps, worldDoors, entityRef, cellCode, slabAt, ventAt, zoneAt, worldZones, startZone,
  worldItems, worldEyes, sightBlocked, worldBells, worldBellSets, worldLinks, worldHooks, worldMirrors, worldCrystals, worldChests, alcoveAt, worldFoes, worldGroups, MAX_AWAKE, worldBraziers, worldBoss, worldBossBox, worldExit,
  CELL, DOOR_FULL, DOOR_STEP, DOOR_CLOSE_STEP,
} from './world.js';
import { runLinks, initLinkState, copyLinkState } from './links.js';

export const CORE_VERSION = 'm0.14';
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
// R-STRIKE-*: swing cooldown and blow delay (Gloamhollow 0.45 s, 110 ms), reach, knock-back, stun. R-FOE-7: ranges.
export const STRIKE_CD = 14, BLOW_DELAY = 3, STRIKE_REACH = 2250, KNOCKBACK = 500, STUN = 9;
const SIGHT_LIT = 6 * 2400, SIGHT_DARK = 3 * 2400, NOISE_RUN = 4 * 2400, NOISE_SWING = 3 * 2400, NOISE_PEBBLE = 3 * 2400;

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
      flasks: 1, pebbles: 10, probeCd: 0, pebbleCd: 0, strikeCd: 0, busy: 0, busyOn: -1, // R-OIL-3, R-PEB-1, R-TOOL-2, R-STRIKE-1, R-BRAZIER-2
      ...freshFx(),                                   // R-POW-*
    },
    doors: worldDoors(world).map(() => ({ open: false, t: 0 })), // R-DOOR-2
    deaths: 0,
    dead: null,             // R-DEATH-1: { cause, at } while dead
    sprung: [],             // R-CP-3 lessons: plates sprung during play, cell indices
    pits: [],               // R-CP-3 lessons: hidden pits found
    marked: [],             // R-CP-3 lessons: plates found with the probe
    bridge: [],             // R-CP-3 lessons: bridge cells found
    floor: [],              // R-PEB-3: pebbles lying on the floor, { x, z }
    loot: [],               // R-THIEF-4: what killed thieves dropped, { x, z, n, f, p }
    flying: [],             // R-PEB-2: pebbles in flight, { x, z, at }
    taken: [],              // R-ITEM-2: entity numbers of items taken
    eyes: worldEyes(world).map(() => 0), // R-EYES-1
    zone: startZone(world),  // R-ZONE-3
    sealed: [],              // R-DOOR-5 (a lesson)
    revealed: [],            // R-LINK-8: hidden items revealed, by entity number
    mirrors: worldMirrors(world).map((m) => m.start), // R-MIRROR-1
    chests: worldChests(world).map(() => ({ look: false, sprung: false, open: false })), // R-CHEST-1
    sealing: [],             // R-ALCOVE-2: doors about to close, { door, left }
    foes: worldFoes(world).map((f) => freshFoe(f, f.start)), // R-FOE-3
    groups: worldGroups(world).map((g) => (g.dormant ? 'dormant' : 'awake')),
    blows: [],               // R-STRIKE-1: { foe, at } (foe -1: the boss)
    braziers: worldBraziers(world).map((b) => b.lit),         // R-BRAZIER-1
    boss: worldBoss(world) === null ? null : freshBoss(worldBoss(world)), // R-BOSS-2
    won: null,               // R-EXIT-1: the tick the run was won
    bellSets: worldBellSets(world).map(() => ({ seq: [], solved: false })), // R-BELL-2
    links: initLinkState(worldLinks(world)),                               // R-LINK-4
    checkpoints: [],        // R-CP-1
    cp: 0,
    prevButtons: 0,
  };
  st.checkpoints.push({ zone: startZone(world), x: st.player.x, z: st.player.z, yaw: 0, life: lifeOf(st) });
  return st;
}

/** R-POW-*: the touch powers' marks on the player, as at the start and after every rise. */
function freshFx() {
  return { doused: false, frozen: 0, freezeImm: 0, held: -1, heldT: 0, holdImm: 0, confused: 0, poison: 0, maxHp: HP_FULL };
}

/** R-CP-3: what a death rolls back. */
function lifeOf(state) {
  const p = state.player;
  return {
    hp: p.hp, oil: p.oil, hooded: p.hooded, hung: p.hung, flasks: p.flasks, pebbles: p.pebbles,
    revealed: state.revealed.slice(), mirrors: state.mirrors.slice(),
    chests: state.chests.map((c) => ({ look: c.look, sprung: c.sprung, open: c.open })), groups: state.groups.slice(),
    braziers: state.braziers.slice(), boss: state.boss === null ? null : state.boss.st === 'asleep' ? 'asleep' : state.boss.st === 'dead' ? 'dead' : 'awake',
    doors: state.doors.map((d) => d.open), floor: state.floor.map((f) => ({ x: f.x, z: f.z })), loot: state.loot.map((l) => ({ ...l })), taken: state.taken.slice(),
    bellSets: copyBellSets(state.bellSets), links: copyLinkState(state.links),
    foes: state.foes.map((f) => [f.loot, f.lf, f.lp]),  // R-CP-3: carried loot (decision #70)
  };
}

/** R-BOSS-2: the boss as she starts (and comes back, R-BOSS-6). */
function freshBoss(def) {
  return { st: 'asleep', x: def.x, z: def.z, hp: def.kind.strikes, phase: 1, t: 0, atk: 0, feedCd: 0, target: -1, feedHits: 0 };
}

/** R-FOE-3: a foe as it starts (or comes back, R-FOE-8). */
function freshFoe(def, st) {
  if (st === 'asleep' && def.disguise !== null) st = 'disguised'; // R-MIMIC-1
  return { st, x: def.x, z: def.z, hp: def.kind.strikes, t: 0, atk: def.kind.firstAttack, stun: 0, wake: false, gx: -1, gz: -1, rg: 0, ft: 0, fa: 0, loot: 0, lf: 0, lp: 0 };
}

function copyBellSets(b) { return b.map((x) => ({ seq: x.seq.slice(), solved: x.solved })); }

/** Sim.step(world, state, input) -> events. Mutates state; advances exactly one tick. */
export function step(world, state, input) {
  assertWorld(world);
  if (state.world !== world.id) throw new Error('state belongs to another world');
  if (state.core !== CORE_VERSION) throw new Error('state from another core version'); // R-WORLD-3
  if (state.dead !== null && state.mode === 'ironman') throw new Error('the run is over'); // R-DEATH-3
  if (state.won !== null) throw new Error('the run is won');                                 // R-EXIT-1
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
    const P0 = state.player, wasBusy = P0.busy > 0 || P0.frozen > 0 || P0.held >= 0; // R-FOE-7: no running noise while busy or rooted (R-POW-8)
    live(world, state, input, pressed, events, batch);
    const on = () => state.dead === null && state.won === null;
    if (on()) updateFoes(world, state, input, events, batch, wasBusy); // R-FOE-6
    if (on()) updateBoss(world, state, events, batch);       // R-BOSS-4
    landPebbles(world, state, events);
    if (on()) links(world, state, batch, events); // R-LINK-7
    if (on()) regenerate(state.player);             // R-HP-1
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
        case 'lanternHung': return (p.hung >= 0) === arg;
        case 'bellsSolved': return state.bellSets[arg].solved;
        case 'beamHits': return beamHits(world, state, arg);
        case 'bossAwake': return state.boss.st !== 'asleep' && state.boss.st !== 'dead';
        case 'lightLit': return state.braziers[arg];
        case 'foesAlive': return worldGroups(world)[arg].foes.some((n) => { const st = state.foes[n].st; return st !== 'dormant' && st !== 'dead'; });
        case 'linkActive': return state.links[worldLinks(world).findIndex((l) => l.id === arg)].active;
      }
      throw new Error('cond');
    },
    apply: (list) => {
      let changed = false;
      for (const fx of list) {
        if (fx.kind === 'message') { events.push({ e: 'message', text: fx.text }); continue; }
        if (fx.kind === 'wakeBoss') {                      // R-BOSS-3
          if (state.boss.st === 'asleep') { state.boss.st = 'stalk'; state.boss.atk = worldBoss(world).kind.wakeAtk; changed = true; events.push({ e: 'boss', st: 'stalk' }); }
          continue;
        }
        if (fx.kind === 'lightOn' || fx.kind === 'lightOff') {
          const lit = fx.kind === 'lightOn';
          if (state.braziers[fx.brazier] !== lit) { state.braziers[fx.brazier] = lit; changed = true; events.push({ e: 'brazier', id: worldBraziers(world)[fx.brazier].id, lit }); }
          continue;
        }
        if (fx.kind === 'setCheckpoint') { reachCheckpoint(world, state, fx.zone, events); changed = true; continue; }
        if (fx.kind === 'spawnFoes') {                     // R-FOE-4
          let woke = false;
          for (const n of worldGroups(world)[fx.group].foes) if (state.foes[n].st === 'dormant' && !state.foes[n].wake) { requestWake(world, state, n, events); woke = true; }
          if (state.groups[fx.group] !== 'defeated' && state.groups[fx.group] !== 'spawned') { state.groups[fx.group] = 'spawned'; woke = true; }
          if (woke) changed = true;
          continue;
        }
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
  if (p.hp < p.maxHp && p.calm > 150 && p.poison === 0) p.hp = Math.min(p.maxHp, p.hp + HP_REGEN); // R-POW-6, R-POW-7
  p.calm = Math.min(CALM_MAX, p.calm + 1);
}

/** R-HP-2 */
function hurt(state, n, events, cause = 'damage') {
  const p = state.player;
  p.hp = Math.max(0, p.hp - HP_UNIT * n);
  p.calm = 0;
  events.push({ e: 'hurt', hp: idiv(p.hp, HP_UNIT) });
  if (p.hp === 0) die(state, cause, events);
}

/** One tick of a living player. */
function live(world, state, input, pressed, events, batch) {
  const p = state.player;
  p.yaw = input.yaw;
  p.pitch = input.pitch;

  // R-POW-4: a seizing foe lets go when it dies, after 5 s, or once it is out of reach.
  if (p.held >= 0) {
    const f = state.foes[p.held], hx = f.x - p.x, hz = f.z - p.z; // squares < 2^36
    if (f.st === 'dead' || p.heldT === 0 || hx * hx + hz * hz > 2600 * 2600) { p.held = -1; p.holdImm = 90; events.push({ e: 'free' }); }
  }

  // R-ALCOVE-2: sprung alcoves' doors close after their delay.
  if (state.sealing.length > 0) {
    const keep = [];
    for (const sl of state.sealing) {
      sl.left -= 1;
      if (sl.left > 0) { keep.push(sl); continue; }
      const d = state.doors[sl.door];
      if (d.open) { d.open = false; events.push({ e: 'door', id: worldDoors(world)[sl.door].id, open: false, sealed: true }); }
    }
    state.sealing = keep;
  }

  // R-TOOL-1: tool presses, in button order, from where the player stood before moving (none while busy, R-BRAZIER-2).
  const busy = p.busy > 0 || p.frozen > 0;            // R-POW-8: frozen counts as busy
  if (busy) pressed = 0;
  if (pressed & BTN.hood) {
    if (p.hung >= 0) events.push({ e: 'msg', k: 'lanternHung' });                     // R-HOOK-2
    else if (p.doused && p.oil > 0) { p.busy = 30; p.busyOn = -2; events.push({ e: 'busy', id: null }); } // R-POW-2: relight
    else if (p.oil > 0 && !p.doused) { p.hooded = !p.hooded; events.push({ e: 'hood', on: p.hooded }); } // R-OIL-2
    else events.push({ e: 'msg', k: 'lanternOut' });
  }
  if (pressed & BTN.probe) probe(world, state, events);
  if (pressed & BTN.pebble) throwPebble(world, state, events);
  if (pressed & BTN.oil) pourOil(p, events);
  if ((pressed & BTN.interact) && input.target !== 0) interact(world, state, input.target, events, batch); // R-ACT-1
  if (state.dead !== null) { moveDoors(state); return; } // R-CHEST-2: the needles (doors still move, R-DEATH-2)
  if (!busy && (input.buttons & BTN.strike) && p.strikeCd === 0) swing(world, state, events); // R-STRIKE-1: held, not pressed

  // R-MOVE-2: normalise the move vector to length <= 127.
  let [fw, st] = busy || p.held >= 0 ? [0, 0] : input.move; // R-POW-8: frozen or held
  const m2 = fw * fw + st * st;
  if (m2 > 127 * 127) { const len = isqrt(m2); fw = idiv(fw * 127, len); st = idiv(st * 127, len); }
  if (p.confused > 0) {                                 // R-POW-8: the move is turned; |fw·cos| < 2^7·2^14
    const n = state.tick, a = idiv(587 * isin(50 * n) + 293 * isin(111 * n), TRIG_ONE), ca = icos(a), sa = isin(a);
    [fw, st] = [idiv(fw * ca - st * sa, TRIG_ONE), idiv(fw * sa + st * ca, TRIG_ONE)];
  }
  const speed = (input.buttons & BTN.run) ? RUN_MM_S : WALK_MM_S;
  const sy = isin(p.yaw), cy = icos(p.yaw);
  // Gloamhollow: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
  const den = 127 * TRIG_ONE;
  const tx = idiv(speed * (-sy * fw + cy * st), den);
  const tz = idiv(speed * (-cy * fw - sy * st), den);
  // R-MOVE-3: velocity eases toward target by 2/5 per tick (Gloamhollow's min(1, dt*12) at 30 Hz).
  p.vx += idiv((tx - p.vx) * 2, 5);
  p.vz += idiv((tz - p.vz) * 2, 5);
  if (p.frozen > 0 || p.held >= 0) { p.vx = idiv(p.vx, 2); p.vz = idiv(p.vz, 2); } // R-POW-8: rooted
  // R-MOVE-3: integrate with an exact remainder so no distance is lost.
  const ax = p.vx + p.rx, az = p.vz + p.rz;
  const dx = idiv(ax, TICK_HZ), dz = idiv(az, TICK_HZ);
  p.rx = ax - dx * TICK_HZ; p.rz = az - dz * TICK_HZ;
  const ox = p.x, oz = p.z;
  p.x += dx; p.z += dz;
  pushOut(world, state, p, PLAYER_R_MM, ox, oz, true);
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
  const cause = trap(world, state, events);
  if (cause !== null) { die(state, cause, events); return; }
  if (wakeEyes(world, state, events)) { die(state, 'eyes', events); return; }
  pickPebbles(state);
  const ex = worldExit(world);                          // R-EXIT-1
  if (ex !== null && (ex.boss ? state.boss.st === 'dead' : ex.item === 0 || state.taken.includes(ex.item))) {
    const dx = p.x - ex.x, dz = p.z - ex.z;             // squares < 2^36
    if (dx * dx + dz * dz < 1000 * 1000) { state.won = state.tick; events.push({ e: 'won' }); return; }
  }

  // R-OIL-1/2: the lantern burns; at 0 it goes out and un-hoods.
  if (p.oil > 0 && !p.doused) {                         // R-POW-2: a doused lantern doesn't burn
    p.oil = Math.max(0, p.oil - (p.hooded ? OIL_BURN_HOODED : OIL_BURN_OPEN));
    if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); }
  }
  // R-TOOL-2: cooldowns.
  if (p.probeCd > 0) p.probeCd -= 1;
  if (p.pebbleCd > 0) p.pebbleCd -= 1;
  if (p.strikeCd > 0) p.strikeCd -= 1;
  for (const k of ['frozen', 'freezeImm', 'heldT', 'holdImm', 'confused', 'poison']) if (p[k] > 0) p[k] -= 1; // R-POW-*
  if (p.busy > 0) {                                     // R-BRAZIER-2: the brazier catches (R-POW-2: or the lantern)
    p.busy -= 1;
    if (p.busy === 0 && p.busyOn === -2) { p.doused = false; p.busyOn = -1; events.push({ e: 'relit' }); }
    else if (p.busy === 0) { state.braziers[p.busyOn] = true; events.push({ e: 'brazier', id: worldBraziers(world)[p.busyOn].id, lit: true }); p.busyOn = -1; }
  }
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
  if (probeChest(world, state, events)) return;
  const sy = isin(p.yaw), cy = icos(p.yaw), pi = fdiv(p.x, CELL_MM), pj = fdiv(p.z, CELL_MM);
  let r = 2050, [tx, tz] = ahead(p, sy, cy, r);
  if (fdiv(tx, CELL_MM) === pi && fdiv(tz, CELL_MM) === pj) { r = 2600; [tx, tz] = ahead(p, sy, cy, r); }
  for (let s = 1; s <= 8; s++) {
    // r·s <= 2600·8
    const [qx, qz] = ahead(p, sy, cy, idiv(r * s, 8)), a = fdiv(qx, CELL_MM), b = fdiv(qz, CELL_MM);
    if (solidCell(world, state, a, b) && !slabOrSprung(world, state, a, b)) { events.push({ e: 'probe', k: 'wall' }); return; }
  }
  const i = fdiv(tx, CELL_MM), j = fdiv(tz, CELL_MM), k = j * world.w + i, code = cellCode(world, i, j);
  const mimic = state.foes.findIndex((f) => f.st === 'disguised' && fdiv(f.x, CELL_MM) === i && fdiv(f.z, CELL_MM) === j);
  if (mimic >= 0) {                                     // R-MIMIC-1: the pole finds it out, safely
    requestWake(world, state, mimic, events);
    events.push({ e: 'probe', k: 'mimic' }, { e: 'reveal', id: worldFoes(world)[mimic].id, safe: true });
    return;
  }
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
  else if (code === CELL.ALCOVE) {
    const a = alcoveAt(world, k);
    if (a !== undefined && !a.drown && !state.sealed.includes(a.door)) { springAlcove(state, a, false, events); what = 'tip'; } else what = 'alcove';
  }
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
    const al = code === CELL.ALCOVE ? alcoveAt(world, k) : undefined;
    if (slabOrSprung(world, state, i, j)) what = 'slab';
    else if (al !== undefined && !state.sealed.includes(al.door) && state.doors[al.door].open) { springAlcove(state, al, false, events); what = 'alcove'; rests = false; }
    else if (code === CELL.PLATE) { state.sprung.push(k); what = 'plate'; rests = false; }
    else if (code === CELL.HPIT) { if (!state.pits.includes(k)) state.pits.push(k); what = 'pit'; rests = false; }
    else if (code === CELL.VOID) { what = 'void'; rests = false; }
    else if (code === CELL.BRIDGE) { if (!state.bridge.includes(k)) state.bridge.push(k); what = 'bridge'; }
    if (rests) state.floor.push({ x: f.x, z: f.z });
    events.push({ e: 'land', k: what });
    if (state.dead === null) noise(world, state, f.x, f.z, NOISE_PEBBLE, 'pebble', events); // R-FOE-7
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
  const lit = p.oil > 0 && !p.hooded && p.hung < 0 && !p.doused; // R-POW-1
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

/** R-LOS-1: from the player to a point. */
function lineOfSight(world, state, ix, iz) { return losFrom(world, state, state.player.x, state.player.z, ix, iz); }

/** R-LOS-2: from (px, pz) to (ix, iz), aimed 300 mm short. */
function losFrom(world, state, px, pz, ix, iz) {
  // R-INT-2: every coordinate lies in the 64·2400 mm grid, so |ex|, |vx| < 2^18: squares < 2^36; |v·s| < 2^18 · n.
  const ex = ix - px, ez = iz - pz, e = isqrt(ex * ex + ez * ez);
  const ax = e > 0 ? ix - idiv(ex * 300, e) : ix, az = e > 0 ? iz - idiv(ez * 300, e) : iz;
  const vx = ax - px, vz = az - pz, n = idiv(isqrt(vx * vx + vz * vz) + 599, 600);
  for (let s = 1; s < n; s++) {
    if (sightBlocked(world, state, fdiv(px + idiv(vx * s, n), CELL_MM), fdiv(pz + idiv(vz * s, n), CELL_MM))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- foes (R-FOE-*, R-STRIKE-*)

const isAwake = (st) => st === 'idle' || st === 'hunting' || st === 'rising';
const awakeCount = (state) => state.foes.reduce((a, f) => a + (isAwake(f.st) ? 1 : 0), 0);

function foeEvent(world, n, st, events) { events.push({ e: 'foe', id: worldFoes(world)[n].id, st }); }

/** R-FOE-4: wake an asleep or dormant foe, or queue the wake while 8 are awake. */
function requestWake(world, state, n, events) {
  const f = state.foes[n], kind = worldFoes(world)[n].kind;
  if (f.st !== 'asleep' && f.st !== 'dormant' && f.st !== 'disguised') return; // R-MIMIC-1: revealed like waking
  if (awakeCount(state) >= MAX_AWAKE) { if (f.st === 'disguised') f.st = 'asleep'; f.wake = true; return; } // R-MIMIC-1: found out over the cap (decision #71)
  f.wake = false;
  if (f.st === 'dormant' && kind.rise > 0) { f.st = 'rising'; f.t = kind.rise; } else { f.st = 'hunting'; f.t = 0; }
  foeEvent(world, n, f.st, events);
}

/** R-FOE-7: noise of `kind` ('run', 'swing', 'pebble') from (x, z), reaching `range` mm. */
function noise(world, state, x, z, range, kind, events) {
  state.foes.forEach((f, n) => {
    const dx = f.x - x, dz = f.z - z; // squares < 2^36
    if (dx * dx + dz * dz > range * range) return;
    if (f.st === 'asleep') requestWake(world, state, n, events);
    else if (f.st === 'idle') {
      // R-FOE-7: a landing pebble is a goal, except for the flytrap (speed 0), which takes none.
      if (kind === 'pebble') { if (worldFoes(world)[n].kind.speed > 0) { f.gx = x; f.gz = z; f.t = 300; } } else { f.st = 'hunting'; f.t = 0; f.gx = -1; f.gz = -1; foeEvent(world, n, 'hunting', events); }
    }
  });
}

/** R-STRIKE-1 */
function swing(world, state, events) {
  const p = state.player, defs = worldFoes(world), sy = isin(p.yaw), cy = icos(p.yaw);
  p.strikeCd = STRIKE_CD;
  events.push({ e: 'swing' });
  let best = -1, bd = 0;
  state.foes.forEach((f, n) => {
    if (f.st !== 'asleep' && f.st !== 'idle' && f.st !== 'hunting' && f.st !== 'disguised') return; // R-MIMIC-1
    const dx = f.x - p.x, dz = f.z - p.z, d = isqrt(dx * dx + dz * dz); // squares < 2^36
    // |dx·sy| < 2^18 · 2^14 = 2^32. d = 0 isn't in front (Gloamhollow `d || 1`).
    if (d === 0 || d > STRIKE_REACH + idiv(6 * defs[n].kind.radius, 10) || 2 * (dx * -sy + dz * -cy) < d * TRIG_ONE) return;
    if (best < 0 || d < bd) { best = n; bd = d; }
  });
  const B = state.boss;
  if (B !== null && B.st !== 'asleep' && B.st !== 'dead') {   // R-BOSS-5: she is a target too (foes win ties)
    const dx = B.x - p.x, dz = B.z - p.z, d = isqrt(dx * dx + dz * dz), r = worldBoss(world).kind.radius;
    if (d > 0 && d <= STRIKE_REACH + idiv(6 * r, 10) && 2 * (dx * -sy + dz * -cy) >= d * TRIG_ONE && (best === -1 || d < bd)) { best = -2; bd = d; }
  }
  noise(world, state, p.x, p.z, NOISE_SWING, 'swing', events);
  if (best !== -1) state.blows.push({ foe: best === -2 ? -1 : best, at: state.tick + BLOW_DELAY });
}

/** R-STRIKE-2 */
function landBlow(world, state, n, events, batch) {
  const f = state.foes[n], def = worldFoes(world)[n], p = state.player;
  if (f.st === 'dead' || f.st === 'gone') return;      // R-STRIKE-2: a gone thief can't be struck
  f.hp -= 1; f.stun = STUN;
  if (f.st === 'asleep' || f.st === 'disguised') requestWake(world, state, n, events);
  if (def.kind.speed > 0) {                             // R-STRIKE-2: the flytrap isn't knocked back
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.max(1, isqrt(dx * dx + dz * dz)); // squares < 2^36
    f.x += idiv(dx * KNOCKBACK, d); f.z += idiv(dz * KNOCKBACK, d);
    pushOut(world, state, f, def.kind.radius, f.x, f.z, false, !def.kind.fly);
  }
  events.push({ e: 'hit', id: def.id, hp: f.hp });
  if (f.hp > 0) return;
  f.st = 'dead'; f.wake = false;
  events.push({ e: 'foeDead', id: def.id });
  if (f.loot > 0 || f.lf > 0 || f.lp > 0) { state.loot.push({ x: f.x, z: f.z, n: f.loot, f: f.lf, p: f.lp }); f.loot = 0; f.lf = 0; f.lp = 0; } // R-THIEF-4
  if (p.held === n) { p.held = -1; p.holdImm = 60; events.push({ e: 'free' }); } // R-POW-4
  const g = def.group;
  if (worldGroups(world)[g].foes.every((m) => state.foes[m].st === 'dead')) { state.groups[g] = 'defeated'; batch.push(['foesDefeated', g]); }
}

/** R-FOE-5: may a walker (or a flier) enter cell (i, j)? */
function enterable(world, state, i, j, fly) {
  if (solidCell(world, state, i, j)) return false;
  if (fly) return true;
  const k = j * world.w + i, code = cellCode(world, i, j);
  if (code === CELL.PLATE) return slabAt(world, k) || state.sprung.includes(k);
  if (code === CELL.HPIT || code === CELL.VOID || code === CELL.VENT) return false;
  if (code === CELL.ALCOVE) { const a = alcoveAt(world, k); return a === undefined || state.sealed.includes(a.door); }
  return true;
}

const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // n, e, s, w

/** R-FOE-5: the breadth-first distance field from the player's cell. */
function field(world, state, fly) {
  const w = world.w, dist = new Int32Array(w * world.h).fill(-1), p = state.player;
  const start = fdiv(p.z, CELL_MM) * w + fdiv(p.x, CELL_MM), queue = [start];
  dist[start] = 0;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % w, j = (k - i) / w;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di, nj = j + dj, nk = nj * w + ni;
      if (ni < 0 || nj < 0 || ni >= w || nj >= world.h || dist[nk] >= 0 || !enterable(world, state, ni, nj, fly)) continue;
      dist[nk] = dist[k] + 1;
      queue.push(nk);
    }
  }
  return dist;
}

/** Move foe f towards (gx, gz) at its speed for one tick. */
function walkTo(f, speed, gx, gz, flit) {
  const ex = gx - f.x, ez = gz - f.z, e = Math.max(1, isqrt(ex * ex + ez * ez)); // squares < 2^36; ex·speed < 2^31
  if (flit === null) { f.x += idiv(ex * speed, 30 * e); f.z += idiv(ez * speed, 30 * e); return; }
  drift(f, speed, idiv(ex * TRIG_ONE, e) + flit[0], idiv(ez * TRIG_ONE, e) + flit[1]); // |ex·2^14| < 2^32
}

/** R-FOE-10: move along v (scaled by 2^14) at the kind's speed; |vx·speed| < 2^15·4500 < 2^28. */
function drift(f, speed, vx, vz) {
  f.x += idiv(vx * speed, 30 * TRIG_ONE); f.z += idiv(vz * speed, 30 * TRIG_ONE);
}

/** R-FOE-6 */
function updateFoes(world, state, input, events, batch, wasBusy) {
  const defs = worldFoes(world);
  const p = state.player, tick = state.tick;
  if (state.blows.length > 0) {
    const keep = [];
    for (const b of state.blows) if (b.at !== tick) keep.push(b); else if (b.foe < 0) bossBlow(world, state, events, batch); else landBlow(world, state, b.foe, events, batch);
    state.blows = keep;
  }
  if (defs.length === 0) return;
  if (!wasBusy && (input.buttons & BTN.run) && (input.move[0] !== 0 || input.move[1] !== 0)) noise(world, state, p.x, p.z, NOISE_RUN, 'run', events);
  state.foes.forEach((f, n) => { if (f.wake && awakeCount(state) < MAX_AWAKE) requestWake(world, state, n, events); }); // R-FOE-4
  state.foes.forEach((f, n) => {                       // R-FOE-11
    const kind = defs[n].kind;
    if (kind.regen === 0 || f.st === 'dormant' || f.st === 'dead') return;
    if (f.hp < kind.strikes) { f.rg += 1; if (f.rg === kind.regen) { f.hp += 1; f.rg = 0; } } else f.rg = 0;
  });
  const lit = p.oil > 0 && !p.hooded && p.hung < 0 && !p.doused, sight = lit ? SIGHT_LIT : SIGHT_DARK; // R-POW-1
  const fields = { walk: null, fly: null };
  const pi = fdiv(p.x, CELL_MM), pj = fdiv(p.z, CELL_MM);
  for (let n = 0; n < defs.length; n++) {
    const f = state.foes[n], kind = defs[n].kind;
    if (f.st === 'gone') {                              // R-THIEF-3: back after 20 s, idle at its cell
      if (f.t > 1) f.t -= 1;
      else if (awakeCount(state) < MAX_AWAKE) { f.st = 'idle'; f.t = 0; f.x = defs[n].x; f.z = defs[n].z; f.atk = kind.firstAttack; f.stun = 0; f.gx = -1; f.gz = -1; foeEvent(world, n, 'idle', events); }
      continue;
    }
    if (f.st === 'dormant' || f.st === 'dead' || f.st === 'asleep' || f.st === 'disguised') continue;
    if (f.st === 'rising') { f.t -= 1; if (f.t === 0) { f.st = 'hunting'; foeEvent(world, n, 'hunting', events); } continue; }
    f.stun = Math.max(0, f.stun - 1); f.atk = Math.max(0, f.atk - 1);
    const dx = p.x - f.x, dz = p.z - f.z;                // squares < 2^36
    if (f.st === 'hunting' && f.t > 0) {
      f.t -= 1;
      if (f.t === 0) {
        const r = kind.reach + 450;
        if (dx * dx + dz * dz < r * r) {
          if (kind.damage > 0) { hurt(state, kind.damage, events, 'beast'); if (state.dead !== null) return; }
          touch(world, state, n, events);               // R-POW-*
        }
        f.atk = kind.cooldown;
      }
      continue;
    }
    if (f.stun > 0) continue;
    let flit = null, moved = false, wound = false;
    if (kind.flit === 1) {                                // R-FOE-10
      if (f.ft > 0) f.ft -= 1;
      if (f.ft === 0) { f.ft = 8 + rngBelow(state.rng, 9); f.fa = rngBelow(state.rng, 4096); }
      flit = [idiv(9 * icos(f.fa), 10), idiv(9 * isin(f.fa), 10)];
    }
    const still = kind.speed === 0;                       // R-FOE-6: the flytrap never moves
    if (f.st === 'hunting') {
      const d = Math.max(1, isqrt(dx * dx + dz * dz));
      if (d < kind.reach && f.atk === 0) { f.t = kind.wind; wound = true; }
      else if (d > idiv(3 * kind.reach, 4)) {
        const fi = fdiv(f.x, CELL_MM), fj = fdiv(f.z, CELL_MM);
        let gx = -1, gz = -1;
        if ((fi === pi && fj === pj) || (Math.abs(fi - pi) <= 1 && Math.abs(fj - pj) <= 1 && losFrom(world, state, f.x, f.z, p.x, p.z))) { gx = p.x; gz = p.z; }
        else {
          const key = kind.fly ? 'fly' : 'walk';
          if (fields[key] === null) fields[key] = field(world, state, kind.fly);
          const dist = fields[key], here = dist[fj * world.w + fi];
          if (here > 0) {
            let bestD = here;
            for (const [di, dj] of NEIGHBOURS) {
              const ni = fi + di, nj = fj + dj, nd = dist[nj * world.w + ni];
              if (nd >= 0 && nd < bestD) { bestD = nd; gx = ni * CELL_MM + CELL_MM / 2; gz = nj * CELL_MM + CELL_MM / 2; }
            }
          }
        }
        if (gx >= 0) { walkTo(f, kind.speed, gx, gz, flit); moved = true; }
      }
    } else {                                              // idle
      const sx = f.x - p.x, sz = f.z - p.z, see = still ? kind.reach : sight; // R-FOE-7
      let gt = null;
      if (sx * sx + sz * sz <= see * see && losFrom(world, state, f.x, f.z, p.x, p.z)) {
        f.st = 'hunting'; f.t = 0; f.gx = -1; f.gz = -1; foeEvent(world, n, 'hunting', events);
      } else if (still) {
        // no goal: it never moves
      } else if (kind.power === 'guard' && (gt = guardTarget(world, state, n)) !== null) { // R-GUARD-1
        const [gx, gz] = gt, ex = gx - f.x, ez = gz - f.z;
        if (ex * ex + ez * ez > 600 * 600) { walkTo(f, kind.speed, gx, gz, flit); moved = true; }
      } else if (f.gx < 0) {
        if (f.t > 0) f.t -= 1;
        if (f.t === 0) {
          const z = zoneAt(world, defs[n].k), cells = [];
          if (z >= 0) for (let k = 0; k < world.w * world.h; k++) if (zoneAt(world, k) === z && enterable(world, state, k % world.w, (k - (k % world.w)) / world.w, kind.fly)) cells.push(k);
          if (cells.length === 0) f.t = 30 + rngBelow(state.rng, 61);
          else { const k = cells[rngBelow(state.rng, cells.length)]; f.gx = (k % world.w) * CELL_MM + CELL_MM / 2; f.gz = ((k - (k % world.w)) / world.w) * CELL_MM + CELL_MM / 2; f.t = 300; }
        }
      } else {
        walkTo(f, kind.speed, f.gx, f.gz, flit); moved = true;
        f.t -= 1;
        if ((fdiv(f.x, CELL_MM) === fdiv(f.gx, CELL_MM) && fdiv(f.z, CELL_MM) === fdiv(f.gz, CELL_MM)) || f.t <= 0) { f.gx = -1; f.gz = -1; f.t = 30 + rngBelow(state.rng, 61); }
      }
    }
    if (flit !== null && !moved && !wound) drift(f, kind.speed, flit[0], flit[1]); // R-FOE-10
    if (still) continue;
    // Separation from the other foes, then the walls and props.
    for (let m = 0; m < defs.length; m++) {
      const o = state.foes[m];
      if (m === n || o.st === 'dormant' || o.st === 'dead' || o.st === 'gone' || o.st === 'disguised') continue;
      const ox = f.x - o.x, oz = f.z - o.z, rr = kind.radius + defs[m].kind.radius, od2 = ox * ox + oz * oz; // < 2^36
      if (od2 > 0 && od2 < rr * rr) { const od = isqrt(od2); f.x += idiv(ox * (rr - od), 2 * od); f.z += idiv(oz * (rr - od), 2 * od); } // |ox·(rr-od)| < 2^22
    }
    pushOut(world, state, f, kind.radius, f.x, f.z, false, !kind.fly);
  }
}

/** R-POW-2..7: the power of foe n's landed blow. */
function touch(world, state, n, events) {
  const p = state.player, def = worldFoes(world)[n], f = state.foes[n], kind = def.kind;
  const roll = (pct) => rngBelow(state.rng, 100) < pct;
  let took = false;
  switch (kind.power) {
    case 'douse':
      if (p.hung < 0) { p.doused = true; p.hooded = false; took = true; if (p.busyOn >= 0) { p.busy = 0; p.busyOn = -1; } } // R-POW-2: no flame, no brazier
      break;
    case 'freeze': if (p.freezeImm === 0) { p.frozen = 45 + rngBelow(state.rng, 31); p.freezeImm = 135; took = true; } break;
    case 'seize': if (p.held === -1 && p.holdImm === 0) { p.held = n; p.heldT = 150; took = true; } break;
    case 'confuse': if (roll(50)) { p.confused = Math.max(p.confused, 90); took = true; } break;
    case 'poison': if (roll(40)) { p.poison = 600; took = true; } break;
    case 'drain':
      if (roll(35)) { p.maxHp = Math.max(1500, p.maxHp - 150); p.hp = Math.min(p.hp, p.maxHp); f.hp = Math.min(kind.strikes, f.hp + 1); took = true; }
      break;
    case 'steal': {                                     // R-THIEF-1
      if (f.loot > 0 || f.lf > 0 || f.lp > 0) return;   // no second theft (decision #69)
      const items = worldItems(world);
      let best = -1;
      let bestV = -1;
      state.taken.forEach((num, k) => { const it = items.find((q) => q.n === num); if (it !== undefined && it.kind === 'treasure' && it.value > bestV) { best = k; bestV = it.value; } });
      if (best >= 0) { f.loot = state.taken[best]; state.taken.splice(best, 1); vanish(f); events.push({ e: 'steal', id: def.id, item: items.find((q) => q.n === f.loot).id }); }
      return;
    }
    case 'pilfer':                                      // R-THIEF-2
      if (f.loot > 0 || f.lf > 0 || f.lp > 0) return;   // no second theft (decision #69)
      if (p.flasks > 0) { p.flasks -= 1; f.lf = 1; } else if (p.pebbles >= 2) { f.lp = idiv(p.pebbles, 2); p.pebbles -= f.lp; } else return;
      vanish(f); events.push({ e: 'steal', id: def.id, flasks: f.lf, pebbles: f.lp });
      return;
    case 'forget': {                                    // R-FORGET-1
      if (!roll(20)) return;
      const z = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
      if (z < 0) return;
      const cands = [...state.marked.map((k) => ['marked', k]), ...state.bridge.map((k) => ['bridge', k])].filter(([, k]) => zoneAt(world, k) === z);
      if (cands.length === 0) return;
      const [list, k] = cands[rngBelow(state.rng, cands.length)];
      state[list].splice(state[list].indexOf(k), 1);
      events.push({ e: 'forget', k });
      return;
    }
    default: break;
  }
  if (took) events.push({ e: 'power', k: kind.power, id: def.id });
}

/** R-THIEF-4: item n is no longer where the GDF put it: taken, carried by a thief, or lying as dropped loot. */
function away(state, n) {
  return state.taken.includes(n) || state.foes.some((f) => f.loot === n) || state.loot.some((l) => l.n === n);
}

/** R-THIEF-3 */
function vanish(f) { f.st = 'gone'; f.t = 600; f.wake = false; f.gx = -1; f.gz = -1; }

/** R-GUARD-1: the treasure an idle guard goes for (its point), or null. */
function guardTarget(world, state, n) {
  const def = worldFoes(world)[n], f = state.foes[n], z = zoneAt(world, def.k);
  if (z < 0) return null;
  let best = null, bd = 0;
  for (const it of worldItems(world)) {
    if (it.kind !== 'treasure' || it.k < 0 || zoneAt(world, it.k) !== z || away(state, it.n) || (it.hidden && !state.revealed.includes(it.n))) continue;
    const dx = it.x - f.x, dz = it.z - f.z, d2 = dx * dx + dz * dz; // < 2^36
    if (best === null || d2 < bd) { best = [it.x, it.z]; bd = d2; }
  }
  return best;
}

/** R-THIEF-4: pick up dropped loot k. */
function takeLoot(world, state, k, events) {
  const p = state.player, l = state.loot[k];
  if (l === undefined) return;
  const dx = p.x - l.x, dz = p.z - l.z; // squares < 2^36
  if (dx * dx + dz * dz > 1700 * 1700 || !lineOfSight(world, state, l.x, l.z)) return;
  if (l.n > 0) state.taken.push(l.n);
  p.flasks += l.f; p.pebbles = Math.min(PEBBLE_MAX, p.pebbles + l.p);
  state.loot.splice(k, 1);
  events.push({ e: 'loot', n: l.n > 0 ? worldItems(world).find((q) => q.n === l.n).id : null, f: l.f, p: l.p });
}

/** R-MIMIC-1: reaching for a disguised foe: a free hit, then it is revealed. */
function reachMimic(world, state, n, events) {
  const p = state.player, f = state.foes[n], def = worldFoes(world)[n];
  if (f.st !== 'disguised') return;
  const dx = p.x - f.x, dz = p.z - f.z; // squares < 2^36
  if (dx * dx + dz * dz > 1700 * 1700 || !lineOfSight(world, state, f.x, f.z)) return;
  if (def.kind.damage > 0) { hurt(state, def.kind.damage, events, 'beast'); if (state.dead !== null) return; }
  requestWake(world, state, n, events);
  events.push({ e: 'reveal', id: def.id, safe: false });
}

/** R-ITEM-2 */
function takeItem(world, state, n, it, events, batch) {
  const p = state.player;
  if (it.kind === 'rubble' ? p.pebbles >= PEBBLE_MAX : away(state, n)) return; // R-THIEF-4: a stolen one isn't back
  if (it.hidden && !state.revealed.includes(n)) return; // R-ITEM-1
  if (it.k < 0) return;                                 // in a chest: R-CHEST-2
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
  reachCheckpoint(world, state, z, events);
}

/** R-CP-2 (and `setCheckpoint`): zone z's checkpoint becomes the current one, with the life as it is now. */
function reachCheckpoint(world, state, z, events) {
  const cp = worldZones(world)[z].cp;
  const entry = { zone: z, x: cp.x, z: cp.z, yaw: cp.yaw, life: lifeOf(state) };
  let n = state.checkpoints.findIndex((c) => c.zone === z);
  if (n < 0) { n = state.checkpoints.length; state.checkpoints.push(entry); } else state.checkpoints[n] = entry;
  state.cp = n;
  state.player.maxHp = HP_FULL;                         // R-POW-7: a checkpoint ends the drain
  events.push({ e: 'checkpoint', zone: worldZones(world)[z].id });
}

/** R-TRAP-1: the trap under the player, if armed: returns the cause of death or null. Records lessons. */
function trap(world, state, events) {
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
  if (code === CELL.ALCOVE) {
    const a = alcoveAt(world, k);
    if (a !== undefined && !state.sealed.includes(a.door)) { springAlcove(state, a, true, events); return a.drown ? 'drown' : 'tip'; }
  }
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
  state.chests = life.chests.map((c) => ({ look: c.look, sprung: c.sprung, open: c.open }));
  state.sealing = [];
  p.flasks = life.flasks;
  p.pebbles = life.pebbles;
  state.floor = life.floor.map((f) => ({ x: f.x, z: f.z }));
  state.loot = life.loot.map((l) => ({ ...l }));        // R-THIEF-4
  state.taken = life.taken.slice();
  state.flying = [];
  state.groups = life.groups.slice();
  state.blows = [];
  state.braziers = life.braziers.slice();
  if (state.boss !== null && life.boss !== 'dead') state.boss = freshBoss(worldBoss(world)); // R-BOSS-6
  else if (state.boss !== null) state.boss.st = 'dead';
  p.busy = 0; p.busyOn = -1;
  Object.assign(p, freshFx());                          // R-POW-*: a rise clears the powers' marks
  // R-FOE-8: defeated groups stay dead; foes starting awake or asleep come back as they started; foes of spawned
  // groups that started dormant come back hunting, in entity order, while fewer than 8 are awake (else they wait).
  state.foes = worldFoes(world).map((def) => {
    const g = state.groups[def.group];
    return freshFoe(def, g === 'defeated' ? 'dead' : def.start);
  });
  life.foes.forEach(([loot, lf, lp], n) => {            // R-FOE-8: carried loot survives the rise (decision #70)
    const f = state.foes[n];
    if (f.st !== 'dead') { f.loot = loot; f.lf = lf; f.lp = lp; }
  });
  worldFoes(world).forEach((def, n) => {
    const f = state.foes[n];
    if (f.st !== 'dormant' || state.groups[def.group] !== 'spawned') return;
    if (awakeCount(state) < MAX_AWAKE) f.st = 'hunting'; else f.wake = true;
  });
  state.eyes = state.eyes.map(() => 0);
  p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.rx = 0; p.rz = 0;
  state.zone = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
  state.dead = null;
  events.push({ e: 'rise', zone: c.zone >= 0 ? worldZones(world)[c.zone].id : null });
}

/** R-ACT-1: interact with a door, item or bell within reach. Anything else does nothing. */
function interact(world, state, n, events, batch) {
  if (n >= 1000) { takeLoot(world, state, n - 1000, events); return; } // R-THIEF-4
  const ref = entityRef(world, n);
  if (ref && ref.type === 'foe') { reachMimic(world, state, ref.foe, events); return; } // R-MIMIC-1
  if (ref && ref.type === 'item') { takeItem(world, state, n, worldItems(world)[ref.item], events, batch); return; }
  if (ref && ref.type === 'bell') { ringBell(world, state, n, worldBells(world)[ref.bell], events, batch); return; }
  if (ref && ref.type === 'lampHook') { useHook(world, state, n, ref.hook, events, batch); return; }
  if (ref && ref.type === 'mirror') { turnMirror(world, state, n, ref.mirror, events, batch); return; }
  if (ref && ref.type === 'chest') { openChest(world, state, n, ref.chest, events, batch); return; }
  if (ref && ref.type === 'brazier') { useBrazier(world, state, n, ref.brazier, events, batch); return; }
  if (!ref || ref.type !== 'door') return;
  const def = worldDoors(world)[ref.door], d = state.doors[ref.door], p = state.player;
  if (d.open) return;
  const dx = p.x - def.cx, dz = p.z - def.cz; // |dx|, |dz| <= 64*2400, so the squares stay below 2^36
  if (dx * dx + dz * dz > REACH_MM * REACH_MM) return;
  batch.push(['interact', n]);
  if (state.sealed.includes(ref.door)) return;
  if (!def.interact && !(def.key > 0 && state.taken.includes(def.key))) return; // R-DOOR-1: interact or key
  d.open = true;
  events.push({ e: 'door', id: def.id, open: true });
}

/** R-BRAZIER-2 */
function useBrazier(world, state, n, bi, events, batch) {
  const p = state.player, b = worldBraziers(world)[bi], dx = p.x - b.x, dz = p.z - b.z; // squares < 2^36
  if (state.braziers[bi] || (state.boss !== null && state.boss.st === 'dead')) return;
  if (dx * dx + dz * dz > b.reach * b.reach || !lineOfSight(world, state, b.x, b.z)) return;
  batch.push(['interact', n]);
  if (p.oil > 0 && p.hung < 0 && !p.doused) { p.busy = 30; p.busyOn = bi; events.push({ e: 'busy', id: b.id }); } // R-POW-2
  else events.push({ e: 'msg', k: 'needLight' });
}

/** R-BOSS-4: one tick of the boss. */
function updateBoss(world, state, events, batch) {
  const B = state.boss;
  if (B === null || B.st === 'asleep' || B.st === 'dead') return;
  const def = worldBoss(world), K = def.kind, p = state.player, box = worldBossBox(world), braziers = worldBraziers(world);
  const dx = p.x - B.x, dz = p.z - B.z, d = Math.max(1, isqrt(dx * dx + dz * dz)); // squares < 2^36
  B.atk = Math.max(0, B.atk - 1); B.feedCd = Math.max(0, B.feedCd - 1);
  if (d < K.drainRange && p.oil > 0 && p.hung < 0) {
    const drain = B.phase === 2 ? K.drain2 : K.drain;
    p.oil = Math.max(0, p.oil - idiv(drain * (5 * K.drainRange - 3 * d), 5 * K.drainRange)); // < 2^27
    if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); }
  }
  const speed = B.phase === 2 ? K.speed2 : K.speed;
  const move = (gx, gz, spd) => {
    const ex = gx - B.x, ez = gz - B.z, e = Math.max(1, isqrt(ex * ex + ez * ez));
    B.x += idiv(ex * spd, 30 * e); B.z += idiv(ez * spd, 30 * e);
    pushOut(world, state, B, K.radius, B.x, B.z, false);
    B.x = clamp(B.x, box.x0, box.x1); B.z = clamp(B.z, box.z0, box.z1);
  };
  if (B.st === 'stalk') {
    let tgt = -1, td = 0;
    if (B.feedCd === 0) braziers.forEach((b, n) => {
      if (!state.braziers[n]) return;
      const ex = b.x - B.x, ez = b.z - B.z, dd = ex * ex + ez * ez;
      if (tgt < 0 || dd < td) { tgt = n; td = dd; }
    });
    if (tgt >= 0) { B.target = tgt; B.st = 'seek'; }
    else if (d < K.windRange && B.atk === 0) { B.st = 'wind'; B.t = K.wind; }
    else if (d > K.stop) move(p.x, p.z, speed);
  } else if (B.st === 'seek') {
    const b = braziers[B.target], ex = b.x - B.x, ez = b.z - B.z;
    if (!state.braziers[B.target]) B.st = 'stalk';
    else if (d < K.seekWindRange && B.atk === 0) { B.st = 'wind'; B.t = K.wind; }
    else if (ex * ex + ez * ez < K.feedReach * K.feedReach) { B.st = 'feed'; B.t = B.phase === 2 ? K.feed2 : K.feed; B.feedHits = 0; events.push({ e: 'boss', st: 'feed' }); }
    else move(b.x, b.z, idiv(speed * 11, 10));
  } else if (B.st === 'feed') {
    B.t -= 1;
    if (B.t === 0 || !state.braziers[B.target]) {
      if (state.braziers[B.target]) { state.braziers[B.target] = false; events.push({ e: 'brazier', id: braziers[B.target].id, lit: false }); }
      B.st = 'stalk'; B.feedCd = K.feedCd;
    }
  } else if (B.st === 'wind') {
    B.t -= 1;
    if (B.t === 0) {
      if (d < K.hitRange) {
        if (p.oil > 0) { p.oil = Math.max(0, p.oil - K.oilHit); if (p.oil === 0) { p.hooded = false; events.push({ e: 'msg', k: 'lanternOut' }); } }
        hurt(state, K.damage, events, 'eater');
      }
      B.st = 'stalk'; B.atk = B.phase === 2 ? K.atk2 : K.atk;
    }
  } else if (B.st === 'reel') {
    B.t -= 1;
    if (B.t === 0) B.st = 'stalk';
  }
}

/** R-BOSS-4: is a lit brazier within her solid range? */
function bossSolid(world, state) {
  const B = state.boss, r = worldBoss(world).kind.solidRange;
  return worldBraziers(world).some((b, n) => { const ex = b.x - B.x, ez = b.z - B.z; return state.braziers[n] && ex * ex + ez * ez < r * r; });
}

/** R-BOSS-5: a blow on the boss. */
function bossBlow(world, state, events, batch) {
  const B = state.boss, def = worldBoss(world), K = def.kind;
  if (B.st === 'dead' || B.st === 'asleep') return;
  if (!bossSolid(world, state)) { events.push({ e: 'boss', smoke: true }); return; }
  B.hp -= 1;
  events.push({ e: 'hit', id: def.id, hp: B.hp });
  if (B.hp === 0) {
    B.st = 'dead';
    state.braziers = state.braziers.map(() => true);
    batch.push(['bossDefeated', 0]);
    events.push({ e: 'bossDead' });
    return;
  }
  if (B.phase === 1 && B.hp <= 3) {
    B.phase = 2; B.st = 'stalk'; B.atk = K.phase2Atk; B.feedCd = K.phase2FeedCd;
    state.braziers = state.braziers.map(() => false);
    events.push({ e: 'boss', phase: 2 });
    return;
  }
  if (B.st === 'feed') { B.feedHits += 1; if (B.feedHits >= 2) { B.st = 'wind'; B.t = K.tearWind; } }
  else if (B.st !== 'wind') { B.st = 'reel'; B.t = K.reel; }
}

/** R-CHEST-2 */
function openChest(world, state, n, ci, events, batch) {
  const p = state.player, c = worldChests(world)[ci], st = state.chests[ci], dx = p.x - c.x, dz = p.z - c.z; // squares < 2^36
  if (st.open || dx * dx + dz * dz > c.reach * c.reach || !lineOfSight(world, state, c.x, c.z)) return;
  batch.push(['interact', n]);
  if (c.needles && !st.look) { st.look = true; events.push({ e: 'chest', id: c.id, look: true }); return; }
  if (c.needles && !st.sprung) { die(state, 'needles', events); return; }
  st.open = true;
  const items = worldItems(world);
  for (const ii of c.contents) {
    const it = items[ii], num = it.n;
    state.taken.push(num);
    if (it.kind === 'flask') p.flasks += 1;
    batch.push(['itemTaken', num]);
    events.push({ e: 'item', id: it.id, kind: it.kind });
  }
  events.push({ e: 'chest', id: c.id, open: true });
}

/** R-CHEST-3: a trapped chest in front of the player takes the probe. Returns true if it did. */
function probeChest(world, state, events) {
  const p = state.player, chests = worldChests(world), sy = isin(p.yaw), cy = icos(p.yaw);
  const z = zoneAt(world, fdiv(p.z, CELL_MM) * world.w + fdiv(p.x, CELL_MM));
  for (let ci = 0; ci < chests.length; ci++) {
    const c = chests[ci], st = state.chests[ci];
    if (!c.needles || st.open || zoneAt(world, c.k) !== z) continue;
    const dx = c.x - p.x, dz = c.z - p.z, d = isqrt(dx * dx + dz * dz); // squares < 2^36
    // In front: 2·(d · forward) > d·2^14, forward = (-sin, -cos)·2^14; |dx·sy| < 2^18 · 2^14.
    if (d === 0 || d >= 2600 || 2 * (dx * -sy + dz * -cy) <= d * TRIG_ONE) continue;
    if (!st.sprung) { st.sprung = true; events.push({ e: 'probe', k: 'needles' }); } else events.push({ e: 'probe', k: 'needlesSpent' });
    return true;
  }
  return false;
}

/** R-ALCOVE-2: spring an armed alcove; inside = the player is in it. */
function springAlcove(state, a, inside, events) {
  if (!state.sealed.includes(a.door)) state.sealed.push(a.door);
  state.sealing.push({ door: a.door, left: inside ? 45 : a.drown ? 78 : 66 });
  events.push({ e: 'alcove', id: a.id, inside });
}

/** R-HOOK-2 */
function useHook(world, state, n, h, events, batch) {
  const p = state.player, hook = worldHooks(world)[h], dx = p.x - hook.x, dz = p.z - hook.z; // squares < 2^36
  if (dx * dx + dz * dz > hook.reach * hook.reach || !lineOfSight(world, state, hook.x, hook.z)) return;
  batch.push(['interact', n]);
  if (p.hung === h) p.hung = -1;
  else if (p.hung >= 0) return;
  else if (p.oil > 0 && !p.doused) { p.hung = h; p.hooded = false; } // R-POW-2
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
function pushOut(world, state, e, r, ox, oz, isPlayer, walker = false) {
  const props = worldProps(world), defs = isPlayer ? worldFoes(world) : [];
  for (let pass = 0; pass < 3; pass++) {
    const ci = fdiv(e.x, CELL_MM), cj = fdiv(e.z, CELL_MM);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const gi = ci + di, gj = cj + dj;
      if (walker ? enterable(world, state, gi, gj, false) : !solidCell(world, state, gi, gj)) continue; // R-FOE-5: walls for walkers
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
    if (isPlayer && state.boss !== null && state.boss.st !== 'dead') { // R-BOSS-5: so does the boss
      const B = state.boss, dx = e.x - B.x, dz = e.z - B.z, d2 = dx * dx + dz * dz, rr = r + idiv(85 * worldBoss(world).kind.radius, 100);
      if (d2 > 0 && d2 < rr * rr) { const d = isqrt(d2); e.x = B.x + idiv(dx * rr, d); e.z = B.z + idiv(dz * rr, d); }
    }
    for (let n = 0; n < defs.length; n++) {            // R-MOVE-4: the foes push the player (Gloamhollow r + 0.85·ρ)
      const f = state.foes[n];
      if (f.st !== 'asleep' && f.st !== 'idle' && f.st !== 'hunting') continue;
      const dx = e.x - f.x, dz = e.z - f.z, d2 = dx * dx + dz * dz, rr = r + idiv(85 * defs[n].kind.radius, 100);
      if (d2 > 0 && d2 < rr * rr) { const d = isqrt(d2); e.x = f.x + idiv(dx * rr, d); e.z = f.z + idiv(dz * rr, d); }
    }
  }
}

/** Sim.hash(state) -> 32 hex chars: SHA-256 of the canonical form, first 16 bytes (R-HASH-1). */
export function hash(state) {
  return toHex(sha256(canonicalBytes(state)).subarray(0, 16));
}

export { clamp };
