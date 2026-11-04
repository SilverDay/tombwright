# Handover: Tombwright (written 2026-11-04 by Claude, Opus 5.5, for the next AI)

**Start here:** the unfinished code is on branch **`wip/step-7c-and-landing`**, not on `main`. Run
`git fetch origin && git checkout wip/step-7c-and-landing` before you continue. Then read `CLAUDE.md`: its ground rules are binding (never guess, ask the owner, log every answer in
`docs/decisions.md`, keep the JS and PHP sim cores identical, use the `sim-change` skill for any rule change).
This file says where the work stands and what to do next.

## Where things stand

- **Repo:** github.com/SilverDay/tombwright (public). The owner wants work committed straight to `main` once the
  tests pass (decision #13), authored as `SilverDay <klingner@silverday.de>`
  (`git -c user.name=SilverDay -c user.email=klingner@silverday.de commit ...`).
- **Live site:** https://tombwright.silverday.de is a git checkout of `main` in `/srv/vhosts/tombwright.silverday.de`
  (DocumentRoot `public/`). It runs core **m0.13**.
  - **Deploy:** in that directory, `git pull --ff-only` then `composer install --no-dev --optimize-autoloader`. Both
    commands are allowed in `.claude/settings.local.json`.
  - **Check:** `curl https://tombwright.silverday.de/healthz` reports the core version.
- **Milestones (spec §16):**
  - **M0 is done:** Gloamhollow plays on the sim core; both e2e walkthroughs pass.
  - **M1 is in progress:**
    - The differential fuzzer is done.
    - Lantern Delve's foes are in four steps (decision #61): 7a (m0.12) and 7b (m0.13) are on `main` and deployed;
      **7c is coded but not committed**; 7d is not started.
  - **M2 (the builder) comes after M1.** The owner expected the builder at `/` and was told it is M2; they said to
    continue the plan.
- **Unfinished work** is pushed to branch **`wip/step-7c-and-landing`** (this file is on it). It is one WIP commit on top
  of `main` holding two things that must become **two separate commits on `main`**:
  1. Step 7c (core m0.14). Finish it as described below.
  2. The landing page with the owner's banner. Its files are written but not wired into the routes yet.

## 1. Finish step 7c (core m0.14): thieves and tricks

**Rules:** `docs/sim-rules.md`, section "Thieves and tricks": R-THIEF-1..4, R-GUARD-1, R-FORGET-1, R-MIMIC-1. Owner
decisions #65–#71 are in `docs/decisions.md`.

**What is already done:**
- **Code:** both cores (`public/js/sim/{sim,world,bestiary}.js`, `src/Sim/{Sim,World,Bestiary}.php`).
- **Data:** bestiary `power` values for leprechaun `steal`, nymph `pilfer`, orc `guard`, wraith `forget`, phantom
  `invisible`, xeroc `mimic`. The bestiary SHA is re-pinned in both loaders.
- **Stolen-item fix:** items a thief carries or that lie as dropped loot count as *away* (`away()` in both cores), so
  they can't be taken twice.
- **Vectors:** 0043–0046 (`thiefRoom`, `trickRoom`, plus `driven()` inputs from the new `tests/fuzz/driver.mjs`).
- **Client:** messages, sounds, disguised-xeroc look and prompt, phantom ghostlight, loot sprites and a "Pick up"
  prompt (Interact target 1000 + k).
- **Checks run:** `npm test` (97) and `phpunit` (63) pass, and 2,000 + 2,000 fuzz cases show 0 mismatches. The
  `sim-parity-reviewer` found no JS/PHP mismatch.

**Still to do. Apply each change to both cores the same way:**
1. **Gone thieves can't be struck (review finding).** In `landBlow` (`sim.js`) / `landBlow` (`Sim.php`), return early
   when the foe's `st` is `gone` as well as `dead`. Add "or gone" to R-STRIKE-2.
2. **Decision #69, no second theft.** In `touch()`, cases `steal` and `pilfer`: if the foe already carries loot
   (`loot > 0 || lf > 0 || lp > 0`), do nothing.
3. **Decision #70, loot saved with the checkpoint.**
   - `lifeOf` (JS) / the life array in `reachCheckpoint` and `init` (PHP) also records each foe's `[loot, lf, lp]`.
   - `rise`: after the foes are rebuilt by `freshFoe`, restore `loot`/`lf`/`lp` to every foe that isn't dead.
   - Update R-CP-3, R-FOE-8 and R-THIEF-3.
4. **Decision #71, xeroc and the awake cap.** In `requestWake`, when the cap is full and the foe is `disguised`, set
   `st = 'asleep'` as well as `wake = true`. Its disguise is then gone, and Interact or probe can't reveal it again.
   Update R-MIMIC-1.
5. **Docs that lag the code (review).** Mention gone/disguised and the new targets in:
   - R-FOE-6: the skip list, and "separation … isn't dormant or dead".
   - R-STRIKE-1: targets include disguised.
   - R-MOVE-4: foes push the player only when asleep, idle or hunting.
   - R-ACT-1: target 1000 + k picks up loot; a foe target means reaching for a mimic.
   - R-FOE-8: also resets `loot`/`lf`/`lp`, and restores them from the life (#70).
6. **Cosmetic:** `guardTarget` is called twice in the idle branch of both cores; compute it once.
7. **Re-check and commit:**
   - Run `npm run golden:regen`, then `node scripts/check-sim-purity.mjs`, `npm test` and `vendor/bin/phpunit`.
   - Run `node tests/fuzz/run.mjs --cases 2000`.
   - Run the **sim-parity-reviewer** agent on the diff.
   - Commit 7c alone on `main` (the rules doc, both cores, the vectors and the client). Push and deploy.
   - Keep `CORE_VERSION` at `m0.14`; it is already bumped in both cores.

## 2. Landing page with the banner (separate commit, after 7c)

The owner wants the banner on a landing page at `/`, in the README and as the social-preview image.

**Already done:**
- **Images:** web-sized copies in `public/assets/images/`:
  - `tombwright-banner-1600.webp` (178 KB);
  - `tombwright-banner-1600.jpg` (231 KB);
  - `tombwright-og-1200x630.jpg`, a centre crop.
- **The original:** `public/assets/images/From Blueprint to Battle.png` (2.9 MB) is untracked in the vhost only. Don't
  commit it.
- **Page:** `templates/home.php` (it expects `$siteUrl`) and `public/assets/css/home.css`.

**To do:**
1. **Routes, `public/index.php`:**
   - `GET`/`HEAD /` serves `templates/home.php`. Before the `require`, define
     `$siteUrl = 'https://tombwright.silverday.de'` (one constant; open question Q9 covers the name and domain).
   - `GET`/`HEAD /play/gloamhollow` serves `templates/game.php`.
   - Keep the existing routes and the 405 handling; add `/play/gloamhollow` to the known paths.
2. **`public/js/game/main.js`:** take the tomb name from the path (`/play/<name>`, allow-list `['gloamhollow']`)
   instead of the hard-coded `'gloamhollow'` in `boot()`.
3. **`tests/e2e/tombwright-walkthrough.spec.mjs`:** `page.goto('http://127.0.0.1:8765/play/gloamhollow')`.
4. **README.md:** add the banner (`public/assets/images/tombwright-banner-1600.jpg`) at the top.
5. **REUSE.toml:** add the images. The banner shows the Tombwright wordmark, which spec §13 excludes from CC BY-SA, so
   mark it all rights reserved, SilverDay Media (a `LicenseRef-…` with a short text in `LICENSES/`). This was told to the
   owner, who hasn't objected; if unsure, ask.
6. **Security:** run the **security-reviewer** agent (CLAUDE.md requires it for `public/index.php`).
7. **Check, then commit:** check the page in a browser (CSP: no inline styles or scripts), then run `npm run e2e`.
   Commit, push and deploy.

## 3. Next: step 7d, then M2

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
  - Work in a scratchpad clone, not in the vhost. Last clone:
    `/tmp/claude-1000/-srv-vhosts-tombwright-silverday-de/bca0a24c-d87b-40a3-9684-4edb76e8c186/scratchpad/tw6`.
    `/tmp` may be gone; then clone from GitHub and run `npm ci` and `composer install`.
- **Commands:**
  - Tests: `npm test`, `vendor/bin/phpunit`, `node scripts/check-sim-purity.mjs`, `composer lint`,
    `npm run golden:regen` (after rule changes).
  - Fuzz: `node tests/fuzz/run.mjs --cases 2000 --jobs 4`; `--case N` reproduces one case.
  - Walkthroughs: `npm run e2e`.
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
