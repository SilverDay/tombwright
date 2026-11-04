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
- **R-ZONE-3** After R-CP-2, if the player's cell is in a different zone from `state.zone` (−1 for none), the link events `leaveZone(old)` (if old ≥ 0) and then `enterZone(new)` (if new ≥ 0) happen, and `state.zone` = new. `init` sets `state.zone` to the start cell's zone.
- **R-CP-2** Each tick after the doors move (R-DOOR-3), if the player's cell is in zone Z, Z has a checkpoint with reach `enter`, and Z's index is greater than the current checkpoint's zone (Gloamhollow's forward-only `cpOrder`), the player reaches it: the entry for Z is replaced, or appended if there is none, with the checkpoint cell's centre, its yaw and the current life; `state.cp` points to it; the step emits `{ e: "checkpoint", zone: id }`. Reach `effect` checkpoints are reached only by a `setCheckpoint` effect (with links, decision #20).
- **R-CP-3** A *life* is what a death rolls back (Gloamhollow `G`): `{ hp, oil, hooded, flasks, pebbles, doors, floor, taken, bellSets, links }`, with `doors` the list of each door's `open`, and copies of `state.floor`, `state.taken`, `state.bellSets` and `state.links`. Lessons are what a death keeps (Gloamhollow `L`, spec §3): `state.sprung` (plates sprung during play), `state.pits` (hidden pits found), `state.marked` (plates found with the probe) and `state.bridge` (bridge cells found), cell indices in the order found, and `state.sealed` (R-DOOR-5).

## Traps and death

- **R-TRAP-1** After the checkpoint check, the trap test looks at the player's cell (i, j) = (fdiv(x, 2400), fdiv(z, 2400)) and the offsets lx = x − 2400·i, lz = z − 2400·j. Only the *inner* part of a cell is armed: 288 < lx < 2112 and 288 < lz < 2112 (Gloamhollow's 0.12–0.88 of the cell). In the inner part:
  - plate (3) with no slab (R-SLAB-1) and not in `state.sprung`: the cell is appended to `state.sprung` and the player dies of `slab`;
  - hidden pit (4): the cell is appended to `state.pits` unless already there, and the player dies of `pit`;
  - void (5): the player dies of `chasm`;
  - vent (7) whose vent is firing (R-VENT-2): the player dies of `vent`.
  Room, corridor, bridge (6) and alcove (8) cells are safe. *(Alcove traps come with the mask doors.)*
- **R-TRAP-2** Cells in `state.sprung` are solid (R-MOVE-4), like slabs.
- **R-EYES-1** Eyes keys: `id`, `type`, `zone` (a zone id) and `wake` (18–1800 ticks; spec §4.4: at least 0.6 s). At most one eyes entity per zone. `state.eyes` holds one meter per eyes entity, in entity order, starting at 0.
- **R-EYES-2** After R-TRAP-1 (if the player is still alive), for each eyes entity in order: if the player's cell is in its zone and the lantern is lit (oil > 0 and not hooded), the meter rises by 5, and the step emits `{ e: "eyes", id }` if it was 0. Otherwise the meter falls by 7, down to 0. Once every meter is updated, if any has reached 5 · its wake, the player dies of `eyes` (Gloamhollow: wake 1.0 s, cooling 1.4 × as fast).
- **R-VENT-1** Vent keys: `id`, `type` (`vent`), `cells` (1–64 cells, each code 7), `period` (2–1800 ticks), `phase` (0 … period − 1), `warn` (≥ 0) and `fire` (≥ 1), with warn + fire ≤ period and 5·fire ≤ 3·period (fire at most 60 % of the period, spec §4.4). Every code-7 cell belongs to exactly one vent (decision #17).
- **R-VENT-2** On the step that starts at tick n (`state.tick` before it advances), u = (n + phase) mod period. The vent warns while u < warn and fires while warn ≤ u < warn + fire. Gloamhollow: period 108, warn 27, fire 33 (3.6 / 0.9 / 1.1 s), phases 0, 36, 72 (0 / 1.2 / 2.4 s). Vents keep their cycle while the player is dead.
- **R-DEATH-1** Dying sets `state.dead = { cause, at: n }` (n as in R-VENT-2), adds 1 to `state.deaths`, sets the velocity and the remainders to 0, and emits `{ e: "death", cause }`. The rest of that living step (eyes, pick-up, oil burn, cooldowns) is skipped; tool presses (R-TOOL-1) have already happened. Causes so far: `slab`, `pit`, `chasm`, `vent`, `eyes`, `damage`.
- **R-DEATH-2** While dead, a step does only this: R-RISE-1, then the doors move (R-DOOR-3, which never stops), then pebbles land (R-PEB-3). No movement, tools (hood, probe, pebble, oil, interact), oil burn, checkpoints, traps, eyes, pick-ups or cooldowns. `state.prevButtons` still updates and `state.tick` still advances.
- **R-DEATH-3** Ironman: after a death the run is over. `step` refuses a state with `dead` set in mode `ironman` (decision #19).
- **R-RISE-1** Rise (button 7) on its rising edge, on a step whose n ≥ at + 51 (1.7 s, Gloamhollow's death card, decision #18): pick the checkpoint. In `practice`, a target N ≠ 0 picks the entry with zone N − 1; if there's none, nothing happens. Otherwise (delve, or target 0) it's `state.cp`. Then: `state.cp` = that entry; the life comes back (hooded, doors' `open`; each door's t = 693 if open, else 0); hp = 3000 (100 hp); oil = max(life.oil, 50 · 30000); flasks, pebbles, `state.floor`, `state.taken`, `state.bellSets` and `state.links` come back from the life; sealed doors stay shut; `state.zone` becomes the zone of the rise point, with no zone events; `state.player.calm` = 151; pebbles in flight are dropped (`state.flying` = []); every eyes meter is 0; the player stands at the entry's x, z with its yaw, pitch 0, velocity and remainders 0; `state.dead` = null; the step emits `{ e: "rise", zone }` (the zone's id, or null for −1). Nothing else happens on that step besides R-DEATH-2's door movement. Lessons stay.

## Entities (the placed things)

- **R-ENT-1** `entities` is optional; when present it is a list of at most 400 objects. Each has `id` (a string matching `^[A-Za-z_][A-Za-z0-9_]{0,31}$`, unique in the file) and `type`. The core knows the types `door`, `slab`, `prop`, `vent`, `item`, `eyes`, `bell` and `bellSet`; any other type is rejected (types are added as the core learns them). Each type allows exactly the keys listed below: a missing key or any other key is rejected.
- **R-ENT-2** `cell` is `[i, j]`, two integers inside the grid. At most one door or slab per cell.
- **R-ENT-3** An entity's *number* is 1 + its index in `entities`. The input's `target` names an entity by number; 0 names none (decision #15).
- **R-DOOR-1** Door keys: `id`, `type`, `cell`, `style` (`stone`, `grate` or `mask`), `opens` (`interact` or `trigger`) and, only when the style is `mask`, `face` (`weep`, `laugh`, `sleep` or `blank`). The cell must be room or corridor and must not be `start.cell`. *(Opening by key id comes with keys.)*
- **R-DOOR-2** `state.doors` holds one `{ open, t }` per door, in entity order; `init` sets `open: false, t: 0`. `t` ∈ [0, 693] is how far the door has moved (693 = 33 · 21).
- **R-DOOR-3** Each tick, after the movement (or, while dead, after R-RISE-1), every door with `open` and t < 693 moves on: t = min(693, t + 21); every door without `open` and t > 0 moves back: t = max(0, t − 33). Opening takes 33 ticks (Gloamhollow 1.1 s), closing 21 (0.7 s).
- **R-DOOR-5** `state.sealed` (a lesson, R-CP-3) lists sealed doors by door index, in the order sealed. A sealed door never opens: R-ACT-1 and `openDoor` leave it shut, and a rise restores it shut.
- **R-DOOR-4** A door's cell is solid while 20·t < 17·693 (Gloamhollow: solid while `anim` < 0.85). A door opened on tick n stops blocking on tick n + 29.
- **R-ACT-1** Interact (button 5) on its rising edge, before movement, with `target` = N ≠ 0: if entity N is an item, R-ITEM-2 applies; if it is a bell, R-BELL-3; if it is a door that isn't open and (x − cx)² + (z − cz)² ≤ 2600² for the door cell's centre (cx, cz) and the player's position before this tick's move, the press *reaches* it: the link event `interact(N)` happens (R-LINK-5), and if the door has `opens: "interact"` and isn't sealed, its `open` becomes true and the step emits `{ e: "door", id, open: true }`. Anything else does nothing: no error, no event. Facing isn't checked; choosing what to highlight is the client's job (Gloamhollow `nearestInteract`: reach 2.6 m, no line of sight).
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
  After the nine cells, the same pass visits every prop and bell in entity order (Gloamhollow's `obstacles`):
  - Circle of radius ρ at (px, pz): dx = x − px, dz = z − pz, d2 = dx² + dz², R = r + ρ. If 0 < d2 < R²: d = isqrt(d2), x = px + idiv(dx·R, d), z = pz + idiv(dz·R, d).
  - Box [x0, x1] × [z0, z1]: qx = clamp(x, x0, x1), qz = clamp(z, z0, z1), dx = x − qx, dz = z − qz, d2 = dx² + dz². If 0 < d2 < r²: d = isqrt(d2), x = qx + idiv(dx·r, d), z = qz + idiv(dz·r, d).
  - d2 = 0 does nothing for props (Gloamhollow only resets for cells).
  Bounds: |dx|, |dz| ≤ 64 · 2400, so d2 < 2³⁶; a push needs d2 < R² ≤ 910², so dx·R < 2²⁰.
  *(Later in M0: foes.)*
- **R-MOVE-5** The sim has no touch-stick speed. The client maps a touch stick onto `move` with run held: move = deflection · 127 · 8/9 (5.4 m/s · 8/9 = Gloamhollow's 4.8 m/s), after a 12 % dead zone (decision #16).

## Health

- **R-HP-1** `state.player.hp` is in units of 1/30 hp: 3000 is full (decision #28). `state.player.calm` counts living ticks since the last hurt, from 0 up to 151; `init` sets 151. Last in each living step, after R-LINK-7, if the player is alive: if hp < 3000 and calm > 150, hp = min(3000, hp + 4); then calm = min(151, calm + 1). So damage on tick n is first healed on tick n + 151, and never on the tick it lands (Gloamhollow: hurt first, then 4 hp/s once more than 5 s unhurt).
- **R-HP-2** Damage n (whole hp, 1–1000): hp −= 30·n, calm = 0, and the step emits `{ e: "hurt", hp: idiv(hp, 30) }` (with hp clamped at 0 first). At hp ≤ 0, hp = 0 and the player dies of `damage` (R-DEATH-1).

## Bells

- **R-BELL-1** Bell keys: `id`, `type` (`bell`), `cell`, `size` (1–3), `patina` (0–2, renderer only) and `note` (20–20000, Hz, renderer only). The cell is room or corridor and holds no door or slab. A bell blocks walking like a prop: a circle at its cell centre of radius 470, 650 or 830 for size 1, 2 or 3 (Gloamhollow r + 0.05 m for its 0.42 / 0.6 / 0.78 m bells), checked as in R-PROP-2. Each bell belongs to exactly one bell set (decision #29).
- **R-BELL-2** Bell set keys: `id`, `type` (`bellSet`), `bells` (2–5 distinct bell ids) and `order` (a permutation of 0 … n − 1, indices into `bells`). `state.bellSets` holds one `{ seq, solved }` per set, in entity order, starting `{ seq: [], solved: false }`.
- **R-BELL-3** Interact with a bell: its reach is 2000 + 420, 600 or 780 (size 1, 2, 3) from the cell centre, with line of sight (R-LOS-1). In reach, `interact(N)` happens and the step emits `{ e: "bell", id }`. If its set isn't solved, the bell's index i in `bells` is appended to `seq`. If `seq` is no longer a prefix of `order`, `seq` = [], the link event `bellsWrong(set)` happens and the step emits `{ e: "bellsWrong", id: set }`. Otherwise, if `seq` is as long as `order`, the set is solved and the step emits `{ e: "bellsSolved", id: set }`.

## Links (spec §4.3)

- **R-LINK-1** `links` is optional; when present it is a list of at most 64 objects with keys `id` (an integer 1–65535, unique), `when`, `do` (1–16 effects) and optionally `undo` (1–16 effects; not allowed when `when` is event-valued, R-LINK-2), `repeat` (true or false, default false) and `delay` (0–600 ticks, default 0); nothing else.
- **R-LINK-2** A *term* is an object. A trigger term has exactly one key, the trigger, from this list:
  - events: `interact` (a door, item or bell id), `itemTaken` (a flask or treasure id), `enterZone` and `leaveZone` (a zone id), `bellsWrong` (a bell set id), `linkFired` (another link's id);
  - conditions: `doorOpen` (a door id), `inZone` (a zone id), `hasItem` (a flask or treasure id), `lanternHooded` (true or false), `bellsSolved` (a bell set id), `linkActive` (another link's id).

  A gate term has exactly one of `all`, `any`, `atLeast`, `sequence` or `not`, plus its options. `all`, `any`, `atLeast`: a list of 2–8 terms; option `within` (1–1800, default 90); `atLeast` also needs `k` (1 … the number of terms). `sequence`: a list of 2–8 event triggers; options `within` (1–1800; without it there is no time limit, decision #27), `strict` (true or false, default false) and `onWrong` (1–16 effects, only with `strict: true`). `not`: one condition-valued term (a condition trigger, or an `all`, `any`, `atLeast` or `not` gate). Event triggers and `sequence` gates are *event-valued*; the rest are condition-valued. Gates nest at most 4 deep, and a link's `when` holds at most 16 triggers. Unknown keys, wrong id types and ids that don't exist are rejected. *(Cycles in the link graph are the publish validator's job, spec §7.3; the 8-pass limit bounds the sim either way.)*
- **R-LINK-3** Effects are objects with one key: `openDoor`, `closeDoor`, `sealDoor` (a door id), `damage` (1–1000) or `message` (a string of at most 1000 bytes of UTF-8).
- **R-LINK-4** `state.links` holds one entry per link in ascending id order: `{ val, active, spent, pend, m }`. `val` is the last value of `when` (false at first); `active` is true from the link's firing to its falling edge; `spent` is true once a link without `repeat` has fired; `pend` is the queue of delayed effect lists, `{ left, undo }` each, oldest first (decision #31); `m` is the memory of the `when` tree, one slot per event trigger inside it (its last tick, −1 for never) and three per `sequence` (progress, the tick of the last step, the tick it completed; 0, −1, −1 at first), in depth-first order.
- **R-LINK-5** Link events happen during a living tick, each as (kind, argument): entity number, zone index, bell set index or link id. Those before link evaluation form batch 0, in the order they happened; the `linkFired` events of pass k form batch k. A batch is delivered once to every link, before the pass that follows it (batch 0 before pass 1). For each trigger term inside the `when` tree, in depth-first order:
  - an event trigger that isn't a step of a `sequence` records the tick if the batch holds its event;
  - a `sequence`: if progress > 0, it has a `within` and the tick − the last step's tick > within, progress = 0. Then, repeatedly, if an event of the batch not used yet equals step `progress`, it is used, progress + 1 and the last step's tick = this tick; when progress reaches the number of steps, the completion tick = this tick, progress = 0, and the batch is done for this sequence. If the batch is done without completing, and the sequence is strict, and an unused event of the batch equals any step, progress = 0 and its `onWrong` list is queued; the queued lists of one link apply, in tree order, once its whole `when` has been delivered, before the next link's delivery.
- **R-LINK-6** Values, on tick n. An event trigger is true if its last tick is n, or, inside an `all`, `any` or `atLeast` gate, if its last tick ≥ 0 and n − last < that gate's `within` (the innermost enclosing one). A `sequence` likewise, with its completion tick. Conditions read the state as it is: `doorOpen` the door's `open`; `inZone` the player's cell; `hasItem` `state.taken`; `lanternHooded` the hood; `bellsSolved` the set; `linkActive` the link's `active`. `all`: every term; `any`: one at least; `atLeast`: k at least; `not`: the term is false.
- **R-LINK-7** Link evaluation runs on living ticks only (decision #30), last in the step, after the pebbles land (R-PEB-3), and only if the player is alive. First, for every link in ascending id order, each entry of `pend` counts down: left − 1; the entries that reach 0 leave the queue and their `do` (or `undo`) lists apply, oldest first. Then up to 8 passes, each delivering the waiting batch (R-LINK-5) and visiting the links in ascending id order:
  - rising edge (`when` true, `val` false): if `pend` holds undo entries, they are dropped and the link is active again; otherwise, unless `spent`, the link fires: `active` = true, `spent` = true if it doesn't repeat, `linkFired(id)` joins the next batch, the step emits `{ e: "link", id }`, and `do` applies now (delay 0) or `{ left: delay, undo: false }` joins `pend`;
  - falling edge (`when` false, `val` true) of an active link: `active` = false. If `when` is event-valued, nothing else happens: its queued effects still land (decision #31). Otherwise, if `pend` holds do entries they are dropped (and no undo runs); else its `undo`, if any, applies now or `{ left: delay, undo: true }` joins `pend`;
  - `val` = the new value.

  Another pass follows if this pass applied an effect that changed the state or raised a `linkFired`, up to 8 passes in all. If an effect kills the player, evaluation stops there: during a pass, after that link's `val` is updated; during the countdown or an `onWrong`, before any `val` changes.
- **R-LINK-8** Effects, in list order: `openDoor` sets a door's `open` unless it is sealed or open (emits `door`); `closeDoor` clears it if set (emits `{ e: "door", id, open: false }`); `sealDoor` adds the door to `state.sealed` and clears `open` (emits `{ e: "door", id, open: false, sealed: true }` the first time); `damage` hurts (R-HP-2); `message` emits `{ e: "message", text }` and changes nothing. Applying a door effect twice changes nothing more; `damage` hurts each time.

## Tools and items

- **R-TOOL-1** Tool presses are handled on their rising edge at the start of a living tick, before movement, in button order: hood (1), probe (2), pebble (3), oil (4), interact (5). They see the player's position before this tick's move and the yaw of this tick's input. Forward is (fx, fz) = (−sin yaw, −cos yaw), each scaled by 2¹⁴; a point at distance d along it is (x + idiv(fx·d, 2¹⁴), z + idiv(fz·d, 2¹⁴)). Bounds: |fx·d| ≤ 2¹⁴ · 8600 < 2²⁸.
- **R-TOOL-2** `probeCd` and `pebbleCd` (in `state.player`) count down by 1 at the end of each living tick that doesn't end in a death, to 0. A probe needs probeCd = 0 and sets it to 21 (0.7 s); a throw needs pebbleCd = 0 and sets it to 15 (0.5 s). Death doesn't reset them.
- **R-PROBE-1** Reach r = 2050; if the point at r lies in the player's own cell, r = 2600. For s = 1 … 8, the point at idiv(r·s, 8): the first one in a solid cell (R-MOVE-4) that isn't a slab or sprung plate ends the probe with `{ e: "probe", k: "wall" }`. Otherwise the point at r names the probed cell (Gloamhollow `probeTarget`).
- **R-PROBE-2** By cell code: plate with a slab or sprung → `slab`; plate in `state.marked` → `plateKnown`; other plate → appended to `state.marked`, `plate`. Hidden pit in `state.pits` → `pitKnown`, else appended, `pit`. Void → `void`. Bridge → appended to `state.bridge` unless there, `bridge`. Vent → `vent`. Alcove → `alcove`. Anything else → `stone`. The step emits `{ e: "probe", k }`. *(The gilded chest and the laughing alcove come with their puzzles.)*
- **R-PEB-1** `state.player.pebbles` starts at 10, at most 12. A throw with none left emits `{ e: "msg", k: "pouchEmpty" }`. Otherwise pebbles − 1, pebbleCd = 15, and the range is want = clamp(6200 + idiv(6000·pitch, 127), 1600, 8500) mm: the int8 pitch maps linearly onto Gloamhollow's ±1.2 rad (decision #22).
- **R-PEB-2** The flight is marched from d = 400 in steps of 120 while d < want: at each point, a solid cell (R-MOVE-4) that isn't a slab or sprung plate stops the march; a slab or sprung plate becomes the landing point and stops it; any other cell becomes the landing point and d grows by 120. The landing point starts as the player's position. The pebble flies for T = idiv(21000 + 3·d + 1999, 2000) ticks (Gloamhollow 0.35 s + 0.05 s per metre, rounded up) and lands on the step at tick n + T − 1, n being the throw's step; `state.flying` gets `{ x, z, at }`. The step emits `{ e: "throw" }`.
- **R-PEB-3** At the end of every step, dead or alive, pebbles in `state.flying` whose `at` is this step's tick land, in list order, and leave the list. By the landing cell: slab or sprung plate → it rests; plate → appended to `state.sprung` (the slab falls, nobody dies), the pebble is gone; hidden pit → appended to `state.pits` unless there, gone; void → gone; bridge → appended to `state.bridge` unless there, rests; anything else → rests. Resting appends `{ x, z }` to `state.floor`. The step emits `{ e: "land", k }` with k = `slab`, `plate`, `pit`, `void`, `bridge` or `floor`. *(Alcoves come with the mask doors.)*
- **R-PEB-4** After the eyes (R-EYES-2), a living player picks up pebbles: for each entry of `state.floor` from last to first, if pebbles < 12 and (x − px)² + (z − pz)² ≤ 750², it leaves the list and pebbles + 1 (Gloamhollow `pickPebbles`).
- **R-OIL-3** Oil (button 4): with no flasks → `{ e: "msg", k: "noFlasks" }`; with oil ≥ 96 points → `{ e: "msg", k: "lanternFull" }`; otherwise flasks − 1, oil = min(100, oil + 60) points, and `{ e: "oil", relit }` (relit: oil was 0). `state.player.flasks` starts at 1.
- **R-ITEM-1** Item keys: `id`, `type`, `kind` (`flask`, `rubble` or `treasure`), `cell` and, for treasure only, `value` (1–100000). The cell is room, corridor or bridge and holds no door or slab (decision #23).
- **R-ITEM-2** Interact (R-ACT-1) with target = an item: the item's point is its cell centre, or for rubble the centre − (300, 300); its reach is 1700 (rubble 1600). It needs (x − ix)² + (z − iz)² ≤ reach² and line of sight (R-LOS-1) to the point. A flask or treasure not in `state.taken` is appended to it (by entity number); a flask adds 1 to flasks; the link events `interact(N)` and `itemTaken(N)` happen. Rubble with pebbles < 12 sets pebbles to 12 and stays; `interact(N)` happens. The step emits `{ e: "item", id, kind }`. Anything else does nothing.
- **R-LOS-1** Line of sight from the player (px, pz) to a point (ix, iz) (Gloamhollow `los`, aimed 300 mm short): ex = ix − px, ez = iz − pz, e = isqrt(ex² + ez²); the aim is (ix − idiv(ex·300, e), iz − idiv(ez·300, e)), or the point itself if e = 0. With v = aim − player, L = isqrt(vx² + vz²) and n = idiv(L + 599, 600), the points player + (idiv(vx·s, n), idiv(vz·s, n)) for s = 1 … n − 1 must not lie in a wall cell or a door cell while R-DOOR-4 holds.

## Lantern *(provisional)*

- **R-OIL-1** 1 oil point = 30,000 units (100 points = full). Burn per tick: 80 open, 25 hooded (0.08 / 0.025 points/s).
- **R-OIL-2** Hood toggles on the press (R-TOOL-1), only if oil > 0. After the eyes and pickups, oil burns (R-OIL-1); at oil 0 the lantern goes out and un-hoods.
