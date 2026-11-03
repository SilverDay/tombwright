// Gloamhollow walkthrough: plays the original game (reference/gloamhollow/Gloamhollow.html)
// from the stair to the daylight shaft and checks every puzzle, trap lesson, checkpoint and
// treasure on the way. It is the M0 exit criterion (spec §16, decisions log): the ported
// engine must pass the same walkthrough once Gloamhollow runs on the Tombwright sim core.
//
// The game runs headless with rendering off (window.__ghNoRender) and advances only when the
// driver calls __gh.sim() in fixed 1/30 s ticks. three.js r128 is served from node_modules
// instead of cdnjs, and Google Fonts are blocked, so the test needs no network.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GAME = 'file://' + ROOT + 'reference/gloamhollow/Gloamhollow.html';
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

const S = 2.4;
const cx = (i) => (i + 0.5) * S;
const idx = (i, j) => j * 44 + i;

test('Gloamhollow: full walkthrough, stair to daylight', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(THREE_CDN, (r) => r.fulfill({ path: ROOT + 'node_modules/three/build/three.min.js', contentType: 'text/javascript' }));
  await page.route(/^https?:\/\/(?!cdnjs\.cloudflare\.com)/, (r) => r.abort());
  await page.addInitScript(() => { window.__ghNoRender = true; });
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__gh);
  await page.addScriptTag({ path: ROOT + 'tests/e2e/lib/gloamhollow-driver.js' });

  let checks = 0;
  const check = (label, cond) => { checks++; expect(cond, label).toBeTruthy(); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const snap = () => ev(() => window.__wt.snap());
  const tick = (n) => ev((k) => window.__wt.tick(k), n);
  const walk = async (cells, opts = {}) => {
    const r = await ev(([c, o]) => window.__wt.walkCells(c, o), [cells, opts]);
    if (!opts.allowDeath) expect(r.result, `walk ${JSON.stringify(cells)} -> ${JSON.stringify(r)}`).toBe('arrived');
    return r;
  };
  const walkTo = async (x, z, opts = {}) => {
    const r = await ev(([a, b, o]) => window.__wt.walkTo(a, b, o), [x, z, opts]);
    expect(r, `walkTo ${x},${z}`).toBe('arrived');
  };
  const use = (x, z, label) => ev(([a, b, l]) => window.__wt.use(a, b, l), [x, z, label]);
  const closePanel = () => ev(() => window.__wt.gh.closePanel());
  const act = (name) => ev((n) => window.__wt.gh[n](), name);
  const realWait = (ms) => page.waitForTimeout(ms); // for the game's few real-time setTimeouts
  const zoneIs = async (key) => (await snap()).visited.includes(key);
  // A deliberate death: the death card names the cause, then you rise at the last checkpoint.
  const deathAndRise = async (cause, deathsNow, cpKey) => {
    let s = await snap();
    check(`${cause}: the trap kills`, s.mode === 'dead' && s.deaths === deathsNow);
    await expect(page.locator('#deathCause')).toContainText(cause);
    await act('rise');
    s = await snap();
    check(`${cause}: you rise at the ${cpKey} checkpoint`, s.mode === 'play' && s.cp === cpKey && s.hp === 100);
    return s;
  };

  // ---------------------------------------------------------------- Vestibule
  await test.step('Vestibule: start, plaque, oil, door', async () => {
    await act('newGame');
    let s = await snap();
    check('a new delve is in play', s.mode === 'play');
    check('starts at the Vestibule checkpoint', s.cp === 'vest' && s.cell[0] === 34 && s.cell[1] === 60);
    check('starts with full health and oil', s.hp === 100 && s.oil === 100);
    check('starts with 10 pebbles and 1 flask', s.pebbles === 10 && s.flasks === 1);
    check('nothing has been taken yet', s.treasureValue === 0);

    await walk([[34, 57], [33, 57], [33, 56]]);
    await use(cx(33), 56 * S, 'Read the bronze plaque');
    check('reading the plaque opens the reader and pauses', (await snap()).mode === 'paused');
    await closePanel();
    check('closing the reader resumes play', (await snap()).mode === 'play');

    await walkTo(cx(32) + 1.0, cx(57));
    await use(cx(32), cx(57), 'Take a flask of lamp oil');
    check('the vestibule flask is taken', (await snap()).flasks === 2);

    await walk([[34, 57], [34, 56]]);
    await use(cx(34), cx(55), 'Open the door');
    await tick(45);
    check('the vestibule door is open', (await snap()).doors.vest === true);
  });

  // ---------------------------------------------------------------- Hall of the Kneeling Bearers
  await test.step('Hall: checkpoint, probe a plate, die on one, rise, cross by the masons\' road', async () => {
    await walk([[34, 55], [34, 54], [34, 53], [34, 52]]);
    let s = await snap();
    check('entering the hall reaches its checkpoint', s.cp === 'hall');

    await walk([[33, 52]]);
    await ev(() => { window.__wt.faceXZ(window.__wt.P.x, window.__wt.P.z - 3); window.__wt.gh.probe(); });
    s = await snap();
    check('probing the tile ahead marks a pressure plate', s.lessons.xplates.includes(idx(33, 51)));

    // Deliberately step on an unmarked plate.
    await walk([[34, 52], [35, 52]]);
    const r = await walk([[35, 51]], { allowDeath: true });
    s = await snap();
    check('stepping on a plate kills', r.result === 'dead' && s.mode === 'dead');
    check('the death is counted', s.deaths === 1);
    check('the sprung plate is remembered as a lesson', s.lessons.sprung.includes(idx(35, 51)));
    await realWait(400); // the death card appears after a short real-time delay
    await act('rise');
    s = await snap();
    check('you rise in play again', s.mode === 'play');
    check('you rise at the hall checkpoint', s.cell[0] === 34 && s.cell[1] === 52);
    check('rising restores health', s.hp === 100);
    check('the lesson survives death', s.lessons.sprung.includes(idx(35, 51)) && s.lessons.xplates.includes(idx(33, 51)));

    // The safe path: the floor cells HALL_PAT marks with '.'.
    await walk([[34, 51], [34, 50], [33, 50], [33, 49], [33, 48], [32, 48], [32, 47], [32, 46], [33, 46], [34, 46],
      [34, 45], [34, 44], [35, 44], [35, 43], [35, 42], [36, 42], [36, 41], [36, 40], [35, 40], [34, 40], [34, 39]]);
    s = await snap();
    check('the hall is crossed without another death', s.deaths === 1 && s.mode === 'play');
  });

  // ---------------------------------------------------------------- Mouth of the Gallery
  await test.step('Mouth: checkpoint, scrawl, chain, rubble', async () => {
    await walk([[34, 38], [34, 37], [34, 36], [34, 35], [34, 34]]);
    let s = await snap();
    check('the Mouth of the Gallery is a checkpoint', s.cp === 'mouth');
    await walk([[35, 34], [35, 33]]);
    await use(cx(35), cx(33) - 2, 'Take a silver lamp-chain');
    s = await snap();
    check('the silver lamp-chain is taken (60)', s.treasure.includes('chain') && s.treasureValue === 60);
    await use(cx(35), cx(33) - 2, 'Look at the scorched bones');
    check('the scorched bones can be read', (await snap()).mode === 'paused');
    await closePanel();
    await walk([[34, 33], [34, 34], [33, 34], [33, 35]]);
    await ev(() => { window.__wt.gh.throwPebble(); });
    await tick(30);
    const before = (await snap()).pebbles;
    await use(cx(33) - 0.3, cx(35) - 0.3, 'Gather pebbles');
    check('the rubble refills the pouch to 12', (await snap()).pebbles === 12 && before < 12);
  });

  // ---------------------------------------------------------------- Gallery of Waking Eyes
  await test.step('Gallery: hooded lantern, the eyes, a pebble finds a pit', async () => {
    await walk([[33, 34]]);
    await ev(() => window.__wt.gh.toggleHood());
    check('the lantern is hooded before the gallery', (await snap()).hooded === true);
    await walk([[32, 34]]);
    check('inside the gallery with a hooded lantern the eyes stay shut', (await snap()).eyeWake === 0);

    await ev(() => window.__wt.gh.toggleHood());
    await tick(12);
    const waking = (await snap()).eyeWake;
    check('an open flame wakes the eyes', waking > 0.3 && (await snap()).mode === 'play');
    await ev(() => window.__wt.gh.toggleHood());
    await tick(45);
    check('hooding again lets them close before they burn', (await snap()).eyeWake === 0 && (await snap()).mode === 'play');

    // Deliberately stay lit: the eyes burn you after about a second.
    await ev(() => window.__wt.gh.toggleHood());
    await tick(40);
    let s = await deathAndRise('Waking Eyes', 2, 'mouth');
    check('a death rolls back what this life took since the checkpoint: the chain is on the floor again', s.treasureValue === 0 && !s.treasure.includes('chain'));
    // Take the chain again, refill the pouch, hood the lantern.
    const backToTheGallery = async () => {
      await walk([[35, 34], [35, 33]]);
      await use(cx(35), cx(33) - 2, 'Take a silver lamp-chain');
      await walk([[34, 33], [34, 34], [33, 34], [33, 35]]);
      await use(cx(33) - 0.3, cx(35) - 0.3, 'Gather pebbles');
      await walk([[33, 34]]);
      await ev(() => window.__wt.gh.toggleHood());
      const t = await snap();
      return t.treasureValue === 60 && t.pebbles === 12 && t.hooded === true;
    };
    check('the chain can be taken again', await backToTheGallery());

    // Deliberately walk onto an untested floor: a hidden pit.
    await walk([[32, 34], [31, 34], [30, 34], [29, 34], [29, 35], [28, 35], [27, 35], [26, 35], [25, 35], [25, 34], [25, 33],
      [24, 33], [23, 33], [22, 33], [21, 33], [21, 34], [21, 35]]);
    await walk([[20, 35]], { allowDeath: true });
    s = await deathAndRise('false floor', 3, 'mouth');
    check('the pit you fell into stays open', s.lessons.pits.includes(idx(20, 35)));
    check('and the chain rolled back once more', s.treasureValue === 0);
    check('back to the gallery with the chain, a full pouch and a hooded lantern', await backToTheGallery());
    await walk([[32, 34]]);

    await walk([[31, 34]]);
    await ev(() => { const w = window.__wt; w.faceXZ(w.P.x - 5, w.P.z); w.P.pitch = 0.2; w.gh.throwPebble(); w.P.pitch = 0; });
    await tick(30);
    s = await snap();
    check('a pebble punches through a hidden pit and reveals it', s.lessons.pits.includes(idx(28, 34)));

    await walk([[30, 34], [29, 34], [29, 35], [28, 35], [27, 35], [26, 35], [25, 35], [25, 34], [25, 33],
      [24, 33], [23, 33], [22, 33], [21, 33], [21, 34], [20, 34], [19, 34], [18, 34], [18, 33]]);
    s = await snap();
    check('the gallery is crossed alive', s.mode === 'play' && s.deaths === 3);
    check('the tomb remembers both pits: the one you fell into and the one the pebble found', s.lessons.pits.length === 2);
  });

  // ---------------------------------------------------------------- Garden of Bells
  await test.step('Bells: checkpoint, a wrong order hurts, the casting order opens the grate', async () => {
    await walk([[18, 32], [18, 31], [18, 30], [18, 29]]);
    await ev(() => window.__wt.gh.toggleHood());
    let s = await snap();
    check('the Garden of Bells is a checkpoint', s.cp === 'bells');
    check('the lantern is open again', s.hooded === false);

    await walk([[18, 28], [17, 28]]);
    await walkTo(cx(16) + 1.4, cx(28));
    await use(cx(16), cx(28), 'Read the plinth');
    await closePanel();

    // Wrong: the great bell first.
    await walk([[17, 28], [17, 27], [17, 26]]);
    await use(cx(17), cx(25), 'Ring the great bright bell');
    await tick(30);
    s = await snap();
    check('a wrong bell fires the darts (28 damage)', s.hp === 72 && s.bellFails === 1);
    check('one wrong order does not wake the gardeners', s.wardens === 'none');

    // Right: green, brown, great (the order they were cast).
    await walk([[18, 26]]);
    await use(cx(18), cx(25), 'Ring the small green bell');
    await tick(10);
    await walk([[19, 26]]);
    await use(cx(19), cx(25), 'Ring the dull brown bell');
    await tick(10);
    await walk([[18, 26], [17, 26]]);
    await use(cx(17), cx(25), 'Ring the great bright bell');
    await tick(75);
    s = await snap();
    check('the bells are solved', s.bellsSolved === true);
    check('the bronze grate rises', s.doors.bell === true);

    await walk([[17, 27], [16, 27], [16, 23], [16, 21]]);
    await walkTo(cx(14) + 1.0, cx(21));
    await use(cx(14), cx(21), 'Take a scatter of old coins');
    s = await snap();
    check('the old coins are taken (40)', s.treasure.includes('coins') && s.treasureValue === 100);
    await tick(150);
    check('health regenerates once nothing has hurt you for a while', (await snap()).hp > 72);
  });

  // ---------------------------------------------------------------- Breathing Hall
  const crossVent = async (ventI, fromI, toI) => {
    // Wait at a safe cell until the vent has just finished firing, then run across.
    await ev(([i]) => {
      const w = window.__wt;
      let prev = w.gh.ventState(i).s;
      for (let t = 0; t < 400; t++) { w.tick(); const st = w.gh.ventState(i).s; if (prev === 'fire' && st === 'idle') return; prev = st; }
      throw new Error('vent never cycled');
    }, [ventI]);
    const r = await ev(([a, b]) => window.__wt.walkCells([[a, 25], [b, 25]], { run: true }), [ventI, toI]);
    expect(r.result, `crossing vent ${ventI} from ${fromI}`).toBe('arrived');
  };
  await test.step('Breathing Hall: checkpoint, time the vents, censer, flask', async () => {
    await walk([[16, 22], [16, 23], [22, 23], [22, 25], [23, 25], [24, 25], [25, 25], [26, 25], [27, 25], [28, 25]]);
    let s = await snap();
    check('the Breathing Hall is a checkpoint', s.cp === 'breath');

    // Deliberately stand on a vent until it breathes out.
    await walk([[29, 25]], { allowDeath: true });
    await ev(() => { const w = window.__wt; for (let t = 0; t < 150 && w.gh.mode === 'play'; t++) w.tick(); });
    s = await deathAndRise('Breathing Hall', 4, 'breath');
    check('the bells stay solved after a death here', s.bellsSolved === true && s.doors.bell === true);
    await walk([[28, 25]]);
    await crossVent(29, 28, 30);
    await walk([[31, 25]]);
    await crossVent(32, 31, 33);
    s = await snap();
    check('two vents crossed alive', s.mode === 'play' && s.deaths === 4);
    await walk([[33, 25]]);
    await walkTo(cx(33), cx(24) + 1.0);
    await use(cx(33), cx(24), 'Take a gold censer');
    await walk([[33, 25]]);
    check('the gold censer is taken (150)', (await snap()).treasure.includes('censer'));
    await walk([[34, 25]]);
    await crossVent(35, 34, 36);
    await walk([[37, 25], [37, 26]]);
    await walkTo(cx(38) - 1.0, cx(26));
    await use(cx(38), cx(26), 'Take a flask of lamp oil');
    s = await snap();
    check('all three vents crossed alive', s.mode === 'play' && s.deaths === 4);
    check('the hall\'s flask is taken', s.flasks === 3);
  });

  // ---------------------------------------------------------------- Mirror Vault
  const fight = async (what, done, maxRounds = 400) => {
    // Face the nearest live foe; strike when it is in reach. Strikes land after a 110 ms real-time delay.
    for (let n = 0; n < maxRounds; n++) {
      const st = await ev(() => {
        const w = window.__wt, foes = w.gh.mons.filter((m) => m.state !== 'dead' && m.state !== 'rise');
        if (!foes.length) return { none: true, mode: w.gh.mode };
        foes.sort((a, b) => Math.hypot(a.x - w.P.x, a.z - w.P.z) - Math.hypot(b.x - w.P.x, b.z - w.P.z));
        const f = foes[0], d = Math.hypot(f.x - w.P.x, f.z - w.P.z);
        w.faceXZ(f.x, f.z);
        if (d < 2.2) w.gh.attack();
        return { d, mode: w.gh.mode };
      });
      if (st.mode !== 'play') return st.mode;
      if (await done()) return 'done';
      await realWait(st.d !== undefined && st.d < 2.2 ? 130 : 0);
      await tick(st.d !== undefined && st.d < 2.2 ? 6 : 4);
    }
    throw new Error(`${what}: fight did not finish`);
  };
  await test.step('Mirror Vault: hang the lantern, kill the crawlers, turn the mirrors, take the opal', async () => {
    await walk([[37, 24], [37, 23], [37, 22], [37, 21], [37, 20]]);
    let s = await snap();
    check('the Mirror Vault is a checkpoint', s.cp === 'vault');
    await walk([[38, 20]]);
    await walkTo(cx(40) - 1.0, cx(20));
    await use(cx(40), cx(20), 'Take a flask of lamp oil');
    check('the vault\'s flask is taken', (await snap()).flasks === 4);

    await walk([[38, 20], [37, 20], [37, 16], [35, 16], [34, 16], [34, 15], [34, 14]]);
    await walkTo(81.0, cx(14));
    await use(33 * S + 0.3, cx(14), 'Hang your lantern on the hook');
    s = await snap();
    check('the lantern hangs on the hook', s.hung === true);
    check('hanging it wakes two gloam crawlers', s.crawlers === 'awake' && s.foes.filter((f) => f.type === 'crawler').length === 2);

    const r = await fight('crawlers', async () => (await snap()).crawlers === 'dead');
    s = await snap();
    check('both crawlers are killed', r === 'done' && s.crawlers === 'dead');
    check('you survive the crawlers', s.mode === 'play' && s.deaths === 4);

    // A \, B \, C /, D \, E \ : each mirror needs one turn from its starting position.
    const turn = async (x, z, fx, fz) => { await walkTo(x, z); await use(fx, fz, 'Turn the mirror'); await tick(5); };
    await walkTo(81.0, cx(15)); await walkTo(cx(36) - 1.6, cx(15)); await walkTo(cx(36) - 1.6, cx(14));
    await turn(cx(36) - 1.6, cx(14), cx(36), cx(14));
    check('mirror A turned', (await snap()).mirrors.A === '\\');
    await turn(cx(36) - 1.6, cx(18), cx(36), cx(18));
    check('mirror B turned', (await snap()).mirrors.B === '\\');
    await walkTo(cx(36) - 1.6, cx(19)); await walkTo(cx(40) - 1.6, cx(19));
    await turn(cx(40) - 1.6, cx(18), cx(40), cx(18));
    check('mirror C turned', (await snap()).mirrors.C === '/');
    await turn(cx(40) - 1.6, cx(12), cx(40), cx(12));
    check('mirror D turned', (await snap()).mirrors.D === '\\');
    check('the beam is not yet on the crystal', (await snap()).mirrorsSolved === false);
    await walkTo(cx(40) - 1.6, cx(13)); await walkTo(cx(38) - 1.6, cx(13));
    await turn(cx(38) - 1.6, cx(12), cx(38), cx(12));
    await tick(40);
    s = await snap();
    check('mirror E turned', s.mirrors.E === '\\');
    check('the beam strikes the sun-crystal', s.mirrorsSolved === true);
    check('the north door of the vault opens', s.doors.vault === true);

    await walkTo(cx(38) - 1.6, cx(13)); await walkTo(cx(41) - 1.2, cx(13)); await walkTo(cx(41) - 1.2, cx(14));
    await use(cx(41), cx(14), 'Take a sun-opal');
    check('the sun-opal is taken (300)', (await snap()).treasure.includes('opal'));

    await walkTo(cx(41) - 1.2, cx(15)); await walkTo(81.0, cx(15)); await walkTo(81.0, cx(14));
    await use(33 * S + 0.3, cx(14), 'Take your lantern back');
    check('the lantern is back in your hand', (await snap()).hung === false);
  });

  // ---------------------------------------------------------------- Scriptorium
  await test.step('Scriptorium: journal, disarm the gilded chest with the pole, both chests', async () => {
    await walkTo(81.0, cx(12)); await walkTo(cx(36), cx(12));
    await walk([[36, 11], [36, 10], [36, 9], [36, 8], [36, 7], [36, 6]]);
    let s = await snap();
    check('the Scriptorium is a checkpoint', s.cp === 'script');
    await walkTo(cx(35), cx(4) + 1.8);
    await use(cx(35), cx(4), 'Read the journal');
    check('the journal opens', (await snap()).mode === 'paused');
    await closePanel();

    // Deliberately open the gilded chest without testing it first.
    await walkTo(cx(33), 7.6);
    await use(cx(33), cx(2) - 0.25, 'Look at the gilded chest');
    await closePanel();
    await use(cx(33), cx(2) - 0.25, 'Open the gilded chest');
    s = await deathAndRise('gilded chest', 5, 'script');
    check('the gilded chest is as it was: unprobed, unlooted', s.gildedSprung === false && s.gildedLooted === false);

    await walkTo(cx(33), 7.6);
    await ev(() => { const w = window.__wt; w.faceXZ((33 + 0.5) * 2.4, (2 + 0.5) * 2.4 - 0.25); w.gh.probe(); });
    check('probing the gilded chest springs its needles harmlessly', (await snap()).gildedSprung === true && (await snap()).mode === 'play');
    await use(cx(33), cx(2) - 0.25, 'Look at the gilded chest');
    await closePanel();
    await use(cx(33), cx(2) - 0.25, 'Open the gilded chest');
    s = await snap();
    check('the gilded chest holds rubies (400)', s.gildedLooted && s.treasure.includes('rubies'));
    check('opening the disarmed chest does not kill', s.mode === 'play' && s.deaths === 5);

    await walkTo(cx(38), 7.6);
    await use(cx(38), cx(2) - 0.25, 'Open the plain chest');
    s = await snap();
    check('the plain chest holds the crescent key', s.key === true);
    check('and a flask of oil', s.flasks === 5);

    await walkTo(cx(32), cx(4));
    await use(cx(31), cx(4), 'Open the door');
    await tick(45);
    check('the west door of the Scriptorium opens', (await snap()).doors.script === true);
  });

  // ---------------------------------------------------------------- Chasm of the Unlit Road
  await test.step('Chasm: checkpoint, rubble, the ledge, probe the road, cross it, the ring', async () => {
    await walk([[31, 4], [30, 4], [29, 4], [28, 4], [27, 4]]);
    let s = await snap();
    check('the Chasm is a checkpoint', s.cp === 'chasm');
    await walkTo(66.0, 4.3);
    check('one pebble short after the gallery', (await snap()).pebbles === 11);
    await use(cx(27) - 0.3, cx(1) - 0.3, 'Gather pebbles');
    check('pebbles gathered from the second rubble pile', (await snap()).pebbles === 12);
    await walkTo(65.2, cx(6));
    await use(cx(27) + 0.85, cx(6), 'Read the carving');
    await closePanel();

    await walk([[26, 6], [26, 5]]);
    await ev(() => { const w = window.__wt; w.faceXZ(w.P.x - 5, w.P.z); w.gh.probe(); });
    check('the pole finds the first cell of the unlit road', (await snap()).lessons.bridge.includes(idx(25, 5)));

    // Deliberately step off the road into the gulf.
    await walk([[26, 4]]);
    await walk([[25, 4]], { allowDeath: true });
    s = await deathAndRise('Unlit Road', 6, 'chasm');
    check('the road cell you found stays marked', s.lessons.bridge.includes(idx(25, 5)));
    await walk([[26, 5]]);

    await walk([[25, 5], [24, 5], [23, 5], [23, 4], [23, 3], [22, 3], [21, 3], [20, 3], [20, 4], [20, 5], [20, 6], [20, 7],
      [20, 8], [21, 8], [22, 8]]);
    await use(cx(22), cx(8) + 2, 'Take a moonstone ring');
    s = await snap();
    check('the moonstone ring is taken from the bones (250)', s.treasure.includes('ring'));
    await walk([[21, 8], [20, 8], [20, 7], [19, 7], [18, 7], [17, 7], [17, 6], [17, 5], [16, 5], [15, 5]]);
    s = await snap();
    check('the unlit road is crossed alive', s.mode === 'play' && s.deaths === 6);
  });

  // ---------------------------------------------------------------- Antechamber of Masks
  await test.step('Masks: checkpoint, the laughing alcove sprung by a pebble, the key opens the sleeping face', async () => {
    await walk([[15, 6], [15, 9], [14, 9], [14, 10], [14, 11], [14, 12], [14, 13], [14, 14], [13, 14], [12, 14], [11, 14], [10, 14]]);
    let s = await snap();
    check('the Antechamber of Masks is a checkpoint', s.cp === 'masks');
    await walk([[9, 14], [9, 13]]);
    await use(cx(9), cx(13) - 1, 'Read the plaque above the doors');
    await closePanel();

    await walk([[10, 13], [11, 13], [11, 14], [11, 15], [11, 16], [11, 17]]);
    await walkTo(cx(11), cx(17) + 0.7);
    await use(cx(11), cx(18) - 0.2, 'Touch the laughing face');
    await tick(40);
    check('the laughing door opens', (await snap()).doors.mLaugh === true);
    await ev(() => { const w = window.__wt; w.faceXZ(w.P.x, w.P.z + 5); w.P.pitch = 0; w.gh.throwPebble(); });
    await tick(40);
    s = await snap();
    check('a pebble springs the laughing alcove', s.lessons.laughOpen === true);
    check('the laughing door is sealed for good', s.lessons.sealed.includes('mLaugh'));
    await tick(70);
    check('and it grinds shut', (await snap()).doors.mLaugh === false);

    await walk([[11, 17], [10, 17], [9, 17], [8, 17], [7, 17]]);
    await walkTo(cx(7), cx(17) + 0.7);
    await use(cx(7), cx(18) - 0.2, 'Unlock the sleeping face');
    await tick(40);
    check('the crescent key opens the sleeping face\'s door', (await snap()).doors.mSleep === true);
    await walk([[7, 18], [7, 19], [7, 20], [7, 21]]);
    s = await snap();
    check('the Dreamer\'s Way is the last checkpoint', s.cp === 'way');
  });

  // ---------------------------------------------------------------- Sanctum of the Candle-Eater
  const BRAZ = [[4, 24], [10, 24], [4, 30], [10, 30]];
  const standAt = ([i, j]) => [cx(i), cx(j) - 1.6]; // just north of the brazier, facing south
  await test.step('Sanctum: wake Ilvaris, light braziers to make her solid, kill her', async () => {
    await walk([[7, 22], [7, 23]]);
    let s = await snap();
    check('the Candle-Eater wakes when you enter', s.bossG === 'awake' && s.boss && s.boss.state !== 'asleep');
    await walkTo(cx(3) + 1.0, cx(23));
    await use(cx(3), cx(23), 'Take a flask of lamp oil');

    // In the dark she is smoke: let her come close and swing once.
    const near = await ev(() => {
      const w = window.__wt;
      for (let t = 0; t < 400; t++) { const b = w.gh.boss; if (Math.hypot(b.x - w.P.x, b.z - w.P.z) < 2.0) { w.faceXZ(b.x, b.z); w.gh.attack(); return true; } w.faceXZ(b.x, b.z); w.tick(); }
      return false;
    });
    await realWait(150);
    s = await snap();
    check('she stalks you in the dark', near === true);
    check('in the dark your blade passes through her', s.boss.hp === 6 && s.boss.solid === false);

    // Tactic: light a brazier while she is not close; strike while she is solid (near a lit
    // brazier); step back out of reach during her 0.7 s wind-up; keep away from her smoke form.
    let lit = 0, phase2Seen = false, dodges = 0, strikes = 0;
    for (let n = 0; n < 1500; n++) {
      const st = await ev(() => {
        const w = window.__wt, gh = w.gh, b = gh.boss, G = gh.G, P = w.P;
        if (G.boss === 'dead' || !b) return { act: 'done' };
        if (gh.mode !== 'play') return { act: 'over', mode: gh.mode };
        if (G.oil < 35 && G.flasks > 0) gh.pourOil();
        const d = Math.hypot(b.x - P.x, b.z - P.z), phase = b.phase;
        const away = (k) => { w.faceXZ(P.x + (P.x - b.x), P.z + (P.z - b.z)); w.keys.add('KeyW'); w.keys.add('ShiftLeft'); w.tick(k); w.release(); };
        if (b.state === 'wind' && d < 3.2) { away(5); return { act: 'dodge', phase }; }
        if (!G.braziers.some(Boolean)) {
          if (d < 4) { away(4); return { act: 'kite', phase }; }
          return { act: 'light', phase, x: P.x, z: P.z };
        }
        if (b.solid && d < 2.3) { w.faceXZ(b.x, b.z); gh.attack(); return { act: 'strike', phase }; }
        if (b.solid) { w.faceXZ(b.x, b.z); w.keys.add('KeyW'); w.tick(3); w.release(); return { act: 'approach', phase }; }
        if (d < 3.0) { away(3); return { act: 'kite', phase }; }
        w.faceXZ(b.x, b.z); w.tick(3);
        return { act: 'wait', phase };
      });
      if (st.act === 'done') break;
      expect(st.act, `you survive the Candle-Eater (${st.mode})`).not.toBe('over');
      if (st.phase === 2) phase2Seen = true;
      if (st.act === 'dodge') dodges++;
      if (st.act === 'strike') { strikes++; await realWait(130); await tick(2); }
      if (st.act === 'light') {
        const b = BRAZ.slice().sort((p, q) => Math.hypot(standAt(p)[0] - st.x, standAt(p)[1] - st.z) - Math.hypot(standAt(q)[0] - st.x, standAt(q)[1] - st.z))[0];
        const [x, z] = standAt(b);
        const r = await ev(([a, c]) => window.__wt.walkTo(a, c, { maxTicks: 90, tol: 0.3, noThrow: true }), [x, z]);
        if (r !== 'arrived') continue; // re-plan next round (she may be winding up)
        const label = await ev(([a, c]) => { window.__wt.faceXZ(a, c); return window.__wt.prompt(); }, [cx(b[0]), cx(b[1])]);
        if (!label.includes('Light the brazier')) continue;
        await use(cx(b[0]), cx(b[1]), 'Light the brazier');
        await tick(32); // lighting takes a second
        lit++;
      }
    }
    s = await snap();
    check('Ilvaris, the Candle-Eater, is destroyed', s.bossG === 'dead');
    check('braziers had to be lit to fight her', lit >= 1);
    check('she was struck while solid in the firelight', strikes >= 6);
    check('her wind-ups were dodged', dodges >= 1);
    check('at half health she snuffs every flame (phase 2)', phase2Seen);
    check('the boss is beaten without dying', s.deaths === 6);
    check('killing her makes the sanctum your checkpoint', s.cp === 'sanctum');
  });

  // ---------------------------------------------------------------- The Heart and the daylight
  await test.step('Heart of Embers and daylight', async () => {
    await tick(90); // the sarcophagus lid slides aside
    await walkTo(cx(7), 73.4);
    await use(cx(7), cx(31), 'Take the Heart of Embers');
    let s = await snap();
    check('the Heart of Embers is taken (1000)', s.heart === true && s.treasure.includes('heart'));
    check('all the tomb\'s treasure is carried: 2200 of 2200', s.treasureValue === 2200);
    const r = await ev(([x, z]) => window.__wt.walkTo(x, z, { tol: 0.5 }), [cx(7), cx(27)]);
    s = await snap();
    check('stepping into the shaft of daylight wins', r === 'won' && s.mode === 'won');
    check('the delve ends with exactly the six deliberate deaths, one per kind of trap', s.deaths === 6);
  });

  expect(errors, 'no page errors').toEqual([]);
  console.log(`walkthrough: ${checks} checks passed`);
});
