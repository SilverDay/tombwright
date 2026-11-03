<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** Integer sine table. Mirrors public/js/sim/sine.js (rules R-TRIG-*). */
final class SineTable
{
    public const ANGLE_UNITS = 4096;
    public const TRIG_ONE = 16384;
    public const SINE_SHA256 = '66b97b9db7fcae9dc1cb5b81d0239e3cb3fceb000cf3893dea7e6a86fc9a50d4';

    /** @var list<int>|null */
    private static ?array $table = null;

    public static function load(?string $path = null): void
    {
        $path ??= dirname(__DIR__, 2) . '/public/js/sim/data/sine4096.bin';
        $bytes = file_get_contents($path);
        if ($bytes === false || strlen($bytes) !== self::ANGLE_UNITS * 2) {
            throw new \RuntimeException('sine table: wrong size or unreadable');
        }
        $got = hash('sha256', $bytes);
        if (!hash_equals(self::SINE_SHA256, $got)) {
            throw new \RuntimeException("sine table: SHA-256 mismatch ($got)");
        }
        $u = unpack('v*', $bytes);
        $t = [];
        foreach ($u as $v) {
            $t[] = $v >= 0x8000 ? $v - 0x10000 : $v;
        }
        self::$table = $t;
    }

    public static function sin(int $a): int
    {
        if (self::$table === null) {
            self::load();
        }
        return self::$table[(($a % 4096) + 4096) % 4096];
    }

    public static function cos(int $a): int
    {
        return self::sin($a + 1024);
    }
}
