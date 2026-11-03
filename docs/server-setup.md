# Server database setup (tombwright-db)

The spec (§11.5) asks for two database users: one for the app, with no DDL rights, and one for migrations.
Run this as a MariaDB admin on the server. Pick your own strong passwords, and replace `localhost`
if PHP connects over TCP from another host.

```sql
CREATE DATABASE IF NOT EXISTS `tombwright-db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'tw_app'@'localhost' IDENTIFIED BY '…';
GRANT SELECT, INSERT, UPDATE, DELETE ON `tombwright-db`.* TO 'tw_app'@'localhost';

CREATE USER 'tw_migrate'@'localhost' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON `tombwright-db`.* TO 'tw_migrate'@'localhost';
```

The name contains a hyphen, so SQL must always quote it with backticks. The PDO DSN (`dbname=tombwright-db`) needs no quoting.

Then:

1. `cp config/local.env.example config/local.env`, fill in both users' credentials, and `chmod 640` it (owner root, group = the PHP-FPM user's group).
2. `php bin/migrate.php status` should print `0 applied` and no error.
3. Point Apache's `DocumentRoot` at `public/`, so `config/` is never web-reachable.

If you'd rather not keep secrets in a file, set the same `TW_*` names as PHP-FPM pool variables (`env[TW_DB_APP_PASS] = …`). Real environment variables take precedence over the file.
