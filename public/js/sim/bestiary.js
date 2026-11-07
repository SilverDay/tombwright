// The bestiary (R-FOE-1): foe numbers as data, pinned by SHA-256 like the sine table. Integers only.
// Mirror: src/Sim/Bestiary.php.
import { sha256Hex } from './sha256.js';

export const BESTIARY_VERSION = 1;
export const BESTIARY_SHA256 = '3b84575fd64dd61b57e65413827298837c0dd199e96a80163deb863961abe1c7';
const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack', 'regen', 'flit'];

// R-FOE-1, R-POW-*: the powers the cores know.
export const POWERS = ['', 'douse', 'freeze', 'seize', 'confuse', 'poison', 'drain', 'steal', 'pilfer', 'guard', 'forget', 'invisible', 'mimic'];
// R-BREATH-1: the ranged block a kind may carry, and the shots the cores know (R-SHOT-1).
const RANGED_FIELDS = ['cd', 'dmg', 'speed', 'range', 'min', 'r', 'off'];
export const SHOT_KINDS = ['fire', 'bolt'];
const MAX_SHOT_SPEED = 11000, MAX_VOLLEY_SPEED = 8000;   // mm/s; the R-INT-2 comments in sim.js rely on them
// R-BOSS-1: the fields every boss kind has, then the ones its behaviour adds.
const BOSS_FIELDS = ['strikes', 'damage', 'radius', 'speed', 'wakeAtk', 'wind', 'hitRange', 'windRange', 'stop', 'atk'];
const BOSS_BEHAVIOURS = {
  eater: ['oilHit', 'speed2', 'seekWindRange', 'reel', 'feed', 'feed2', 'feedReach', 'feedCd', 'phase2Atk', 'phase2FeedCd', 'atk2', 'tearWind', 'solidRange', 'drainRange', 'drain', 'drain2'],
  warden: ['summonCd', 'summonFirst', 'summonPer', 'summonMax', 'ring', 'volleyCd', 'volleyFirst', 'volleyBolts', 'volleySpread', 'volleyDmg', 'volleySpeed', 'volleyR', 'volleyOff', 'volleyMin'],
};

let kinds = null, bosses = null;

/** Load and verify bestiary.v1.json from its bytes. */
export function loadBestiary(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bestiary must be bytes');
  const got = sha256Hex(bytes);
  if (got !== BESTIARY_SHA256) throw new Error(`bestiary: SHA-256 mismatch (${got})`);
  const b = JSON.parse(new TextDecoder().decode(bytes));
  const m = new Map();
  for (const [kind, f] of Object.entries(b.foes)) {
    for (const k of FIELDS) if (!Number.isSafeInteger(f[k])) throw new Error('bestiary: ' + kind + '.' + k);
    if (!POWERS.includes(f.power)) throw new Error('bestiary: ' + kind + '.power'); // R-FOE-1
    let ranged = null;
    if (Object.hasOwn(f, 'ranged')) {                    // R-BREATH-1
      for (const k of RANGED_FIELDS) if (!Number.isSafeInteger(f.ranged[k])) throw new Error('bestiary: ' + kind + '.ranged.' + k);
      if (!SHOT_KINDS.includes(f.ranged.kind)) throw new Error('bestiary: ' + kind + '.ranged.kind');
      if (f.ranged.speed < 1 || f.ranged.speed > MAX_SHOT_SPEED) throw new Error('bestiary: ' + kind + '.ranged.speed'); // R-INT-2 bound in updateShots
      ranged = Object.freeze({ ...f.ranged });
    }
    m.set(kind, Object.freeze({ ...f, ranged, fly: f.mover === 'fly' }));
  }
  kinds = m;
  const bm = new Map();
  for (const [kind, f] of Object.entries(b.bosses)) {
    const extra = BOSS_BEHAVIOURS[f.behaviour];          // R-BOSS-1
    if (extra === undefined) throw new Error('bestiary: boss ' + kind + '.behaviour');
    for (const k of [...BOSS_FIELDS, ...extra]) if (!Number.isSafeInteger(f[k])) throw new Error('bestiary: boss ' + kind + '.' + k);
    if (f.behaviour === 'warden') {                      // R-INT-2 bounds assumed in the volley and the ring
      if (f.volleySpeed < 1 || f.volleySpeed > MAX_VOLLEY_SPEED) throw new Error('bestiary: boss ' + kind + '.volleySpeed');
      if (f.ring < 0 || f.ring >= 4096) throw new Error('bestiary: boss ' + kind + '.ring');
    }
    bm.set(kind, Object.freeze({ ...f }));
  }
  bosses = bm;
}

/** R-BOSS-1: a boss kind's numbers, or undefined. */
export function bossKind(kind) {
  if (bosses === null) throw new Error('bestiary not loaded');
  return typeof kind === 'string' ? bosses.get(kind) : undefined;
}

/** The kind's numbers, or undefined for an unknown kind. */
export function foeKind(kind) {
  if (kinds === null) throw new Error('bestiary not loaded');
  return typeof kind === 'string' ? kinds.get(kind) : undefined;
}
