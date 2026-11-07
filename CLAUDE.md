# Tombwright: notes for Claude Code

Server-based successor to *Gloamhollow*: players build trap-filled tombs in a browser editor, prove they're beatable, publish them, and challenge each other. **Every scored run is re-simulated on the server from recorded inputs.**

- Spec: `docs/spec.md` (v0.3). Decisions taken since then: `docs/decisions.md`. Normative game rules: `docs/sim-rules.md`.
- Porting reference: `reference/gloamhollow/Gloamhollow.html` (the original single-file game); checklist in `docs/gloamhollow-port-notes.md`.
- Current milestone: **M2, the builder** (spec §16). M0 (engine split) and M1 (PHP core) are done: Gloamhollow plays on the sim core, both cores agree on the golden vectors and over 10,000 fuzz cases, and Lantern Delve's 26 foes and the Warden of the Deep are ported.

## Ground rules

- **Never guess.** If the spec, the decisions log and the code don't settle a question, ask the owner. Log every answer in `docs/decisions.md`.
- Stack is fixed: **PHP 8.3** (no 8.4-only features), **MariaDB 10.11**, Apache 2.4 + PHP-FPM, vanilla ES modules, no framework, no build step. Licence MIT. Don't add dependencies without asking; three.js is the only planned runtime dependency (vendored and pinned).

## The invariant

Same GDF + seed + inputs give the same state hash on every tick, in JS (`public/js/sim/`) and in PHP (`src/Sim/`).

- Integers only in sim state: mm, 1/4096-turn angles, ticks at 30 Hz. No `Math.random`, no float trig, no wall clock, no DOM in the sim core. `scripts/check-sim-purity.mjs` enforces this, and a PostToolUse hook runs it after every edit.
- Any rule change: follow the **`sim-change` skill** (rules doc → both cores → `CORE_VERSION` bump → `npm run golden:regen` → tests → `sim-parity-reviewer` agent).
- Never regenerate golden vectors to make PHP pass. A mismatch is a bug in one core.

## Commands

```bash
npm test                                 # JS: primitives (vs BigInt / node:crypto) + golden replays
vendor/bin/phpunit                       # PHP: same golden vectors, config, migrator (needs DB), headers
node scripts/check-sim-purity.mjs        # determinism lint for both cores
npm run golden:regen                     # regenerate vectors after an intentional rules change
node bin/build-gloamhollow-gdf.mjs       # rebuild dungeons/gloamhollow.gdf.json from the original's map data
php bin/migrate.php status|up [--test]   # migrations (migrate user, not the app user)
composer lint                            # php -l over the tree
npm run e2e                              # Playwright: both walkthroughs (reference game and the Tombwright port)
npm run fuzz -- --cases 10000            # differential fuzzer: random tombs + inputs, JS vs PHP (--case N reproduces one)
```

Two walkthroughs play Gloamhollow from the stair to daylight in fixed 1/30 s ticks with rendering off:
`tests/e2e/gloamhollow-walkthrough.spec.mjs` plays the reference (`reference/gloamhollow/Gloamhollow.html`, through its `window.__gh` hook), and `tests/e2e/tombwright-walkthrough.spec.mjs` plays the Tombwright client at `/` (served by `php -S` with `tests/e2e/lib/dev-router.php`) through `window.__tw`, which the client installs only when `window.__twTest` is set before boot (driver: `tests/e2e/lib/tombwright-driver.js`, checks read the sim state). The page's CSP refuses injected `<script>` tags, so test code goes in with `page.evaluate`. The game client is `public/js/game/` (renderer, UI, sound); it reads sim state and never writes it.

Cloud sessions: `.claude/hooks/session-start.sh` installs and starts MariaDB, creates `tombwright` and `tombwright_test` with random dev credentials in `config/local.env`, and runs composer and npm installs. Playwright's Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Don't run `playwright install`.

## Security (spec §11; target OWASP ASVS 5.0.0, L2 for auth, sessions, input and access control)

- CSP is strict: `script-src 'self'; style-src 'self'`. No inline `<script>`, `<style>`, `style=""` or `on*=` attributes. Use external files and `addEventListener`.
- User text (titles, inscriptions, handles) is plain text: `e()` in templates, `textContent` in JS, never `innerHTML`.
- PDO prepared statements only (`ATTR_EMULATE_PREPARES=false`). Check ownership in every handler; never trust ids from the client.
- Cap every body before parsing; `json_decode` with an explicit depth and `JSON_THROW_ON_ERROR`; bounded binary decoders; streaming inflate with a hard cap.
- No secrets in the repo. Server config goes in `config/local.env` (git-ignored; template `config/local.env.example`; production DB `tombwright-db`, see `docs/server-setup.md`).
- Run the **`security-reviewer` agent** on changes under `src/Http`, `src/Auth`, `src/Run`, `src/Dungeon`, `public/index.php` or `migrations/`.

## Layout (spec §5.3)

`public/` web root (`index.php` front controller, `js/sim` JS core + `data/sine4096.bin`) · `src/` PHP (`Sim`, `Db`, `Http`, …) · `bin/` CLI tools · `migrations/` numbered SQL (`db-migration` skill) · `tests/{js,php,golden,e2e}` · `config/` · `docs/` · `dungeons/` official tombs as GDF · `reference/` original game.

## Git

Commit messages describe the user-facing and the technical change. Sim-core commits include the rules doc, both cores and the regenerated vectors together.
