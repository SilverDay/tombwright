// Generates public/js/sim/data/sine4096.bin: 4096 x int16 little-endian,
// value[i] = round(sin(2*pi*i/4096) * 2^14). Uses floating point ONCE, offline;
// the output bytes are then pinned by SHA-256 in both sim cores (rule R-TRIG-1).
// Run: node bin/gen-sine-table.mjs   (then update SINE_SHA256 in both cores if it changed)
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const N = 4096, SCALE = 1 << 14;
const buf = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  // Exact values at the quarter points avoid float noise (sin(pi) != 0 in IEEE).
  let v;
  if (i === 0 || i === 2048) v = 0;
  else if (i === 1024) v = SCALE;
  else if (i === 3072) v = -SCALE;
  else v = Math.round(Math.sin((2 * Math.PI * i) / N) * SCALE);
  buf.writeInt16LE(v, i * 2);
}
const out = fileURLToPath(new URL('../public/js/sim/data/sine4096.bin', import.meta.url));
writeFileSync(out, buf);
console.log('wrote', out, 'sha256', createHash('sha256').update(buf).digest('hex'));
