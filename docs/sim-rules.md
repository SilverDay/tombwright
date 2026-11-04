# Sim rules (normative)

This file is the single specification both sim cores implement (spec §6.4, point 4).
`public/js/sim/` and `src/Sim/` cite these rule ids in comments. A change here needs the
same change in both cores, regenerated golden vectors, and a `CORE_VERSION` bump.

Status: **M0 draft**. Rules marked *provisional* will change while Gloamhollow is ported.

## Numbers

- **R-INT-1** Every number in sim state is an integer in [−(2⁵³−1), 2⁵³−1]. No floats, ever.
- **R-INT-2** Every intermediate product stays inside that range too. Bound it in a comment next to any multiplication of two non-constant values.
- **R-INT-3** Division truncates toward zero (`intdiv` in PHP, `idiv` in JS). Division by zero is an error, not a value.
- **R-INT-4** `isqrt(n)` = ⌊√n⌋ exactly, for 0 ≤ n ≤ 2⁵³−1 (an approximate root, then integer correction).
- **R-INT-5** `fdiv(a, b)` = ⌊a / b⌋ (rounds toward −∞). Used for cell indices: cell = fdiv(mm, 2400).
- **R-UNIT-1** Positions are in millimetres; one cell = 2,400 mm. Cell (i, j) spans x ∈ [2400·i, 2400·i+2400), z likewise. i runs west→east, j runs north→south (Gloamhollow's grid).

## Angles and trig

- **R-TRIG-1** Angles are integers; 4,096 units per full turn. Yaw 0 faces north (−z), and yaw increases counter-clockwise seen from above (Gloamhollow's convention).
- **R-TRIG-2** `sin(a)` = `SINE[a mod 4096]`, scaled by 2¹⁴. The table is `public/js/sim/data/sine4096.bin` (4,096 × int16 LE). Both cores refuse to start unless its SHA-256 equals `SINE_SHA256`. `cos(a) = sin(a + 1024)`.
- **R-TRIG-3** The table was generated once by `bin/gen-sine-table.mjs` (round(sin(2πi/4096)·2¹⁴), exact at the quarter points). Regenerating it is a rules change.

## Randomness

- **R-RNG-1** xoshiro128** on four uint32 words, every operation masked to 32 bits.
- **R-RNG-2** Seeding from a uint32 seed s: z₀ = s; zᵢ₊₁ = zᵢ + 0x9E3779B9 (mod 2³²); wordᵢ = fmix32(zᵢ₊₁) (MurmurHash3 finaliser). An all-zero state becomes [1, 0, 0, 0].
- **R-RNG-3** `below(n)` for 1 ≤ n ≤ 65,536 = ⌊next() · n / 2³²⌋.
- **R-RNG-4** *(from M1)* Draws happen in a fixed order per tick: player, then foes by ascending id, then links by ascending id (spec §4.9.5).

## World (the static map)

The contract is `world = Sim.load(gdf)`, `state = Sim.init(world, seed, mode)`, `events = Sim.step(world, state, input)`, `hash = Sim.hash(state)` (decision #10). The world is immutable and is not hashed; the state names it.

- **R-GDF-0** `Sim.load` takes the GDF file's bytes, never a parsed object, so both cores read the same values. The bytes must be UTF-8 with no BOM, at most 262,144 bytes, nested at most 12 deep (spec §7.2), and every number must be a plain integer literal (`-?(0|[1-9][0-9]*)`, not `-0`; no `.`, `e`, `E`). Objects stay objects: an empty object or a key outside R-CANON-3 is rejected, and the top level must be an object. Integers outside R-INT-1 are rejected.
- **R-GDF-1** `grid.w`, `grid.h` are integers in [3, 64]. Cells are row-major: index = j·w + i.
- **R-GDF-2** `grid.cells` is strict standard base64 (RFC 4648 §4): length a multiple of 4, `=` only as final padding, padding bits zero. Anything else is rejected.
- **R-GDF-3** The decoded bytes are run-length pairs `[count, code]`: count in [1, 255], code in [0, 8] (spec §7.1 cell codes). The runs must cover exactly w·h cells (decision #11).
- **R-WORLD-1** Every border cell is wall (code 0), so the sim never reaches a position outside the grid.
- **R-WORLD-2** The player spawns at the centre of `start.cell`, which must be room (1) or corridor (2), facing yaw 0. In Gloamhollow that is the Vestibule checkpoint (34, 60); the sealed stair (34, 61) is wall (decision #12).
- **R-WORLD-3** World id = the first 16 bytes of SHA-256 over the canonical GDF (R-CANON-*), as 32 lower-case hex characters. `init` stores it as `state.world`; `step` refuses a state whose `world` differs, and one whose `core` isn't this core's `CORE_VERSION` (an older state has another shape).
- **R-WORLD-4** The world can't be changed after load (the JS core keeps the grid out of reach; `init` and `step` refuse anything `load` didn't build). Anything that changes during play (doors, sprung slabs) lives in state.

## Zones and checkpoints

- **R-ZONE-1** `zones` is optional; when present it is a list of at most 16 objects with keys `id` (as R-ENT-1, unique among zones), `name` (a string), `rects`, `ceil` and optionally `checkpoint`; nothing else. `rects` holds 1–8 rectangles `[x, y, w, h]` with w, h ≥ 1, inside the grid. No cell lies in two zones (spec §7.3). `ceil` is an integer in [3000, 6500] mm (spec §4.2). A cell's zone is the zone whose rect holds it, or none.
- **R-ZONE-2** `checkpoint` has keys `cell`, `yaw` (0–4095) and optionally `reach` (`"enter"`, the default, or `"effect"`). At most 12 zones have one. The cell lies in its own zone, is room or corridor, holds no door or slab, and no prop footprint covers it (R-PROP-2).
- **R-CP-1** `state.checkpoints` lists the checkpoints reached this run, `{ zone, x, z, yaw, life }`, in the order they were first reached; `state.cp` is the index of the current one. `init` puts in one entry: zone = the zone of `start.cell` (−1 if none), the start cell's centre, yaw 0, and the initial life (R-CP-3). `state.cp` = 0.
- **R-CP-2** Each tick after the doors move (R-DOOR-3), if the player's cell is in zone Z, Z has a checkpoint with reach `enter`, and Z's index is greater than the current checkpoint's zone (Gloamhollow's forward-only `cpOrder`), the player reaches it: the entry for Z is replaced, or appended if there is none, with the checkpoint cell's centre, its yaw and the current life; `state.cp` points to it; the step emits `{ e: "checkpoint", zone: id }`. Reach `effect` checkpoints are reached only by a `setCheckpoint` effect (with links, decision #20).
- **R-CP-3** A *life* is what a death rolls back (Gloamhollow `G`): `{ hp, oil, hooded, doors }`, with `doors` the list of each door's `open`. Lessons are what a death keeps (Gloamhollow `L`, spec §3): `state.sprung` (plates sprung during play) and `state.pits` (hidden pits found), cell indices in the order found.

## Traps and death

- **R-TRAP-1** After the checkpoint check, the trap test looks at the player's cell (i, j) = (fdiv(x, 2400), fdiv(z, 2400)) and the offsets lx = x − 2400·i, lz = z − 2400·j. Only the *inner* part of a cell is armed: 288 < lx < 2112 and 288 < lz < 2112 (Gloamhollow's 0.12–0.88 of the cell). In the inner part:
  - plate (3) with no slab (R-SLAB-1) and not in `state.sprung`: the cell is appended to `state.sprung` and the player dies of `slab`;
  - hidden pit (4): the cell is appended to `state.pits` unless already there, and the player dies of `pit`;
  - void (5): the player dies of `chasm`;
  - vent (7) whose vent is firing (R-VENT-2): the player dies of `vent`.
  Room, corridor, bridge (6) and alcove (8) cells are safe. *(Alcove traps come with the mask doors.)*
- **R-TRAP-2** Cells in `state.sprung` are solid (R-MOVE-4), like slabs.
- **R-VENT-1** Vent keys: `id`, `type` (`vent`), `cells` (1–64 cells, each code 7), `period` (2–1800 ticks), `phase` (0 … period − 1), `warn` (≥ 0) and `fire` (≥ 1), with warn + fire ≤ period and 5·fire ≤ 3·period (fire at most 60 % of the period, spec §4.4). Every code-7 cell belongs to exactly one vent (decision #17).
- **R-VENT-2** On the step that starts at tick n (`state.tick` before it advances), u = (n + phase) mod period. The vent warns while u < warn and fires while warn ≤ u < warn + fire. Gloamhollow: period 108, warn 27, fire 33 (3.6 / 0.9 / 1.1 s), phases 0, 36, 72 (0 / 1.2 / 2.4 s). Vents keep their cycle while the player is dead.
- **R-DEATH-1** Dying sets `state.dead = { cause, at: n }` (n as in R-VENT-2), adds 1 to `state.deaths`, sets the velocity and the remainders to 0, and emits `{ e: "death", cause }`. The rest of that step (hood, oil) is skipped. Causes so far: `slab`, `pit`, `chasm`, `vent`.
- **R-DEATH-2** While dead, a step does only this: R-RISE-1, then the doors move (R-DOOR-3, which never stops). No movement, interact, hood, oil burn, checkpoints or traps. `state.prevButtons` still updates and `state.tick` still advances.
- **R-DEATH-3** Ironman: after a death the run is over. `step` refuses a state with `dead` set in mode `ironman` (decision #19).
- **R-RISE-1** Rise (button 7) on its rising edge, on a step whose n ≥ at + 51 (1.7 s, Gloamhollow's death card, decision #18): pick the checkpoint. In `practice`, a target N ≠ 0 picks the entry with zone N − 1; if there's none, nothing happens. Otherwise (delve, or target 0) it's `state.cp`. Then: `state.cp` = that entry; the life comes back (hooded, doors' `open`; each door's t = 693 if open, else 0); hp = 100; oil = max(life.oil, 50 · 30000); the player stands at the entry's x, z with its yaw, pitch 0, velocity and remainders 0; `state.dead` = null; the step emits `{ e: "rise", zone }` (the zone's id, or null for −1). Nothing else happens on that step besides R-DEATH-2's door movement. Lessons stay.

## Entities (the placed things)

- **R-ENT-1** `entities` is optional; when present it is a list of at most 400 objects. Each has `id` (a string matching `^[A-Za-z_][A-Za-z0-9_]{0,31}$`, unique in the file) and `type`. The core knows the types `door`, `slab`, `prop` and `vent`; any other type is rejected (types are added as the core learns them). Each type allows exactly the keys listed below: a missing key or any other key is rejected.
- **R-ENT-2** `cell` is `[i, j]`, two integers inside the grid. At most one door or slab per cell.
- **R-ENT-3** An entity's *number* is 1 + its index in `entities`. The input's `target` names an entity by number; 0 names none (decision #15).
- **R-DOOR-1** Door keys: `id`, `type`, `cell`, `style` (`stone`, `grate` or `mask`), `opens` (`interact` or `trigger`) and, only when the style is `mask`, `face` (`weep`, `laugh`, `sleep` or `blank`). The cell must be room or corridor and must not be `start.cell`. *(Opening by key id comes with keys.)*
- **R-DOOR-2** `state.doors` holds one `{ open, t }` per door, in entity order; `init` sets `open: false, t: 0`. `t` ∈ [0, 693] is how far the door has moved (693 = 33 · 21).
- **R-DOOR-3** Each tick, after the movement (or, while dead, after R-RISE-1), every door with `open` and t < 693 moves on: t = min(693, t + 21). From the press it takes 33 ticks to open fully (Gloamhollow: 1.1 s). *(Closing (0.7 s, 21 ticks) comes with the effects that close or seal doors.)*
- **R-DOOR-4** A door's cell is solid while 20·t < 17·693 (Gloamhollow: solid while `anim` < 0.85). A door opened on tick n stops blocking on tick n + 29.
- **R-ACT-1** Interact (button 5) on its rising edge, before movement, with `target` = N ≠ 0: if entity N exists, is a door with `opens: "interact"` that isn't open, and (x − cx)² + (z − cz)² ≤ 2600² for the door cell's centre (cx, cz) and the player's position before this tick's move, the door's `open` becomes true and the step emits `{ e: "door", id, open: true }`. Anything else does nothing: no error, no event. Facing isn't checked; choosing what to highlight is the client's job (Gloamhollow `nearestInteract`: reach 2.6 m, no line of sight).
- **R-SLAB-1** Slab keys: `id`, `type`, `cell`. A slab lies on a plate cell (code 3) that was sprung before the run began (Gloamhollow `PRE_SLABS`). Its cell is solid. Plates sprung during play are lessons in `state.sprung` (R-TRAP-1).
- **R-PROP-1** Prop keys: `id`, `type`, `kind`, `pos` (`[x, z]` in mm, integers with 0 ≤ x ≤ 2400·w and 0 ≤ z ≤ 2400·h) and `yaw` (0–4095). A prop is decor that blocks walking. Its footprint is fixed by its kind (Gloamhollow `addCircle` / `addBox`):

  | kind | footprint |
  |---|---|
  | `statue` | circle r 500 |
  | `stele` | circle r 550 |
  | `tree` | circle r 450 |
  | `post` | circle r 160 |
  | `plinth` | circle r 500 |
  | `lectern` | circle r 500 |
  | `sarcophagus` | box, half-extents 750 (x) × 1150 (z); at yaw 1024 or 3072 the half-extents swap |

  A box prop's yaw must be a multiple of 1024. A circle's yaw is only for the renderer.
- **R-PROP-2** The footprint's bounding square or box [x0, x1] × [z0, z1] (x0 = x − r, x1 = x + r, or x ∓ the half-extent) covers the cells fdiv(x0, 2400) … fdiv(x1 − 1, 2400), and the same for z. Every one of those cells must be inside the grid, must not be wall, a door cell, a slab cell, `start.cell` or a checkpoint cell.

## State, hash, input

- **R-CANON-1** Canonical form: JSON with keys sorted by byte order, no whitespace, integers in plain decimal (−0 → 0), `true`/`false`/`null`.
- **R-CANON-2** Strings: `"` → `\"`, `\` → `\\`, U+0000–U+001F → `\u00xx` (lower-case hex); everything else is raw UTF-8. Invalid UTF-8 or lone surrogates are errors.
- **R-CANON-3** Object keys match `^[A-Za-z_][A-Za-z0-9_]*$` (so PHP never turns a key into an int).
- **R-CANON-4** No empty objects in sim state (PHP can't tell `{}` from `[]`). Use a list or leave the key out.
- **R-HASH-1** `hash(state)` = the first 16 bytes of SHA-256(canonical(state)), as 32 lower-case hex characters.
- **R-INPUT-1** Input per tick: `move` [fw, strafe] ∈ [−127, 127]², `yaw` ∈ [0, 4095], `pitch` ∈ [−127, 127], `buttons` uint16, `target` uint16. Anything else is rejected **before** state changes.
- **R-INPUT-2** Buttons are levels. An action fires on its rising edge (pressed now, not on the previous tick). Bits: 0 strike, 1 hood, 2 probe, 3 pebble, 4 oil, 5 interact, 6 run, 7 rise.

## Movement *(provisional)*

- **R-MOVE-1** Walk 3,200 mm/s, run 5,400 mm/s (Gloamhollow).
- **R-MOVE-2** If fw² + strafe² > 127², scale both by 127/isqrt(fw² + strafe²) (truncating).
- **R-MOVE-3** Target velocity: tx = speed·(−sin·fw + cos·strafe) / (127·2¹⁴), tz = speed·(−cos·fw − sin·strafe) / (127·2¹⁴). Velocity eases by `v += (t − v)·2/5` per tick (Gloamhollow's `min(1, dt·12)` at 30 Hz). Position moves by `(v + r) / 30` and keeps the exact remainder r, so no distance is lost.
- **R-MOVE-4** Collision (Gloamhollow `pushCircle`). The player is a circle of radius r = 360 mm. After the move of R-MOVE-3, run 3 passes. Each pass computes (ci, cj) = (fdiv(x, 2400), fdiv(z, 2400)) once, then visits dj = −1, 0, 1 and, inside that, di = −1, 0, 1. For each solid cell (gi, gj) = (ci+di, cj+dj): qx = clamp(x, 2400·gi, 2400·gi+2400), qz = clamp(z, 2400·gj, 2400·gj+2400), dx = x − qx, dz = z − qz, d2 = dx² + dz².
  If d2 = 0 (the centre is in or on the cell), x, z go back to the position before this tick's move. Else if d2 < r²: d = isqrt(d2), x = qx + idiv(dx·r, d), z = qz + idiv(dz·r, d). Later cells in the same pass see the updated x, z. Velocity and remainders are not changed. Bounds: |dx|, |dz| ≤ 2,760, so every product stays below 2²³.
  Solid cells: outside the grid, wall cells, door cells while R-DOOR-4 holds, slab cells and cells in `state.sprung` (R-TRAP-2).
  After the nine cells, the same pass visits every prop in entity order (Gloamhollow's `obstacles`):
  - Circle of radius ρ at (px, pz): dx = x − px, dz = z − pz, d2 = dx² + dz², R = r + ρ. If 0 < d2 < R²: d = isqrt(d2), x = px + idiv(dx·R, d), z = pz + idiv(dz·R, d).
  - Box [x0, x1] × [z0, z1]: qx = clamp(x, x0, x1), qz = clamp(z, z0, z1), dx = x − qx, dz = z − qz, d2 = dx² + dz². If 0 < d2 < r²: d = isqrt(d2), x = qx + idiv(dx·r, d), z = qz + idiv(dz·r, d).
  - d2 = 0 does nothing for props (Gloamhollow only resets for cells).
  Bounds: |dx|, |dz| ≤ 64 · 2400, so d2 < 2³⁶; a push needs d2 < R² ≤ 910², so dx·R < 2²⁰.
  *(Later in M0: foes.)*
- **R-MOVE-5** The sim has no touch-stick speed. The client maps a touch stick onto `move` with run held: move = deflection · 127 · 8/9 (5.4 m/s · 8/9 = Gloamhollow's 4.8 m/s), after a 12 % dead zone (decision #16).

## Lantern *(provisional)*

- **R-OIL-1** 1 oil point = 30,000 units (100 points = full). Burn per tick: 80 open, 25 hooded (0.08 / 0.025 points/s).
- **R-OIL-2** Hood toggles on the press, only if oil > 0. At oil 0 the lantern goes out and un-hoods.
