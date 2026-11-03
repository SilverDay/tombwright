# Porting Gloamhollow (M0 working notes)

Source: `reference/gloamhollow/Gloamhollow.html` (one file, three.js r128 from a CDN).
These notes list what has to change for the sim core and for CSP. They are a checklist, not a spec;
the rules themselves go in `docs/sim-rules.md`.

## Logic that moves into the sim core (variable `dt` floats → fixed ticks, integers)

| Gloamhollow | Values | Sim-core note |
|---|---|---|
| `updatePlayer` | walk 3.2, run 5.4, stick 4.8·m m/s; velocity lerp `min(1, dt·12)`; arrows turn 2.1 rad/s | Done provisionally (R-MOVE-*). Arrow turning becomes client-side yaw input |
| `pushCircle` | player radius 0.36 m, 3 iterations, cells + circle/box obstacles + foes | Next: integer circle-vs-AABB with `isqrt` |
| `checkTraps` | the "inner" test: 0.12–0.88 of the cell | Plates, pits, void, vents, weep/laugh alcoves |
| `ventState` | period 3.6 s, warn 0.9 s, fire 1.1 s, phases 0 / 1.2 / 2.4 s | 108 / 27 / 33 ticks; phases 0 / 36 / 72 |
| Waking eyes | wake when the lantern is lit in the gallery; die at 1.0 s; decay ×1.4 | 30 ticks; spec floor is ≥ 0.6 s |
| Oil | burn 0.08/s open, 0.025/s hooded; flask +60; rise with oil ≥ 50 | Done (R-OIL-*) |
| Health | regen 4/s after 5 s unhurt | |
| Pebbles | range `clamp(6.2 + pitch·5, 1.6, 8.5)` m, 0.12 m march, flight `0.35 + d·0.05` s | Pitch now int8, so the mapping needs a rule |
| Probe | reach 2.05 m (2.6 m if still in your own cell), 8-step wall check | |
| Foes | warden 3 hp/14 dmg/2.2 m/s; crawler 2/9/2.9; wind-up and cooldowns | `ph: Math.random()` is visual only; leave it out of state |
| Boss | 6 hp, solid within 3.6 m of a lit brazier, phase 2 at ≤ 3 hp, oil drain | |
| `later()` / `setTimeout` in rules (`strike` 110 ms, bell 0.65 s / 0.9 s, mask doors 1.5–2.6 s) | | Tick-scheduled events in state (spec §6.2) |
| Door animation `anim < 0.85` gates collision | | Door open/close needs a tick-based state machine |
| Interactions `nearestInteract` | dot ≥ 0.45, score `dot·2 − d·0.6 + pri·0.4` | Client sends `target`; the server re-checks reach |

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

Two real-time timers still sit in game logic and the walkthrough has to wait for them: the 110 ms strike delay (`setTimeout(strike)`) and the death card. Both must become tick-scheduled in the sim core.
