<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** Canonical serialisation of sim state (rules R-CANON-*). Byte-identical to public/js/sim/canon.js. */
final class Canonical
{
    public static function encode(mixed $v): string
    {
        if ($v === null) {
            return 'null';
        }
        if ($v === true) {
            return 'true';
        }
        if ($v === false) {
            return 'false';
        }
        if (is_int($v)) {
            IntMath::assertInt($v, 'canon number');
            return (string) $v;
        }
        if (is_float($v)) {
            throw new \TypeError('canon: float in sim state');
        }
        if (is_string($v)) {
            return self::str($v);
        }
        if (is_array($v)) {
            if (array_is_list($v)) {
                return '[' . implode(',', array_map(self::encode(...), $v)) . ']';
            }
            $keys = array_keys($v);
            foreach ($keys as $k) {
                if (!is_string($k) || preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $k) !== 1) {
                    throw new \TypeError('canon: bad key ' . $k);
                }
            }
            sort($keys, SORT_STRING);
            $parts = [];
            foreach ($keys as $k) {
                $parts[] = self::str($k) . ':' . self::encode($v[$k]);
            }
            return '{' . implode(',', $parts) . '}';
        }
        throw new \TypeError('canon: unsupported type ' . get_debug_type($v));
    }

    private static function str(string $s): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) {
            throw new \TypeError('canon: invalid UTF-8');
        }
        $out = preg_replace_callback(
            '/["\\\\\x00-\x1F]/',
            static function (array $m): string {
                $c = $m[0];
                if ($c === '"') {
                    return '\\"';
                }
                if ($c === '\\') {
                    return '\\\\';
                }
                return sprintf('\\u%04x', ord($c));
            },
            $s
        );
        return '"' . $out . '"';
    }
}
