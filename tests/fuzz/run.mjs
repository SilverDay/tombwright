#!/usr/bin/env node
// Differential fuzzer (spec §6.4, §15; M1 exit criterion: 0 mismatches over 10,000 cases).
// The JS core plays each case and records its state hash every HASH_EVERY ticks; PHP workers
// (tests/fuzz/check.php) replay the same cases and report the first tick where the cores disagree.
//   node tests/fuzz/run.mjs [--cases 10000] [--start 0] [--jobs 4]   all cases
//   node tests/fuzz/run.mjs --case 1234                              one case, with its GDF written out
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../js/lib/load.mjs';
import * as Sim from '../../public/js/sim/sim.js';
import { makeCase } from './gen.mjs';

export const HASH_EVERY = 100;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
loadCore();

/** Play a case in the JS core: hashes every HASH_EVERY ticks, the final hash, and where `step` refused (ironman death, a win). */
export function playJs(c) {
  const world = Sim.load(new TextEncoder().encode(c.gdf)), st = Sim.init(world, c.seed, c.mode), hashes = { 0: Sim.hash(st) };
  const inputs = [];
  let t = 0, stop = null;
  outer: while (t < c.ticks) {
    const [n, inp] = c.driver(st);
    inputs.push([n, inp]);
    for (let k = 0; k < n; k++) {
      try { Sim.step(world, st, inp); } catch (e) { stop = { tick: t, why: String(e.message) }; break outer; }
      t++;
      if (t % HASH_EVERY === 0) hashes[t] = Sim.hash(st);
    }
  }
  return { inputs, ticks: t, hashes, final: Sim.hash(st), stop, deaths: st.deaths, won: st.won !== null };
}

function runPhp(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('php', [join(ROOT, 'tests/fuzz/check.php'), file], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => (code === 0 || code === 1 ? resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) : reject(new Error('check.php exited ' + code))));
  });
}

async function main() {
  const one = opt('case', null);
  if (one !== null) {
    const c = makeCase(one), r = playJs(c), file = join(ROOT, `test-results/fuzz-case-${one}.json`);
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    const { driver, ...plain } = c;
    writeFileSync(file, JSON.stringify({ ...plain, ...r, hashEvery: HASH_EVERY }, null, 1));
    const res = await runPhp(await asJsonl([{ ...plain, ...r }]));
    console.log(`case ${one}: ${r.ticks} ticks, ${r.deaths} deaths${r.won ? ', won' : ''}${r.stop ? ', stopped: ' + r.stop.why : ''}; written to ${file}`);
    console.log(res.length ? JSON.stringify(res, null, 1) : 'PHP agrees');
    process.exitCode = res.length ? 1 : 0;
    return;
  }
  const cases = opt('cases', 10000), start = opt('start', 0), jobs = opt('jobs', Math.max(1, availableParallelism() - 1)), CHUNK = 250;
  const dir = mkdtempSync(join(tmpdir(), 'tw-fuzz-'));
  let mismatches = [], ticks = 0, deaths = 0, wins = 0, stops = 0, done = 0, running = [];
  const t0 = Date.now();
  try {
    for (let a = start; a < start + cases; a += CHUNK) {
      const batch = [];
      for (let n = a; n < Math.min(a + CHUNK, start + cases); n++) {
        const c = makeCase(n), r = playJs(c);
        ticks += r.ticks; deaths += r.deaths; wins += r.won ? 1 : 0; stops += r.stop ? 1 : 0;
        const { driver, ...plain } = c; batch.push({ ...plain, ...r });
      }
      const file = join(dir, `b${a}.jsonl`);
      writeFileSync(file, batch.map((x) => JSON.stringify({ ...x, hashEvery: HASH_EVERY })).join('\n') + '\n');
      const job = runPhp(file).then((res) => { mismatches = mismatches.concat(res); done += batch.length; process.stdout.write(`\r${done}/${cases} cases checked, ${mismatches.length} mismatches`); });
      running.push(job);
      if (running.length >= jobs) { await running.shift(); }
    }
    await Promise.all(running);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`\n${cases} cases (${start}..${start + cases - 1}), ${ticks} ticks, ${deaths} deaths, ${wins} wins, ${stops} runs stopped by step; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const m of mismatches.slice(0, 20)) console.log('MISMATCH', JSON.stringify(m));
  if (mismatches.length) console.log(`Reproduce one with: node tests/fuzz/run.mjs --case ${mismatches[0].n}`);
  process.exitCode = mismatches.length ? 1 : 0;
}

async function asJsonl(list) {
  const dir = mkdtempSync(join(tmpdir(), 'tw-fuzz-')), file = join(dir, 'one.jsonl');
  writeFileSync(file, list.map((x) => JSON.stringify({ ...x, hashEvery: HASH_EVERY })).join('\n') + '\n');
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
