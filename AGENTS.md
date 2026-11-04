# Instructions for AI coding agents (Codex and others)

1. Read **`docs/HANDOVER.md`** first: where the work stands and what to do next.
2. Then follow **`CLAUDE.md`**: the project's binding rules (never guess, ask the owner and log answers in
   `docs/decisions.md`; keep the JS and PHP sim cores identical; tests and reviews before every commit).
   They apply to every agent, not only Claude.
3. The workflow for any game-rule change is in `.claude/skills/sim-change/SKILL.md`; the review checklists are
   in `.claude/agents/` (sim-parity-reviewer, security-reviewer). Follow them by hand if your tool can't run them.
