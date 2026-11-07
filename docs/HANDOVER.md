# Handover: Tombwright (updated 2026-11-06 by Copilot, for the next AI)

**Start here:** everything up to core m0.15 (step 7d) is on `main` and deployed; M1 is complete.
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

## Follow-ups from the 7d review (do these before M2)

The `sim-parity-reviewer` found **no desync between the cores**; two findings were left open on purpose:

- **The fuzzer barely reaches R-WARDEN-3/4.** Over 600 generated cases it produced 13 `deepWarden` tombs, 0 calls
  and 0 volleys: a random tomb rarely has a `wakeBoss` link, and the volley needs 16 blows on a 30-strike boss.
  Make `tests/fuzz/gen.mjs` always emit a `wakeBoss` link for a `deepWarden`, raise the boss chance (~45 %, so the
  Candle-Eater keeps her share), and add a golden vector that volleys for several hundred ticks. `summon: 1`, the
  "no free ring spot" break and the over-the-cap wake queue are exercised nowhere today.
- **The new R-INT-2 bound comments hold only because the bestiary is pinned by SHA-256** (they assume
  `ranged.speed <= 11000`, `volleySpeed <= 8000`, `ring < 4096`). A range check on those fields in both bestiary
  loaders would make the comments self-enforcing before a v2 bestiary exists.

Checks at the 7d commit, all green: purity lint, `npm test` (103), `vendor/bin/phpunit` (69, 1 skipped),
`composer lint`, the fuzzer (10,000 cases, 0 mismatches), `npm run e2e`. Don't run the fuzzer beside the e2e: the
walkthrough then hits its 10-minute timeout (alone ~2 minutes).

## Next: M2, the builder

- **M2 is the tomb builder** (spec §16, §4.2, §4.3): the in-browser editor, the proof run, and the GDF a tomb is saved
  as. Nothing of it exists yet; the sim core, the GDF loader and the link engine it builds on are finished and frozen
  behind `CORE_VERSION`.
- **Ask the owner** before starting: the spec leaves the editor's shape fairly open, and §17's open questions
  (Q1, Q3, Q5, Q7) touch it.

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
