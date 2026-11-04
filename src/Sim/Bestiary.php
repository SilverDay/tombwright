<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** The bestiary (R-FOE-1), pinned by SHA-256. Mirrors public/js/sim/bestiary.js. */
final class Bestiary
{
    public const VERSION = 1;
    public const BESTIARY_SHA256 = 'd25a43054fbf61da11568c6e6ebe4972fa8eca811b163345cdd10681899905fe';
    private const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack'];

    /** @var array<string,array<string,mixed>>|null */
    private static ?array $kinds = null;

    public static function load(?string $path = null): void
    {
        $path ??= dirname(__DIR__, 2) . '/public/js/sim/data/bestiary.v1.json';
        $bytes = file_get_contents($path);
        if ($bytes === false) {
            throw new \RuntimeException('bestiary: unreadable');
        }
        $got = hash('sha256', $bytes);
        if (!hash_equals(self::BESTIARY_SHA256, $got)) {
            throw new \RuntimeException("bestiary: SHA-256 mismatch ($got)");
        }
        $b = json_decode($bytes, true, 8, JSON_THROW_ON_ERROR);
        $m = [];
        foreach ($b['foes'] as $kind => $f) {
            foreach (self::FIELDS as $k) {
                if (!is_int($f[$k] ?? null)) {
                    throw new \RuntimeException("bestiary: $kind.$k");
                }
            }
            $m[(string) $kind] = $f + ['fly' => $f['mover'] === 'fly'];
        }
        self::$kinds = $m;
    }

    /** @return array<string,mixed>|null the kind's numbers, or null for an unknown kind */
    public static function kind(mixed $kind): ?array
    {
        if (self::$kinds === null) {
            self::load();
        }
        return is_string($kind) ? (self::$kinds[$kind] ?? null) : null;
    }
}
