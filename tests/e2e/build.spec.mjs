// The builder (M2 slice 1, decisions #79-#85): paint, undo, see the loader's verdict, export, reopen, and hand the tomb
// to the game for a practice-mode playtest. Served like the other pages (php -S through public/index.php).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'http://127.0.0.1:8765';
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('builder: paint, check, export, reopen, playtest', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8765)/, (r) => r.abort());
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  await expect(page.locator('#playBtn')).toBeEnabled();

  // A fresh page starts from the starter tomb (no earlier save in a new context).
  expect(await page.evaluate(() => [window.__twBuild.doc.w, window.__twBuild.doc.h])).toEqual([16, 12]);
  const Z = 20;
  const box = await page.locator('#grid').boundingBox();
  const at = (i, j) => ({ x: box.x + (i + 0.5) * Z, y: box.y + (j + 0.5) * Z });
  const click = async (i, j) => { const p = at(i, j); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); };
  const cell = (i, j) => page.evaluate(([a, b]) => window.__twBuild.M.cellAt(window.__twBuild.doc, a, b), [i, j]);

  // Paint a void cell, then undo it.
  await page.getByRole('radio', { name: 'Void' }).click();
  await click(6, 5);
  expect(await cell(6, 5)).toBe(5);
  await page.locator('#undoBtn').click();
  expect(await cell(6, 5)).toBe(1);

  // Painting a wall under the start is something the loader refuses; the editor says so and disables Playtest.
  await page.getByRole('radio', { name: 'Wall', exact: true }).click();
  await click(2, 6);
  await expect(page.locator('#status')).toContainText(/start|checkpoint/i);
  await expect(page.locator('#playBtn')).toBeDisabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('#playBtn')).toBeEnabled();

  // Drag a brush stroke of corridor, then a new chamber is refused on top of the existing one.
  await page.getByRole('radio', { name: 'Corridor' }).click();
  { const a = at(4, 3), b = at(8, 3); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
  for (let i = 4; i <= 8; i++) expect(await cell(i, 3)).toBe(2);
  await page.getByRole('radio', { name: 'Chamber (drag)' }).click();
  { const a = at(3, 3), b = at(5, 5); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up(); }
  await expect(page.locator('#toast')).toContainText('free space');
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.zones.length)).toBe(1);

  // Remove the chamber (the start is then outside every chamber: a warning, not an error), rename, retitle.
  await page.getByRole('button', { name: /Remove chamber/ }).click();
  await expect(page.locator('#problems')).toContainText('outside every chamber');
  await page.locator('#undoBtn').click();
  await page.locator('#zones input[type=text]').fill('The Hall');
  await page.locator('#zones input[type=text]').press('Enter');
  await page.locator('#title').fill('Test of the Builder');
  await page.locator('#title').press('Enter');
  expect(await page.evaluate(() => [window.__twBuild.doc.gdf.zones[0].name, window.__twBuild.doc.gdf.meta.title])).toEqual(['The Hall', 'Test of the Builder']);

  // Export: a file that the sim core's own loader accepts.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#saveBtn').click()]);
  expect(dl.suggestedFilename()).toBe('test-of-the-builder.gdf.json');
  const path = await dl.path();
  const exported = readFileSync(path, 'utf8');
  expect(JSON.parse(exported).meta.title).toBe('Test of the Builder');

  // Open the shipped Gloamhollow through the file chooser: it loads, validates and keeps its entities.
  await page.locator('#file').setInputFiles(ROOT + 'dungeons/gloamhollow.gdf.json');
  await expect(page.locator('#title')).toHaveValue('Gloamhollow');
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.entities.length)).toBeGreaterThan(50);
  // A file that is not a tomb is refused and the open tomb stays.
  await page.locator('#file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await expect(page.locator('#toast')).toContainText('not a tomb');
  await expect(page.locator('#title')).toHaveValue('Gloamhollow');

  // Back to the exported tomb, reload the page: the autosave brings it back.
  await page.locator('#file').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page.locator('#title')).toHaveValue('Test of the Builder');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => !!window.__twBuild);
  await expect(page.locator('#title')).toHaveValue('Test of the Builder');

  // Playtest: the game page boots on that tomb in practice mode.
  await page.locator('#playBtn').click();
  await page.waitForURL(BASE + '/play/test');
  await page.waitForFunction(() => !!window.__tw);
  expect(await page.evaluate(() => [window.__tw.T.name, window.__tw.T.mode, document.getElementById('title').textContent])).toEqual(['test', 'practice', 'Test of the Builder']);
  await page.evaluate(() => window.__tw.start(7));
  expect(await page.evaluate(() => window.__tw.state.mode)).toBe('practice');

  expect(errors).toEqual([]);
});

test('playtest without a tomb says so instead of crashing', async ({ page }) => {
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/play/test');
  await expect(page.locator('#err')).toContainText('could not be loaded');
});

test('builder: place things, name the loot, then play them', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8765)/, (r) => r.abort());
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  const Z = 20, box = await page.locator('#grid').boundingBox();
  const click = async (i, j) => { const x = box.x + (i + 0.5) * Z, y = box.y + (j + 0.5) * Z; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
  const ents = () => page.evaluate(() => window.__twBuild.doc.gdf.entities);

  // Palette: a door in the way (opens on interact), a treasure with a name, an inscription on the north wall.
  await page.getByRole('radio', { name: 'Door', exact: true }).click(); await click(6, 6);
  await page.getByRole('radio', { name: 'Treasure' }).click(); await click(4, 5);
  await page.getByRole('radio', { name: 'Inscription' }).click(); await click(9, 1);
  await page.getByRole('radio', { name: 'Torch' }).click(); await click(12, 1);
  await page.getByRole('radio', { name: 'Chest' }).click(); await click(3, 1);
  expect((await ents()).map((e) => e.type)).toEqual(['door', 'item', 'inscription', 'torch', 'chest']);
  // Refusals say why.
  await page.getByRole('radio', { name: 'Chest' }).click(); await click(8, 6);
  await expect(page.locator('#toast')).toContainText('against a wall');

  // The inspector edits the selected thing (the chest placed last is selected; pick the treasure by Select).
  await page.getByRole('radio', { name: 'Select / move' }).click(); await click(4, 5);
  await expect(page.locator('#inspector')).toContainText('Item');
  await page.getByLabel('Name (optional)').fill('a silver lamp-chain'); await page.getByLabel('Name (optional)').press('Enter');
  await page.getByLabel('Value').fill('75'); await page.getByLabel('Value').press('Enter');
  expect(await page.evaluate(() => { const t = window.__twBuild.doc.gdf.entities[1]; return [t.name, t.value]; })).toEqual(['a silver lamp-chain', 75]);
  // Move the torch by dragging it, and remove the chest.
  { const a = [12, 1], b = [14, 1]; await page.mouse.move(box.x + (a[0] + .5) * Z, box.y + (a[1] + .5) * Z); await page.mouse.down(); await page.mouse.move(box.x + (b[0] + .5) * Z, box.y + (b[1] + .5) * Z, { steps: 4 }); await page.mouse.up(); }
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.entities[3].cell)).toEqual([14, 1]);
  await click(3, 1); await page.getByRole('button', { name: 'Remove chest1' }).click();
  expect((await ents()).map((e) => e.type)).toEqual(['door', 'item', 'inscription', 'torch']);
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  // Undo brings the chest back.
  await page.locator('#undoBtn').click();
  expect((await ents()).length).toBe(5);
  await page.locator('#undoBtn').click();   // the torch move
  await page.locator('#redoBtn').click();
  await page.locator('#redoBtn').click();
  expect((await ents()).length).toBe(4);

  // Play it: the treasure has its own name, the door opens, the inscription reads.
  await page.locator('#playBtn').click();
  await page.waitForURL(BASE + '/play/test');
  await page.waitForFunction(() => !!window.__tw);
  await page.evaluate(readFileSync(ROOT + 'tests/e2e/lib/tombwright-driver.js', 'utf8'));
  await page.evaluate(() => window.__tw.start(3));
  const S = 2.4, cx = (i) => (i + 0.5) * S;
  const walk = (x, z) => page.evaluate(([a, b]) => window.__wt.walkTo(a, b, { tol: 0.4 }), [x, z]);
  expect(await walk(cx(4) - 1.0, cx(5))).toBe('arrived');
  const label = await page.evaluate(([x, z]) => window.__wt.use(x, z), [cx(4), cx(5)]);
  expect(label).toContain('a silver lamp-chain');
  expect(await page.evaluate(() => window.__wt.st().taken)).toEqual([2]);
  expect(await walk(cx(6) - 1.3, cx(6))).toBe('arrived');
  expect(await page.evaluate(([x, z]) => window.__wt.use(x, z), [cx(6), cx(6)])).toMatch(/door/i);
  await page.evaluate(() => window.__wt.tick(40));
  expect(await page.evaluate(() => window.__wt.st().doors.map((d) => d.open))).toEqual([true]);
  expect(await walk(cx(9), cx(1))).toBe('arrived');
  expect(await page.evaluate(() => window.__wt.prompt())).toContain('Read');
  expect(errors).toEqual([]);
});

test('builder: bells, mirror, foes with the threat counter, and a boss', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8765)/, (r) => r.abort());
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  await expect(page.locator('#foeKind option')).toHaveCount(28);
  const Z = 20, box = await page.locator('#grid').boundingBox();
  const click = async (i, j) => { const x = box.x + (i + 0.5) * Z, y = box.y + (j + 0.5) * Z; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
  const radio = (n) => page.getByRole('radio', { name: n });

  // Two bells make a set (the first alone is not yet a valid set).
  await radio('Bell (joins the selected set)').click(); await click(5, 3);
  await expect(page.locator('#status')).not.toHaveText('The tomb loads and can be played.');
  await click(7, 3);
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.entities.map((e) => e.type))).toEqual(['bell', 'bellSet', 'bell']);
  await radio('Mirror').click(); await click(9, 3);
  await radio('Brazier').click(); await click(11, 3);

  // Foes: pick a kind in the list, watch the budget; five dragons are too many.
  await page.locator('#foeKind').selectOption('dragon');
  await radio('Foe (kind below)').click();
  for (const i of [3, 5, 7, 9]) await click(i, 9);
  await expect(page.locator('#threat')).toContainText('Threat 100 / 100');
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  await click(11, 9);
  await expect(page.locator('#threat')).toContainText('Threat 125 / 100');
  await expect(page.locator('#status')).toContainText(/foe limits|too many|threat/i);
  await expect(page.locator('#playBtn')).toBeDisabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('#playBtn')).toBeEnabled();

  // The boss, then her kind in the inspector.
  await radio('Boss (inside a chamber)').click(); await click(12, 6);
  await page.getByLabel('Kind').selectOption('deepWarden');
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.entities.find((e) => e.type === 'boss').kind)).toBe('deepWarden');
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');

  // Play: ring a bell by its derived name, turn the mirror; nothing breaks.
  await page.locator('#playBtn').click();
  await page.waitForURL(BASE + '/play/test');
  await page.waitForFunction(() => !!window.__tw);
  await page.evaluate(readFileSync(ROOT + 'tests/e2e/lib/tombwright-driver.js', 'utf8'));
  await page.evaluate(() => window.__tw.start(5));
  const S = 2.4, cx = (i) => (i + 0.5) * S;
  const walk = (x, z) => page.evaluate(([a, b]) => window.__wt.walkTo(a, b, { tol: 0.4 }), [x, z]);
  expect(await walk(cx(5), cx(4) - 0.4)).toBe('arrived');
  expect(await page.evaluate(([x, z]) => window.__wt.use(x, z), [cx(5), cx(3)])).toBe('Ring the middling bright bell');
  expect(await page.evaluate(() => window.__wt.st().bellSets[0].seq.length)).toBe(1);
  expect(await page.evaluate(() => [window.__wt.st().boss.st, window.__wt.st().foes.length])).toEqual(['asleep', 4]);
  // Every card has a way out: a playtest goes back to the builder, which still holds the tomb.
  await expect(page.locator('a.leave')).toHaveCount(4);
  for (const a of await page.locator('a.leave').all()) { await expect(a).toHaveAttribute('href', '/build'); await expect(a).toHaveText('Back to the builder'); }
  await page.evaluate(() => window.__tw.game.ui.openMenu());
  await page.locator('#menu a.leave').click();
  await page.waitForURL(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.entities.filter((e) => e.type === 'foe').length)).toBe(4);
  expect(errors).toEqual([]);
});

test('an official tomb has a way out to the main page', async ({ page }) => {
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/play/gloamhollow');
  await page.waitForFunction(() => !!window.__tw);
  const a = page.locator('#newBox a.leave');
  await expect(a).toHaveAttribute('href', '/');
  await expect(a).toHaveText('Leave the tomb');
  await a.click();
  await page.waitForURL(BASE + '/');
});

test('builder: wire a link, then watch it in the playtest', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:8765)/, (r) => r.abort());
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  const Z = 20, box = await page.locator('#grid').boundingBox();
  const click = async (i, j) => { const x = box.x + (i + 0.5) * Z, y = box.y + (j + 0.5) * Z; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
  const radio = (n) => page.getByRole('radio', { name: n });

  // A door that waits for a trigger, and a treasure to take. Without a link the door warns.
  await radio('Door').click(); await click(6, 6);
  await page.getByRole('radio', { name: 'Select / move' }).click(); await click(6, 6);
  await page.getByLabel('Opens on').selectOption('trigger');
  await expect(page.locator('#problems')).toContainText('no link opens it');
  await radio('Treasure').click(); await click(4, 5);

  // The wiring view: add a link, make it "when you take the treasure, open the door and say something".
  await page.locator('#viewWiring').click();
  await expect(page.locator('#wiring')).toBeVisible();
  await page.getByRole('button', { name: 'Add a link' }).click();
  const card = page.locator('article.link[data-link="1"]');
  await expect(card).toBeVisible();
  await card.locator('.term select').first().selectOption('itemTaken');
  await expect(card.locator('.lsum')).toContainText('you take “gem1”');
  await expect(card.locator('.term.event')).toHaveCount(1);
  await card.getByRole('button', { name: 'Add an effect' }).first().click();
  await card.locator('.leffects select').nth(2).selectOption('message');   // the second effect: its kind select
  await card.locator('.leffects input.msg').fill('Stone grinds somewhere ahead.');
  await card.locator('.leffects input.msg').press('Enter');
  await expect(card.locator('.lsum')).toContainText('say “Stone grinds somewhere ahead.”');
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  await expect(page.locator('#problems')).not.toContainText('no link opens it');

  // Gates: wrap it in ALL (two terms appear), refuse a NOT of an event, and go back to the single trigger.
  await card.locator('.term select').first().selectOption('all');
  await expect(card.locator('.term.gate')).toHaveCount(1);
  expect(await page.evaluate(() => window.__twBuild.doc.gdf.links[0].when.all.length)).toBe(2);
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  await page.locator('#undoBtn').click();
  await expect(card.locator('.term.gate')).toHaveCount(0);

  // Playtest it: the Wiring chip shows the link; taking the treasure fires it and opens the door.
  await page.locator('#playBtn').click();
  await page.waitForURL(BASE + '/play/test');
  await page.waitForFunction(() => !!window.__tw);
  await page.evaluate(readFileSync(ROOT + 'tests/e2e/lib/tombwright-driver.js', 'utf8'));
  await page.evaluate(() => window.__tw.start(9));
  await page.keyboard.press('l');                                       // the mouse is captured by the game; L opens the panel
  await expect(page.locator('#wirePanel')).toBeVisible();
  const live = page.locator('#wirePanel article.wl');
  await expect(live).toHaveCount(1);
  await expect(live.locator('.wlbadge')).toHaveText('waiting');
  const S = 2.4, cx = (i) => (i + 0.5) * S;
  expect(await page.evaluate(([x, z]) => window.__wt.walkTo(x, z, { tol: 0.4 }), [cx(4) - 1.0, cx(5)])).toBe('arrived');
  await page.evaluate(([x, z]) => window.__wt.use(x, z), [cx(4), cx(5)]);
  await page.evaluate(() => window.__wt.tick(10));
  expect(await page.evaluate(() => window.__wt.st().doors.map((d) => d.open))).toEqual([true]);
  await page.evaluate(() => window.__tw.game.hud());                    // rendering is off in tests, so refresh the HUD by hand
  await expect(live.locator('.wlbadge')).toContainText('used up');
  await expect(live.locator('.wlterm .wlstate').first()).toContainText('fired');
  expect(errors).toEqual([]);
});

test('wiring view: a hand-edited, malformed link is shown as such and can be removed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { window.__twTest = true; window.__twNoRender = true; });
  await page.goto(BASE + '/build');
  await page.waitForFunction(() => !!window.__twBuild);
  await page.evaluate(() => {
    const t = JSON.parse(window.__twBuild.text);
    t.links = [{ id: 1, when: { constructor: 1 }, do: 'nope' }];
    window.__twBuild.use(JSON.stringify(t));
  });
  await page.locator('#viewWiring').click();
  await expect(page.locator('article.link.broken')).toContainText('malformed');
  await page.getByRole('button', { name: 'Remove malformed link 1' }).click();
  await expect(page.locator('article.link')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('The tomb loads and can be played.');
  expect(errors).toEqual([]);
});
