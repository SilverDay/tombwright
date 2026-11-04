// Tombwright game client (M0 step 6a): plays an official tomb on the sim core.
// The sim runs at a fixed 30 Hz from recorded inputs; this file samples input once per tick, steps the sim,
// turns its events into Gloamhollow's messages, and draws interpolated frames in between.
// All text goes in with textContent (spec §11).
import * as Sim from '../sim/sim.js';
import { loadSineTable } from '../sim/sine.js';
import { loadBestiary, foeKind, bossKind } from '../sim/bestiary.js';
import { b64decode, rleDecode } from '../sim/world.js';
import { audioInit } from './audio.js';
import { TombView, yawRad } from './render.js';
import { UI } from './ui.js';
import { SAY, DEATHS, TOMB_TEXT, FOE_NAMES, FLASK_NAME, READ_LABEL, FACE_NAME, cap } from './text.js';
import { DELVE_NAMES } from './delve-art.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / Sim.TICK_HZ, S = 2400, TAU = Math.PI * 2;
const B = Sim.BTN;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
if (coarse) document.body.classList.add('touch');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function showError(text) { const e = $('err'); e.textContent = text; e.hidden = false; $('goBtn').disabled = true; $('contBtn').disabled = true; }

async function fetchBytes(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ------------------------------------------------------------------ the tomb
async function loadTomb(name) {
  const [sine, best, bytes] = await Promise.all([fetchBytes('/js/sim/data/sine4096.bin'), fetchBytes('/js/sim/data/bestiary.v1.json'), fetchBytes(`/tombs/${name}.gdf.json`)]);
  loadSineTable(sine); loadBestiary(best);
  const world = Sim.load(bytes);                        // validates everything (R-GDF-*, R-DRESS-*)
  const gdf = JSON.parse(new TextDecoder().decode(bytes));
  const { w, h } = gdf.grid, grid = rleDecode(b64decode(gdf.grid.cells), w * h);
  // Official tombs only: their text is keyed by the route's name, never by the tomb's own (user-editable) title.
  const text = Object.hasOwn(TOMB_TEXT, name) ? TOMB_TEXT[name] : { items: {}, bells: {}, reads: {} };
  return { name, world, gdf, grid, w, h, text, bestiary: (k) => foeKind(k) };
}

// ------------------------------------------------------------------ what the player can use (Gloamhollow setupInteractions)
function buildInteractions(T) {
  const { gdf, w } = T, ents = gdf.entities ?? [], IA = [], cx = (i) => i * S + S / 2;
  const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const wallPt = (i, j, side, off = 350) => [cx(i) + SIDE[side][0] * (S / 2 - off), cx(j) + SIDE[side][1] * (S / 2 - off)];
  const num = (e) => ents.indexOf(e) + 1;
  const doors = ents.filter((e) => e.type === 'door'), items = ents.filter((e) => e.type === 'item'), chests = ents.filter((e) => e.type === 'chest');
  const braziers = ents.filter((e) => e.type === 'brazier'), mirrors = ents.filter((e) => e.type === 'mirror');
  for (const t of ents.filter((e) => e.type === 'inscription')) {
    if (t.on) continue;                                  // shown when its chest is looked at
    const pt = t.wall ? wallPt(t.wall[0][0], t.wall[0][1], t.wall[1], t.style === 'scrawl' ? 250 : 350) : t.pos;
    IA.push({ read: t, pt, r: t.style === 'look' && t.pos ? 1800 : 2400, label: () => T.text.reads?.[t.id] ?? READ_LABEL[t.style] });
  }
  doors.forEach((d, n) => {
    const [i, j] = d.cell, mask = d.style === 'mask';
    const key = d.opens === 'key' ? items.find((it) => it.id === d.key) : null;
    IA.push({
      n: num(d), pt: [cx(i), cx(j) - (mask ? 200 : 0)], r: mask ? 2000 : 2600, noLos: true,
      cond: (st) => !st.doors[n].open || (mask && st.sealed.includes(n)),
      label: (st) => {
        if (mask) return key && st.taken.includes(num(key)) ? `Unlock the ${FACE_NAME[d.face]} face’s door` : `Touch the ${FACE_NAME[d.face]} face`;
        if (d.opens === 'interact') return 'Open the door';
        if (key && st.taken.includes(num(key))) return 'Unlock the door';
        return d.style === 'grate' ? 'Try the bronze grate' : 'Try the door';
      },
    });
  });
  for (const b of ents.filter((e) => e.type === 'bell')) {
    const name = T.text.bells?.[b.id]?.name ?? 'the bell';
    IA.push({ n: num(b), pt: [cx(b.cell[0]), cx(b.cell[1])], r: [2420, 2600, 2780][b.size - 1], label: () => `Ring ${name}` });
  }
  ents.filter((e) => e.type === 'lampHook').forEach((hk, n) => {
    const d = SIDE[hk.dir];
    IA.push({ n: num(hk), pt: [cx(hk.cell[0]) - 900 * d[0], cx(hk.cell[1]) - 900 * d[1]], r: 2200, pri: 1, label: (st) => (st.player.hung === n ? 'Take your lantern back' : 'Hang your lantern on the hook') });
  });
  for (const m of mirrors) IA.push({ n: num(m), pt: [cx(m.cell[0]), cx(m.cell[1])], r: 2150, label: () => 'Turn the mirror' });
  chests.forEach((c, n) => {
    const d = SIDE[c.wall], g = c.style === 'gilded' ? 'gilded' : 'plain';
    IA.push({ n: num(c), pt: [cx(c.cell[0]) + 250 * d[0], cx(c.cell[1]) + 250 * d[1]], r: 2200, cond: (st) => !st.chests[n].open,
      label: (st) => (c.trap === 'needles' && !st.chests[n].look ? `Look at the ${g} chest` : `Open the ${g} chest`) });
  });
  braziers.forEach((b, n) => IA.push({ n: num(b), pt: [cx(b.cell[0]), cx(b.cell[1])], r: 2300, cond: (st) => !st.braziers[n] && !(st.boss && st.boss.st === 'dead'), label: () => 'Light the brazier' }));
  for (const it of items) {
    if (!it.cell) continue;
    const [i, j] = it.cell, n = num(it);
    if (it.kind === 'rubble') { IA.push({ n, pt: [cx(i) - 300, cx(j) - 300], r: 1600, cond: (st) => st.player.pebbles < Sim.PEBBLE_MAX, label: () => 'Gather pebbles from the rubble' }); continue; }
    const name = it.kind === 'flask' ? FLASK_NAME : T.text.items?.[it.id]?.name ?? 'it';
    IA.push({ n, pt: [cx(i), cx(j)], r: 1700, pri: it.hidden ? 2 : 1, cond: (st) => !st.taken.includes(n) && !st.foes.some((f) => f.loot === n) && !st.loot.some((l) => l.n === n) && (!it.hidden || st.revealed.includes(n)), label: () => `Take ${name}` });
  }
  // R-MIMIC-1: a disguised xeroc offers what it pretends to be.
  ents.forEach((f, k) => {
    if (f.type !== 'foe' || !f.disguise) return;
    const label = f.disguise === 'chest' ? 'Open the chest' : f.disguise === 'flask' ? `Take ${FLASK_NAME}` : 'Take a scatter of old coins';
    IA.push({ n: k + 1, pt: [cx(f.cell[0]), cx(f.cell[1])], r: 1700, pri: 1, cond: (st) => st.foes[ents.filter((e) => e.type === 'foe').indexOf(f)].st === 'disguised', label: () => label });
  });
  void w;
  return IA;
}

// ------------------------------------------------------------------ cells as the sim sees them (for line of sight, the beam, the HUD)
function makeWorldQueries(T) {
  const { gdf, grid, w, h } = T, ents = gdf.entities ?? [];
  const doorAt = new Map(), slab = new Set();
  ents.filter((e) => e.type === 'door').forEach((d, n) => doorAt.set(d.cell[1] * w + d.cell[0], n));
  for (const s of ents.filter((e) => e.type === 'slab')) slab.add(s.cell[1] * w + s.cell[0]);
  const zoneOf = new Int8Array(w * h).fill(-1);
  (gdf.zones ?? []).forEach((z, zi) => { for (const [x, y, rw, rh] of z.rects) for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) zoneOf[j * w + i] = zi; });
  const inB = (i, j) => i >= 0 && j >= 0 && i < w && j < h;
  const doorShut = (st, k) => { const n = doorAt.get(k); return n !== undefined && 20 * st.doors[n].t < 17 * 693; }; // R-DOOR-4
  const sightBlocked = (st, i, j) => !inB(i, j) || grid[j * w + i] === 0 || doorShut(st, j * w + i);
  const solid = (st, i, j) => sightBlocked(st, i, j) || slab.has(j * w + i) || st.sprung.includes(j * w + i);
  const los = (st, x0, z0, x1, z1) => {
    const dx = x1 - x0, dz = z1 - z0, n = Math.ceil(Math.hypot(dx, dz) / (S * 0.25));
    for (let s = 1; s < n; s++) if (sightBlocked(st, Math.floor((x0 + dx * s / n) / S), Math.floor((z0 + dz * s / n) / S))) return false;
    return true;
  };
  const alcoves = ents.filter((e) => e.type === 'alcove'), doors = ents.filter((e) => e.type === 'door');
  const tipAt = new Map(alcoves.filter((a) => a.kind === 'tip').map((a) => [a.cell[1] * w + a.cell[0], doors.findIndex((d) => d.id === a.door)]));
  const doorShutAt = (st, k) => doorShut(st, k);
  const slabAt = (st, k) => slab.has(k) || st.sprung.includes(k);
  const openAlcovePit = (st, k) => tipAt.has(k) && st.sealed.includes(tipAt.get(k));
  return { zoneOf, inB, solid, los, sightBlocked, doorShutAt, slabAt, openAlcovePit };
}

// R-BEAM-1, traced for drawing: the hook's beam through the mirrors, in metres.
function traceBeam(T, Q, st) {
  if (st.player.hung < 0) return null;
  const ents = T.gdf.entities, hooks = ents.filter((e) => e.type === 'lampHook'), mirrors = ents.filter((e) => e.type === 'mirror'), crystals = ents.filter((e) => e.type === 'crystal');
  const hk = hooks[st.player.hung], D = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  let [i, j] = hk.cell, [di, dj] = D[hk.dir];
  const cxm = (c) => (c + 0.5) * 2.4, pts = [[cxm(i) - di * 0.86, cxm(j) - dj * 0.86]];
  let hits = null;
  for (let n = 0; n < 80; n++) {
    const ni = i + di, nj = j + dj;
    if (Q.solid(st, ni, nj)) {
      const ex = di ? (di > 0 ? (i + 1) * 2.4 : i * 2.4) : cxm(i), ez = dj ? (dj > 0 ? (j + 1) * 2.4 : j * 2.4) : cxm(j);
      pts.push([ex - di * 0.04, ez - dj * 0.04]);
      const c = crystals.find((q) => q.cell[0] === i && q.cell[1] === j && D[q.wall][0] === di && D[q.wall][1] === dj);
      if (c) hits = c.id;
      return { pts, hits };
    }
    i = ni; j = nj;
    const mi = mirrors.findIndex((q) => q.cell[0] === i && q.cell[1] === j);
    if (mi >= 0) { pts.push([cxm(i), cxm(j)]); if (st.mirrors[mi] === 0) [di, dj] = [-dj, -di]; else [di, dj] = [dj, di]; }
  }
  return { pts, hits: null };
}

// ------------------------------------------------------------------ the game
class Game {
  constructor(T) {
    this.T = T; this.Q = makeWorldQueries(T); this.IA = buildInteractions(T);
    this.view = new TombView($('view'), T, { reduced, coarse });
    this.keys = new Set(); this.pending = 0; this.held = 0; this.look = { yaw: 0, pitch: 0 };
    this.mode = 'title'; this.st = null; this.prev = null; this.acc = 0; this.log = [];
    this.lastHungMsg = -99; this.lowOilWarned = false; this.visited = new Set(); this.hungOnce = false; this.fresh = true;
    this.drive = null; // test hook: { move, yaw, pitch, buttons, target } replaces device input
    this.ui = new UI(this, { reduced, coarse });
  }

  newGame(seed = crypto.getRandomValues(new Uint32Array(1))[0]) {
    const T = this.T;
    this.ui.clearSave(); this.ui.fresh();
    this.begin(Sim.init(T.world, seed >>> 0, 'delve'), { yaw: 0, pitch: 0 }, []);
    this.say(T.text.intro ?? `You enter ${T.gdf.meta?.title ?? 'the tomb'}.`);
    this.ui.save();
  }

  /** A saved delve goes on exactly where it was left (the sim state itself is saved, never edited). */
  continueGame(s) {
    if (!s) { this.newGame(); return; }
    let st;
    try { st = structuredClone(s.state); Sim.step(this.T.world, structuredClone(st), { move: [0, 0], yaw: 0, pitch: 0, buttons: 0, target: 0 }); } catch { this.newGame(); return; }
    this.ui.restore(s);
    const look = s.look && Number.isFinite(s.look.yaw) && Number.isFinite(s.look.pitch) ? { yaw: s.look.yaw, pitch: clamp(s.look.pitch, -1.2, 1.2) } : { yaw: yawRad(st.player.yaw), pitch: 0 };
    this.begin(st, look, Array.isArray(s.visited) ? s.visited.filter(Number.isInteger) : []);
    const z = st.checkpoints[st.cp].zone;
    this.say(`You return to ${z >= 0 ? this.T.gdf.zones[z].name : 'the tomb'}. The tomb remembers you.`);
    if (st.dead !== null) this.ui.showDeath(st.dead.cause);
  }

  begin(st, look, visited) {
    this.st = st; this.prev = structuredClone(st);
    this.look = look; this.log = []; this.visited = new Set(visited); this.hungOnce = false; this.fresh = true; this.lowOilWarned = false;
    this.ui.hideOverlays();
    this.mode = 'play';
    for (const z of ['bar', 'pframe']) $(z).hidden = false;
    const z = this.zoneAt(); if (z >= 0) this.visited.add(z);
    this.hud(); this.setHints();
    if (!coarse) this.tryLock();
  }

  applyLook(dx, dy) { this.look.yaw -= dx; this.look.pitch = clamp(this.look.pitch - dy, -1.2, 1.2); }

  lootName(l) {
    const T = this.T;
    if (l.n > 0) { const it = T.gdf.entities[l.n - 1]; return T.text.items?.[it.id]?.name ?? 'the treasure'; }
    return l.f > 0 ? FLASK_NAME : `${l.p} pebbles`;
  }

  zoneAt(st = this.st) { const p = st.player, i = Math.floor(p.x / S), j = Math.floor(p.z / S); return this.Q.inB(i, j) ? this.Q.zoneOf[j * this.T.w + i] : -1; }
  zoneName(z) { return z >= 0 ? this.T.gdf.zones[z].name : null; }

  // Gloamhollow nearestInteract: in front (dot >= 0.45), in reach, in sight, best score.
  nearest() {
    const st = this.st; if (!st || st.dead !== null || this.mode !== 'play') return null;
    const p = st.player, fx = -Math.sin(this.look.yaw), fz = -Math.cos(this.look.yaw);
    let best = null, bs = -1e9;
    for (const o of this.IA) {
      if (o.cond && !o.cond(st)) continue;
      const dx = o.pt[0] - p.x, dz = o.pt[1] - p.z, d = Math.hypot(dx, dz);
      if (d > o.r) continue;
      const dot = d < 600 ? 1 : (dx * fx + dz * fz) / d;
      if (dot < 0.45) continue;
      if (!o.noLos && !this.Q.los(st, p.x, p.z, o.pt[0] - dx / (d || 1) * 300, o.pt[1] - dz / (d || 1) * 300)) continue;
      const s = dot * 2 - (d / 1000) * 0.6 + (o.pri || 0) * 0.4;
      if (s > bs) { bs = s; best = o; }
    }
    // R-THIEF-4: loot a thief dropped, target 1000 + its index.
    st.loot.forEach((l, k) => {
      const dx = l.x - p.x, dz = l.z - p.z, d = Math.hypot(dx, dz);
      if (d > 1700) return;
      const dot = d < 600 ? 1 : (dx * fx + dz * fz) / d;
      if (dot < 0.45 || !this.Q.los(st, p.x, p.z, l.x - dx / (d || 1) * 300, l.z - dz / (d || 1) * 300)) return;
      const sc = dot * 2 - (d / 1000) * 0.6 + 0.4;
      if (sc > bs) { bs = sc; best = { n: 1000 + k, label: () => `Pick up ${this.lootName(l)}` }; }
    });
    return best;
  }

  // One tick of input (R-INPUT-1) from the devices, or from the test hook.
  sample() {
    if (this.drive) { const d = { ...this.drive, buttons: this.drive.buttons | this.pending }; this.pending = 0; return d; }
    const k = this.keys;
    let fw = 0, sd = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fw += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fw -= 1;
    if (k.has('KeyD')) sd += 1;
    if (k.has('KeyA')) sd -= 1;
    let turn = 0; if (k.has('ArrowLeft')) turn += 1; if (k.has('ArrowRight')) turn -= 1;
    this.look.yaw += turn * 2.1 * DT;
    const m = Math.hypot(fw, sd), sc = m > 1 ? 127 / m : 127;
    let buttons = this.held | this.pending; this.pending = 0;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) buttons |= B.run;
    let move = [Math.round(fw * sc), Math.round(sd * sc)];
    const stick = this.ui.stickInput();
    if (stick) { move = stick.move; if (stick.run) buttons |= B.run; }
    let target = 0;
    if (buttons & B.interact) {
      const o = this.nearest();
      if (o && o.read) { this.read(o.read); buttons &= ~B.interact; } else if (o) target = o.n;
    }
    return { move, yaw: this.qYaw(), pitch: this.qPitch(), buttons, target };
  }
  qYaw() { return ((Math.round(this.look.yaw * 4096 / TAU) % 4096) + 4096) % 4096; }
  qPitch() { return clamp(Math.round(this.look.pitch / 1.2 * 127), -127, 127); } // decision #22

  tick() {
    const st = this.st;
    if (!st || st.won !== null || this.mode !== 'play') return;
    const input = this.sample();
    if (this.mode !== 'play') return; // reading a text opened a panel this tick
    this.prev = structuredClone(st);
    const before = { buttons: st.prevButtons };
    const events = Sim.step(this.T.world, st, input);
    this.log.push(input);
    for (const ev of events) { this.view.onEvent(ev, st); this.onEvent(ev, events); }
    this.ui.afterTick(events, input, before);
    this.watchLantern();
    if (this.prev.player.frozen > 0 && st.player.frozen === 0 && st.dead === null) this.say(SAY.thawed);
    if (this.prev.player.confused > 0 && st.player.confused === 0 && st.dead === null) this.say(SAY.unconfused);
    // Gloamhollow says "You enter …" the first time you reach a chamber (not a one-cell-wide way).
    const z = this.zoneAt(), Z = this.T.gdf.zones?.[z];
    if (Z && !this.visited.has(z) && st.dead === null) { this.visited.add(z); if (Z.rects.some(([, , rw, rh]) => rw > 1 && rh > 1)) this.say(SAY.enter(Z.name)); }
    this.fresh = false;
  }

  onEvent(ev, events) {
    const T = this.T, st = this.st, P = st.player;
    switch (ev.e) {
      case 'message': this.say(ev.text); break;
      case 'msg':
        if (ev.k === 'lanternHung') { if (st.tick - this.lastHungMsg > 45) { this.lastHungMsg = st.tick; this.say(SAY.msg.lanternHung); } }
        else if (ev.k === 'lanternOut' && st.boss && st.boss.st !== 'asleep' && st.boss.st !== 'dead') this.say(SAY.bossDrained);
        else this.say(SAY.msg[ev.k]);
        break;
      case 'probe': this.say(SAY.probe[ev.k]); break;
      case 'land': if (SAY.land[ev.k]) this.say(SAY.land[ev.k]); break;
      case 'alcove': if (!ev.inside && !events.some((x) => x.e === 'probe')) { const a = T.gdf.entities.find((e) => e.id === ev.id); this.say(SAY.alcove[a.kind]); } break;
      case 'hood': this.say(ev.on ? SAY.hoodOn : SAY.hoodOff); break;
      case 'oil': this.say(ev.relit ? SAY.relit : SAY.oil); break;
      case 'hook': if (ev.hung) { this.say(this.hungOnce ? SAY.hungAgain : SAY.hung); this.hungOnce = true; } else this.say(SAY.unhung); break;
      case 'item': {
        const it = T.gdf.entities.find((e) => e.id === ev.id);
        if (ev.kind === 'rubble') this.say(SAY.rubble);
        else if (it.cell) this.say(SAY.take(ev.kind === 'flask' ? FLASK_NAME : T.text.items?.[it.id]?.name ?? 'it'));
        break;
      }
      case 'bell': {
        if (events.some((x) => x.e === 'bellsWrong')) break;
        const name = T.text.bells?.[ev.id]?.name ?? 'the bell';
        const solvedBefore = this.prev.bellSets.some((s) => s.solved);
        this.say(solvedBefore ? SAY.bellQuiet(name) : SAY.bell(name));
        break;
      }
      case 'eyes': this.say(SAY.eyes); break;
      case 'brazier':
        if (ev.lit && P.busyOn < 0 && this.prev.player.busy > 0) this.say(SAY.brazier);
        else if (!ev.lit && st.boss && st.boss.st !== 'dead' && !events.some((x) => x.e === 'boss' && x.phase === 2)) this.say(SAY.bossSwallow);
        break;
      case 'boss':
        if (ev.smoke) this.say(SAY.smoke);
        else if (ev.phase === 2) this.say(SAY.bossPhase2);
        else if (ev.st === 'feed') this.say(SAY.bossFeed);
        break;
      case 'power': {                                   // R-POW-*
        const kind = T.gdf.entities.find((e) => e.id === ev.id)?.kind, f = SAY.power[ev.k];
        if (f) this.say(f(DELVE_NAMES[kind] ?? 'creature'));
        break;
      }
      case 'free': this.say(SAY.free); break;
      case 'steal': {                                   // R-THIEF-1, R-THIEF-2
        const f = T.gdf.entities.find((e) => e.id === ev.id), who = DELVE_NAMES[f?.kind] ?? 'thief';
        if (ev.item) { const it = T.gdf.entities.find((e) => e.id === ev.item); this.say(SAY.stealTreasure(who, T.text.items?.[it?.id]?.name ?? 'your treasure')); }
        else if (ev.flasks > 0) this.say(SAY.stealFlask(who)); else this.say(SAY.stealPebbles(who, ev.pebbles));
        break;
      }
      case 'loot': this.say(SAY.lootBack(ev.n ? T.text.items?.[ev.n]?.name ?? 'your treasure' : ev.f > 0 ? FLASK_NAME : `${ev.p} pebbles`)); break;
      case 'forget': this.say(SAY.forget); break;
      case 'reveal': {                                  // R-MIMIC-1
        const f = T.gdf.entities.find((e) => e.id === ev.id), was = f?.disguise === 'chest' ? 'chest' : f?.disguise === 'flask' ? 'flask' : 'coins';
        this.say(ev.safe ? SAY.mimicSafe(was) : SAY.mimic(was));
        break;
      }
      case 'relit': this.say(SAY.relit); break;
      case 'death': this.onDeath(ev.cause); break;
      case 'rise': this.say(SAY.rise(this.zoneName(this.zoneAt()) ?? 'the dark')); this.look = { yaw: yawRad(P.yaw), pitch: 0 }; this.fresh = true; this.lowOilWarned = false; break;
      case 'won': this.onWin(); break;
      default: break;
    }
  }

  watchLantern() {
    const P = this.st.player, was = this.prev.player.oil;
    if (this.st.dead !== null) return;
    if (P.oil > 0 && P.oil < 20 * Sim.OIL_UNIT && !this.lowOilWarned) { this.lowOilWarned = true; this.say(SAY.lowOil); }
    if (P.oil >= 20 * Sim.OIL_UNIT) this.lowOilWarned = false;
    if (was > 0 && P.oil === 0 && !(this.st.boss && this.st.boss.st !== 'asleep' && this.st.boss.st !== 'dead')) this.say(SAY.out);
  }

  onDeath(cause) {
    const D = DEATHS[cause] ?? DEATHS.beast, T = this.T;
    let who = 'something in the dark';
    if (cause === 'damage') who = T.text.damageWho ?? who;
    else if (cause === 'beast') {
      const p = this.st.player; let bd = Infinity;
      this.st.foes.forEach((f, n) => { if (f.st === 'dead' || f.st === 'dormant') return; const d = Math.hypot(f.x - p.x, f.z - p.z); if (d < bd) { bd = d; who = FOE_NAMES[T.foeKinds[n]] ?? who; } });
    }
    this.keys.clear(); this.held = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    this.say(D.cause.replace('{who}', who));
    this.setHints();
  }

  rise() { if (this.st && this.st.dead !== null && this.st.tick >= this.st.dead.at + Sim.RISE_TICKS) { this.pending |= B.rise; if (!coarse) this.tryLock(); } }

  onWin() {
    this.mode = 'won'; if (document.pointerLockElement) document.exitPointerLock();
    this.keys.clear(); this.held = 0; this.setHints();
  }

  read(t) { this.ui.openRead(t); }

  say(text) {
    if (!text) return;
    const m = $('msg'); m.textContent = text; m.classList.remove('old');
    clearTimeout(this.msgTimer); this.msgTimer = setTimeout(() => m.classList.add('old'), 7000);
  }

  // ---------------------------------------------------------------- HUD (Gloamhollow hud / updatePrompt)
  hud() {
    const st = this.st; if (!st) return;
    const P = st.player, T = this.T, ents = T.gdf.entities;
    const z = this.zoneAt(), zn = z >= 0 ? cap(this.zoneName(z)) : 'A narrow passage';
    const status = $('status'); status.replaceChildren();
    const b = document.createElement('b'); b.textContent = zn; status.append(b, '\n');
    const inv = [['Pebbles', P.pebbles], ['Flasks', P.flasks]];
    inv.forEach(([k, v], n) => { const i = document.createElement('i'); i.textContent = k; status.append(n ? '  ' : '', i, ` ${v}`); });
    for (const num of st.taken) { const it = ents[num - 1]; if (it.kind === 'key') { const u = document.createElement('u'); u.textContent = T.text.items?.[it.id]?.hud ?? 'A key'; status.append('  ', u); } }
    // R-POW-*: what the foes' touch has done to you.
    const fx = [[P.frozen > 0, 'Frozen'], [P.held >= 0, 'Seized'], [P.confused > 0, 'Confused'], [P.poison > 0, 'Poisoned']].filter(([on]) => on).map(([, n]) => n);
    status.append(`\nDeaths ${st.deaths}`);
    if (fx.length) { const u = document.createElement('u'); u.textContent = fx.join(' · '); status.append('  ', u); }
    const hp = P.hp / Sim.HP_UNIT, oil = P.oil / Sim.OIL_UNIT;
    $('hpBar').style.setProperty('--v', String(clamp(hp / 100, 0, 1)));
    $('hpTxt').textContent = `${Math.ceil(hp)} / ${Math.round(P.maxHp / Sim.HP_UNIT)}`; // R-POW-7
    $('oilBar').style.setProperty('--v', String(clamp(oil / 100, 0, 1)));
    $('oilBarBox').classList.toggle('low', oil < 20);
    $('oilTxt').textContent = P.oil <= 0 ? 'Lantern out' : P.doused ? `Oil ${Math.ceil(oil)} · doused` : P.hung >= 0 ? `Oil ${Math.ceil(oil)} · on the hook` : P.hooded ? `Oil ${Math.ceil(oil)} · hooded` : `Oil ${Math.ceil(oil)}`;
    const treasure = st.taken.reduce((a, num) => a + (ents[num - 1].value ?? 0), 0);
    $('pfTre').textContent = `Treasure ${treasure}`;
    $('pebCt').textContent = String(P.pebbles); $('oilCt').textContent = String(P.flasks);
    $('hoodNm').textContent = P.hooded ? 'Open' : 'Hood';
    $('sHood').classList.toggle('lit', P.hooded); $('sPeb').classList.toggle('off', P.pebbles <= 0); $('sOil').classList.toggle('off', P.flasks <= 0);
    const cd = (id, v) => $(id).querySelector('.cd').style.setProperty('--cd', String(clamp(v, 0, 1)));
    cd('sAtk', P.strikeCd / Sim.STRIKE_CD); cd('sProbe', P.probeCd / Sim.PROBE_CD); cd('sPeb', P.pebbleCd / Sim.PEBBLE_CD);
    // the boss's frame, while you are in her zone or the way to it
    const tf = $('tframe'), bs = st.boss;
    if (bs && bs.st !== 'asleep' && bs.st !== 'dead') {
      const bd = ents.find((e) => e.type === 'boss'), bzi = T.gdf.zones.findIndex((q) => q.id === bd.zone);
      tf.hidden = !(z === bzi || (z >= 0 && T.gdf.zones[z].rects.every(([, , rw, rh]) => rw === 1 || rh === 1)));
      tf.querySelector('.tf-name').textContent = T.text.boss?.name ?? 'The keeper of the tomb';
      $('tfBar').style.setProperty('--v', String(bs.hp / (T.bestiaryBoss?.strikes ?? 6)));
      $('tfState').textContent = this.info().bossSolid ? 'Solid in the firelight: strike now' : 'Smoke: your blade will pass through her';
    } else tf.hidden = true;
  }

  prompt() {
    const el = $('prompt'), st = this.st;
    let txt = '', key = true;
    if (st && this.mode === 'play' && st.dead === null) {
      if (st.player.busy > 0) { txt = st.player.busyOn === -2 ? 'Relighting your lantern…' : 'Lighting the brazier…'; key = false; }
      else { const o = this.nearest(); if (o) txt = o.label(st); }
    } else if (st && st.dead !== null && this.mode === 'play') { txt = st.tick >= st.dead.at + Sim.RISE_TICKS ? 'Rise again' : ''; key = false; }
    if (txt === this.promptKey) return;
    this.promptKey = txt; el.hidden = !txt; el.replaceChildren();
    if (!txt) return;
    const dead = st.dead !== null;
    if (key || dead) { const b = document.createElement('b'); b.textContent = dead ? 'Enter' : 'E'; el.append(b); }
    el.append(txt);
  }

  info() {
    const st = this.st, P = st.player, ents = this.T.gdf.entities;
    const beam = traceBeam(this.T, this.Q, st);
    const braziers = ents.filter((e) => e.type === 'brazier');
    const b = st.boss;
    let bossSolid = false, bossNear = 0;
    if (b && b.st !== 'asleep' && b.st !== 'dead') {
      bossSolid = braziers.some((q, n) => { if (!st.braziers[n]) return false; const dx = q.cell[0] * S + S / 2 - b.x, dz = q.cell[1] * S + S / 2 - b.z; return dx * dx + dz * dz < 3600 * 3600; });
      bossNear = clamp(1 - Math.hypot(b.x - P.x, b.z - P.z) / 5500, 0, 1);
    }
    const ex = this.T.gdf.exit;
    let exitOpen = false;
    if (ex) exitOpen = ex.requires === undefined ? true : ex.requires === 'bossDefeated' ? !!(b && b.st === 'dead') : st.taken.includes(ents.findIndex((e) => e.id === ex.requires) + 1);
    const alcoves = ents.filter((e) => e.type === 'alcove'), doors = ents.filter((e) => e.type === 'door');
    const sealedAlcoves = new Set(alcoves.filter((a) => st.sealed.includes(doors.findIndex((d) => d.id === a.door))).map((a) => a.id));
    const vent = (v) => { const u = (st.tick + v.phase) % v.period; return u < v.warn ? { s: 'warn', f: u / Math.max(1, v.warn) } : u < v.warn + v.fire ? { s: 'fire', f: (u - v.warn) / v.fire } : { s: 'idle', f: 0 }; }; // R-VENT-2
    return { beam, beamSolved: beam?.hits != null, bossSolid, bossNear, exitOpen, sealedAlcoves, vent, lit: P.oil > 0 && !P.hooded && P.hung < 0 && !P.doused, fresh: this.fresh, won: this.mode === 'won' };
  }

  frame(dt) {
    if (this.mode === 'play' && this.st && !window.__twNoRender) {
      this.acc = Math.min(this.acc + dt, 0.25);
      while (this.acc >= DT) { this.acc -= DT; this.tick(); }
    }
    if (window.__twNoRender) return;
    if (!this.st) return;
    this.ui.frame(dt);
    this.hudT = (this.hudT ?? 0) + dt; if (this.hudT > 0.1) { this.hudT = 0; this.hud(); }
    this.prompt();
    const alpha = this.mode === 'play' ? clamp(this.acc / DT, 0, 1) : 1;
    this.view.frame(dt, this.st, this.prev, alpha, this.look, this.info());
  }

  // ---------------------------------------------------------------- input
  tryLock() {
    const v = $('view');
    if (coarse || !v.requestPointerLock || this.mode !== 'play') return;
    try { const p = v.requestPointerLock(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* drag-to-look still works */ }
  }
  setHints() {
    const play = this.mode === 'play' && !!this.st && this.st.dead === null, v = $('view');
    $('hint').hidden = !(play && !coarse && document.pointerLockElement !== v);
    $('cross').hidden = !play;
  }
  bindInput() {
    const v = $('view'), MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const PRESS = { KeyE: B.interact, KeyF: B.hood, KeyL: B.hood, KeyQ: B.probe, KeyR: B.pebble, KeyO: B.oil };
    addEventListener('keydown', (e) => {
      if (this.mode !== 'play' || !this.st) return;
      if (this.st.dead !== null) { if (e.code === 'Enter' || e.code === 'Space') { this.rise(); e.preventDefault(); } return; }
      if (MOVE.has(e.code)) { this.keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); return; }
      if (e.code === 'Space') { this.held |= B.strike; e.preventDefault(); return; }
      if (e.repeat) return;
      if (PRESS[e.code]) { this.pending |= PRESS[e.code]; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'Space') this.held &= ~B.strike; });
    addEventListener('blur', () => { this.keys.clear(); this.held = 0; });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== v) this.held &= ~B.strike; this.setHints(); });
    const applyLook = (dx, dy) => this.applyLook(dx, dy);
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === v && this.mode === 'play') applyLook(e.movementX * 0.0022, e.movementY * 0.0022); });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    let drag = null;
    v.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play' || !this.st) return;
      if (this.st.dead !== null) { this.rise(); return; }
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement === v) { if (e.button === 0) this.held |= B.strike; else if (e.button === 2) this.pending |= B.probe; return; }
        this.tryLock(); drag = { x: e.clientX, y: e.clientY }; return;
      }
      audioInit(); this.ui.touchDown(e);
    });
    v.addEventListener('pointermove', (e) => {
      if (this.mode !== 'play') return;
      if (e.pointerType !== 'mouse') { this.ui.touchMove(e); return; }
      if (!drag) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) return;
      const k = drag.touch ? 0.0058 : 0.005; applyLook((e.clientX - drag.x) * k, (e.clientY - drag.y) * k); drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = (e) => { if (e.pointerType === 'mouse') this.held &= ~B.strike; else this.ui.touchUp(e); drag = null; };
    v.addEventListener('pointerup', end); v.addEventListener('pointercancel', end);
    const slot = (id, bit, hold) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); audioInit(); if (!this.ui.touchedOnce && e.pointerType !== 'mouse') { this.ui.touchedOnce = true; this.setHints(); } if (hold) this.held |= bit; else this.pending |= bit; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
      const up = () => { if (hold) this.held &= ~bit; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
      el.addEventListener('click', (e) => e.preventDefault());
    };
    slot('sAtk', B.strike, true); slot('sHood', B.hood); slot('sProbe', B.probe); slot('sPeb', B.pebble); slot('sOil', B.oil);
    $('prompt').addEventListener('click', (e) => { e.preventDefault(); audioInit(); if (this.st?.dead !== null) this.rise(); else this.pending |= B.interact; });
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  for (const host of document.querySelectorAll('.keysHost')) host.appendChild($(coarse ? 'keysTouch' : 'keysDesk').content.cloneNode(true));
  $('introKeys').open = !coarse;
  $('goBtn').disabled = true;
  let T;
  // The tomb comes from the path (/play/<name>), allow-listed: the name never reaches the file system by itself.
  const played = /^\/play\/([a-z0-9-]{1,64})$/.exec(location.pathname);
  const name = played !== null && ['gloamhollow'].includes(played[1]) ? played[1] : null;
  if (name === null) { showError('There is no tomb of that name.'); return; }
  try { T = await loadTomb(name); } catch (e) { showError('The tomb could not be loaded. Reload the page to try again.'); console.error(e); return; }
  let game;
  try { game = new Game(T); } catch (e) { showError('This page needs WebGL to draw the tomb, and it is turned off or unavailable in this browser.'); console.error(e); return; }
  { const b = T.gdf.entities.find((e) => e.type === 'boss'); T.bestiaryBoss = b ? bossKind(b.kind) : null; }
  game.bindInput();
  const resize = () => game.view.resize(innerWidth, innerHeight);
  addEventListener('resize', resize); if (window.visualViewport) visualViewport.addEventListener('resize', resize); resize();
  $('goBtn').disabled = false;
  game.ui.showTitle();
  // A first frame behind the title card.
  game.st = Sim.init(T.world, 0, 'delve'); game.prev = structuredClone(game.st);
  let last = performance.now();
  const loop = (now) => { requestAnimationFrame(loop); const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; if (game.mode === 'title' && !reduced) game.look.yaw += dt * 0.12; game.frame(dt); };
  requestAnimationFrame(loop);
  // Test hook for the Playwright walkthrough (step 6c), only when the test sets window.__twTest before boot:
  // fixed ticks, rendering off with window.__twNoRender.
  if (window.__twTest === true) window.__tw = {
    game, Sim, T,
    get state() { return game.st; }, get mode() { return game.mode; }, get look() { return game.look; },
    start: (s = 1) => game.newGame(s),
    tick(n = 1) { for (let k = 0; k < n; k++) game.tick(); },
    nearest: () => { const o = game.nearest(); return o ? { n: o.n ?? 0, label: o.label(game.st), read: o.read?.id ?? null } : null; },
  };
}
boot();
