#!/bin/bash
# Creates the dev and test databases and two least-privilege users (spec §11.5),
# idempotently, on a local MariaDB reachable as root over the unix socket.
# Passwords are random per container and kept in config/local.env (git-ignored).
# DEV CONTAINER ONLY: never run this against a shared or production server.
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF=config/local.env
if [ ! -f "$ENVF" ]; then
  umask 077
  cat > "$ENVF" <<EOT
TW_ENV=dev
TW_DB_HOST=127.0.0.1
TW_DB_PORT=3306
TW_DB_NAME=tombwright
TW_DB_TEST_NAME=tombwright_test
TW_DB_APP_USER=tw_app
TW_DB_APP_PASS=$(openssl rand -hex 24)
TW_DB_MIGRATE_USER=tw_migrate
TW_DB_MIGRATE_PASS=$(openssl rand -hex 24)
EOT
fi
set -a; . "$ENVF"; set +a
for db in "$TW_DB_NAME" "$TW_DB_TEST_NAME"; do
  mariadb -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$TW_DB_APP_USER'@'127.0.0.1' IDENTIFIED BY '$TW_DB_APP_PASS';
CREATE USER IF NOT EXISTS '$TW_DB_MIGRATE_USER'@'127.0.0.1' IDENTIFIED BY '$TW_DB_MIGRATE_PASS';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$db\`.* TO '$TW_DB_APP_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$db\`.* TO '$TW_DB_MIGRATE_USER'@'127.0.0.1';
SQL
done
mariadb -uroot -e "FLUSH PRIVILEGES;"
