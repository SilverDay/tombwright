#!/usr/bin/env node
// Re-expresses Gloamhollow's hand-written map (reference/gloamhollow/Gloamhollow.html, lines 342-447)
// as a GDF v1 file: dungeons/gloamhollow.gdf.json. M0 deliverable (spec §16).
// Run after changing the map data below: node bin/build-gloamhollow-gdf.mjs
// Entities and links are added as the sim core learns them: doors, slabs and props so far; bells, mirrors, foes, ... later.
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
  { id: 'sanctum', name: 'the Sanctum of the Candle-Eater', r: [2, 22, 11, 11], ceil: 6.2, cp: [7, 24, 2 * Q], reach: 'effect' }, // set when the boss falls (decision #20)
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

// Entities (R-ENT-*), in the order Gloamhollow builds them, which is also the order props push (R-MOVE-4).
// Doors (Gloamhollow DOORS). The mask doors open through their faces' trick; the sleeping door's key comes with keys.
const DOORS = [
  { id: 'vest', cell: [34, 55], style: 'stone', opens: 'interact' },
  { id: 'bell', cell: [23, 25], style: 'grate', opens: 'trigger' },
  { id: 'vault', cell: [36, 11], style: 'stone', opens: 'trigger' },
  { id: 'script', cell: [31, 4], style: 'stone', opens: 'interact' },
  { id: 'mSleep', cell: [7, 18], style: 'mask', opens: 'key', key: 'crescent', face: 'sleep' },  // the true door (R-DOOR-1)
  { id: 'mWeep', cell: [9, 18], style: 'mask', opens: 'interact', face: 'weep' },               // touch a lying face: it opens
  { id: 'mLaugh', cell: [11, 18], style: 'mask', opens: 'interact', face: 'laugh' },
];
const PRE_SLABS = [[32, 51], [35, 47]];  // plates sprung long ago, a skeleton under each
// Vents (Gloamhollow VENTS, VENT_T 3.6 s, VENT_WARN 0.9 s, VENT_FIRE 1.1 s, phases 0 / 1.2 / 2.4 s), in ticks (R-VENT-*).
const VENT_PHASES = [0, 36, 72];
// Loot and rubble (Gloamhollow LOOT, RUBBLE; R-ITEM-*). The sun-opal (hidden until the mirrors are solved)
// comes with the mirror puzzle; names stay client text for now (decision #23).
const ITEMS = [
  ['chain', 'treasure', 35, 33, 60], ['coins', 'treasure', 14, 21, 40], ['censer', 'treasure', 33, 24, 150],
  ['ring', 'treasure', 22, 8, 250], ['opal', 'treasure', 41, 14, 300, true],
  ['f1', 'flask', 32, 57], ['f2', 'flask', 38, 26], ['f3', 'flask', 40, 20], ['f4', 'flask', 3, 23], ['f5', 'flask', 11, 23],
  ['rub1', 'rubble', 33, 35], ['rub2', 'rubble', 27, 1],
];
// The Garden of Bells (Gloamhollow BELLS, BELL_ORDER; R-BELL-*): size from the radius (0.42 / 0.6 / 0.78 m),
// patina 0 bright, 1 dull brown, 2 verdigris. Order of casting: green, brown, great.
const BELLS = [
  { id: 'great', cell: [17, 25], size: 3, patina: 0, note: 98 },
  { id: 'green', cell: [18, 25], size: 1, patina: 2, note: 330 },
  { id: 'brown', cell: [19, 25], size: 2, patina: 1, note: 196 },
];
const BELL_ORDER = ['green', 'brown', 'great'];
// The Scriptorium's chests (Gloamhollow openGilded / openPlain; R-CHEST-*): both against the north wall. The gilded one
// is trapped (needles) and holds the rubies; the plain one the crescent key and a flask. The alcoves behind the
// weeping and laughing doors (K_WEEP / K_LAUGH; R-ALCOVE-*).
const CHESTS = [
  { id: 'gilded', cell: [33, 2], wall: 'n', style: 'gilded', trap: 'needles' },
  { id: 'plain', cell: [38, 2], wall: 'n', style: 'plain', trap: 'none' },
];
const IN_CHESTS = [
  { id: 'rubies', type: 'item', kind: 'treasure', in: 'gilded', value: 400 },
  { id: 'crescent', type: 'item', kind: 'key', in: 'plain' },
  { id: 'f6', type: 'item', kind: 'flask', in: 'plain' },
];
const ALCOVES_E = [
  { id: 'weep', type: 'alcove', cell: [9, 19], kind: 'drown', door: 'mWeep' },
  { id: 'laugh', type: 'alcove', cell: [11, 19], kind: 'tip', door: 'mLaugh' },
];
// The Sanctum (Gloamhollow BRAZIERS, spawnBoss, killBoss, takeHeart, SHAFT; R-BRAZIER-*, R-BOSS-*, R-EXIT-1): four unlit
// braziers, Ilvaris asleep on the sarcophagus (cx(7), cz(29) + 0.4 m), the Heart of Embers hidden in it.
const BRAZIERS = [[4, 24], [10, 24], [4, 30], [10, 30]].map(([i, j], n) => ({ id: `brazier${n + 1}`, type: 'brazier', cell: [i, j], lit: false }));
const BOSS = { id: 'ilvaris', type: 'boss', kind: 'eater', pos: [7 * 2400 + 1200, 29 * 2400 + 1200 + 400], zone: 'sanctum' };
const HEART = { id: 'heart', type: 'item', kind: 'treasure', cell: [7, 31], value: 1000, hidden: true };
// The tomb's keepers (Gloamhollow spawnWardens / spawnCrawlers; R-FOE-*): two bone gardeners rise in the Garden of
// Bells after the second wrong ringing, two gloam crawlers wake in the Mirror Vault when the lantern is first hung.
const FOES = [
  { id: 'warden1', type: 'foe', kind: 'warden', cell: [14, 24], start: 'dormant', group: 'keepers' },
  { id: 'warden2', type: 'foe', kind: 'warden', cell: [22, 24], start: 'dormant', group: 'keepers' },
  { id: 'crawler1', type: 'foe', kind: 'crawler', cell: [41, 19], start: 'dormant', group: 'crawlers' },
  { id: 'crawler2', type: 'foe', kind: 'crawler', cell: [41, 13], start: 'dormant', group: 'crawlers' },
];
// The Mirror Vault (Gloamhollow HOOK, MIRRORS, CRYSTAL; R-HOOK-*, R-MIRROR-*, R-BEAM-*). The beam leaves the hook
// going east. Solution: A \, B \, C /, D \, E \.
const HOOK = { id: 'hook', cell: [33, 14], dir: 'e' };
const MIRRORS = [['A', 36, 14, '/'], ['B', 36, 18, '/'], ['C', 40, 18, '\\'], ['D', 40, 12, '/'], ['E', 38, 12, '/']];
const CRYSTAL = { id: 'crystal', cell: [38, 12], wall: 'n' };
// Links (R-LINK-*), with Gloamhollow's texts. Delays: 0.65 s and 0.9 s in ticks. The second failure's
// wardens (link 3) rise with the darts of the second failure.
const LINKS = [
  { id: 1, when: { bellsSolved: 'bells' }, delay: 27,
    do: [{ openDoor: 'bell' }, { message: 'The three notes hang in the air together. With a long rattle, the bronze grate in the east wall rises.' }] },
  { id: 2, when: { bellsWrong: 'bells' }, repeat: true, delay: 20,
    do: [{ damage: 28 }, { message: 'The bells clash horribly. Darts spit from the stone trees around you.' }] },
  { id: 3, when: { sequence: [{ bellsWrong: 'bells' }, { bellsWrong: 'bells' }] }, delay: 20,
    do: [{ spawnFoes: 'keepers' }, { message: 'The bells clash. Darts spit from the stone trees, and the soil heaves: two of the garden’s keepers claw their way up.' }] },
  { id: 17, when: { lanternHung: true }, do: [{ spawnFoes: 'crawlers' }] },
  { id: 18, when: { lanternHung: true }, delay: 48, do: [{ message: 'Something skitters in the dark at the far end of the vault. Two things.' }] },
  { id: 19, when: { foesDefeated: 'keepers' }, do: [{ message: 'The last of the keepers falls apart into dry roots and bone.' }] },
  { id: 20, when: { foesDefeated: 'crawlers' }, do: [{ message: 'The vault is quiet again.' }] },
  { id: 21, when: { enterZone: 'sanctum' }, do: [{ wakeBoss: 'ilvaris' }, { message: 'Soot lifts from the sarcophagus and stands up into a thin shape with a crown of snuffed candles. It turns its face toward your lantern, and opens its mouth.' }] },
  // Reveal before setCheckpoint: the checkpoint saves the life as it is at that point in the list (R-LINK-8).
  { id: 22, when: { bossDefeated: true }, do: [{ reveal: 'heart' }, { setCheckpoint: 'sanctum' },
    { message: 'Ilvaris comes apart. Every light she ever swallowed pours out of her at once, cold and blue, and rushes up into the dark. The lid of the sarcophagus slides aside.' }] },
  { id: 23, when: { itemTaken: 'heart' }, do: [{ message: 'You lift the Heart of Embers. Far above, stone cracks, and a shaft of real daylight falls into the middle of the sanctum.' }] },
  { id: 4, when: { interact: 'vest' }, do: [{ message: 'The door is not locked. It swings down into the floor with a breath of very old air.' }] },
  { id: 5, when: { interact: 'script' }, do: [{ message: 'The door sinks into the floor. Cold air rises from somewhere far below.' }] },
  { id: 6, when: { interact: 'bell' }, repeat: true, do: [{ message: 'The bronze grate will not move. Something in this garden must raise it.' }] },
  { id: 7, when: { interact: 'vault' }, repeat: true, do: [{ message: 'The door has no handle and no keyhole. It does not move.' }] },
  { id: 9, when: { doorOpen: 'mWeep' }, do: [{ message: '“Weep with me, traveller, and pass,” the weeping face sighs, and its door sinks into the floor.' }] },
  { id: 10, when: { doorOpen: 'mLaugh' }, do: [{ message: '“Ha! Come through, come through, the way is short!” the laughing face cackles, and its door sinks into the floor.' }] },
  { id: 11, when: { doorOpen: 'mSleep' }, do: [{ message: 'The crescent key turns. The sleeping face does not wake, but its door sinks into the floor.' }] },
  { id: 12, when: { all: [{ interact: 'mSleep' }, { not: { hasItem: 'crescent' } }], within: 1 }, repeat: true,
    do: [{ message: 'The sleeping face says nothing. Beneath its chin is a keyhole shaped like a crescent moon.' }] },
  { id: 13, when: { all: [{ interact: 'mWeep' }, { not: { doorOpen: 'mWeep' } }], within: 1 }, repeat: true,
    do: [{ message: 'This door is sealed. The face above it looks satisfied.' }] },
  { id: 14, when: { all: [{ interact: 'mLaugh' }, { not: { doorOpen: 'mLaugh' } }], within: 1 }, repeat: true,
    do: [{ message: 'This door is sealed. The face above it looks satisfied.' }] },
  { id: 15, when: { itemTaken: 'crescent' }, do: [{ message: 'Inside the plain chest: a crescent-shaped key of black iron, and a flask of lamp oil.' }] },
  { id: 16, when: { itemTaken: 'rubies' }, do: [{ message: 'You lift the gilded lid. Inside, on rotten velvet: a fistful of rubies.' }] },
  { id: 8, when: { beamHits: 'crystal' },
    do: [{ openDoor: 'vault' }, { reveal: 'opal' }, { message: 'The beam strikes the crystal, which blazes like a small sun. With a deep grinding, the north door sinks into the floor, and in the glare something glints in a crack of the east wall.' }] },
];

// Props (Gloamhollow buildProps addCircle/addBox), positions in mm. cx/cz = cell centre.
const MM = 2400, cx = (i) => i * MM + MM / 2;
const PROPS = [
  ...[49, 44, 41, 39].map((j) => ['statue', 32 * MM + 720, cx(j), 3 * Q]),   // kneelers facing east (-PI/2)
  ...[51, 48, 45, 43].map((j) => ['statue', 37 * MM - 720, cx(j), Q]),       // kneelers facing west (PI/2)
  ['stele', cx(36) + 300, cx(52) + 200, T - 326],                            // rotation.y -0.5 rad
  ...[[15, 22], [21, 22], [15, 28], [21, 28]].map(([i, j]) => ['tree', cx(i), cx(j), 0]),
  ['post', cx(17) - 1488, cx(25), 0], ['post', cx(19) + 1488, cx(25), 0], // the bell frame (S * 0.62 = 1.488 m)
  ['plinth', cx(16), cx(28), 0],
  ['lectern', cx(35), cx(4), 0],
  ['sarcophagus', cx(7), cx(31), 0],
];

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
  bestiary: 1,
  meta: { title: 'Gloamhollow', lang: 'en', authorId: 0 },
  grid: { w: W, h: H, cells: b64encode(rleEncode(cells)) },
  zones: ZONES.map((z) => ({
    id: z.id, name: z.name, rects: [z.r], ceil: Math.round(z.ceil * 1000),
    ...(z.cp ? { checkpoint: { cell: [z.cp[0], z.cp[1]], yaw: z.cp[2], ...(z.reach ? { reach: z.reach } : {}) } } : {}),
  })),
  start: { cell: [34, 60] },
  exit: { cell: [7, 27], requires: 'heart' },  // the daylight shaft: carry the Heart into it (decision #50)
  entities: [
    ...DOORS.map((d) => ({ id: d.id, type: 'door', cell: d.cell, style: d.style, opens: d.opens, ...(d.key ? { key: d.key } : {}), ...(d.face ? { face: d.face } : {}) })),
    ...PRE_SLABS.map(([i, j], n) => ({ id: `slab${n + 1}`, type: 'slab', cell: [i, j] })),
    ...ITEMS.map(([id, kind, i, j, value, hidden]) => ({ id, type: 'item', kind, cell: [i, j], ...(kind === 'treasure' ? { value } : {}), ...(hidden ? { hidden } : {}) })),
    { id: 'eyes', type: 'eyes', zone: 'gallery', wake: 30 },  // the Waking Eyes: 1.0 s (R-EYES-*)
    ...VENTS.map((i, n) => ({ id: `vent${n + 1}`, type: 'vent', cells: VENT_ROWS.map((j) => [i, j]), period: 108, phase: VENT_PHASES[n], warn: 27, fire: 33 })),
    ...PROPS.flatMap(([kind, x, z, yaw], n) => {
      const prop = { id: kind + PROPS.slice(0, n + 1).filter((p) => p[0] === kind).length, type: 'prop', kind, pos: [x, z], yaw };
      // The bells hang between the frame's posts and the plinth, as in Gloamhollow's obstacle list (push order).
      if (kind === 'plinth') return [...BELLS.map((b) => ({ type: 'bell', ...b })), prop];
      // The mirrors stand between the plinth and the lectern in Gloamhollow's obstacle list.
      if (kind === 'lectern') return [...MIRRORS.map(([id, i, j, start]) => ({ id, type: 'mirror', cell: [i, j], start })), prop];
      // The chests stand between the lectern and the braziers / sarcophagus in Gloamhollow's obstacle list.
      if (kind === 'sarcophagus') return [...CHESTS.map((c) => ({ type: 'chest', ...c })), ...BRAZIERS, prop];
      return [prop];
    }),
    { type: 'lampHook', ...HOOK }, { type: 'crystal', ...CRYSTAL }, ...IN_CHESTS, ...ALCOVES_E, ...FOES, BOSS, HEART,
    { id: 'bells', type: 'bellSet', bells: BELLS.map((b) => b.id), order: BELL_ORDER.map((id) => BELLS.findIndex((b) => b.id === id)) },
  ],
  links: LINKS,
};
writeFileSync(ROOT + 'dungeons/gloamhollow.gdf.json', JSON.stringify(gdf, null, 1) + '\n');
console.log('dungeons/gloamhollow.gdf.json:', gdf.grid.cells.length, 'base64 chars for', W * H, 'cells');
