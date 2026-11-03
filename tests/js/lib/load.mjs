// Node-side loader: reads the pinned sine table from disk into the sim core.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSineTable } from '../../../public/js/sim/sine.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export function loadCore() {
  loadSineTable(new Uint8Array(readFileSync(ROOT + 'public/js/sim/data/sine4096.bin')));
}
