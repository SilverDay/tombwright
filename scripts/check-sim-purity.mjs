#!/usr/bin/env node
// Guards the determinism rules (docs/sim-rules.md) with a static scan of both sim cores.
// Exit 2 (with reasons on stderr) on a violation, so a Claude Code PostToolUse hook
// feeds the message straight back to the agent. Also run in CI.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rules = [
  { dir: 'public/js/sim', ext: '.js', banned: [
    [/\bMath\.(random|sin|cos|tan|asin|acos|atan2?|hypot|pow|exp|log\d*|cbrt|fround)\b/, 'float maths / Math.random (use int.js, sine.js, rng.js)'],
    [/\b(Date|performance)\s*[.(]/, 'wall-clock time'],
    [/\b(document|window|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame)\b/, 'DOM or timers'],
    [/\bcrypto\.subtle\b/, 'async crypto (Sim.hash must be synchronous)'],
    [/\bparseFloat\b|\.toFixed\(/, 'float parsing / formatting'],
    [/\*\*\s*0?\.\d|\d\.\d+/, 'float literal'],
  ] },
  { dir: 'src/Sim', ext: '.php', allow: ['IntMath.php'], banned: [
    [/(?<![\w:>$]|function\s+)\b(sin|cos|tan|asin|acos|atan2?|hypot|pow|exp|log\d*|sqrt|fmod|round|floor|ceil)\s*\(/, 'float maths'],
    [/\b(rand|mt_rand|random_int|lcg_value|mt_srand|srand|uniqid)\s*\(/, 'non-seeded randomness'],
    [/\b(microtime|hrtime|time|date)\s*\(/, 'wall-clock time'],
    [/\(float\)|\bfloatval\s*\(|\d\.\d+/, 'float cast / literal'],
  ] },
];

const problems = [];
function walk(dir, ext, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out); else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
for (const r of rules) {
  for (const file of walk(join(ROOT, r.dir), r.ext)) {
    if (r.allow?.some((a) => file.endsWith(a))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line
        .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''") // string literals
        .replace(/\/\/.*$|^\s*\*.*$|^\s*\/\*.*$|#.*$/, '');                             // comments
      for (const [re, why] of r.banned) if (re.test(code)) problems.push(`${relative(ROOT, file)}:${i + 1}: ${why}: ${line.trim()}`);
    });
  }
}
if (problems.length) {
  console.error('Sim purity check failed (docs/sim-rules.md):\n' + problems.join('\n'));
  process.exit(2);
}
console.log('sim purity: ok');
