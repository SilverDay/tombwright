# Decisions log

Settled answers to the spec's open questions (spec §17), and other project-level choices.
Add a row whenever something is decided; never edit an old row, supersede it.

| # | Date | Decision | Source |
|---|---|---|---|
| 1 | 2026-11-03 | **Verifier runtime (Q2):** PHP re-implementation of the sim core. Two cores, kept in lockstep by golden vectors and a differential fuzzer. | Owner |
| 2 | 2026-11-03 | **Versions:** PHP 8.3 and MariaDB 10.11 LTS (security support to Feb 2028). Code must not need 8.4 features. | Owner |
| 3 | 2026-11-03 | **Licence:** MIT for engine and server code. | Owner |
| 4 | 2026-11-03 | `FOR UPDATE SKIP LOCKED` verified to work on MariaDB 10.11.14 (spec §8.3). | Tested in the dev container |
| 5 | 2026-11-03 | `Sim.hash` is synchronous in the browser, so the JS core ships its own SHA-256 (tested against `node:crypto`). | Implementation |
| 6 | 2026-11-03 | **Gloamhollow reference licence:** `reference/gloamhollow/Gloamhollow.html` is MIT. | Owner |
| 7 | 2026-11-03 | **Copyright holder:** SilverDay Media (`LICENSE`, `REUSE.toml`). | Owner |
| 8 | 2026-11-03 | The original "80-check walkthrough" could not be found. It is replaced by `tests/e2e/gloamhollow-walkthrough.spec.mjs` (94 checks, stair to daylight, one deliberate death). The M0 exit criterion becomes "the Gloamhollow walkthrough passes". | Owner |
| 9 | 2026-11-03 | `three@0.128.0` is a pinned devDependency, used only by the e2e test to serve the r128 build that `Gloamhollow.html` loads from cdnjs (no network in tests). The client's vendored three.js is a separate decision. | Owner |

## Still open (spec §17)

Q1 async only · Q3 guest play · Q4 breached-password check (external API or local list) · Q5 user content licence ·
Q6 DSA scope (legal) · Q7 player rating · Q8 monetisation · Q9 name and domain · Q10 languages ·
Q11 foes and traps · Q12 bestiary tuning.

Raised during M0:
- Touch-stick speed (see `docs/sim-rules.md`, Movement).
