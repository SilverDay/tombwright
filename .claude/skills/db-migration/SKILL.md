---
name: db-migration
description: Add or change a MariaDB schema migration for Tombwright (migrations/*.sql, bin/migrate.php). Use for any new table, column, index or constraint.
---

# Adding a migration

1. Create `migrations/NNNN_short_name.sql` (next number, zero-padded to 4) and, for anything destructive, `migrations/NNNN_short_name.down.sql` with the rollback.
2. Rules (spec §9): InnoDB, `utf8mb4` / `utf8mb4_unicode_ci`, UTC `DATETIME(3)` timestamps, `BIGINT UNSIGNED` ids (runs use `BINARY(16)` ULIDs), explicit indexes for the query patterns, and foreign keys.
3. Never edit a migration that has been applied anywhere. The runner stores each file's SHA-256 and refuses if it changes. Add a new migration instead.
4. MariaDB commits DDL implicitly, so keep each file to one logical change, so a failure leaves a clear state.
5. Apply and test:
   - `php bin/migrate.php status`
   - `php bin/migrate.php up` (uses the `TW_DB_MIGRATE_*` user; the app user has no DDL rights)
   - `php bin/migrate.php up --test` (applies to the test database)
   - `vendor/bin/phpunit`
6. Update the data-model table in `docs/spec.md` §9 if the shape differs from it.
