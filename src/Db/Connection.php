<?php

declare(strict_types=1);

namespace Tombwright\Db;

use PDO;

/** PDO factory (spec §11.5): real prepared statements, exceptions, utf8mb4, UTC. */
final class Connection
{
    /** @param array<string,mixed> $db */
    public static function make(array $db, string $role = 'app', bool $test = false): PDO
    {
        $name = $test ? $db['test_name'] : $db['name'];
        [$user, $pass] = $role === 'migrate'
            ? [$db['migrate_user'], $db['migrate_pass']]
            : [$db['app_user'], $db['app_pass']];
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], $db['port'], $name);
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
        return $pdo;
    }
}
