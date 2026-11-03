#!/usr/bin/env node
// Re-expresses Gloamhollow's hand-written map (reference/gloamhollow/Gloamhollow.html, lines 342-447)
// as a GDF v1 file: dungeons/gloamhollow.gdf.json. M0 deliverable (spec §16).
// Run after changing the map data below: node bin/build-gloamhollow-gdf.mjs
// Entities and links (doors, bells, mirrors, foes, ...) are added as the sim core learns them.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CELL, rleEncode, b64encode } from '../public/js/sim/world.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const W = 44, H = 63;
const T = 4096, Q = T / 4; // angles in 1/4096 turn: Gloamhollow PI/2 -> 1024, PI -> 2048, -PI/2 -> 3072

// Gloamhollow ZONES (r = [x, y, w, h], ceil in m, cp = checkpoint).
const ZONES = [
  { id: 'vest', name: 'the Vestibule', r: [31, 56, 7, 6], ceil: 4.2, cp: [34, 60, 0] },
  { id: 'hall', name: 'the Hall of the Kneeling Bearers', r: [32, 39, 5, 14], ceil: 4.6, cp: [34, 52, 0] },
  { id: 'mouth', name: 'the Mouth of the Gallery', r: [33, 33, 3, 3], ceil: 3.6, cp: [34, 34, Q] },
  { id: 'gallery', name: 'the Gallery of Waking Eyes', r: [17, 33, 16, 3], ceil: 3.6 },
  { id: 'bells', name: 'the Garden of Bells', r: [14, 21, 9, 9], ceil: 5.4, cp: [18, 28, 0] },
  { id: 'breath', name: 'the Breathing Hall', r: [27, 24, 12, 3], ceil: 4.2, cp: [27, 25, 3 * Q] },
  { id: 'vault', name: 'the Mirror Vault', r: [33, 12, 9, 9], ceil: 4.6, cp: [37, 19, 0] },
  { id: 'script', name: 'the Scriptorium', r: [32, 1, 8, 7], ceil: 4.2, cp: [36, 6, 0] },
  { id: 'chasm', name: 'the Chasm of the Unlit Road', r: [14, 1, 14, 9], ceil: 6.5, cp: [26, 5, Q] },
  { id: 'masks', name: 'the Antechamber of Masks', r: [6, 13, 7, 5], ceil: 4.2, cp: [10, 14, 2 * Q] },
  { id: 'way', name: "the Dreamer's Way", r: [7, 19, 1, 3], ceil: 3.0, corr: true, cp: [7, 19, 2 * Q] },
  { id: 'sanctum', name: 'the Sanctum of the Candle-Eater', r: [2, 22, 11, 11], ceil: 6.2, cp: [7, 24, 2 * Q] },
];
const CORRS = [[34, 53], [34, 54], [34, 55], [34, 36], [34, 37], [34, 38], [18, 30], [18, 31], [18, 32],
  [23, 25], [24, 25], [25, 25], [26, 25], [37, 21], [37, 22], [37, 23], [36, 8], [36, 9], [36, 10], [36, 11],
  [28, 4], [29, 4], [30, 4], [31, 4], [14, 10], [14, 11], [14, 12], [14, 13], [14, 14], [13, 14],
  [7, 18], [9, 18], [11, 18], [9, 19], [11, 19]];
const HALL_PAT = ['.....', 'pp.pp', 'p..pp', 'p.ppp', '..ppp', '.pppp', '...pp', 'pp.pp', 'pp..p', 'ppp.p', 'ppp..', 'pppp.', 'pp...', 'pp.pp'];
const HIDDEN_PITS = [[28, 33], [28, 34], [24, 34], [24, 35], [20, 33], [20, 35]];
const BRIDGE = [[25, 5], [24, 5], [23, 5], [23, 4], [23, 3], [22, 3], [21, 3], [20, 3], [20, 4], [20, 5], [20, 6], [20, 7],
  [19, 7], [18, 7], [17, 7], [17, 6], [17, 5], [16, 5], [20, 8], [21, 8], [22, 8]];
const VOID_RECT = [16, 1, 10, 9];
const VENTS = [29, 32, 35], VENT_ROWS = [24, 25, 26];
const ALCOVES = [[9, 19], [11, 19]];  // weeping and laughing alcoves
const STAIR = [34, 61];               // the sealed stair: solid (Gloamhollow K_STAIR)

const cells = new Uint8Array(W * H).fill(CELL.WALL);
const set = (i, j, c) => { cells[j * W + i] = c; };
for (const z of ZONES) { const [x, y, w, h] = z.r; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, z.corr ? CELL.CORR : CELL.ROOM); }
for (const [i, j] of CORRS) set(i, j, CELL.CORR);
HALL_PAT.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === 'p') set(32 + c, 52 - r, CELL.PLATE); });
for (const [i, j] of HIDDEN_PITS) set(i, j, CELL.HPIT);
{ const [x, y, w, h] = VOID_RECT; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, CELL.VOID); }
for (const [i, j] of BRIDGE) set(i, j, CELL.BRIDGE);
for (const i of VENTS) for (const j of VENT_ROWS) set(i, j, CELL.VENT);
for (const [i, j] of ALCOVES) set(i, j, CELL.ALCOVE);
set(...STAIR, CELL.WALL);

const gdf = {
  gdf: 1,
  meta: { title: 'Gloamhollow', lang: 'en', authorId: 0 },
  grid: { w: W, h: H, cells: b64encode(rleEncode(cells)) },
  zones: ZONES.map((z) => ({
    id: z.id, name: z.name, rects: [z.r], ceil: Math.round(z.ceil * 1000),
    ...(z.cp ? { checkpoint: { cell: [z.cp[0], z.cp[1]], yaw: z.cp[2] } } : {}),
  })),
  start: { cell: [34, 60] },
  exit: { cell: [7, 27], requires: 'bossDefeated' },
  entities: [],
  links: [],
};
writeFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', JSON.stringify(gdf, null, 1) + '\n');
console.log('dungeons/gloamhollow.gdf.json:', gdf.grid.cells.length, 'base64 chars for', W * H, 'cells');
