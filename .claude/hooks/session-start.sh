#!/bin/bash
# SessionStart hook: makes tests, migrations and the dev server work in cloud sessions.
# Synchronous on purpose: the session waits until dependencies are ready.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-.}"

# --- system packages (normally done by scripts/cloud-setup.sh; fallback) ---
if ! command -v mariadbd >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server mariadb-client >/dev/null
fi

# --- MariaDB running, dev/test databases and users present ---
if ! mariadb-admin ping --silent >/dev/null 2>&1; then
  service mariadb start >/dev/null
fi
bash scripts/dev-db.sh

# --- PHP dependencies (only when composer.json/lock or this hook changed) ---
hashes=vendor/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  composer install --no-interaction --no-progress
  sha256sum .claude/hooks/session-start.sh composer.json composer.lock > "$hashes"
fi

# --- JS dependencies (Playwright browsers are pre-installed in /opt/pw-browsers) ---
nhashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$nhashes" 2>/dev/null; then
  rm -f "$nhashes"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json > "$nhashes"
fi

# --- every session: expose config to the agent's shell ---
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) ;; *) echo "export $line" >> "$CLAUDE_ENV_FILE" ;; esac
  done < config/local.env
  echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
fi
