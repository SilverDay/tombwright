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
