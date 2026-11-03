<?php

declare(strict_types=1);

namespace Tombwright\Db;

use PDO;
use RuntimeException;

/**
 * Applies migrations/NNNN_name.sql in order and records each file's SHA-256.
 * Refuses to run if an applied file has changed (never edit an applied migration).
 * MariaDB commits DDL implicitly, so each file is applied, then recorded.
 */
final class Migrator
{
    public function __construct(private PDO $pdo, private string $dir)
    {
    }

    public function ensureTable(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
            version CHAR(4) NOT NULL PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            sha256 CHAR(64) NOT NULL,
            applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    /** @return list<array{version:string,name:string,file:string,sha256:string}> */
    public function available(): array
    {
        $out = [];
        foreach (glob($this->dir . '/[0-9][0-9][0-9][0-9]_*.sql') ?: [] as $file) {
            if (str_ends_with($file, '.down.sql')) {
                continue;
            }
            $base = basename($file, '.sql');
            $out[] = [
                'version' => substr($base, 0, 4),
                'name' => substr($base, 5),
                'file' => $file,
                'sha256' => hash_file('sha256', $file) ?: throw new RuntimeException("unreadable $file"),
            ];
        }
        usort($out, static fn (array $a, array $b): int => strcmp($a['version'], $b['version']));
        return $out;
    }

    /** @return array<string,string> version => sha256 */
    public function applied(): array
    {
        $this->ensureTable();
        $rows = $this->pdo->query('SELECT version, sha256 FROM schema_migrations ORDER BY version')->fetchAll();
        return array_column($rows, 'sha256', 'version');
    }

    /** @return list<string> versions applied by this call */
    public function up(): array
    {
        $done = $this->applied();
        $ran = [];
        foreach ($this->available() as $m) {
            if (isset($done[$m['version']])) {
                if (!hash_equals($done[$m['version']], $m['sha256'])) {
                    throw new RuntimeException("Migration {$m['version']} changed after it was applied; add a new migration instead");
                }
                continue;
            }
            $sql = (string) file_get_contents($m['file']);
            $this->pdo->exec($sql);
            $st = $this->pdo->prepare('INSERT INTO schema_migrations (version, name, sha256) VALUES (?, ?, ?)');
            $st->execute([$m['version'], $m['name'], $m['sha256']]);
            $ran[] = $m['version'];
        }
        return $ran;
    }
}
