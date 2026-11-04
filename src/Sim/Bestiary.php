<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** The bestiary (R-FOE-1), pinned by SHA-256. Mirrors public/js/sim/bestiary.js. */
final class Bestiary
{
    public const VERSION = 1;
    public const BESTIARY_SHA256 = '9b0a23db005c50ec0d6a7f1e4955fd6a1f4495d32a3c28b2dcf5aaba43d790f9';
    private const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack', 'regen', 'flit'];

    /** R-FOE-1, R-POW-*: the powers the cores know. */
    public const POWERS = ['', 'douse', 'freeze', 'seize', 'confuse', 'poison', 'drain'];
    private const BOSS_FIELDS = ['strikes', 'damage', 'oilHit', 'radius', 'speed', 'speed2', 'wakeAtk', 'wind', 'hitRange', 'windRange', 'seekWindRange',
        'stop', 'reel', 'feed', 'feed2', 'feedReach', 'feedCd', 'phase2Atk', 'phase2FeedCd', 'atk', 'atk2', 'tearWind', 'solidRange', 'drainRange', 'drain', 'drain2'];

    /** @var array<string,array<string,mixed>>|null */
    private static ?array $kinds = null;
    /** @var array<string,array<string,int>>|null */
    private static ?array $bosses = null;

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
            if (!in_array($f['power'] ?? null, self::POWERS, true)) {
                throw new \RuntimeException("bestiary: $kind.power"); // R-FOE-1
            }
            $m[(string) $kind] = $f + ['fly' => $f['mover'] === 'fly'];
        }
        self::$kinds = $m;
        $bm = [];
        foreach ($b['bosses'] as $kind => $f) {
            foreach (self::BOSS_FIELDS as $k) {
                if (!is_int($f[$k] ?? null)) {
                    throw new \RuntimeException("bestiary: boss $kind.$k");
                }
            }
            $bm[(string) $kind] = $f;
        }
        self::$bosses = $bm;
    }

    /** @return array<string,int>|null R-BOSS-1: a boss kind's numbers, or null */
    public static function boss(mixed $kind): ?array
    {
        if (self::$bosses === null) {
            self::load();
        }
        return is_string($kind) ? (self::$bosses[$kind] ?? null) : null;
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
