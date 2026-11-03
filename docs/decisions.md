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
| 10 | 2026-11-03 | **Sim contract:** the static map is a separate immutable world: `Sim.load(gdf)`, `init(world, seed, mode)`, `step(world, state, input)`. State holds only what changes plus the world id (SHA-256 of the canonical GDF), so hashes stay small and a state can't be replayed against another tomb. Amends spec §6.3. | Owner |
| 11 | 2026-11-03 | **GDF `grid.cells`:** strict base64 of run-length pairs `[count 1–255, code 0–8]` (spec §7.1 left the RLE scheme open). | Owner |
| 12 | 2026-11-03 | `start.cell` is the spawn cell and must be floor. Gloamhollow's GDF starts at the Vestibule checkpoint (34, 60); the sealed stair (34, 61) is a wall cell (the spec §7.1 example's `[34,61]` was illustrative). Official tombs live in `dungeons/`. | Implementation |
| 13 | 2026-11-03 | Work is committed straight to `main` once the tests pass. | Owner |
| 14 | 2026-11-03 | The Gloamhollow walkthrough adds one deliberate death per trap kind (slab, eyes, pit, vent, needles, chasm) and checks what each death rolls back and what the tomb remembers: 112 checks, 6 deaths. Supersedes the counts in #8. | Owner |

## Still open (spec §17)

Q1 async only · Q3 guest play · Q4 breached-password check (external API or local list) · Q5 user content licence ·
Q6 DSA scope (legal) · Q7 player rating · Q8 monetisation · Q9 name and domain · Q10 languages ·
Q11 foes and traps · Q12 bestiary tuning.

Raised during M0:
- Touch-stick speed (see `docs/sim-rules.md`, Movement).
