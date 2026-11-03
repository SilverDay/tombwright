<?php

declare(strict_types=1);

namespace Tombwright\Tests;

use PDO;
use PHPUnit\Framework\TestCase;
use Tombwright\Db\Connection;
use Tombwright\Db\Migrator;

/** Runs against the test database (TW_DB_TEST_NAME). Skipped when no DB credentials are set. */
final class MigratorTest extends TestCase
{
    private PDO $pdo;
    private string $dir;

    protected function setUp(): void
    {
        if (getenv('TW_DB_MIGRATE_PASS') === false) {
            self::markTestSkipped('No database configured (run scripts/dev-db.sh or set TW_DB_* variables)');
        }
        $config = require __DIR__ . '/../../config/config.php';
        $this->pdo = Connection::make($config['db'], 'migrate', true);
        $this->pdo->exec('DROP TABLE IF EXISTS schema_migrations, tw_migrator_probe');
        $this->dir = sys_get_temp_dir() . '/tw-mig-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
        file_put_contents($this->dir . '/0001_probe.sql', 'CREATE TABLE tw_migrator_probe (id INT PRIMARY KEY) ENGINE=InnoDB');
    }

    protected function tearDown(): void
    {
        if (isset($this->pdo)) {
            $this->pdo->exec('DROP TABLE IF EXISTS schema_migrations, tw_migrator_probe');
            array_map('unlink', glob($this->dir . '/*') ?: []);
            rmdir($this->dir);
        }
    }

    public function testAppliesOnceAndDetectsEdits(): void
    {
        $m = new Migrator($this->pdo, $this->dir);
        self::assertSame(['0001'], $m->up());
        self::assertSame([], $m->up());
        file_put_contents($this->dir . '/0001_probe.sql', '-- edited');
        $this->expectExceptionMessage('changed after it was applied');
        $m->up();
    }
}
