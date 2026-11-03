// Test driver injected into reference/gloamhollow/Gloamhollow.html by the walkthrough.
// It plays through the game's own test hook (window.__gh): fixed 1/30 s ticks via
// __gh.sim(), rendering off (window.__ghNoRender). It never writes game state; it only
// presses keys, sets the view direction and calls the same actions the HUD buttons call.
(() => {
  'use strict';
  const gh = window.__gh;
  if (!gh) throw new Error('window.__gh missing: the game did not boot');
  const S = 2.4;
  const DT = 1 / 30;
  const cx = (i) => (i + 0.5) * S;
  const P = gh.player;
  const keys = gh.keys;

  function tick(n = 1) { for (let k = 0; k < n; k++) gh.sim(DT); }
  function release() { keys.delete('KeyW'); keys.delete('ShiftLeft'); }
  function speed() { return Math.hypot(P.vx, P.vz); }
  function faceXZ(x, z) { P.yaw = Math.atan2(-(x - P.x), -(z - P.z)); }

  // Walk to a point in metres by holding W (and Shift to run) with the yaw aimed at it.
  // Returns 'arrived', or the game mode if it changed (e.g. 'dead').
  function walkTo(x, z, opts = {}) {
    const tol = opts.tol ?? 0.12;
    for (let t = 0; t < (opts.maxTicks ?? 1800); t++) {
      if (gh.mode !== 'play') { release(); return gh.mode; }
      const d = Math.hypot(x - P.x, z - P.z);
      // velocity eases by min(1, dt*12) per tick, so a released walker coasts about v * 0.05 m
      if (d <= tol + speed() * 0.05) {
        release();
        let settle = 0;
        while (speed() > 0.03 && settle++ < 60) { tick(); if (gh.mode !== 'play') return gh.mode; }
        if (Math.hypot(x - P.x, z - P.z) <= tol + 0.08) return 'arrived';
        continue;
      }
      faceXZ(x, z);
      keys.add('KeyW');
      if (opts.run) keys.add('ShiftLeft'); else keys.delete('ShiftLeft');
      tick();
    }
    release();
    if (opts.noThrow) return 'blocked';
    throw new Error(`walkTo(${x.toFixed(2)}, ${z.toFixed(2)}) timed out at (${P.x.toFixed(2)}, ${P.z.toFixed(2)})`);
  }

  // Walk cell centre to cell centre, [i, j] grid coordinates.
  function walkCells(cells, opts) {
    for (const [i, j] of cells) {
      const r = walkTo(cx(i), cx(j), opts);
      if (r !== 'arrived') return { result: r, at: [i, j] };
    }
    return { result: 'arrived' };
  }

  function prompt() { const o = gh.nearestInteract(); return o ? o.label() : ''; }

  // Face a point, check the prompt, and press E (interact).
  function use(x, z, expect) {
    faceXZ(x, z);
    const label = prompt();
    if (expect && !label.includes(expect)) throw new Error(`expected prompt "${expect}", got "${label}"`);
    gh.interact();
    return label;
  }

  function snap() {
    const G = gh.G, L = gh.L, b = gh.boss;
    return {
      mode: gh.mode,
      cp: gh.CP && gh.CP.key,
      deaths: gh.STATS.deaths,
      x: P.x, z: P.z,
      cell: [Math.floor(P.x / S), Math.floor(P.z / S)],
      hp: G.hp, oil: G.oil, flasks: G.flasks, pebbles: G.pebbles, hooded: G.hooded, hung: G.hung, key: G.key,
      treasure: G.treasure.map((t) => t.id), treasureValue: G.treasure.reduce((a, t) => a + t.v, 0),
      doors: { ...G.doors },
      bellFails: G.bellFails, bellsSolved: G.bellsSolved, wardens: G.wardens,
      mirrors: { ...G.mirrors }, mirrorsSolved: G.mirrorsSolved, crawlers: G.crawlers,
      gildedSprung: G.gildedSprung, gildedLooted: G.gildedLooted, plainLooted: G.plainLooted,
      braziers: G.braziers.slice(), bossG: G.boss, heart: G.heart, visited: G.visited.slice(),
      lessons: { sprung: L.sprung.slice(), xplates: L.xplates.slice(), pits: L.pits.slice(), bridge: L.bridge.slice(), sealed: L.sealed.slice(), laughOpen: L.laughOpen },
      boss: b ? { x: b.x, z: b.z, hp: b.hp, state: b.state, solid: b.solid, phase: b.phase } : null,
      foes: gh.mons.filter((m) => m.state !== 'dead').map((m) => ({ type: m.type, x: m.x, z: m.z, state: m.state })),
      eyeWake: gh.eyeWake,
      zone: G.visited[G.visited.length - 1],
    };
  }

  window.__wt = { gh, S, cx, P, keys, tick, release, faceXZ, walkTo, walkCells, use, prompt, snap,
    idx: (i, j) => j * 44 + i };
})();
