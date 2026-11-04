// The bestiary (R-FOE-1): foe numbers as data, pinned by SHA-256 like the sine table. Integers only.
// Mirror: src/Sim/Bestiary.php.
import { sha256Hex } from './sha256.js';

export const BESTIARY_VERSION = 1;
export const BESTIARY_SHA256 = 'd25a43054fbf61da11568c6e6ebe4972fa8eca811b163345cdd10681899905fe';
const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack'];

let kinds = null;

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
}

/** The kind's numbers, or undefined for an unknown kind. */
export function foeKind(kind) {
  if (kinds === null) throw new Error('bestiary not loaded');
  return typeof kind === 'string' ? kinds.get(kind) : undefined;
}
