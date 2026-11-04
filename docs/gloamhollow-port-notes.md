# Porting Gloamhollow (M0 working notes)

Source: `reference/gloamhollow/Gloamhollow.html` (one file, three.js r128 from a CDN).
These notes list what has to change for the sim core and for CSP. They are a checklist, not a spec;
the rules themselves go in `docs/sim-rules.md`.

## Logic that moves into the sim core (variable `dt` floats → fixed ticks, integers)

| Gloamhollow | Values | Sim-core note |
|---|---|---|
| `updatePlayer` | walk 3.2, run 5.4, stick 4.8·m m/s; velocity lerp `min(1, dt·12)`; arrows turn 2.1 rad/s | Done provisionally (R-MOVE-*). Arrow turning becomes client-side yaw input |
| `pushCircle` | player radius 0.36 m, 3 iterations, cells + circle/box obstacles + foes | Done for cells, doors, old slabs and decor props (R-MOVE-4, R-PROP-*). Bells, mirrors, chests and braziers bring their footprints with them; foes later |
| `checkTraps` | the "inner" test: 0.12–0.88 of the cell | Done for plates, pits, void and vents (R-TRAP-1: 288 < offset < 2112 mm). Weep/laugh alcoves come with the mask doors |
| `ventState` | period 3.6 s, warn 0.9 s, fire 1.1 s, phases 0 / 1.2 / 2.4 s | Done: `vent` entities, 108 / 27 / 33 ticks, phases 0 / 36 / 72, on the tick count (R-VENT-*) |
| Waking eyes | wake when the lantern is lit in the gallery; die at 1.0 s; decay ×1.4 | Done: `eyes` entity, meter +5 / −7 per tick, death at 5·30 (R-EYES-*) |
| Oil | burn 0.08/s open, 0.025/s hooded; flask +60; rise with oil ≥ 50 | Done (R-OIL-*, flasks as items) |
| Health | regen 4/s after 5 s unhurt | Done (R-HP-*): 1/30-hp units, +4 a tick after 150 calm ticks; damage via links |
| Pebbles | range `clamp(6.2 + pitch·5, 1.6, 8.5)` m, 0.12 m march, flight `0.35 + d·0.05` s | Done (R-PEB-*): int8 pitch = ±1.2 rad (decision #22); flight in whole ticks; pick-up 0.75 m; rubble refills to 12 |
| Probe | reach 2.05 m (2.6 m if still in your own cell), 8-step wall check | Done (R-PROBE-*); the gilded chest's needles come with chests |
| Foes | warden 3 hp/14 dmg/2.2 m/s; crawler 2/9/2.9; wind-up and cooldowns | Done (R-FOE-*, bestiary.v1.json): spec §4.9 senses and BFS pathing around Gloamhollow's numbers; `ph` stays visual |
| Boss | 6 hp, solid within 3.6 m of a lit brazier, phase 2 at ≤ 3 hp, oil drain | Done (R-BOSS-*, bestiary `bosses.eater`); braziers R-BRAZIER-*; the Heart and the shaft R-EXIT-1 |
| `later()` / `setTimeout` in rules (`strike` 110 ms, bell 0.65 s / 0.9 s, mask doors 1.5–2.6 s) | | Bells done as link delays (20 / 27 ticks, R-LINK-7, decision #31); mask doors with 5c, strike with 5d |
| Door animation `anim < 0.85` gates collision | open 1.1 s, close 0.7 s | Opening done (R-DOOR-*: 33 ticks, passable from tick 29). Closing comes with seal/close effects |
| Interactions `nearestInteract` | dot ≥ 0.45, score `dot·2 − d·0.6 + pri·0.4` | Client picks and sends `target` (entity number); the sim re-checks reach only (R-ACT-1). Done for interact doors |

## CSP blockers in the current file (spec §11.4)

- Inline `<style>` and `<script>` blocks → external files.
- `style="font-size:15.5px"` on the notes lede (line 250).
- `element.style.*` writes and `style.setProperty('--v', …)`: allowed under CSP (CSSOM, not inline attributes), but check against the AGENTS rules.
- `innerHTML` with `esc()` in `toast`, `hud`, death and win summaries → `textContent`, or build the nodes.
- Google Fonts and the cdnjs three.js → self-host (check the font licences first).
- three.js r128 → current pinned release; `outputEncoding`/`texture.encoding` → `outputColorSpace`/`colorSpace` (r152).

## Test hook

`window.__gh` exposes state and `sim(sec)`, which steps `tick(1/30)` with rendering off (`window.__ghNoRender`).
Keep an equivalent hook for the Playwright walkthroughs (spec §15). `tests/e2e/gloamhollow-walkthrough.spec.mjs` uses `__gh.sim`, `player`, `keys`, `nearestInteract`, `interact`, `probe`, `throwPebble`, `toggleHood`, `pourOil`, `attack`, `rise`, `newGame`, `closePanel`, `ventState`, `G`, `L`, `CP`, `STATS`, `mode`, `mons`, `boss` and `eyeWake`. The ported client must keep all of them, or the driver must be adapted in the same change.

Two real-time timers still sit in game logic and the walkthrough has to wait for them: the 110 ms strike delay (`setTimeout(strike)`) and the death card. The death card is now a sim rule: rise is accepted from 51 ticks after the death (R-RISE-1). The strike delay must still become tick-scheduled.

Checkpoints, death and rising are done (R-CP-*, R-DEATH-*, R-RISE-1): Gloamhollow's `G` becomes the checkpoint's `life`, `L` becomes the lesson lists `sprung` and `pits`. The Sanctum checkpoint waits for the `setCheckpoint` effect (decision #20).

Bells and wiring (step 5a): `ringBell` becomes `bell` / `bellSet` entities (R-BELL-*) and links (R-LINK-*): solved → grate after 27 ticks; wrong → 28 damage after 20 ticks (repeat). The second failure's wardens (`sequence` of two `bellsWrong`) come with foes in 5d. The locked-door and door-opening texts are `message` links on `interact`.

Mirror Vault (step 5b): `HOOK`, `MIRRORS`, `CRYSTAL` become `lampHook`, `mirror` and `crystal` entities (R-HOOK-*, R-MIRROR-*, R-CRYSTAL-1); `buildBeam` becomes R-BEAM-1, traced from the state whenever `beamHits` is read; `solveMirrors` is link 8 (open the vault, reveal the hidden sun-opal, Gloamhollow's text). `G.hung` is `player.hung`; leaving the vault while it hangs is undone (R-HOOK-3). The crawlers that wake on the first hanging come with foes in 5d.

Chests, keys and masks (step 5c): `openGilded` / `openPlain` / `gildedInReach` become `chest` entities (R-CHEST-*) holding item entities `in` them (the rubies; the crescent key and a flask); the first press on the gilded chest only looks. The sleeping-face door is a `key` door (R-DOOR-1); the weeping and laughing doors open on touch. `weepTrap` / `laughTrap` become `alcove` entities (R-ALCOVE-*): stepping in kills (`drown`, `tip`), a pebble sets either off, the probe only `tip`; the door seals at once and closes 45 / 78 / 66 ticks later. Gloamhollow's texts are links 9–16.

Foes and combat (step 5d): `FOES`, `spawnFoe`, `updateFoes`, `attack` / `strike` become the bestiary file, `foe` entities and R-FOE-* / R-STRIKE-* (decisions #39–#46). Gloamhollow's foes chase in a straight line; Tombwright's follow a breadth-first field round walls and lethal cells, which reaches the player the same way in the Garden and the Vault. The 110 ms strike delay is now 3 ticks (no real-time timers left in the rules). Links 3 and 17–20 raise the keepers and the crawlers and say when they fall.

The Sanctum (step 5e): `spawnBoss` / `wakeBoss` / `updateBoss` / `bossHit` / `killBoss` become the `boss` entity and R-BOSS-* (decisions #48, #51), with her numbers in the bestiary; `lightBrazier` is a 30-tick busy spell (R-BRAZIER-2, decision #49); `takeHeart` / `winGame` are the hidden Heart (revealed by link 22, which also sets the Sanctum checkpoint) and `exit.requires: "heart"` (R-EXIT-1, decision #50). Deviations: she wakes on entering the Sanctum (link 21) rather than 0.6 m past row 22's middle; her box is her zone's bounding box inset by 700 mm on all sides (Gloamhollow: 0.9 m on the north side); the Heart is taken within 1.7 m (item reach) instead of 2.5 m.

Dressing (core m0.11, decision #56): Gloamhollow's `TORCHES`, `TEXTS` (verbatim, with where each is read), the masons' marks (`HALL_PAT` '.'), the bones, scorch, candles and sealed stair, and `ZONE_TINT` / the Scriptorium's shelves are GDF entities and zone keys (R-DRESS-*), appended after the rules entities so entity numbers don't move. The client reads them from the GDF; the sim ignores them.

The client (step 6): `public/js/game/` renders the sim state with Gloamhollow's renderer (6a) and its panels, cards, map, touch controls and sounds (6b). One deviation: Gloamhollow's save put you back at the last checkpoint with its snapshot; the client may not edit sim state, so it saves the whole sim state (localStorage, with the core version and world id) and a delve resumes exactly where it was left, including a pending death card. Saved delves from another core version are discarded.
