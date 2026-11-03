<?php

declare(strict_types=1);

namespace Tombwright\Tests;

use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        $this->file = tempnam(sys_get_temp_dir(), 'twcfg');
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        putenv('TW_CONFIG_FILE');
        putenv('TW_ZZ_UNUSED');
    }

    /** @return array<string,mixed> */
    private function load(string $contents): array
    {
        file_put_contents($this->file, $contents);
        putenv('TW_CONFIG_FILE=' . $this->file);
        return require __DIR__ . '/../../config/config.php';
    }

    public function testReadsLiteralValuesFromFile(): void
    {
        if (getenv('TW_DB_NAME') !== false) {
            self::markTestSkipped('TW_DB_NAME is set in the environment and takes precedence');
        }
        $c = $this->load("# comment\nTW_DB_NAME=tombwright-db\nTW_DB_APP_PASS=a\$b'c\"d#e\n");
        self::assertSame('tombwright-db', $c['db']['name']);
        if (getenv('TW_DB_APP_PASS') === false) {
            self::assertSame('a$b\'c"d#e', $c['db']['app_pass']);
        }
    }

    public function testRejectsMalformedLines(): void
    {
        $this->expectExceptionMessage('expected KEY=VALUE');
        $this->load("export TW_DB_NAME=x\n");
    }
}
