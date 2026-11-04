// The bestiary (R-FOE-1): foe numbers as data, pinned by SHA-256 like the sine table. Integers only.
// Mirror: src/Sim/Bestiary.php.
import { sha256Hex } from './sha256.js';

export const BESTIARY_VERSION = 1;
export const BESTIARY_SHA256 = '4ec12a4f269299c5af032dce0196373f8dd729bd372bb692a1ffcb8ed439b04e';
const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack', 'regen', 'flit'];

const BOSS_FIELDS = ['strikes', 'damage', 'oilHit', 'radius', 'speed', 'speed2', 'wakeAtk', 'wind', 'hitRange', 'windRange', 'seekWindRange',
  'stop', 'reel', 'feed', 'feed2', 'feedReach', 'feedCd', 'phase2Atk', 'phase2FeedCd', 'atk', 'atk2', 'tearWind', 'solidRange', 'drainRange', 'drain', 'drain2'];

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
    m.set(kind, Object.freeze({ ...f, fly: f.mover === 'fly' }));
  }
  kinds = m;
  const bm = new Map();
  for (const [kind, f] of Object.entries(b.bosses)) {
    for (const k of BOSS_FIELDS) if (!Number.isSafeInteger(f[k])) throw new Error('bestiary: boss ' + kind + '.' + k);
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
