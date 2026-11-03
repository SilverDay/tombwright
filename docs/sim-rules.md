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
- **R-MOVE-4** *(open)* Collision: circle of radius 360 mm against solid cells (walls, the stair cell, shut doors, slabs) and props. Not implemented yet.
- **Open question:** Gloamhollow's touch stick moves at 4.8 m/s × deflection, which is neither walk nor run speed. Decide whether the client maps the stick onto walk/run, or the input gains a speed field.

## Lantern *(provisional)*

- **R-OIL-1** 1 oil point = 30,000 units (100 points = full). Burn per tick: 80 open, 25 hooded (0.08 / 0.025 points/s).
- **R-OIL-2** Hood toggles on the press, only if oil > 0. At oil 0 the lantern goes out and un-hoods.
