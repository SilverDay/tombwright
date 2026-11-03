# Tombwright — build, prove, and challenge killer dungeons

**Working title.** Server-based successor to *Gloamhollow* (SilverDay Media)
**Status:** Draft v0.3 for review · **Date:** 2026-11-03 · **Owner:** Klaus-E. Klingner

**Changes in v0.3:** the 26 Lantern Delve foes and the Warden of the Deep join the bestiary, with a threat budget, senses and adapted powers (§4.9, §7, §13, §15).

**Changes in v0.2:** new *Button* component (§4.2); triggers can now be combined with ALL / ANY / SEQUENCE / AT LEAST / NOT, with time windows and an undo branch (§4.3, §7.1, §7.2, §15).

---

## 0. Summary

Tombwright turns the Gloamhollow first-person engine into a platform. Players **build** their own trap-filled tomb in a browser editor, **prove** it is beatable by clearing it themselves, **publish** it, and **challenge** other players to run it. Every run that counts toward a leaderboard or a challenge is **re-simulated on the server** from the player's recorded inputs, so a score can't be faked by editing the client or the network traffic.

Everything is asynchronous: nobody has to be online at the same time. That keeps the server on your usual stack (PHP, MariaDB, Apache, plain request/response) with no WebSocket or game-server process.

### Key decisions in this draft

| # | Decision | Why |
|---|---|---|
| D1 | Asynchronous play only (no real-time multiplayer) | Fits PHP request/response; challenges and leaderboards don't need live sessions |
| D2 | Server-side replay of every scored run | The only way to make leaderboards trustworthy when the game runs on the client |
| D3 | Deterministic, fixed-tick, integer ("fixed-point") rules core, implemented in JS (client) and PHP (verifier) | PHP and JS can only agree bit-for-bit if neither uses floating point or library trig |
| D4 | Dungeons are data (versioned JSON, "GDF"), never code | Safe to host user content; no scripting language for authors in v1 |
| D5 | Publishing requires a verified clear by the author | Guarantees every public dungeon is beatable; stops "impossible" troll tombs |
| D6 | Published versions are immutable and content-hashed | Leaderboards and challenges always refer to exactly the dungeon that was run |
| D7 | Chamber data streamed per checkpoint (phase 2) | Stops players reading hidden-trap positions out of the client before they reach them |

---

## 1. Goals and non-goals

### Goals

- **G1** A browser dungeon editor that uses the Gloamhollow building blocks (rooms, corridors, doors, trap tiles, puzzles, foes, light, inscriptions) and lets authors playtest at any time.
- **G2** Verified runs: every scored result is reproduced by the server from inputs before it is accepted.
- **G3** Challenges between players: direct challenges, open bounties, and later duels.
- **G4** Per-dungeon leaderboards, dungeon ratings that include a *fairness* signal, and simple author stats.
- **G5** Your usual stack: PHP, MariaDB, Apache, no heavy framework, front-controller routing, PDO with prepared statements, server-rendered pages, NIST SP 800-63B as the authentication baseline.
- **G6** Hosting user content in the EU properly: notice-and-action, statements of reasons, GDPR data minimisation.

### Non-goals (v1)

- Real-time co-op or PvP inside a dungeon.
- Author scripting (Lua or JS in dungeons). Logic is limited to the trigger/effect wiring in §4.3.
- Custom 3D models or uploaded textures (closes a whole class of content and malware risk; can come later with review).
- Comments or chat (each is a moderation surface of its own; ratings and fairness votes cover feedback in v1).
- Native apps. The game stays a responsive web app with the touch controls it already has.

---

## 2. Assumptions to confirm

These shape the design. Each one is an open question in §17 as well.

1. "Challenge other players" means *asynchronous*: A sends B a dungeon, B runs it later, results are compared.
2. Accounts are required to publish, challenge and appear on leaderboards; anyone can play published dungeons as a guest, unscored.
3. A single EU-hosted VPS is enough at launch (hundreds of concurrent players, not tens of thousands).
4. The game keeps Gloamhollow's rules: instant-death traps, chamber checkpoints, lessons that persist across deaths, a lantern you hood, a pole, pebbles, and light-dependent foes.
5. English and German UI.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **GDF** | Gloamhollow Dungeon Format: versioned JSON describing one dungeon (§7) |
| **Sim core** | The deterministic rules engine: movement, collision, traps, puzzles, foes, scoring. No rendering. |
| **Tick** | One fixed simulation step, 1/30 s |
| **Input log** | Per-tick player inputs recorded during a run (§8.2) |
| **Verifier** | PHP CLI worker that replays an input log through the PHP sim core (§8.3) |
| **Proof run** | The author's own verified clear that unlocks publishing |
| **Chamber / zone** | A named region of the dungeon; a zone may hold a checkpoint |
| **Lesson** | Knowledge that survives death: sprung plates, found pits, revealed bridge tiles, sealed doors |
| **Delve / Ironman / Practice** | Run modes (§4.5) |

---

## 4. Game design

### 4.1 Core loop

```
 BUILD ──► PLAYTEST ──► PROVE (author's verified clear) ──► PUBLISH (immutable version)
                                                               │
                ┌──────────────────────────────────────────────┤
                ▼                                              ▼
        RUN (Delve / Ironman)                         CHALLENGE (direct / bounty / duel)
                │                                              │
                └──► VERIFY on server ──► LEADERBOARD · RATINGS · CHALLENGE RESULT
```

### 4.2 Building blocks

Everything in Gloamhollow becomes a placeable, parameterised component. The engine already implements all of these as hard-coded one-offs; §6 turns them into data.

| Category | Component | Parameters | Lethal | Notes |
|---|---|---|---|---|
| Structure | Room cell, corridor cell, wall | — | | Corridors get the low ceiling |
| | Zone (chamber) | name, rect(s), ceiling height 3.0–6.5, tint, checkpoint on/off, spawn cell + facing | | ≤ 16 zones |
| | Start stair, exit (daylight shaft) | cell | | Exactly one of each |
| | Torch (captive flame) | wall side | | Light source |
| Doors | Stone, grate, mask-face | opens on: interact / trigger / key id; face: weep / laugh / sleep / blank | | Sealing is an effect |
| Hazards | Pressure plate + falling slab | — | yes | Probe marks it; a pebble springs it |
| | Hidden pit | — | yes | Probe or pebble reveals it |
| | Void (chasm) | — | yes | |
| | Unlit bridge tile | — | | Glows only when your lantern is dim |
| | Fire vent column | period, phase, warn time, fire time | yes | Telegraphs with glow and rumble |
| | Waking-eyes zone | wake time (≥ 0.6 s) | yes | Kills an open flame inside the zone |
| | Alcove trap | kind: drown / tip; reset: seal door | yes | Pebble or probe sets it off safely |
| | Dart volley | damage | no | An effect, usually wired to a wrong answer |
| Puzzles | Bell set | 2–5 bells (size, patina, note), order | | Wrong order fires a configurable effect |
| | Mirror set | lamp hook, 2–8 mirrors (start orientation), crystal target | | Beam traced on the grid |
| | Lever | on/off, once / toggle | | New, generic |
| | Button | mount: wall / pedestal; behaviour: *press* (momentary), *latch* (stays down for good), *toggle* (down/up on each press), *timed* (stays down for N ticks, then pops up); pressed by: hand / pebble / both; glyph (one of 16 runes); concealed (found by probing) | | New. Pebble-pressable buttons let authors put switches out of reach, across a chasm or behind a grate. A *timed* button is how one player satisfies a "press two things together" puzzle. |
| | Brazier | lit at start? | | Light source; required by light-dependent foes |
| | Chest | plain / gilded; contents; trap: none / needles (lethal) | opt. | Probe disarms needles |
| Foes | 3 from Gloamhollow, 26 from Lantern Delve, 2 bosses | kind, start state, group id, spawn on trigger | no | Full list, costs and rules in §4.9. An HP death counts as a death. |
| Items | Treasure | name, value | | Counts toward score |
| | Oil flask, pebble rubble, key | key id + name | | |
| Text | Inscription | style: plaque / stele / scrawl / book; title; pages | | §11.6 limits and moderation |
| Marks | Masons' marks | cells | | Floor glyphs visible only when hooded |

### 4.3 Wiring: triggers, conditions and effects

Gloamhollow's puzzles are hard-coded ("bells solved → open grate"). In Tombwright, authors wire **links** in the editor. A link has a **when** (one trigger, or several combined), a **do** list of effects, and optionally an **undo** list.

#### 4.3.1 Two kinds of trigger

Combining only works cleanly if "something happened" is kept apart from "something is true".

| Kind | Meaning | Examples |
|---|---|---|
| **Event** | Happens on one tick | `buttonPressed(b)`, `interact(entity)`, `itemTaken(item)`, `enterZone(zone)`, `leaveZone(zone)`, `plateStepped(plate)`, `pebbleHit(entity)`, `bellsWrong(set)`, `foesDefeated(group)`, `bossDefeated`, `linkFired(link)` |
| **Condition** | True or false at any tick | `buttonDown(b)`, `leverOn(lever)`, `doorOpen(door)`, `lightLit(source)`, `inZone(zone)`, `hasItem(item)`, `lanternHooded`, `beamHits(crystal)`, `bellsSolved(set)`, `foesAlive(group)`, `linkActive(link)` |

The editor colours the two differently (events as diamonds, conditions as squares), so authors can see what a gate is being fed.

#### 4.3.2 Combining: gates

A `when` is either a single trigger or a **gate** holding 2–8 terms. Gates nest up to 4 levels deep.

| Gate | True when | Accepts | Options |
|---|---|---|---|
| **ALL** (and) | Every term is true at the same time | events and conditions | `within`: how long an event counts as "just happened" (default 90 ticks = 3 s, max 1,800) |
| **ANY** (or) | At least one term is true | events and conditions | `within` as above |
| **AT LEAST *k*** | At least *k* of the terms are true | events and conditions | `k`, `within` |
| **SEQUENCE** | The listed events happen in this order | events only | `within` (max gap between steps), `strict` (a listed event out of order resets progress), `onWrong` (effects to fire on a reset, e.g. darts) |
| **NOT** | Its single term is false | conditions only | — |

An event counts as true for `within` ticks after it fires; after that it falls back to false. That is what lets "press both buttons within 3 seconds" work as an ALL.

#### 4.3.3 When a link fires

- A link fires on the **rising edge**: the tick its `when` turns from false to true.
- `repeat: false` (default) fires once per life. After a death, the link's state comes back exactly as it was saved at the checkpoint.
- `repeat: true` re-arms once the `when` has been false again.
- **undo** runs on the falling edge (true → false). This is how "the door stays open only while the lever is up and the brazier burns" works without two separate links.
- `delay` (0–600 ticks) postpones the effects. A delayed effect is stored in sim state with its due tick, so it survives the state hash and checkpoint snapshots.

#### 4.3.4 Effects

`openDoor`, `closeDoor`, `sealDoor`, `spawnFoes(group)`, `reveal(entity)`, `hide(entity)`, `message(text)`, `damage(n)`, `lightOn` / `lightOff(source)`, `grantItem(item)`, `resetButton(b)`, `setLever(lever, state)`.

The bell set from Gloamhollow becomes shorthand: in the editor it compiles to a SEQUENCE over `bellRung` events with `strict` and `onWrong`. Authors can use either form.

#### 4.3.5 Rules that keep wiring safe and deterministic

- **Evaluation order:** once per tick, after the player, foes and entities have updated. Links are evaluated in ascending id order; a link whose effects change state that other links read causes another pass, at most 8 passes per tick.
- **Idempotent effects:** applying an effect twice changes nothing more.
- **No loops:** `linkFired` and `linkActive` let one link feed another (multi-stage puzzles), but the validator rejects any cycle in the link graph, including indirect ones through effects (a link that opens a door can't depend on `doorOpen` of that same door, directly or via another link).
- **Same-tick events:** several events on one tick satisfy consecutive SEQUENCE steps in the order the steps are listed. A `linkFired` event is raised in the pass in which its link fires, so later passes of the same tick can see it.
- **Delays:** `delay` applies to both `do` and `undo`. If the link flips back before a delayed `do` is due, the pending `do` is dropped and the `undo` is not run.
- **State in the sim:** event timestamps, sequence progress, latch states and pending delays all live in sim state, so they're part of the state hash and the checkpoint snapshot.
- **Limits:** at most 64 links per dungeon, at most 16 trigger terms per link, nesting depth 4.

#### 4.3.6 Examples

1. **Out of reach.** Two buttons on opposite sides of a chasm; one is pebble-pressable. `ALL(buttonPressed(near), pebbleHit(far)) within 120` → open the bridge grate. The player presses one by hand and has 4 seconds to hit the other with a pebble.
2. **Held open.** `ALL(leverOn(L1), lightLit(brazier2))` → `do: openDoor(d7)`, `undo: closeDoor(d7)`. If the Candle-Eater drinks the brazier, the door slams shut.
3. **Rune lock.** Four wall buttons with glyphs; an inscription elsewhere hints at the order. `SEQUENCE(buttonPressed(moon), buttonPressed(eye), buttonPressed(eye), buttonPressed(key)) strict, within 300, onWrong: damage(20)`.
4. **Two of three.** `AT LEAST 2(hasItem(silverKey), hasItem(ironKey), leverOn(L3))` → reveal a hidden alcove. Lets a dungeon have more than one way through.

### 4.4 Fairness

Killer tombs are only fun when deaths feel earned. Three mechanisms:

1. **Tells are a first-class component.** Every lethal component has an optional linked *tell*: an inscription, a visual cue (scorch, bones, fallen slab, scratches) or a sound. The editor shows lethal components with no tell in amber. It does not block publishing (authors may want a truly blind trap), but the dungeon page shows the share of lethal traps that have tells.
2. **Fairness votes.** After a run, the player sees their deaths by cause and can mark each one "fair" or "cheap". The dungeon page shows a fairness percentage next to the like ratio.
3. **Engine guarantees.** Checkpoint spawn cells must be safe; vent fire time ≤ 60 % of the period; waking-eyes wake time ≥ 0.6 s; no lethal cell within one cell of a checkpoint spawn.

### 4.5 Run modes

| Mode | Lives | Scored | Lessons persist | Use |
|---|---|---|---|---|
| **Delve** | unlimited, rise at last checkpoint | yes | yes | The default; Gloamhollow's rules |
| **Ironman** | one | yes, separate board | n/a | Bragging rights; bounties |
| **Practice** | unlimited, start at any reached checkpoint | no | yes | Learning a dungeon; author playtest |

### 4.6 Scoring

Every verified run produces: `cleared`, `ticks` (game time), `deaths` (Delve), `treasure`, `deathCauses[]`.

- **Leaderboards per published version and mode**, with three sort orders: *Fewest deaths* (ties → time), *Fastest* (ties → deaths), *Richest* (ties → time). Only cleared runs appear.
- **Tomb score** for challenge comparisons: `max(0, 1000 + treasure − 150 × deaths − seconds)`, where seconds = ticks / 30. The constants live in config and are versioned, so old results keep the formula they were scored with.
- **Dungeon difficulty** is derived, never self-declared: Bayesian-smoothed clear rate and median deaths per clear, shown as 1–5 skulls once a dungeon has 20 runs.

### 4.7 Challenges

| Kind | Flow | Win condition |
|---|---|---|
| **Direct** | A picks a published version (their own or any), a mode, a deadline (1–14 days) and optionally a target (A's own best). B accepts or declines. | B posts a verified run that meets or beats the target before the deadline. With no target, the result is simply recorded. |
| **Bounty** (open) | An author posts a condition on their dungeon: "Ironman clear", "under 8 minutes", "all treasure". | Every verified run meeting it earns a badge; the first three are listed. |
| **Duel** (phase 3) | A and B each nominate one of their own proven dungeons; each runs the other's within the window. | Higher tomb score wins. A dungeon with no clear by the opponent scores 0. |

**Anti-abuse:** at most 10 open outgoing challenges per user; blocking a user silently declines their challenges; challenges to a user expire if not accepted within 72 h.

**Notifications:** an in-app inbox. Email is opt-in, double opt-in, per kind, and every mail carries a one-click unsubscribe link.

### 4.8 Ratings and reputation

- After a run, the player may like or dislike and cast fairness votes. One vote per user per version; it can be changed.
- Author stats: dungeons published, total plays, clears, likes. No Elo-style player rating in v1 (see §17).

---

### 4.9 Bestiary

Authors pick foes from two games. Gloamhollow's foes fit its trap-first style; Lantern Delve's A–Z roster (taken from Rogue) gives far more variety. Lantern Delve was an RPG with armour, gold, strength and character levels, and Tombwright has none of those, so the foes whose powers touched those stats get a Tombwright version of the power that works on what the player *does* have: health, the lantern, carried items, treasure, and the traps they've found.

#### 4.9.1 Converting Lantern Delve stats

- **Toughness:** strikes to kill = Lantern Delve hit points ÷ 10, rounded, at least 1. Tombwright strikes always do 1 damage.
- **Damage:** Lantern Delve average damage × 2.5, rounded, applied as a fixed amount, so two Delve runs of the same dungeon stay comparable. Powers that work by chance still roll, on the run's seeded random generator (§6.2).
- **Speed:** unchanged, in metres per second (one cell is 2.4 m; the player walks at 3.2 and runs at 5.4).
- **Regeneration:** Lantern Delve's per-second regeneration ÷ 10, expressed as one strike healed every N seconds.
- These are starting values. All foe numbers live in a versioned data file (`bestiary.v1.json`); a published dungeon records the bestiary version it was proven with, exactly like the sim core version (§14), so retuning never invalidates old leaderboards.

#### 4.9.2 Threat budget

Each foe has a tier, and each tier a cost: tier 1 = 1, tier 2 = 4, tier 3 = 9, tier 4 = 16, tier 5 = 25. A dungeon may spend **100 threat points**, on top of the limits of 24 foes and 8 awake at once (§7.2). That allows, for example, four dragons and nothing else, or a large mixed crowd of small foes. Bosses sit outside the budget; a dungeon has at most one.

#### 4.9.3 The roster

**From Gloamhollow**

| Foe | Tier (cost) | Strikes | Damage | Speed | Movement | Power |
|---|---|---|---|---|---|---|
| Bone gardener | 2 (4) | 3 | 14 | 2.2 | walks; can rise out of the ground when spawned | — |
| Gloam crawler | 1 (1) | 2 | 9 | 2.9 | walks; glowing eyes visible in the dark | — |

**From Lantern Delve**

| | Foe | Tier (cost) | Strikes | Damage | Speed | Movement | In Lantern Delve | In Tombwright |
|---|---|---|---|---|---|---|---|---|
| A | Aquator | 2 (4) | 2 | 0 | 2.8 | walks | Rusts your armour | **Douses your lantern.** Each touch puts it out; oil is kept, and relighting (Hood button) takes 1 s during which you can't move |
| B | Bat | 1 (1) | 1 | 5 | 4.4 | flies, flits erratically | — | — |
| C | Centaur | 3 (9) | 3 | 15 | 3.8 | walks | — | — |
| D | Dragon | 5 (25) | 14 | 31 | 2.6 | walks | Breathes fire | **Fire breath** every 4.5 s within 10 m, 36 damage, a projectile you can dodge |
| E | Emu | 1 (1) | 1 | 5 | 3.8 | walks | — | — |
| F | Venus flytrap | 4 (16) | 7 | 18 | 0 | never moves | Holds you | **Seizes you** for 5 s or until you kill it. Placed in a doorway, it is a toll |
| G | Griffin | 5 (25) | 12 | 28 | 3.9 | flies | Regenerates | **Regenerates** 1 strike every 7 s |
| H | Hobgoblin | 1 (1) | 2 | 6 | 3.0 | walks | — | — |
| I | Ice monster | 1 (1) | 2 | 0 | 2.7 | walks | Freezes you | **Freezes you** for 1.5–2.5 s, then you're immune for 4.5 s |
| J | Jabberwock | 5 (25) | 13 | 35 | 3.0 | walks | — | — |
| K | Kestrel | 1 (1) | 1 | 6 | 4.5 | flies | — | — |
| L | Leprechaun | 2 (4) | 2 | 0 | 3.6 | walks | Steals gold and vanishes | **Steals your most valuable treasure** and vanishes; kill it to get the treasure back |
| M | Medusa | 4 (16) | 10 | 21 | 2.8 | walks | Confuses with a gaze | **Confuses you** for 3 s (50 % per hit): your movement is scrambled |
| N | Nymph | 2 (4) | 2 | 0 | 3.6 | walks | Steals an item and vanishes | **Steals an oil flask** (or half your pebbles if you have none) and vanishes; never takes keys |
| O | Orc | 2 (4) | 2 | 10 | 2.9 | walks | Goes for gold | **Guards treasure:** walks to the nearest treasure in its chamber and stands over it until it notices you |
| P | Phantom | 4 (16) | 8 | 20 | 3.4 | flies, flits | Invisible | **Invisible**, except as a faint ghostlight while your lantern is hooded (the same light that shows the unlit road) |
| Q | Quagga | 2 (4) | 3 | 14 | 3.9 | walks | — | — |
| R | Rattlesnake | 2 (4) | 2 | 9 | 3.1 | walks | Weakens you (strength) | **Poisons you** (40 % per bite): no health regeneration for 20 s |
| S | Snake | 1 (1) | 1 | 5 | 3.2 | walks | — | — |
| T | Troll | 4 (16) | 8 | 22 | 3.0 | walks | Regenerates | **Regenerates** 1 strike every 5 s |
| U | Black unicorn | 4 (16) | 9 | 26 | 4.0 | walks | — | — |
| V | Vampire | 3 (9) | 6 | 18 | 3.2 | walks | Drains maximum health; regenerates | **Drains you** (35 % per bite): maximum health −5 until you rise again or reach the next checkpoint, and it heals by the damage dealt. Also regenerates 1 strike every 10 s |
| W | Wraith | 3 (9) | 4 | 15 | 3.1 | flies | Drains character levels | **Makes you forget** (20 % per hit): one trap you have marked or bridge tile you have found in this chamber fades from your view. It is still there |
| X | Xeroc | 3 (9) | 4 | 20 | 2.6 | walks | Poses as loot | **Mimic:** placed disguised as treasure, an oil flask or a chest. Probing it with the pole reveals it safely; reaching for it wakes it with a free hit |
| Y | Yeti | 3 (9) | 4 | 18 | 3.2 | walks | — | — |
| Z | Zombie | 2 (4) | 2 | 10 | 2.2 | walks | — | — |

**Bosses** (at most one per dungeon, outside the budget)

| Boss | Strikes | Damage | Behaviour |
|---|---|---|---|
| Ilvaris, the Candle-Eater (Gloamhollow) | 6 | 20 | Smoke in the dark, solid only near a lit brazier; drinks your lantern oil when close; feeds on braziers; at half health snuffs every flame |
| The Warden of the Deep (Lantern Delve) | 30 | 30 | Calls up two zombies every 11 s (never more than four at once); below half health, fires a fan of five bolts (15 damage each) every 4.5 s while you're more than 2.5 m away. Lantern Delve's Warden has 650 hit points; 30 strikes is a deliberate cut, since a straight conversion (65) would be a slog with a one-damage sword |

#### 4.9.4 Senses and starting state

Lantern Delve's foes sleep, idle or hunt, and noise wakes them. Tombwright keeps that and ties it to the lantern and pebbles:

- **Start state** (set per foe by the author): *asleep* (wakes only to noise or a strike), *idle* (wanders its chamber), or *hunting*.
- **Noise:** running wakes foes within 4 cells; a strike, within 3. **New:** a pebble landing wakes foes within 3 cells of where it lands, and idle foes walk over to the spot, so pebbles can lure foes away from a door.
- **Sight:** idle and hunting foes notice you within 6 cells, with line of sight, while your lantern is open; within 3 while it's hooded or out. The flytrap only notices you when you are within its reach.
- **Pathing:** walking foes follow a flow field over the grid (Lantern Delve already works this way), recomputed when a door changes. They treat lethal cells as walls and never set off traps. Fliers (bat, kestrel, griffin, phantom, wraith) cross pits, the void and vents.

#### 4.9.5 Rules that keep foes fair and replayable

- **No dead ends from thieves:** keys can never be stolen. Anything a leprechaun or nymph takes drops where it dies. A thief that vanishes reappears at its spawn point 20 s later, still carrying the loot.
- **Mixed groups:** an author can place a "mixed group" (for example "three foes of tier 1–2"). The foes are picked at publish time, seeded by the version's content hash, so every player meets exactly the same ones.
- **Determinism:** every chance-based power rolls on the seeded generator, in a fixed order per tick (by foe id). Foes are part of the sim state and the state hash.
- **Art and sound:** Lantern Delve's pixel-art sprites and synthesised sounds for all 26 foes and the Warden carry over.
- **Attribution:** the foe names and base stats come from Rogue 5.4 by way of Lantern Delve; Rogue 5.4.4 is distributed under a BSD licence, so its notice ships with the game (§13).

---

## 5. Architecture

### 5.1 Overview

```
                ┌────────────────────────────── Browser ──────────────────────────────┐
                │  Server-rendered pages (PHP templates): browse, dungeon page,        │
                │  profiles, inbox, settings, moderation                               │
                │                                                                      │
                │  Game client (ES modules)          Builder (ES modules)              │
                │  ├─ sim core (JS, fixed-point) ◄── same core for playtests           │
                │  ├─ renderer (three.js, vendored)                                    │
                │  └─ input recorder                                                   │
                └──────────────┬───────────────────────────────────────────┬──────────┘
                               │ HTTPS (JSON API, session cookie, CSRF)     │
                ┌──────────────▼───────────────────────────────────────────▼──────────┐
                │ Apache 2.4 + PHP-FPM · public/index.php front controller            │
                │  Router → middleware (session, CSRF, rate limit, authz) → handlers   │
                │  Services: Auth · Dungeons · GDF Validator · Runs · Challenges ·     │
                │            Leaderboards · Moderation · Notifications                 │
                └──────────────┬──────────────────────────────┬────────────────────────┘
                               │ PDO (prepared statements)     │ jobs table
                        ┌──────▼──────┐               ┌────────▼─────────┐
                        │  MariaDB    │◄──────────────┤ Verifier worker  │  php bin/verifier.php
                        │ (LTS)       │  results       │ (PHP sim core)   │  systemd, N processes
                        └─────────────┘               └──────────────────┘
```

### 5.2 Components

| Component | Tech | Responsibility |
|---|---|---|
| Front controller | `public/index.php`, small router (method + path patterns) | Everything goes through one entry point; static files served by Apache directly |
| Pages | Server-rendered PHP templates, auto-escaping helper `e()` | Browse, detail, profile, inbox, settings, admin |
| JSON API | `/api/v1/*` handlers, same session as pages | Builder saves, runs, challenges |
| Game client | Vanilla ES modules, no framework, no build step required; three.js vendored and pinned | Rendering, input, local sim, recording |
| Builder | Vanilla ES modules: 2D grid editor on `<canvas>`, playtest via the game client | Authoring, live validation |
| Sim core (JS) | Pure module, no DOM, no `Math.random`, no floats in state | Rules, shared by game and builder |
| Sim core (PHP) | `src/Sim/` with `declare(strict_types=1)` | Same rules for verification |
| Verifier worker | PHP CLI under systemd, claims jobs from MariaDB | Replays runs, writes results |
| Database | MariaDB LTS | All persistent state |

### 5.3 Repository layout

```
tombwright/
├─ public/                 index.php · assets/ (css, fonts, img) · js/ (game/, builder/, sim/, vendor/three/)
├─ src/
│  ├─ Http/                Router, Request, Response, Middleware/
│  ├─ Auth/                Passwords, Sessions, Totp, WebAuthn (phase 2), Breached-password check
│  ├─ Dungeon/             Gdf/ (Schema, Validator, Canonicalizer), Repository, Publisher
│  ├─ Run/                 RunService, InputLog codec, Scoring
│  ├─ Sim/                 PHP sim core (mirrors public/js/sim/)
│  ├─ Challenge/  Leaderboard/  Moderation/  Notify/
│  └─ Db/                  PDO factory, migrations runner
├─ templates/              Server-rendered views
├─ bin/                    verifier.php · migrate.php · gc.php (log retention)
├─ migrations/             Numbered SQL files
├─ tests/                  php/ (PHPUnit), js/, golden/ (shared replay vectors), e2e/ (Playwright)
├─ config/                 config.php (reads env), scoring.php (versioned constants)
├─ REUSE.toml · LICENSES/ · README.md
```

### 5.4 Request pipeline

`index.php` → load config → open session (if cookie) → **rate limit** (per IP and per user, per route class) → **CSRF check** on state-changing methods → route match → **authorisation** (role check plus object ownership, done in the handler; never trust ids from the client) → handler → response with security headers (§11.4).

---

## 6. From Gloamhollow to the Tombwright engine

### 6.1 What Gloamhollow has today

One HTML file: three.js r128 from a CDN; a hand-written map in code; game logic tied to variable frame time with floats; puzzles wired by hand; progress saved in `localStorage`. Rendering (procedural textures, pixel sprites, lantern lighting), audio, HUD, touch and mouse input, and the tool mechanics (hood, pole, pebbles, oil) carry over almost unchanged.

### 6.2 Required changes

| Area | Today | Tombwright |
|---|---|---|
| Map | Constants in source | Loaded from GDF; component factories build meshes |
| Time | Variable `dt` per frame | Fixed 30 Hz ticks; renderer interpolates between the last two states |
| Numbers | JS floats | Integers: millimetres for position (1 cell = 2400), angles in 1/4096 turn |
| Trig | `Math.sin` / `Math.cos` | Integer sine table (4096 entries, scaled by 2¹⁴), shipped as data with its SHA-256 pinned in both cores |
| Square roots | `Math.hypot` | Integer square root (`isqrt`), specified and test-vectored |
| Randomness | `Math.random` | Seeded xoshiro128**, 32-bit operations masked explicitly (it only multiplies by 5 and 9, so it can't overflow PHP's 64-bit ints) |
| Timers | `setTimeout` mixed with game time | Tick-scheduled events only |
| Puzzles | Hard-coded functions | Generic components plus the §4.3 trigger/effect graph |
| Save | `localStorage` snapshot | Server-side run record; local storage only for unsent drafts |
| three.js | r128 via CDN | Vendored, pinned current release. The colour-management renames in r152 (`outputEncoding` → `outputColorSpace`, `texture.encoding` → `colorSpace`) need a migration pass. |

### 6.3 The sim core contract

```
world  = Sim.load(gdf)                        // immutable map, never hashed (decision #10)
state  = Sim.init(world, seed, mode)          // canonical, integer-only, JSON-serialisable; names its world
events = Sim.step(world, state, input)        // advances exactly one tick, mutates state, returns events
hash   = Sim.hash(state)                      // SHA-256 over the canonical serialisation, truncated to 16 bytes
```

- `input` per tick: `{ move: [fw, strafe] ∈ int8², yaw: uint12, pitch: int8, buttons: uint16, target: uint16 }`. Buttons: strike, hood, probe, pebble, oil, interact, run, rise.
- `events` (deaths, pickups, messages, sounds) drive the HUD and audio. The renderer never changes `state`.
- **Same inputs, same GDF, same seed → same state hash on every tick, in JS and in PHP.** This is the single most important invariant in the project.

### 6.4 Keeping two implementations in lockstep

Two codebases implementing one rule set will drift. Mitigations:

1. **Golden vectors.** `tests/golden/` holds dungeons plus input logs plus the expected state hash every 300 ticks. CI runs both cores and fails on any mismatch.
2. **Generated vectors.** A fuzzer produces random small dungeons and random input streams; both cores must agree. Run nightly, and on every change under `sim/`.
3. **Desync forensics.** Clients send a state hash every 300 ticks with their log, so the verifier can name the first tick where the two cores disagree.
4. **One spec.** `docs/sim-rules.md` is normative; both cores cite rule ids in comments.

> **Alternative to weigh (§17, Q2):** run the JS sim core on the server instead (a sandboxed Node or Deno worker). That removes the second implementation, at the cost of a second runtime beside PHP. This draft keeps PHP to match your stack.

---

## 7. Dungeon format (GDF v1)

### 7.1 Shape

```json
{
  "gdf": 1,
  "meta": { "title": "The Drowned Choir", "lang": "en", "authorId": 1042 },
  "grid": { "w": 44, "h": 63, "cells": "<base64 of uint8 per cell, RLE>" },
  "zones": [
    { "id": "z1", "name": "The Vestibule", "rects": [[31,56,7,6]], "ceil": 4200,
      "checkpoint": { "cell": [34,60], "yaw": 0 } }
  ],
  "start": { "cell": [34,61] },
  "exit":  { "cell": [7,27], "requires": "bossDefeated" },
  "entities": [
    { "id": "d1", "type": "door", "cell": [34,55], "style": "stone", "opens": "interact" },
    { "id": "b1", "type": "bellSet", "bells": [
        { "cell": [17,25], "size": 3, "patina": 0, "note": 98 },
        { "cell": [18,25], "size": 1, "patina": 2, "note": 330 } ],
      "order": [1, 0] },
    { "id": "t1", "type": "inscription", "style": "plaque", "wall": [[33,56],"n"],
      "title": "To whoever comes with a light", "pages": ["…"] },
    { "id": "bt1", "type": "button", "wall": [[20,6],"e"], "behaviour": "press", "pressedBy": "hand", "glyph": "moon" },
    { "id": "bt2", "type": "button", "wall": [[26,3],"w"], "behaviour": "timed", "downTicks": 150, "pressedBy": "pebble", "glyph": "eye" },
    { "id": "f1", "type": "foe", "kind": "medusa", "cell": [18,24], "start": "idle", "group": "garden" },
    { "id": "f2", "type": "foe", "kind": "xeroc", "cell": [33,2], "start": "asleep", "disguise": "chest" },
    { "id": "g1", "type": "foeGroup", "tiers": [1,2], "count": 3, "zone": "z4", "start": "asleep", "group": "crypt",
      "picked": ["zombie", "hobgoblin", "snake"] }
  ],
  "links": [
    { "id": 1, "when": { "bellsSolved": "b1" }, "do": [{ "openDoor": "d2" }] },
    { "id": 2, "when": { "bellsWrong": "b1" },  "do": [{ "damage": 28 }], "repeat": true },
    { "id": 3,
      "when": { "all": [ { "buttonPressed": "bt1" },
                         { "buttonDown": "bt2" },
                         { "not": { "lanternHooded": true } } ],
                "within": 120 },
      "do":   [ { "openDoor": "d5" }, { "message": "Somewhere below, stone grinds against stone." } ],
      "undo": [ { "closeDoor": "d5" } ],
      "repeat": true, "delay": 15 },
    { "id": 4,
      "when": { "sequence": [ { "buttonPressed": "bt1" }, { "linkFired": 3 } ],
                "within": 900, "strict": true, "onWrong": [ { "damage": 15 } ] },
      "do":   [ { "reveal": "chest3" } ] }
  ]
}
```

A `when` is either one trigger object (`{ "buttonPressed": "bt1" }`) or a gate object with exactly one of the keys `all`, `any`, `atLeast` (with `k`), `sequence` or `not`. Gate options (`within`, `strict`, `onWrong`) sit next to that key. The validator checks that `sequence` holds only events and `not` only a condition.

Cell codes: `0` wall · `1` room · `2` corridor · `3` plate · `4` hidden pit · `5` void · `6` bridge · `7` vent · `8` alcove trap.

### 7.2 Limits

| Item | Limit |
|---|---|
| GDF size | ≤ 256 KiB, JSON nesting depth ≤ 12 |
| Grid | ≤ 64 × 64 |
| Zones / checkpoints | ≤ 16 / ≤ 12 |
| Entities / links | ≤ 400 / ≤ 64 |
| Buttons / levers | ≤ 32 / ≤ 32 |
| Trigger terms per link / gate nesting / terms per gate | ≤ 16 / ≤ 4 / 2–8 |
| `within` / `delay` | ≤ 1,800 ticks (60 s) / ≤ 600 ticks (20 s) |
| Foes | ≤ 24, at most 8 awake at once; threat budget 100 points (§4.9.2); ≤ 1 boss |
| Inscriptions | ≤ 24, ≤ 1,500 characters each, ≤ 8 pages |
| Title | ≤ 60 characters |

### 7.3 Validation pipeline (on every save and on publish)

1. **Parse:** size and depth caps first, then `json_decode` with `JSON_THROW_ON_ERROR` and an explicit depth.
2. **Schema:** a hand-written validator (no framework); every field typed, bounded and enumerated; unknown fields rejected.
3. **Canonicalise:** sort keys, normalise numbers, NFC-normalise strings → `content_sha256`.
4. **Structure:** the grid is closed by walls; zones lie inside the grid and don't overlap; exactly one start and one exit; every entity sits on a legal cell; checkpoint spawn cells are safe and at least one cell from any lethal cell.
5. **Foes:** kinds exist in the pinned bestiary version; the threat budget holds; no foe starts on a lethal cell unless it flies; no foe starts within 3 cells of a checkpoint spawn; mixed groups are resolved into `picked` at publish time.
6. **Graph:** the exit is reachable from the start when every door counts as open (an upper bound). Links reference existing ids. The link dependency graph (link → the conditions and events it reads → the links whose effects can change them) has no cycles. `sequence` holds only events, `not` only a condition, `atLeast.k` lies between 1 and the number of terms, and pebble-only buttons are in line of sight of a floor cell a pebble can be thrown from.
7. **Text:** length caps, control characters stripped, URLs rejected, blocklist check (§11.6).
8. **Publish only:** a verified proof run (§8) of *this exact* `content_sha256` by the author, in Delve mode.

---

## 8. Runs and verification

### 8.1 Run lifecycle

```
POST /runs ──► started ──(client plays, records inputs)──► POST /runs/{id}/finish ──► queued
                  │                                                                    │
                  └── abandoned (no finish within 6 h)                       verifier replays
                                                                                       │
                                                                   verified ◄──────────┴──► rejected (reason)
```

- `POST /runs` returns `run_id`, `seed` (server-chosen, 32 bits), the version's `content_sha256`, and the server start time. The seed decides foe behaviour, so it can't be picked by the player.
- **Wall-clock check:** a run's game time can't exceed the real time the server saw between start and finish, plus 2 % and 5 seconds of tolerance. Speed hacks fail here. Pausing is fine, since real time then simply exceeds game time.
- **Tick cap:** 54,000 ticks (30 min of game time) for a scored run.

### 8.2 Input log

- Binary and change-based: `varint tickDelta · uint8 fieldMask · changed fields`. Only changes are written, so standing still costs nothing.
- State hash every 300 ticks appended for desync forensics.
- Sent gzip-compressed. Server caps: ≤ 1 MiB compressed, ≤ 8 MiB decompressed (enforced while inflating, chunk by chunk, so a decompression bomb is cut off early).
- Expected size for a 10-minute run: tens of kilobytes.

### 8.3 Verifier

- `bin/verifier.php` claims jobs with `SELECT … FOR UPDATE SKIP LOCKED` (confirm support on the deployed MariaDB version), runs `Sim.init` + `Sim.step` for each tick, and compares hashes.
- Result: `cleared, ticks, deaths, treasure, deathCauses`, computed by the server. Whatever the client claimed is only used to report a mismatch.
- Limits per job: CPU time 10 s, memory 128 MiB. A job over its limit is rejected as `too_expensive` and logged for review.
- Rejection reasons are stored and shown to the player in plain words ("your run disagreed with the server at 4:12, in the Mirror Vault"). Rejections are rare and usually mean a bug, so every one is logged with the client build id.
- Top-10 leaderboard entries keep their full input log for replays and spot checks. Other logs are pruned after 30 days.

### 8.4 Chamber streaming (phase 2, against reading the map out of the client)

**The problem:** the client must hold the dungeon to simulate it, so anyone can read every hidden pit and plate out of the downloaded GDF. Replay stops *impossible* runs, but not *informed* ones.

**The mitigation:** split the GDF per zone. The client starts with the first chamber only. At each checkpoint it posts the segment's inputs; the server replays that segment (fast, since segments are short), and only if it verifies does it return the next chamber's data. This also makes verification incremental, which spreads server load.

**Residual risk:** a player can still read the chamber they're standing in, and someone who has run a dungeon can share its layout. Accept this. Ironman boards and blind first-clear badges reward people who play it straight. Spec it, test it with the golden vectors, and switch it on per dungeon once it's stable.

### 8.5 Ghosts and replays

Since a verified run is just inputs, the client can replay any stored run (your best, the leader's) as a ghost in Practice mode. The data is already there, so this costs almost nothing extra.

---

## 9. Data model (MariaDB)

All tables InnoDB, `utf8mb4`, UTC timestamps; ids `BIGINT UNSIGNED` unless noted.

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, handle (unique, 3–24 chars), email (unique), email_verified_at, pw_hash, totp_secret_enc, role (`player`/`moderator`/`admin`), status, created_at | Email is used for login and recovery only |
| `webauthn_credentials` | id, user_id, credential_id, public_key, sign_count, created_at | Phase 2 |
| `sessions` | id (SHA-256 of token), user_id, created_at, last_seen_at, ip_prefix, ua_hash, revoked_at | Token itself lives only in the cookie |
| `auth_events` | id, user_id null, kind, ip_prefix, at | Audit of logins, failures, MFA changes |
| `dungeons` | id, owner_id, slug, title, status (`draft`/`proven`/`published`/`hidden`/`removed`), current_version_id, created_at, updated_at | |
| `dungeon_drafts` | dungeon_id, revision, gdf (MEDIUMTEXT), updated_at | Optimistic locking on revision |
| `dungeon_versions` | id, dungeon_id, version_no, content_sha256 (unique), gdf, proof_run_id, published_at | Immutable |
| `runs` | id (ULID, BINARY(16)), user_id, version_id, mode, seed, status, started_at, finished_at, wall_ms, ticks, deaths, treasure, cleared, score, score_formula_v, client_build, reject_reason | Index (version_id, mode, cleared, deaths, ticks) |
| `run_logs` | run_id, segment_no, log (MEDIUMBLOB), sha256, retain_until | Pruned by `bin/gc.php` |
| `challenges` | id, kind, from_user, to_user null, version_id, mode, target json, expires_at, status, result_run_id, created_at | |
| `ratings` | user_id, version_id, liked, fair_votes json, updated_at | PK (user_id, version_id) |
| `reports` | id, reporter_id null, reporter_email null, target_type, target_id, category, explanation, created_at, status | Notice intake (§11.6) |
| `moderation_actions` | id, report_id null, target_type, target_id, action, ground (`law`/`terms`), reasons, automated (bool), decided_by, decided_at | Statement of reasons source |
| `notifications` | id, user_id, kind, payload json, created_at, read_at | |
| `jobs` | id, kind, payload json, status, attempts, run_after, locked_by, locked_at | Verifier queue |
| `audit_log` | id, actor_id, action, target, details json, at | Append-only; admin actions |

---

## 10. API (JSON, `/api/v1`)

Session cookie authentication; a CSRF token header on every state-changing call; JSON request bodies capped per route.

| Method | Path | Auth | Purpose | Rate limit |
|---|---|---|---|---|
| POST | `/auth/register` | — | Create account, send verification mail | 5/h per IP |
| POST | `/auth/login` | — | Password (+ TOTP if enrolled) | §11.2 |
| POST | `/auth/logout` | user | Revoke session | — |
| POST | `/auth/mfa/totp` | user | Enrol or remove TOTP (re-auth required) | 10/h |
| GET | `/dungeons?sort=&q=&page=` | — | Browse published | 120/min |
| POST | `/dungeons` | user | New draft | 20/day |
| GET / PUT | `/dungeons/{id}/draft` | owner | Load or save draft (revision check) | 60/min |
| POST | `/dungeons/{id}/validate` | owner | Full validation report | 30/min |
| POST | `/dungeons/{id}/publish` | owner | Requires a verified proof run of the draft hash | 10/day |
| GET | `/versions/{hash}` | — | Published GDF (whole, or per zone in phase 2) | 120/min |
| POST | `/runs` | user | Start a scored run (or proof run) | 30/h |
| POST | `/runs/{id}/segment` | owner | Phase 2: post segment, get next chamber | 60/min |
| POST | `/runs/{id}/finish` | owner | Upload log; queue verification | 30/h |
| GET | `/runs/{id}` | owner | Status, result, rejection reason | 120/min |
| GET | `/versions/{hash}/leaderboard?mode=&sort=` | — | Top 100 + your rank | 120/min |
| GET | `/runs/{id}/replay` | — | Input log of a leaderboard run | 30/min |
| POST | `/challenges` | user | Create direct challenge or bounty | 10 open max |
| POST | `/challenges/{id}/accept` / `decline` | recipient | | 60/min |
| GET | `/me/inbox` | user | Challenges and notifications | 60/min |
| PUT | `/versions/{hash}/rating` | user (has run it) | Like/dislike, fairness votes | 60/min |
| POST | `/reports` | — | Notice of illegal content or a terms breach | 10/h per IP |
| GET/POST | `/admin/…` | moderator/admin + MFA | Review queue, actions | — |

---

## 11. Security

### 11.1 Threat model (summary)

| Asset | Threat (STRIDE) | Mitigation |
|---|---|---|
| Accounts | **S**: credential stuffing, phishing | NIST SP 800-63B-4 password rules, breached-password check, throttling, optional TOTP (WebAuthn in phase 2), MFA mandatory for staff |
| Leaderboards, challenges | **T**: forged results, edited client, speed hacks | Server replay (§8.3), server seed, wall-clock check, tick cap |
| Hidden trap data | **I**: reading the map from the client | Chamber streaming (§8.4); accepted residual risk |
| Dungeon content | **T**: malformed or hostile GDF | Strict schema, caps, canonicalisation, data-only format (no scripts) |
| Players' browsers | **T/E**: XSS through titles or inscriptions | Text only, output encoding everywhere, `textContent` in the client, CSP without inline script |
| Verifier, server | **D**: huge logs, decompression bombs, CPU exhaustion | Size caps, streaming inflate cap, per-job CPU/memory limits, queues, per-user quotas |
| Drafts, runs, inbox | **E/I**: IDOR | Ownership checked in every handler; opaque ULIDs for runs |
| Moderation, admin | **E**: privilege escalation | Separate role checks, MFA required, audit log, no admin actions over GET |
| Actions | **R**: disputes over removals or results | Audit log, stored statements of reasons, stored rejection reasons |

### 11.2 Authentication (baseline: NIST SP 800-63B-4)

SP 800-63B-4 was published as final in July 2025 and supersedes the earlier SP 800-63B, so this draft targets it.

- **Passwords:** at least 15 characters when the password is the only factor, at least 8 when the account has a second factor; accept at least 64 characters; no composition rules; no scheduled rotation; check against a blocklist of common and breached passwords. Hash with `password_hash()` using Argon2id.
- **Breached-password check:** a k-anonymity range query to a breach corpus, or a local blocklist file if you'd rather avoid any third-party call (§17).
- **Throttling:** per account and per IP; exponential backoff; no permanent lockout (it invites denial of service against known handles).
- **MFA:** TOTP in v1, WebAuthn/passkeys in phase 2; recovery codes (10, single use, hashed).
- **Recovery:** email link, single use, 30 minutes, invalidates all sessions after a reset.
- **No security questions, no password hints.**

### 11.3 Sessions and CSRF

- Token: 32 random bytes; cookie `__Host-tw`, `Secure; HttpOnly; SameSite=Lax; Path=/`; only its SHA-256 is stored.
- Rotate on login and on privilege change; idle timeout 30 days for players, 12 h for staff; "sign out everywhere" in settings.
- CSRF: a synchronizer token per session, sent as a header by the JS clients and as a hidden field by forms; also reject state-changing requests whose `Origin` doesn't match.

### 11.4 Transport and headers

- TLS only, HSTS (with preload once stable).
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. The engine's inline script and styles move into files.
- Self-host the fonts and three.js. No third-party requests from game pages (privacy and supply chain). Check the fonts' licences before vendoring them.
- `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying camera, microphone and geolocation.

### 11.5 Input handling

- Every JSON body: size cap before parsing, explicit `json_decode` depth, schema validation, typed DTOs.
- PDO with prepared statements only; `PDO::ATTR_EMULATE_PREPARES = false`; a least-privilege DB user for the web app and a separate one for migrations.
- Binary logs: parsed by a bounded decoder (every length checked against remaining bytes).

### 11.6 User content and moderation

- **Text:** inscriptions, titles and handles are plain text. Control characters are stripped and strings NFC-normalised. URLs are rejected. A blocklist filter runs in DE and EN; flagged text goes to the review queue rather than being silently rejected.
- **Notice and action:** as a host of user content, the service needs a notice-and-action mechanism under DSA Article 16 and a statement of reasons to the affected user under Article 17. Every dungeon page, inscription view and profile gets a "Report" action. `reports` and `moderation_actions` hold what those statements need: what was restricted, the facts, whether automation was involved, the legal or terms ground, and how to object.
- **Online-platform duties:** further duties (for example sending statements of reasons to the Commission's transparency database) apply to online platforms, and some have size-based exemptions. Which of them apply to Tombwright needs a legal check before launch (§17).
- **Imprint:** the German imprint duty now sits in § 5 DDG, which replaced § 5 TMG in May 2024.

### 11.7 Logging and monitoring

- Structured JSON logs; no passwords, tokens or full IPs (store /24 or /48 prefixes).
- Alerts on: verifier rejection rate above baseline, auth failure spikes, queue age > 5 min, disk > 80 %.
- Application-security target: **OWASP ASVS 5.0.0** (released May 2025), Level 2 for authentication, session management, input validation and access control; Level 1 elsewhere.

---

## 12. Privacy (GDPR)

| Data | Purpose | Retention |
|---|---|---|
| Email | Login, recovery, opt-in notifications | Until account deletion |
| Handle, published dungeons, ratings | Public profile, the service itself | Until deletion; dungeons can be kept anonymised (§13) |
| Runs (results) | Leaderboards, challenges | Until deletion, then anonymised |
| Run input logs | Verification, replays | 30 days, longer only for top-10 entries |
| Auth events, IP prefixes | Security | 90 days |
| Reports, moderation actions | Legal duties, appeals | 3 years (confirm with legal advice) |

- No analytics trackers, no third-party embeds, no ad tech.
- Local storage is used only for unsent drafts and UI preferences.
- Account deletion: immediate session revocation; personal data removed within 30 days; leaderboard entries renamed to "a forgotten thief".
- Data export: JSON of profile, dungeons, runs and ratings.

---

## 13. Licensing

- Engine and server code: MIT, matching your published code (EUPL-1.2 as the European alternative if you prefer copyleft).
- **Rogue:** Lantern Delve's foe names and base stats derive from Rogue 5.4 (Michael Toy, Ken Arnold, Glenn Wichman), which is distributed under a BSD licence. Ship its copyright notice and licence text in `LICENSES/` and list it in `REUSE.toml`; confirm the exact BSD variant from the 5.4.4 distribution's `LICENSE.TXT` before release.
- Original non-code assets (textures, sprite art, sound design notes, inscriptions written for the official tombs): CC BY-SA, declared with the REUSE spec (`REUSE.toml`, SPDX headers, `.license` sidecars). The Tombwright and SilverDay wordmarks are excluded.
- **User dungeons:** the terms need an explicit licence grant from author to platform (host, display, let others play and replay). Whether authors may *also* pick a public licence (for example CC BY-SA) for their GDF is open (§17).

---

## 14. Operations

- **Host:** one EU VPS to start; Apache 2.4 with PHP-FPM; MariaDB on the same host at first.
- **Versions:** your stack names PHP 8.3, but 8.3 is security-fix-only now and its support ends 31 Dec 2027. For a new project, target PHP 8.4 (security support to 31 Dec 2028) and keep the code 8.3-compatible. On MariaDB, 10.11 LTS is supported to February 2028; 11.4 LTS (to May 2029) is the better target.
- **Worker:** `tombwright-verifier@.service` (systemd template), start with 2 instances; `Restart=always`; resource limits via systemd (`CPUQuota`, `MemoryMax`) on top of the per-job limits.
- **Backups:** nightly `mariadb-dump` plus binary logs for point-in-time recovery; restore tested monthly; logs and backups encrypted at rest.
- **Deploys:** atomic symlink switch of release directories; migrations run before the switch; the sim core version is part of the client build id so the verifier can refuse logs from a retired core.
- **Sim core versioning:** a published version stores the sim core version it was proven with. The verifier keeps old cores available, so a rules fix doesn't silently invalidate old leaderboards.

---

## 15. Testing

| Layer | What | Tooling |
|---|---|---|
| Sim core | Golden replay vectors, JS and PHP must match hash-for-hash | PHPUnit, Node test runner, shared `tests/golden/` |
| Sim core | Differential fuzzing: random dungeons and inputs | Nightly job |
| GDF | Validator unit tests; fuzzed malformed JSON; limit edges | PHPUnit |
| Wiring | Truth tables for every gate in both cores; `within` window edges (tick N−1, N, N+1); SEQUENCE strict resets and `onWrong`; rising/falling edges with `repeat` and `undo`; `delay` across a death and a checkpoint restore; cycle detection, including cycles through effects | PHPUnit, Node test runner, golden vectors |
| Bestiary | Every foe power in both cores (freeze and hold timers, theft and drop, key never stolen, thief respawn after 20 s, wraith forgetting, mimic reveal by probe, phantom visible only when hooded); threat budget edges; mixed groups resolve identically from the same content hash; flier vs walker pathing over hazards | PHPUnit, Node test runner, golden vectors |
| Input log | Codec round-trips; truncated and oversized inputs; decompression bombs | PHPUnit |
| Gameplay | Scripted walkthroughs of the official tombs through a test hook (fast-forwarding fixed ticks, rendering off, as already used for Gloamhollow) | Playwright |
| API | Authorisation matrix: every route × every role × own/foreign object | PHPUnit |
| Security | ASVS checklist; ZAP baseline scan; dependency review (three.js only) | CI |
| Performance | Verifier time for a 30-minute log; 100 concurrent finishes | Load script |

---

## 16. Milestones

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **M0 — Engine split** | Sim core (JS) with fixed ticks, integers, xoshiro128**, sine table; renderer reads state; Gloamhollow re-expressed as a GDF file | Gloamhollow plays as before; the 80-check walkthrough passes |
| **M1 — PHP core** | PHP sim core; golden vectors; differential fuzzer; Lantern Delve's 26 foes and the Warden ported into both cores from `bestiary.v1.json` | 0 mismatches over 10,000 fuzz cases |
| **M2 — Builder** | Grid editor, component palette (including the full bestiary with live threat-budget counter), wiring view (trigger nodes, ALL / ANY / AT LEAST / SEQUENCE / NOT gates, effect nodes, live "would fire now" highlighting during playtest), live validation, playtest | Gloamhollow can be rebuilt in the editor; the four §4.3.6 examples work |
| **M3 — Server MVP** | Accounts (800-63B-4), drafts, proof runs, publishing, verified runs, leaderboards | First closed-beta dungeons published |
| **M4 — Challenges** | Direct challenges, bounties, inbox, opt-in email | 20 testers completing challenges |
| **M5 — Hardening** | Moderation queue, reports, statements of reasons, ASVS L2 review, backups tested | Launch checklist signed off |
| **M6 — Phase 2** | Chamber streaming, ghosts, WebAuthn, duels | |

---

## 17. Open questions

1. **Async only?** Is asynchronous play enough for "challenge", or do you want live races later? Live races would need a WebSocket service outside the PHP request model.
2. **Verifier runtime:** PHP re-implementation (this draft, your stack) or the JS core on a sandboxed Node/Deno worker (one implementation, two runtimes)?
3. **Guest play:** may guests play published dungeons unscored, or is an account required for everything?
4. **Breached-password check:** an external k-anonymity range API, or only a local blocklist (no third-party call)?
5. **User content licence:** platform licence only, or let authors add a public licence such as CC BY-SA?
6. **DSA scope:** which online-platform duties apply at launch size? Needs a legal check.
7. **Player rating:** add a skill rating (for matching challenges to ability), or keep plain stats?
8. **Monetisation:** none, a supporter tier, or paid extras (more dungeon slots, cosmetic lantern styles)? If paid, central billing across SilverDay projects or per project?
9. **Name and domain:** keep "Tombwright", or a name that ties it to Gloamhollow or Wizard's Castle? Shared accounts with other SilverDay projects?
10. **Languages:** DE and EN for UI only, or also tagging and filtering dungeons by language?

11. **Foes and traps:** should walking foes be able to set off traps (lure a troll onto a pressure plate)? This draft says no, so traps stay predictable; allowing it would make foes a puzzle tool but complicates fairness.
12. **Bestiary tuning:** the conversion in §4.9.1 is a mechanical first pass. Do you want a playtest round to retune the expensive foes before beta, or ship as is and retune in `bestiary.v2`?
---

## Sources

- NIST SP 800-63B-4 (final, July 2025): https://csrc.nist.gov/pubs/sp/800/63/b/4/final
- NIST SP 800-63B-4, password rules (§3.1.1.2): https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP ASVS (5.0.0, May 2025): https://github.com/OWASP/ASVS
- DSA Art. 17 and the transparency database (European Commission FAQ): https://digital-strategy.ec.europa.eu/en/faqs/dsa-transparency-database-questions-and-answers
- DSA Art. 16 and Art. 17 for hosting services: https://presencis.com/regulations/dsa/article-16/ · https://prighter.com/resources/laws/dsa/articles/article-17
- § 5 DDG replaces § 5 TMG (IHK Nürnberg): https://www.ihk-nuernberg.de/ihr-unternehmen/rechtsinformationen-fuer-unternehmen/internetrecht-recht-des-e-commerce/impressumspflicht
- PHP support dates: https://endoflife.date/PHP
- MariaDB LTS end-of-life dates: https://endoflife.ai/article-mariadb-eol.html
- Rogue 5.4.4 licence and authors: https://packages.altlinux.org/en/p11/srpms/rogue/ · https://github.com/sagemathinc/rogue
- three.js r152 colour-management changes: https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791
