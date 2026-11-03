---
name: sim-change
description: Workflow for any change to Tombwright game rules or the deterministic sim core (public/js/sim/, src/Sim/, docs/sim-rules.md, golden vectors). Use whenever a task touches movement, traps, foes, wiring, scoring, RNG, the sine table or state shape.
---

# Changing the sim core

Both cores must stay hash-identical (spec §6.3). Work in this order:

1. **Rule first.** Write or change the rule in `docs/sim-rules.md` with an id (`R-<AREA>-<n>`). Give exact integer formulas, units and edge cases. Port numbers from `reference/gloamhollow/Gloamhollow.html` and note the conversion (seconds → ticks at 30 Hz, metres → mm).
2. **JS core** (`public/js/sim/`): implement it and cite the rule id in a comment.
3. **PHP core** (`src/Sim/`): mirror it in the same order of operations. Watch PHP int → float overflow and `array_is_list`.
4. **Version:** bump `CORE_VERSION` in `sim.js` and `Sim.php` (`m0.1` → `m0.2`, …) if the hash of any existing vector changes.
5. **Vectors:** add a scripted vector to `tests/golden/generate.mjs` that exercises the new rule, then run `npm run golden:regen`.
6. **Check:**
   - `node scripts/check-sim-purity.mjs`
   - `npm test`
   - `vendor/bin/phpunit --filter SimParityTest`
7. **Review:** run the `sim-parity-reviewer` agent on the diff.
8. **Commit** the rules doc, both cores and the regenerated vectors together, and say in the message which rule changed and why the hashes moved.

Never regenerate vectors to make a failing PHP test pass. A mismatch means the cores disagree. Find the first mismatching tick (the vectors hold a hash every 300 ticks) and fix the core that is wrong.
