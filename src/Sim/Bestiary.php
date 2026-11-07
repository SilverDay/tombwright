<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** The bestiary (R-FOE-1), pinned by SHA-256. Mirrors public/js/sim/bestiary.js. */
final class Bestiary
{
    public const VERSION = 1;
    public const BESTIARY_SHA256 = '3b84575fd64dd61b57e65413827298837c0dd199e96a80163deb863961abe1c7';
    private const FIELDS = ['tier', 'strikes', 'damage', 'speed', 'radius', 'reach', 'wind', 'cooldown', 'rise', 'firstAttack', 'regen', 'flit'];

    /** R-FOE-1, R-POW-*: the powers the cores know. */
    public const POWERS = ['', 'douse', 'freeze', 'seize', 'confuse', 'poison', 'drain', 'steal', 'pilfer', 'guard', 'forget', 'invisible', 'mimic'];
    /** R-BREATH-1: the ranged block a kind may carry, and the shots the cores know (R-SHOT-1). */
    private const RANGED_FIELDS = ['cd', 'dmg', 'speed', 'range', 'min', 'r', 'off'];
    public const SHOT_KINDS = ['fire', 'bolt'];
    /** R-BOSS-1: the fields every boss kind has, then the ones its behaviour adds. */
    private const BOSS_FIELDS = ['strikes', 'damage', 'radius', 'speed', 'wakeAtk', 'wind', 'hitRange', 'windRange', 'stop', 'atk'];
    private const BOSS_BEHAVIOURS = [
        'eater' => ['oilHit', 'speed2', 'seekWindRange', 'reel', 'feed', 'feed2', 'feedReach', 'feedCd', 'phase2Atk', 'phase2FeedCd', 'atk2', 'tearWind', 'solidRange', 'drainRange', 'drain', 'drain2'],
        'warden' => ['summonCd', 'summonFirst', 'summonPer', 'summonMax', 'ring', 'volleyCd', 'volleyFirst', 'volleyBolts', 'volleySpread', 'volleyDmg', 'volleySpeed', 'volleyR', 'volleyOff', 'volleyMin'],
    ];

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
            $ranged = null;
            if (array_key_exists('ranged', $f)) {        // R-BREATH-1
                foreach (self::RANGED_FIELDS as $k) {
                    if (!is_int($f['ranged'][$k] ?? null)) {
                        throw new \RuntimeException("bestiary: $kind.ranged.$k");
                    }
                }
                if (!in_array($f['ranged']['kind'] ?? null, self::SHOT_KINDS, true)) {
                    throw new \RuntimeException("bestiary: $kind.ranged.kind");
                }
                $ranged = $f['ranged'];
            }
            $m[(string) $kind] = ['ranged' => $ranged, 'fly' => $f['mover'] === 'fly'] + $f;
        }
        self::$kinds = $m;
        $bm = [];
        foreach ($b['bosses'] as $kind => $f) {
            $extra = self::BOSS_BEHAVIOURS[$f['behaviour'] ?? ''] ?? null;   // R-BOSS-1
            if ($extra === null) {
                throw new \RuntimeException("bestiary: boss $kind.behaviour");
            }
            foreach ([...self::BOSS_FIELDS, ...$extra] as $k) {
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
