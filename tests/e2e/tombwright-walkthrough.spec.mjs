// Tombwright walkthrough (M0 exit criterion, decision #54): plays Gloamhollow on the Tombwright client and
// sim core from the stair to the daylight shaft, and checks every puzzle, trap lesson, checkpoint, treasure
// and the boss on the way, with one deliberate death per kind of trap. Same route as the reference
// walkthrough (gloamhollow-walkthrough.spec.mjs), but every check reads the sim state, not the old game.
//
// The page is served by PHP's built-in server through public/index.php (playwright.config.mjs). The client
// boots in test mode (window.__twTest) with rendering off (window.__twNoRender); the driver steps the sim one
// tick at a time with the inputs a player would send. No real-time waits are needed except for the death
// card, which the client shows after a short delay.
//
// Deviations from the reference that the decisions log documents: the Candle-Eater wakes on entering the
// Sanctum (#48), the strike lands 3 ticks after the swing (#44), foes path round walls (#42), and the Heart
// of Embers is taken from within 1.7 m (#50).
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const S = 2.4;
const cx = (i) => (i + 0.5) * S;
const idx = (i, j) => j * 44 + i;

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('Tombwright: Gloamhollow on the sim core, stair to daylight', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8765)/, (r) => r.abort()); // no third-party requests
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto('http://127.0.0.1:8765/play/gloamhollow');
  await page.waitForFunction(() => !!window.__tw);
  // The page's CSP refuses injected <script> tags (as it should), so the driver goes in through evaluate.
  await page.evaluate(readFileSync(ROOT + 'tests/e2e/lib/tombwright-driver.js', 'utf8'));

  let checks = 0;
  const check = (label, cond) => { checks++; expect(cond, label).toBeTruthy(); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const snap = () => ev(() => window.__wt.snap());
  const tick = (n) => ev((k) => window.__wt.tick(k), n);
  const press = (name) => ev((b) => window.__wt.press(window.__wt.B[b]), name);
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
  const closePanel = () => ev(() => window.__wt.closePanel());
  // A deliberate death: the card names the cause, then you rise at the checkpoint (R-RISE-1: 51 ticks on).
  const deathAndRise = async (cause, deathsNow, cpId) => {
    let s = await snap();
    check(`${cause}: the trap kills`, s.mode === 'dead' && s.deaths === deathsNow);
    await tick(55);
    await expect(page.locator('#deathCause')).toContainText(cause);
    await expect(page.locator('#death')).toBeVisible();
    await page.click('#riseBtn');
    await ev(() => { window.__wt.step(); window.__wt.step(); });
    s = await snap();
    check(`${cause}: you rise at the ${cpId} checkpoint`, s.mode === 'play' && s.cp === cpId && s.hp === 100);
    check(`${cause}: the death card is gone`, await page.locator('#death').isHidden());
    return s;
  };

  // ---------------------------------------------------------------- Vestibule
  await test.step('Vestibule: start, plaque, oil, door', async () => {
    await page.click('#goBtn');
    let s = await snap();
    check('a new delve is in play', s.mode === 'play');
    check('starts at the Vestibule checkpoint', s.cp === 'vest' && s.cell[0] === 34 && s.cell[1] === 60);
    check('starts with full health and oil', s.hp === 100 && s.oil === 100);
    check('starts with 10 pebbles and 1 flask', s.pebbles === 10 && s.flasks === 1);
    check('nothing has been taken yet', s.treasureValue === 0);

    await walk([[34, 57], [33, 57], [33, 56]]);
    await use(cx(33), 56 * S, 'Read the bronze plaque');
    check('reading the plaque opens the reader and pauses', (await snap()).mode === 'paused');
    await expect(page.locator('#readTitle')).toHaveText('To whoever comes with a light');
    await page.click('#readNext');
    await expect(page.locator('#readPage')).toHaveText('2 of 2');
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
    await ev(() => { const w = window.__wt; w.faceXZ(w.P().x / 1000, w.P().z / 1000 - 3); w.press(w.B.probe); });
    s = await snap();
    check('probing the tile ahead marks a pressure plate', s.lessons.marked.includes(idx(33, 51)));

    await walk([[34, 52], [35, 52]]);
    const r = await walk([[35, 51]], { allowDeath: true });
    s = await snap();
    check('stepping on a plate kills', r.result === 'dead' && s.mode === 'dead' && s.cause === 'slab');
    check('the sprung plate is remembered as a lesson', s.lessons.sprung.includes(idx(35, 51)));
    s = await deathAndRise('slab of the ceiling', 1, 'hall');
    check('you rise at the hall checkpoint', s.cell[0] === 34 && s.cell[1] === 52);
    check('the lessons survive death', s.lessons.sprung.includes(idx(35, 51)) && s.lessons.marked.includes(idx(33, 51)));

    await walk([[34, 51], [34, 50], [33, 50], [33, 49], [33, 48], [32, 48], [32, 47], [32, 46], [33, 46], [34, 46],
      [34, 45], [34, 44], [35, 44], [35, 43], [35, 42], [36, 42], [36, 41], [36, 40], [35, 40], [34, 40], [34, 39]]);
    s = await snap();
    check('the hall is crossed without another death', s.deaths === 1 && s.mode === 'play');
  });

  // ---------------------------------------------------------------- Mouth of the Gallery
  await test.step('Mouth: checkpoint, bones, chain, rubble', async () => {
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
    await press('pebble');
    await tick(30);
    const before = (await snap()).pebbles;
    await use(cx(33) - 0.3, cx(35) - 0.3, 'Gather pebbles');
    check('the rubble refills the pouch to 12', (await snap()).pebbles === 12 && before < 12);
  });

  // ---------------------------------------------------------------- Gallery of Waking Eyes
  await test.step('Gallery: hooded lantern, the eyes, a pebble finds a pit', async () => {
    await walk([[33, 34]]);
    await press('hood');
    check('the lantern is hooded before the gallery', (await snap()).hooded === true);
    await walk([[32, 34]]);
    check('inside the gallery with a hooded lantern the eyes stay shut', (await snap()).eyes[0] === 0);

    await press('hood');
    await tick(12);
    let s = await snap();
    check('an open flame wakes the eyes', s.eyes[0] > 0 && s.mode === 'play');
    await press('hood');
    await tick(45);
    s = await snap();
    check('hooding again lets them close before they burn', s.eyes[0] === 0 && s.mode === 'play');

    // Deliberately stay lit: the eyes burn you after a second.
    await press('hood');
    await tick(40);
    s = await deathAndRise('Waking Eyes', 2, 'mouth');
    check('a death rolls back what this life took since the checkpoint: the chain is on the floor again', s.treasureValue === 0 && !s.treasure.includes('chain'));
    const backToTheGallery = async () => {
      await walk([[35, 34], [35, 33]]);
      await use(cx(35), cx(33) - 2, 'Take a silver lamp-chain');
      await walk([[34, 33], [34, 34], [33, 34], [33, 35]]);
      await use(cx(33) - 0.3, cx(35) - 0.3, 'Gather pebbles');
      await walk([[33, 34]]);
      await press('hood');
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
    await ev(() => { const w = window.__wt; w.faceXZ(w.P().x / 1000 - 5, w.P().z / 1000); w.setPitch(0.2); w.press(w.B.pebble); w.setPitch(0); });
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
    await press('hood');
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
    check('a wrong bell fires the darts (28 damage)', s.hp === 72);
    check('one wrong order does not wake the gardeners', s.groups.keepers === 'dormant');

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
  const crossVent = async (ventI, toI) => {
    // Wait at a safe cell until the vent has just finished firing, then run across.
    await ev(([i]) => {
      const w = window.__wt;
      let prev = w.ventState(i);
      for (let t = 0; t < 400; t++) { w.step(); const s = w.ventState(i); if (prev === 'fire' && s === 'idle') return; prev = s; }
      throw new Error('vent never cycled');
    }, [ventI]);
    const r = await ev(([a, b]) => window.__wt.walkCells([[a, 25], [b, 25]], { run: true }), [ventI, toI]);
    expect(r.result, `crossing vent ${ventI}`).toBe('arrived');
  };
  await test.step('Breathing Hall: checkpoint, time the vents, censer, flask', async () => {
    await walk([[16, 22], [16, 23], [22, 23], [22, 25], [23, 25], [24, 25], [25, 25], [26, 25], [27, 25], [28, 25]]);
    let s = await snap();
    check('the Breathing Hall is a checkpoint', s.cp === 'breath');

    // Deliberately stand on a vent until it breathes out.
    await walk([[29, 25]], { allowDeath: true });
    await ev(() => { const w = window.__wt; for (let t = 0; t < 150 && w.snap().mode === 'play'; t++) w.step(); });
    s = await deathAndRise('Breathing Hall', 4, 'breath');
    check('the bells stay solved after a death here', s.bellsSolved === true && s.doors.bell === true);
    await walk([[28, 25]]);
    await crossVent(29, 30);
    await walk([[31, 25]]);
    await crossVent(32, 33);
    s = await snap();
    check('two vents crossed alive', s.mode === 'play' && s.deaths === 4);
    await walk([[33, 25]]);
    await walkTo(cx(33), cx(24) + 1.0);
    await use(cx(33), cx(24), 'Take a gold censer');
    await walk([[33, 25]]);
    check('the gold censer is taken (150)', (await snap()).treasure.includes('censer'));
    await walk([[34, 25]]);
    await crossVent(35, 36);
    await walk([[37, 25], [37, 26]]);
    await walkTo(cx(38) - 1.0, cx(26));
    await use(cx(38), cx(26), 'Take a flask of lamp oil');
    s = await snap();
    check('all three vents crossed alive', s.mode === 'play' && s.deaths === 4);
    check('the hall\'s flask is taken', s.flasks === 3);
  });

  // ---------------------------------------------------------------- Mirror Vault
  // Face the nearest live foe and swing when it is in reach; the blow lands 3 ticks later (R-STRIKE-1).
  const fight = (group) => ev((grp) => {
    const w = window.__wt;
    for (let n = 0; n < 4000; n++) {
      const s = w.snap();
      if (s.mode !== 'play') return s.mode;
      if (s.groups[grp] === 'defeated') return 'done';
      const live = s.foes.filter((f) => f.group === grp && f.st !== 'dead' && f.st !== 'dormant' && f.st !== 'rising');
      if (!live.length) { w.step(); continue; }
      live.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
      const f = live[0], d = Math.hypot(f.x - s.x, f.z - s.z);
      w.faceXZ(f.x, f.z);
      w.step([0, 0], d < 2.2 ? w.B.strike : 0);
    }
    return 'timeout';
  }, group);
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
    check('hanging it wakes two gloam crawlers', s.groups.crawlers === 'spawned' && s.foes.filter((f) => f.group === 'crawlers' && f.st === 'hunting').length === 2);

    const r = await fight('crawlers');
    s = await snap();
    check('both crawlers are killed', r === 'done' && s.groups.crawlers === 'defeated');
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
    check('the beam is not yet on the crystal', (await snap()).beamHits === null);
    await walkTo(cx(40) - 1.6, cx(13)); await walkTo(cx(38) - 1.6, cx(13));
    await turn(cx(38) - 1.6, cx(12), cx(38), cx(12));
    await tick(40);
    s = await snap();
    check('mirror E turned', s.mirrors.E === '\\');
    check('the beam strikes the sun-crystal', s.beamHits === 'crystal');
    check('the north door of the vault opens', s.doors.vault === true);
    check('the sun-opal is revealed', s.revealed.includes('opal'));

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
    await expect(page.locator('#readPage')).toHaveText('1 of 5');
    await closePanel();

    // Deliberately open the gilded chest without testing it first.
    await walkTo(cx(33), 7.6);
    await use(cx(33), cx(2) - 0.25, 'Look at the gilded chest');
    check('looking at the gilded chest shows its warning', (await snap()).mode === 'paused');
    await expect(page.locator('#readTitle')).toHaveText('A gilded chest');
    await closePanel();
    await use(cx(33), cx(2) - 0.25, 'Open the gilded chest');
    s = await deathAndRise('gilded chest', 5, 'script');
    check('the gilded chest is as it was: unprobed, unlooted', !s.chests.gilded.sprung && !s.chests.gilded.open);

    await walkTo(cx(33), 7.6);
    await ev(() => { const w = window.__wt; w.faceXZ(cx33(), 2.5 * 2.4 - 0.25); w.press(w.B.probe); function cx33() { return 33.5 * 2.4; } });
    s = await snap();
    check('probing the gilded chest springs its needles harmlessly', s.chests.gilded.sprung === true && s.mode === 'play');
    await use(cx(33), cx(2) - 0.25, 'Look at the gilded chest');
    await closePanel();
    await use(cx(33), cx(2) - 0.25, 'Open the gilded chest');
    s = await snap();
    check('the gilded chest holds rubies (400)', s.chests.gilded.open && s.treasure.includes('rubies'));
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
    await ev(() => { const w = window.__wt; w.faceXZ(w.P().x / 1000 - 5, w.P().z / 1000); w.press(w.B.probe); });
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
    await ev(() => { const w = window.__wt; w.faceXZ(w.P().x / 1000, w.P().z / 1000 + 5); w.setPitch(0); w.press(w.B.pebble); });
    await tick(40);
    s = await snap();
    check('the laughing door is sealed for good: a pebble sprang its alcove', s.lessons.sealed.includes('mLaugh'));
    await tick(70);
    check('and it grinds shut', (await snap()).doors.mLaugh === false);

    await walk([[11, 17], [10, 17], [9, 17], [8, 17], [7, 17]]);
    await walkTo(cx(7), cx(17) + 0.7);
    await use(cx(7), cx(18) - 0.2, 'Unlock the sleeping face');
    await tick(40);
    check('the crescent key opens the sleeping face\'s door', (await snap()).doors.mSleep === true);
    await walk([[7, 18], [7, 19], [7, 20], [7, 21]]);
    s = await snap();
    check('the Dreamer\'s Way is the last checkpoint before the sanctum', s.cp === 'way');
  });

  // ---------------------------------------------------------------- Sanctum of the Candle-Eater
  await test.step('Sanctum: wake Ilvaris, light braziers to make her solid, kill her', async () => {
    await walk([[7, 22], [7, 23]]);
    let s = await snap();
    check('the Candle-Eater wakes when you enter (decision #48)', s.boss && s.boss.st !== 'asleep' && s.boss.st !== 'dead');
    await walkTo(cx(3) + 1.0, cx(23));
    await use(cx(3), cx(23), 'Take a flask of lamp oil');

    // In the dark she is smoke: let her come close and swing.
    const near = await ev(() => {
      const w = window.__wt;
      for (let t = 0; t < 400; t++) {
        const s = w.snap(), b = s.boss;
        w.faceXZ(b.x, b.z);
        if (Math.hypot(b.x - s.x, b.z - s.z) < 2.0) { w.step([0, 0], w.B.strike); w.tick(4); return true; }
        w.step();
      }
      return false;
    });
    s = await snap();
    check('she stalks you in the dark', near === true);
    check('in the dark your blade passes through her', s.boss.hp === 6 && s.boss.solid === false);

    // Light a brazier while she is not close; strike while she is solid; step back out of reach during her
    // wind-up; keep away from her smoke form.
    const fightBoss = await ev(() => {
      const w = window.__wt, B = w.B, cx = (i) => (i + 0.5) * 2.4;
      const stands = w.braziers.map((b) => ({ b, x: cx(b.cell[0]), z: cx(b.cell[1]) - 1.6 }));
      let lit = 0, phase2 = false, dodges = 0, strikes = 0;
      const away = (s, b, k) => { w.faceXZ(s.x + (s.x - b.x), s.z + (s.z - b.z)); for (let n = 0; n < k; n++) w.step([127, 0], B.run); };
      for (let n = 0; n < 3000; n++) {
        const s = w.snap(), b = s.boss;
        if (b.st === 'dead') return { done: true, lit, phase2, dodges, strikes };
        if (s.mode !== 'play') return { done: false, mode: s.mode, lit, phase2, dodges, strikes };
        if (b.phase === 2) phase2 = true;
        if (s.oil < 35 && s.flasks > 0) { w.press(B.oil); continue; }
        const d = Math.hypot(b.x - s.x, b.z - s.z);
        if (b.st === 'wind' && d < 3.2) { away(s, b, 5); dodges++; continue; }
        if (!s.braziers.some(Boolean)) {
          if (d < 4) { away(s, b, 4); continue; }
          const t = stands.slice().sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z))[0];
          if (w.walkTo(t.x, t.z, { maxTicks: 90, tol: 0.3, noThrow: true }) !== 'arrived') continue;
          w.faceXZ(cx(t.b.cell[0]), cx(t.b.cell[1]));
          if (!w.prompt().includes('Light the brazier')) continue;
          w.use(cx(t.b.cell[0]), cx(t.b.cell[1]), 'Light the brazier');
          w.tick(32);
          lit++;
          continue;
        }
        if (b.solid && d < 2.3) { w.faceXZ(b.x, b.z); if (w.P().strikeCd === 0) strikes++; w.step([0, 0], B.strike); w.tick(2); continue; }
        if (b.solid) { w.faceXZ(b.x, b.z); for (let k = 0; k < 3; k++) w.step([127, 0]); continue; }
        if (d < 3.0) { away(s, b, 3); continue; }
        w.faceXZ(b.x, b.z); w.tick(3);
      }
      return { done: false, mode: 'timeout', lit, phase2, dodges, strikes };
    });
    s = await snap();
    expect(fightBoss.mode, 'you survive the Candle-Eater').toBeUndefined();
    check('Ilvaris, the Candle-Eater, is destroyed', fightBoss.done && s.boss.st === 'dead');
    check('braziers had to be lit to fight her', fightBoss.lit >= 1);
    check('she was struck while solid in the firelight', fightBoss.strikes >= 6);
    check('her wind-ups were dodged', fightBoss.dodges >= 1);
    check('at half health she snuffs every flame (phase 2)', fightBoss.phase2);
    check('the boss is beaten without dying', s.deaths === 6);
    check('killing her makes the sanctum your checkpoint', s.cp === 'sanctum');
    check('and reveals the Heart of Embers', s.revealed.includes('heart'));
  });

  // ---------------------------------------------------------------- The Heart and the daylight
  await test.step('Heart of Embers and daylight', async () => {
    await tick(90);
    // The Heart lies on the sarcophagus; within 1.7 m (decision #50) you reach it from the side, not the head end.
    await walkTo(cx(8), cx(29)); await walkTo(cx(7) + 1.2, cx(31));
    await use(cx(7), cx(31), 'Take the Heart of Embers');
    let s = await snap();
    check('the Heart of Embers is taken (1000)', s.treasure.includes('heart'));
    check('all the tomb\'s treasure is carried: 2200 of 2200', s.treasureValue === 2200);
    const r = await ev(([x, z]) => window.__wt.walkTo(x, z, { tol: 0.5 }), [cx(7), cx(27)]);
    s = await snap();
    check('stepping into the shaft of daylight wins', r === 'won' && s.mode === 'won');
    check('the delve ends with exactly the six deliberate deaths, one per kind of trap', s.deaths === 6);
    await expect(page.locator('#win')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#winSum')).toContainText('2200 of 2200');
  });

  expect(errors, 'no page errors').toEqual([]);
  console.log(`tombwright walkthrough: ${checks} checks passed`);
});
