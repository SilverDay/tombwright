#!/bin/bash
# Environment SETUP SCRIPT for Claude Code cloud sessions (paste into the cloud
# environment's settings → Setup script). Runs as root before the session, and the
# resulting container is cached, so system packages belong here, not in the hook.
# The repo's SessionStart hook (.claude/hooks/session-start.sh) installs them too as a
# fallback, then does the per-repo work (databases, composer, npm).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v mariadbd >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq mariadb-server mariadb-client   # Ubuntu 24.04 archive: MariaDB 10.11 LTS
fi
php -v | head -1
mariadb --version
