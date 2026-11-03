// Integer sine table (R-TRIG-*). Angles are uint12: 4096 units per full turn.
// Values are scaled by 2^14. The table is data (data/sine4096.bin), pinned by SHA-256.
import { sha256Hex } from './sha256.js';

export const ANGLE_UNITS = 4096;
export const TRIG_ONE = 1 << 14;
export const SINE_SHA256 = '66b97b9db7fcae9dc1cb5b81d0239e3cb3fceb000cf3893dea7e6a86fc9a50d4';

let table = null;

/** Load and verify the table. `bytes` is a Uint8Array of the .bin file (8192 bytes). */
export function loadSineTable(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== ANGLE_UNITS * 2) {
    throw new Error('sine table: wrong size');
  }
  const got = sha256Hex(bytes);
  if (got !== SINE_SHA256) throw new Error(`sine table: SHA-256 mismatch (${got})`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = new Int16Array(ANGLE_UNITS);
  for (let i = 0; i < ANGLE_UNITS; i++) t[i] = dv.getInt16(i * 2, true);
  table = t;
}

function need() { if (!table) throw new Error('sine table not loaded'); return table; }

/** sin(angle) * 2^14, angle in 1/4096 turn (any integer, wrapped). */
export function isin(a) { return need()[((a % 4096) + 4096) % 4096]; }
/** cos(angle) * 2^14. */
export function icos(a) { return isin(a + 1024); }
