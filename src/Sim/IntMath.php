<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** Integer helpers. Mirrors public/js/sim/int.js (rules R-INT-*). */
final class IntMath
{
    public const MAX_SAFE = 9007199254740991; // 2^53 - 1, the range shared with JS

    public static function assertInt(mixed $v, string $what = 'value'): int
    {
        if (!is_int($v) || $v > self::MAX_SAFE || $v < -self::MAX_SAFE) {
            throw new \RangeError("$what is not a safe integer");
        }
        return $v;
    }

    /** R-INT-3: truncating division (same as JS idiv). */
    public static function idiv(int $a, int $b): int
    {
        self::assertInt($a, 'idiv a');
        self::assertInt($b, 'idiv b');
        if ($b === 0) {
            throw new \RangeError('idiv by zero');
        }
        return intdiv($a, $b);
    }

    /** R-INT-4: floor(sqrt(n)), exact, for 0 <= n <= 2^53-1. */
    public static function isqrt(int $n): int
    {
        self::assertInt($n, 'isqrt n');
        if ($n < 0) {
            throw new \RangeError('isqrt of negative');
        }
        $x = (int) floor(sqrt((float) $n));
        while ($x * $x > $n) {
            $x--;
        }
        while (($x + 1) * ($x + 1) <= $n) {
            $x++;
        }
        return $x;
    }

    public static function clamp(int $v, int $lo, int $hi): int
    {
        return $v < $lo ? $lo : ($v > $hi ? $hi : $v);
    }
}
