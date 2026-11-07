// The builder's model and validation (M2 slice 1): round trips, the starter tomb, edits, and Gloamhollow surviving a save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore, ROOT } from './lib/load.mjs';
import { canonical } from '../../public/js/sim/canon.js';
import { CELL } from '../../public/js/sim/world.js';
import * as M from '../../public/js/build/model.js';
import { validate } from '../../public/js/build/validate.js';

loadCore();
const GLOAM = readFileSync(ROOT + 'dungeons/gloamhollow.gdf.json');

test('the starter tomb is valid and has no warnings', () => {
  const doc = M.newTomb();
  assert.deepEqual(validate(doc), { ok: true, error: null, warnings: [] });
  const big = M.newTomb(64, 64);
  assert.equal(validate(big).ok, true);
  assert.throws(() => M.newTomb(65, 10));
});

test('Gloamhollow opens and saves back unchanged (canonical forms equal)', () => {
  const doc = M.fromBytes(new Uint8Array(GLOAM));
  assert.equal(validate(doc).ok, true);
  assert.equal(canonical(JSON.parse(M.toText(doc))), canonical(JSON.parse(new TextDecoder().decode(GLOAM))));
});

test('an exported tomb reads back as the same document', () => {
  const doc = M.newTomb(20, 10);
  M.paint(doc, 5, 5, CELL.VOID);
  const back = M.fromText(M.toText(doc));
  assert.equal(M.cellAt(back, 5, 5), CELL.VOID);
  assert.equal(M.toText(back), M.toText(doc));
});

test('painting keeps the outer ring wall and rejects bad codes', () => {
  const doc = M.newTomb();
  assert.equal(M.paint(doc, 0, 3, CELL.ROOM), false);
  assert.equal(M.paint(doc, 3, 3, 99), false);
  assert.equal(M.paint(doc, 3, 3, CELL.ROOM), false, 'no change');
  assert.equal(M.paint(doc, 3, 3, CELL.WALL), true);
  assert.equal(M.paintRect(doc, 5, 3, 3, 3, CELL.CORR), 3);
});

test('painting a wall under the start gives a readable error', () => {
  const doc = M.newTomb();
  M.paint(doc, 2, 6, CELL.WALL);
  const v = validate(doc);
  assert.equal(v.ok, false);
  assert.match(v.error, /start|checkpoint/i);
});

test('zones: add, overlap refused, edit, remove', () => {
  const doc = M.newTomb(20, 12);
  M.removeZone(doc, 'z1');
  const a = M.addZone(doc, 1, 1, 8, 10);
  assert.ok(a);
  assert.equal(M.addZone(doc, 8, 3, 12, 5), null, 'overlaps a');
  const b = M.addZone(doc, 12, 1, 9, 10);        // corners in any order
  assert.deepEqual(b.rects[0], [9, 1, 4, 10]);
  assert.equal(M.updateZone(doc, b.id, { name: 'Crypt', ceil: 9999, checkpoint: { cell: [10, 5], yaw: 5000 } }), true);
  assert.equal(b.ceil, M.CEIL_MAX);
  assert.deepEqual(b.checkpoint, { cell: [10, 5], yaw: 904 });
  assert.equal(validate(doc).ok, true);
  M.updateZone(doc, b.id, { checkpoint: null });
  assert.equal(b.checkpoint, undefined);
  assert.equal(M.removeZone(doc, 'nope'), false);
});

test('start and exit need floor; no exit is a warning, not an error', () => {
  const doc = M.newTomb();
  assert.equal(M.setStart(doc, 0, 0), false);
  assert.equal(M.setExit(doc, 0, 0), false);
  assert.equal(M.setExit(doc, 5, 5), true);
  M.clearExit(doc);
  const v = validate(doc);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 1);
});

test('exit keeps its `requires` when moved', () => {
  const doc = M.fromBytes(new Uint8Array(GLOAM));
  const req = doc.gdf.exit.requires;
  assert.ok(M.setExit(doc, 8, 27) || M.setExit(doc, 7, 27));
  assert.equal(doc.gdf.exit.requires, req);
});

test('imports refuse junk', () => {
  assert.throws(() => M.fromText('{"gdf":2}'));
  assert.throws(() => M.fromText('not json'));
  assert.throws(() => M.fromBytes(new Uint8Array(300000)));
  assert.throws(() => M.fromText('{"gdf":1,"grid":{"w":99,"h":3,"cells":""}}'));
});

test('a malformed chamber is an error in validation, not a crash', () => {
  const doc = M.newTomb();
  doc.gdf.zones[0].rects = 5;
  const v = validate(doc);
  assert.equal(v.ok, false);
});
