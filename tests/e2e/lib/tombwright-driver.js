// Test driver injected into the Tombwright game page by the port's walkthrough (decision #54).
// It plays through the client's test hook (window.__tw, installed when window.__twTest is set before boot):
// every tick is one Sim.step with an input the driver builds (move, yaw, pitch, buttons, target), the way
// the client's own input sampling does; rendering is off (window.__twNoRender). It never writes sim state.
// Distances in this file are metres, as in the reference driver; the sim works in millimetres.
(() => {
  'use strict';
  const tw = window.__tw;
  if (!tw) throw new Error('window.__tw missing: the client did not boot in test mode');
  const g = tw.game, Sim = tw.Sim, B = Sim.BTN, S = 2.4;
  const ents = tw.T.gdf.entities, zones = tw.T.gdf.zones;
  const cx = (i) => (i + 0.5) * S;
  const st = () => g.st;
  const P = () => g.st.player;
  const num = (id) => ents.findIndex((e) => e.id === id) + 1;
  const ofType = (t) => ents.filter((e) => e.type === t);
  const doors = ofType('door'), mirrors = ofType('mirror'), chests = ofType('chest'), braziers = ofType('brazier'), vents = ofType('vent'), foes = ofType('foe');
  const groups = [...new Set(foes.map((f) => f.group))];
  let held = 0; // buttons held across ticks (run, strike)

  // One tick with the given input; pending UI presses (the death card's rise button) are merged in by the client.
  function step(move = [0, 0], buttons = 0, target = 0) {
    g.drive = { move, yaw: g.qYaw(), pitch: g.qPitch(), buttons: buttons | held, target };
    tw.tick(1); g.drive = null;
  }
  function tick(n = 1) { for (let k = 0; k < n; k++) { if (over()) return; step(); } }
  const over = () => g.mode !== 'play' || st().won !== null || (st().dead !== null && st().mode === 'ironman');
  function mode() { const s = st(); return g.mode === 'paused' ? 'paused' : s.won !== null ? 'won' : s.dead !== null ? 'dead' : g.mode; }
  function speed() { return Math.hypot(P().vx, P().vz) / 1000; }
  function faceXZ(x, z) { const p = P(); g.look.yaw = Math.atan2(-(x * 1000 - p.x), -(z * 1000 - p.z)); }
  function setPitch(rad) { g.look.pitch = rad; }
  // Buttons act on their rising edge (R-INPUT-2): if a panel paused the game before a press was released,
  // release it first.
  function fresh(bit) { if (st().prevButtons & bit) step(); }
  function press(bit) { fresh(bit); step([0, 0], bit); step(); }

  // Walk to a point by holding forward (and run) with the yaw on it. Returns 'arrived', or the mode if it changed.
  function walkTo(x, z, opts = {}) {
    const tol = opts.tol ?? 0.12;
    for (let t = 0; t < (opts.maxTicks ?? 1800); t++) {
      if (mode() !== 'play') return mode();
      const p = P(), d = Math.hypot(x - p.x / 1000, z - p.z / 1000);
      // velocity eases by 2/5 a tick (R-MOVE-3), so a released walker coasts about v * 0.05 m
      if (d <= tol + speed() * 0.05) {
        let settle = 0;
        while (speed() > 0.03 && settle++ < 60) { step(); if (mode() !== 'play') return mode(); }
        if (Math.hypot(x - P().x / 1000, z - P().z / 1000) <= tol + 0.08) return 'arrived';
        continue;
      }
      faceXZ(x, z);
      step([127, 0], opts.run ? B.run : 0);
    }
    if (opts.noThrow) return 'blocked';
    throw new Error(`walkTo(${x.toFixed(2)}, ${z.toFixed(2)}) timed out at (${(P().x / 1000).toFixed(2)}, ${(P().z / 1000).toFixed(2)})`);
  }
  function walkCells(cells, opts) {
    for (const [i, j] of cells) { const r = walkTo(cx(i), cx(j), opts); if (r !== 'arrived') return { result: r, at: [i, j] }; }
    return { result: 'arrived' };
  }

  function prompt() { const o = g.nearest(); return o ? o.label(st()) : ''; }
  // Face a point, check the prompt, press interact (E): a text opens the reader, anything else goes to the sim.
  function use(x, z, expect) {
    faceXZ(x, z);
    const o = g.nearest(), label = o ? o.label(st()) : '';
    if (expect && !label.includes(expect)) throw new Error(`expected prompt "${expect}", got "${label}"`);
    if (!o) return label;
    if (o.read) g.read(o.read); else { fresh(B.interact); step([0, 0], B.interact, o.n); if (g.mode === 'play') step(); }
    return label;
  }
  function closePanel() { g.ui.closePanel(); }
  function rise() { g.rise(); step(); step(); }

  function ventState(i) {
    const v = vents.find((q) => q.cells.some((c) => c[0] === i));
    const u = (st().tick + v.phase) % v.period; // R-VENT-2
    return u < v.warn ? 'warn' : u < v.warn + v.fire ? 'fire' : 'idle';
  }

  function snap() {
    const s = st(), p = s.player, taken = s.taken.map((n) => ents[n - 1]);
    const treasure = taken.filter((e) => e.kind === 'treasure');
    const cpZone = s.checkpoints[s.cp].zone, zi = g.zoneAt();
    const b = s.boss, info = g.info();
    return {
      mode: mode(), tick: s.tick,
      cp: cpZone >= 0 ? zones[cpZone].id : null, zone: zi >= 0 ? zones[zi].id : null,
      deaths: s.deaths, cause: s.dead?.cause ?? null,
      x: p.x / 1000, z: p.z / 1000, cell: [Math.floor(p.x / 2400), Math.floor(p.z / 2400)],
      hp: p.hp / Sim.HP_UNIT, oil: p.oil / Sim.OIL_UNIT, flasks: p.flasks, pebbles: p.pebbles, hooded: p.hooded, hung: p.hung >= 0,
      key: taken.some((e) => e.kind === 'key'),
      treasure: treasure.map((e) => e.id), treasureValue: treasure.reduce((a, e) => a + e.value, 0),
      doors: Object.fromEntries(doors.map((d, n) => [d.id, s.doors[n].open])),
      bellsSolved: s.bellSets.every((x) => x.solved),
      groups: Object.fromEntries(groups.map((id, n) => [id, s.groups[n]])),
      mirrors: Object.fromEntries(mirrors.map((m, n) => [m.id, s.mirrors[n] === 0 ? '/' : '\\'])),
      beamHits: info.beam?.hits ?? null,
      chests: Object.fromEntries(chests.map((c, n) => [c.id, { ...s.chests[n] }])),
      braziers: s.braziers.slice(), revealed: s.revealed.map((n) => ents[n - 1].id),
      boss: b ? { x: b.x / 1000, z: b.z / 1000, hp: b.hp, st: b.st, phase: b.phase, solid: info.bossSolid } : null,
      foes: s.foes.map((f, n) => ({ kind: foes[n].kind, group: foes[n].group, x: f.x / 1000, z: f.z / 1000, st: f.st })),
      eyes: s.eyes.slice(),
      lessons: { sprung: s.sprung.slice(), marked: s.marked.slice(), pits: s.pits.slice(), bridge: s.bridge.slice(), sealed: s.sealed.map((n) => doors[n].id) },
      msg: document.getElementById('msg').textContent,
    };
  }

  window.__wt = { tw, g, Sim, B, S, cx, num, P, st, step, tick, press, faceXZ, setPitch, walkTo, walkCells, use, prompt, closePanel, rise, ventState, snap, braziers,
    hold(bit) { held |= bit; }, release(bit) { held &= ~bit; }, idx: (i, j) => j * tw.T.w + i };
})();
