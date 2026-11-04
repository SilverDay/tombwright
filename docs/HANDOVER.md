# Handover: Tombwright (updated 2026-11-04 by Copilot, for the next AI)

**Start here:** everything finished so far is on `main` and deployed; there is no WIP branch to pick up.
Read `CLAUDE.md` first: its ground rules are binding (never guess, ask the owner, log every answer in
`docs/decisions.md`, keep the JS and PHP sim cores identical, use the `sim-change` skill for any rule change).
This file says where the work stands and what to do next.

## Where things stand

- **Repo:** github.com/SilverDay/tombwright (public). The owner wants work committed straight to `main` once the
  tests pass (decision #13), authored as `SilverDay <klingner@silverday.de>`
  (`git -c user.name=SilverDay -c user.email=klingner@silverday.de commit ...`).
- **Live site:** https://tombwright.silverday.de is a git checkout of `main` in `/srv/vhosts/tombwright.silverday.de`
  (DocumentRoot `public/`). It runs core **m0.14**: the landing page at `/`, the game at `/play/gloamhollow`.
  - **Deploy:** in that directory, `git pull --ff-only` then `composer install --no-dev --optimize-autoloader`. Both
    commands are allowed in `.claude/settings.local.json`.
  - **Check:** `curl https://tombwright.silverday.de/healthz` reports the core version.
- **Milestones (spec §16):**
  - **M0 is done:** Gloamhollow plays on the sim core; both e2e walkthroughs pass.
  - **M1 is in progress:**
    - The differential fuzzer is done.
    - Lantern Delve's foes come in four steps (decision #61): 7a (m0.12), 7b (m0.13) and **7c (m0.14, thieves and
      tricks, decisions #65-#71)** are on `main` and deployed; **7d is not started**.
  - **M2 (the builder) comes after M1.** The owner expected the builder at `/` and was told it is M2; they said to
    continue the plan.
- **The landing page is done:** `public/index.php` routes GET/HEAD by the `PAGES` allow-list (`/` -> `templates/home.php`
  with `$siteUrl`, `/play/gloamhollow` -> `templates/game.php`); the client takes the tomb name from the path
  (allow-list in `boot()`, `public/js/game/main.js`); the banner is in the README and `REUSE.toml` marks the images all
  rights reserved (`LICENSES/LicenseRef-SilverDay-AllRightsReserved.txt`, spec §13 excludes the wordmark from CC BY-SA).
  The owner has uploaded the social-preview image (`public/assets/images/tombwright-og-1200x630.jpg`) in the repo
  settings.

## Next: step 7d, then M2

- **7d (core m0.15):** the dragon's fire breath and the Warden of the Deep.
  - **Dragon:** fire breath every 4.5 s within 10 m, 36 damage, a projectile you can dodge.
  - **Warden:** a boss with 30 strikes and 30 damage; calls up two zombies every 11 s, never more than four at once;
    below half health, fires a fan of five bolts (15 damage each) every 4.5 s while you're more than 2.5 m away.
  - **Sources:** spec §4.9.3 and Lantern Delve's `shoot`, `bossTick`, `spawnProj`, `updateProjectiles` in
    `reference/lantern-delve/LanternDelve.html` (MIT, decision #60).
  - **New sim state:** projectiles. Integer motion; decide the hit test with the owner if it isn't clear.
  - **Bestiary:** a `warden` entry under `bosses`. Careful: the bestiary's `foes.warden` is Gloamhollow's bone gardener,
    so the boss needs another key such as `deepWarden`.
  - **Client:** sprites are in `public/js/game/delve-art.js` (`DELVE_ART.warden`); sounds `fire`, `boss` are in
    `audio.js`.
  - **Ask the owner first** about anything the spec and Lantern Delve don't settle.
- **Then M1 is complete;** the next milestone is **M2, the builder** (spec §16, §4.2, §4.3).

## Working notes

- **Clone and paths:**
  - Work in a scratchpad clone, not in the vhost. Clone from GitHub and run `npm ci` and `composer install`.
- **Commands:**
  - Tests: `npm test`, `vendor/bin/phpunit`, `node scripts/check-sim-purity.mjs`, `composer lint`,
    `npm run golden:regen` (after rule changes).
  - Fuzz: `node tests/fuzz/run.mjs --cases 2000 --jobs 4`; `--case N` reproduces one case.
  - Walkthroughs: `npm run e2e`. **Mind stale `php -S` servers on port 8765** (`reuseExistingServer: true` in
    `playwright.config.mjs` happily reuses one running old code); kill them by PID first.
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
