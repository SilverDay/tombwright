# Handover: Tombwright (updated 2026-11-06 by Copilot, for the next AI)

**Start here:** M1 is complete. Core m0.15 (step 7d) is deployed; **m0.16** (item names) and builder slice 2 are on `main` and wait for the owner's deploy.
Read `CLAUDE.md` first: its ground rules are binding (never guess, ask the owner, log every answer in
`docs/decisions.md`, keep the JS and PHP sim cores identical, use the `sim-change` skill for any rule change).
This file says where the work stands and what to do next.

## Where things stand

- **Repo:** github.com/SilverDay/tombwright (public). The owner wants work committed straight to `main` once the
  tests pass (decision #13), authored as `SilverDay <klingner@silverday.de>`
  (`git -c user.name=SilverDay -c user.email=klingner@silverday.de commit ...`).
- **Live site:** https://tombwright.silverday.de is a git checkout of `main` in `/srv/vhosts/tombwright.silverday.de`
  (DocumentRoot `public/`). It runs core **m0.15**: the landing page at `/`, the game at `/play/gloamhollow`.
  - **Deploy:** in that directory, `git pull --ff-only` then `composer install --no-dev --optimize-autoloader`. Both
    commands are allowed in `.claude/settings.local.json`.
  - **Check:** `curl https://tombwright.silverday.de/healthz` reports the core version.
- **Milestones (spec §16):**
  - **M0 is done:** Gloamhollow plays on the sim core; both e2e walkthroughs pass.
  - **M1 is done:** the PHP core, the golden vectors, the differential fuzzer (0 mismatches over 10,000 cases) and
    Lantern Delve's foes in four steps (decision #61): 7a (m0.12), 7b (m0.13), 7c (m0.14) and
    **7d (m0.15, projectiles, the dragon's breath and the Warden of the Deep, decisions #72-#78)**.
  - **M2 (the builder) is next** (spec §16, §4.2, §4.3). The owner expected the builder at `/` and was told it is M2;
    they said to continue the plan.
- **The landing page is done:** `public/index.php` routes GET/HEAD by the `PAGES` allow-list (`/` -> `templates/home.php`
  with `$siteUrl`, `/play/gloamhollow` -> `templates/game.php`); the client takes the tomb name from the path
  (allow-list in `boot()`, `public/js/game/main.js`); the banner is in the README and `REUSE.toml` marks the images all
  rights reserved (`LICENSES/LicenseRef-SilverDay-AllRightsReserved.txt`, spec §13 excludes the wordmark from CC BY-SA).
  The owner has uploaded the social-preview image (`public/assets/images/tombwright-og-1200x630.jpg`) in the repo
  settings.

## Closed after 7d

The 7d review's two open findings are done: the fuzzer now gives every `deepWarden` a `wakeBoss` link and a dormant
`wd` group to call, and also starts from the golden Warden rooms (calls, `summon: 1` and a few volleys now happen in
a few hundred cases); vectors 0053 (call at the awake cap, `summon: 1`) and 0054 (no free ring spot) cover the call's
edges; both bestiary loaders range-check `ranged.speed`, `volleySpeed` and `ring`. The fuzzer still rarely reaches the
volley (it needs 16 blows); vectors 0049/0050 cover it.
Playwright runs with one worker (the single-threaded `php -S` can't serve parallel walkthroughs: they timed out). Don't run the fuzzer beside the e2e walkthroughs: the walkthrough then hits its 10-minute timeout (alone ~2 minutes).

## Next: M2, the builder

- **M2 is the tomb builder** (spec §16, §4.2, §4.3): the in-browser editor, the proof run, and the GDF a tomb is saved
  as. Nothing of it exists yet; the sim core, the GDF loader and the link engine it builds on are finished and frozen
  behind `CORE_VERSION`.
- **Decided (#79-#82):** browser autosave plus `.gdf.json` import/export, a 2D top-down editor at `/build` with
  Playtest in the existing 3D client, five slices (see #81), Q1/Q3/Q5/Q7 stay open until M3. Decisions #83-#85: Playtest runs in practice mode, `/build` is public as a preview, an exit is optional while building.
  **Slice 1 is done** (the grid, chambers, start/exit, checkpoints, import/export/autosave, live validation by
  `Sim.load`, `/play/test`): code in `public/js/build/` (`model.js` is DOM-free and unit-tested, `validate.js` wraps the
  core's loader, `main.js` is the UI), `templates/build.php`, `tests/e2e/build.spec.mjs`. Everything it doesn't edit
  (entities, links, dressing) passes through untouched; a test proves Gloamhollow round-trips. **Slice 2 is done** (decisions #86-#87): core **m0.16** adds an optional display-only `name` on treasure and key
  items (R-ITEM-1; the client's `itemName` in `game/text.js` shows it). The builder now places doors, slabs, vents,
  alcoves, chests, items, inscriptions, torches, masons' marks, props and decor, and waking eyes per chamber. The
  design is `public/js/build/entities.js`: one `PALETTE` + `FIELDS` table (UI metadata only; `Sim.load` is still the
  validator), with `place`, `move`, `setField` (which adds and drops the keys that go with an option, since the loader
  wants exact key sets), unit-tested in `tests/js/build-entities.test.mjs`; the inspector, Select / move tool and
  the palette are in `main.js`. A vent cell without a vent entity is a load error (the loader says so; place the
  Fire vent tool on it). Doors that open on a trigger and hidden items warn until a link exists (slice 4).
  Entities can't be renamed (links will refer to ids).
  **Slice 3 is done** (decisions #88-#90): braziers, bells (a bell set is made by the Bell tool: the first bell starts
  a set, later bells join the *selected* set or bell; the set's ring order is in its inspector), the lamp hook, mirrors,
  crystals, foes (kind chosen in the list under Things; the threat counter shows tier² of 100, foes of 24, awake of 8)
  and the boss (inside a chamber; the Warden's `summons` names a foe group). Foes or a boss add the top-level
  `bestiary: 1`. Bells are named in the client by size and patina. The game page now has a way out on every card
  (anchor `a.leave`: `/` for an official tomb, `/build` for a playtest). The landing page does **not** link to `/build`
  (owner, #89) until access control exists. Dormant foes and trigger doors warn until a link wires them.
  **Slice 4 is done** (decisions #91-#93): the **Wiring** tab of the builder (`public/js/build/wiring.js`, over the pure
  `public/js/build/links.js`, tested in `tests/js/build-links.test.mjs`): each link a card with its `when` as a nested
  tree (events ◆ and conditions ■ by colour; gates ALL / ANY / AT LEAST / SEQUENCE / NOT with their options), Do / Undo
  lists, repeat and delay. `links.js` knows exactly the triggers and effects the core has today (R-LINK-2/3), refuses
  shapes the core refuses (a sequence takes events only, a NOT a condition, 4 levels, 8 terms, 16 triggers) and its
  slot map is tested against the core's memory layout. The playtest page has a live **Wiring** panel (chip or the `L`
  key; `public/js/game/wiring-live.js`, display only): per link "true now / active / used up / effects in N s", and
  when each event trigger last fired. The node-graph canvas is V2 (#91).
  **Step 4b is done** (core **m0.17**, decisions #92, #94-#97, rules R-BTN-1..5 and R-LEVER-1/2): `button` entities
  (wall-mounted or on a pedestal; press / latch / toggle / timed; hand, pebble or both; 16 rune glyphs; concealed until the
  pole finds them) and `lever` (once / toggle), the events `buttonPressed` and `pebbleHit`, the conditions `buttonDown` and
  `leverOn`, `interact` on a lever, and the effects `grantItem`, `resetButton`, `setLeverOn` / `setLeverOff`. Pebbles hit a
  wall button when the flight is stopped by its wall from the cell in front, a pedestal when they land within 0.6 m
  (`state.flying` entries carry `w`). `plateStepped` is deferred (#97). The builder places buttons and levers (palette,
  inspector, wiring tables); the game draws them (runes in `game/textures.js`, `makeGlyph`), prompts "Press the moon
  button" / "Pull the lever", and the live panel reads them. Vectors 0055-0057 and the `buttons:` load cases cover them;
  the fuzzer generates them (and the button room).
  **Slice 5 is done: M2 (the builder) is complete** (decision #98): `tests/js/build-rebuild.test.mjs` rebuilds Gloamhollow
  from an empty tomb with only the builder's operations (paint, chambers, palette, inspector setters, renames, the wiring
  model) and checks it equals `dungeons/gloamhollow.gdf.json`; and builds and plays the four spec §4.3.6 examples. New for
  that: `public/js/build/rename.js` (ids and link numbers, references follow), chamber tint / walls / checkpoint facing and
  reach, exact millimetre positions, the exit's requirement. Known V2 items: the node-graph wiring canvas (#91),
  `plateStepped` (#97), per-vent cell editing, reordering entities (only the sim's numbering sees it), a 3D preview.
  **Next: M3, the server MVP** (spec §16, §5, §8-§11): accounts (NIST 800-63B-4), drafts, proof runs, publishing, verified
  runs, leaderboards. **Ask the owner first**: Q1 async only, Q3 guest play, Q4 breached-password check, Q5 content licence,
  Q7 player rating; and when `/build` gets its access control (#89) and a link from the landing page.

### What 7d left behind (worth knowing)

- **Projectiles** are `state.shots` (R-SHOT-1/2/3): three substeps a tick, stopped by solid cells and props, hitting
  only the player. The dragon's breath (R-BREATH-1) is a bestiary `ranged` block, so any kind can get one.
- **The Warden of the Deep** is the boss kind `deepWarden` (R-WARDEN-1..4). Boss kinds now carry a `behaviour`
  (`eater` or `warden`) and the boss update branches on it. She calls the dormant foes of the group named by the
  boss entity's new optional `summons` key (decisions #77, #78).
- **The bestiary file changed** (the dragon's `ranged`, the bosses' `behaviour`, `deepWarden`), so
  `BESTIARY_SHA256` moved in both cores. The version is still 1: nothing is published yet.
- **Events are not compared between the cores** by any test: the vectors and the fuzzer compare state hashes only.
  7d's events were checked once by hand (JS vs PHP, the six new vectors, identical). A standing event-parity check
  would be worth adding when the server starts replaying runs.
- **No official tomb has a dragon or the Warden yet,** so the client's new drawing (the shots, her sprite) is only
  exercised by hand; the e2e walkthroughs play Gloamhollow, which has neither.

## Working notes

- **Clone and paths:**
  - Work in a scratchpad clone, not in the vhost. Clone from GitHub and run `npm ci` and `composer install`.
- **Commands:**
  - Tests: `npm test`, `vendor/bin/phpunit`, `node scripts/check-sim-purity.mjs`, `composer lint`,
    `npm run golden:regen` (after rule changes).
  - Fuzz: `node tests/fuzz/run.mjs --cases 2000 --jobs 4`; `--case N` reproduces one case.
  - Walkthroughs: `npm run e2e`. **Mind stale `php -S` servers on port 8765** (`reuseExistingServer: true` in
    `playwright.config.mjs` happily reuses one running old code); kill them by PID first. Each walkthrough has a
    10-minute timeout and takes about 2 minutes on an idle machine: don't run a fuzz job beside it, or it times out.
- **Headless Chromium on this server:**
  - Set `LD_LIBRARY_PATH` to
    `/tmp/claude-1000/-srv-vhosts-tombwright-silverday-de/b8540504-b0d2-45aa-bbf6-2c27cfb0ed20/scratchpad/chromelibs/root/usr/lib/x86_64-linux-gnu`
    (extracted .debs, no sudo). If it's gone, re-extract `libatk` and the others from Ubuntu .debs.
  - WebGL needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - Screenshots: set `window.__twNoRender` and `window.__twTest` before boot, then call
    `game.view.frame(...)` once by hand.
- **Dev server:** `php -S 127.0.0.1:8765 -t public tests/e2e/lib/dev-router.php`.
- **Avoid `pkill -f` with a pattern** that also matches your own shell command; it kills the shell.
- **Before committing:**
  - Run the `sim-parity-reviewer` agent on every sim-core change.
  - Run the `security-reviewer` agent on changes under `src/Http`, `public/index.php` and friends.
  - Respect the CSP: no inline `<script>`, `<style>`, `style=` or `on*=` attributes; set text with `textContent`.
- **Memory:** the owner's Claude memory is in `~/.claude/projects/-srv-vhosts-tombwright-silverday-de/memory/`
  (`tombwright-progress.md`).
