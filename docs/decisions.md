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
| 15 | 2026-11-04 | **Entities in the GDF:** decor that blocks walking is a `prop` from a fixed kind catalogue (`statue`, `stele`, `tree`, `post`, `plinth`, `lectern`, `sarcophagus`) with a position in mm and a yaw; the footprint per kind is fixed in `docs/sim-rules.md` (R-PROP-1), so authors can't place giant invisible walls. Slabs that were sprung before the run are `slab` entities on plate cells. The input's `target` = 1 + the entity's index in `entities` (0 = none); the sim re-checks reach only (2,600 mm, as in Gloamhollow), not facing. | Owner |
| 16 | 2026-11-04 | **Touch-stick speed:** the client maps the stick onto `move` with run held (deflection · 127 · 8/9 ≈ Gloamhollow's 4.8 m/s, 12 % dead zone). No sim or input-format change. | Owner |
| 17 | 2026-11-04 | **Vents in the GDF:** a `vent` entity lists its cells and its `period`, `phase`, `warn` and `fire` in ticks; every code-7 cell belongs to exactly one vent; the loader enforces fire ≤ 60 % of the period (spec §4.4). The cycle runs on the tick count, so it keeps going while the player is dead. | Owner |
| 18 | 2026-11-04 | **Rising:** the sim accepts the rise button from 51 ticks (1.7 s, Gloamhollow's death card) after a death, so every death costs the same time whatever the client's motion settings. | Owner |
| 19 | 2026-11-04 | **Modes at death:** in Ironman a death ends the run; `step` refuses the state afterwards, so the run log must end there. In Practice the rise's `target` = zone number picks any checkpoint reached this run (0 = the current one); Delve always rises at the current one. | Owner |
| 20 | 2026-11-04 | **Checkpoint reach:** a zone checkpoint is reached on entering the zone (`reach: "enter"`, the default) or only by a new `setCheckpoint` effect (`reach: "effect"`); Gloamhollow's Sanctum uses `effect`, fired when the boss falls. The sim doesn't enforce spec §4.4's "no lethal cell within one cell of a checkpoint spawn"; the publish validator (§7.3) checks it for the four orthogonal neighbours only, which Gloamhollow's Hall (34, 52) and Chasm (26, 5) spawns pass. Amends §4.3.4 (new effect) and §4.4. | Owner |
| 21 | 2026-11-04 | Commits are authored with `klingner@silverday.de`. | Owner |
| 22 | 2026-11-04 | **Pitch:** the input's int8 pitch maps linearly onto Gloamhollow's look range, ±1.2 rad (pitch_rad = 1.2·p/127). The client quantises its camera pitch on the same scale. Pebble range = clamp(6200 + idiv(6000·p, 127), 1600, 8500) mm. | Owner |
| 23 | 2026-11-04 | **Items:** an `item` entity of kind `flask`, `rubble` or `treasure` (with `value`), taken by interact within reach and line of sight (Gloamhollow 1.7 m, rubble 1.6 m). Rubble refills the pouch to 12 and stays. Item names stay client text for now; hidden items and keys come with their puzzles. | Owner |
| 24 | 2026-11-04 | **Waking eyes:** an `eyes` entity names a zone and a wake time in ticks (≥ 18, one per zone). Its meter is in state: +5 per tick with an open flame inside, −7 otherwise, death at 5·wake; it resets on rise. | Owner |

## Still open (spec §17)

Q1 async only · Q3 guest play · Q4 breached-password check (external API or local list) · Q5 user content licence ·
Q6 DSA scope (legal) · Q7 player rating · Q8 monetisation · Q9 name and domain · Q10 languages ·
Q11 foes and traps · Q12 bestiary tuning.
