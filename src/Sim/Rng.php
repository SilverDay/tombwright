<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * xoshiro128** on PHP's 64-bit ints, every result masked to 32 bits (rules R-RNG-*).
 * Mirrors public/js/sim/rng.js. State is a list of four uint32 ints, stored in sim state.
 */
final class Rng
{
    private const M32 = 0xFFFFFFFF;

    private static function rotl(int $x, int $k): int
    {
        return (($x << $k) | ($x >> (32 - $k))) & self::M32;
    }

    /** Low 32 bits of a*b for uint32 a, b, without overflowing 64-bit ints. */
    public static function mul32(int $a, int $b): int
    {
        $lo = $a * ($b & 0xFFFF);
        $hi = (($a * ($b >> 16)) & 0xFFFF) << 16;
        return ($lo + $hi) & self::M32;
    }

    public static function fmix32(int $h): int
    {
        $h &= self::M32;
        $h ^= $h >> 16;
        $h = self::mul32($h, 0x85EBCA6B);
        $h ^= $h >> 13;
        $h = self::mul32($h, 0xC2B2AE35);
        $h ^= $h >> 16;
        return $h;
    }

    /** @return list<int> */
    public static function seed(int $seed): array
    {
        if ($seed < 0 || $seed > self::M32) {
            throw new \RangeException('seed must be uint32');
        }
        $s = [];
        $z = $seed;
        for ($i = 0; $i < 4; $i++) {
            $z = ($z + 0x9E3779B9) & self::M32;
            $s[] = self::fmix32($z);
        }
        if (($s[0] | $s[1] | $s[2] | $s[3]) === 0) {
            $s[0] = 1;
        }
        return $s;
    }

    /** @param list<int> $s */
    public static function next(array &$s): int
    {
        $result = (self::rotl(($s[1] * 5) & self::M32, 7) * 9) & self::M32;
        $t = ($s[1] << 9) & self::M32;
        $s[2] ^= $s[0];
        $s[3] ^= $s[1];
        $s[1] ^= $s[2];
        $s[0] ^= $s[3];
        $s[2] ^= $t;
        $s[3] = self::rotl($s[3], 11);
        return $result;
    }

    /** @param list<int> $s */
    public static function below(array &$s, int $n): int
    {
        if ($n < 1 || $n > 65536) {
            throw new \RangeException('below: n out of range');
        }
        return (self::next($s) * $n) >> 32;
    }
}
