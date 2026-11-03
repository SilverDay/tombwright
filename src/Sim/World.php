<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * The static world, built once from a GDF (rules R-GDF-*, R-WORLD-*). Immutable and never part of
 * sim state. Mirrors public/js/sim/world.js.
 */
final class World
{
    public const WALL = 0;
    public const ROOM = 1;
    public const CORR = 2;
    public const PLATE = 3;
    public const HPIT = 4;
    public const VOID = 5;
    public const BRIDGE = 6;
    public const VENT = 7;
    public const ALCOVE = 8;
    public const MAX_CELL_CODE = 8;
    public const MAX_GRID = 64;
    public const MAX_GDF_BYTES = 262144;
    public const MAX_GDF_DEPTH = 12;
    private const KEY_RE = '/^[A-Za-z_][A-Za-z0-9_]*$/D';

    /** @param string $grid one byte per cell, row-major */
    private function __construct(
        public readonly string $id,
        public readonly int $w,
        public readonly int $h,
        private readonly string $grid,
        public readonly int $startI,
        public readonly int $startJ,
    ) {
    }

    /** R-GDF-2: strict standard base64 (RFC 4648 §4), canonical padding bits. */
    public static function b64decode(mixed $s): string
    {
        if (!is_string($s) || strlen($s) % 4 !== 0 || preg_match('#^[A-Za-z0-9+/]*={0,2}$#D', $s) !== 1) {
            throw new \RangeException('base64: bad input');
        }
        $out = base64_decode($s, true);
        if ($out === false || base64_encode($out) !== $s) {
            throw new \RangeException('base64: non-canonical');
        }
        return $out;
    }

    /** R-GDF-3: run-length pairs [count 1..255, code 0..8] that cover exactly n cells. */
    public static function rleDecode(string $bytes, int $n): string
    {
        $len = strlen($bytes);
        if ($len % 2 !== 0) {
            throw new \RangeException('cells: odd RLE length');
        }
        $out = '';
        for ($k = 0; $k < $len; $k += 2) {
            $count = ord($bytes[$k]);
            $code = ord($bytes[$k + 1]);
            if ($count < 1) {
                throw new \RangeException('cells: zero-length run');
            }
            if ($code > self::MAX_CELL_CODE) {
                throw new \RangeException('cells: unknown cell code');
            }
            if (strlen($out) + $count > $n) {
                throw new \RangeException('cells: runs overflow the grid');
            }
            $out .= str_repeat(chr($code), $count);
        }
        if (strlen($out) !== $n) {
            throw new \RangeException('cells: runs do not fill the grid');
        }
        return $out;
    }

    /**
     * R-GDF-0: the only way in, byte for byte the same checks as parseGdf in world.js: UTF-8 without a
     * BOM, at most 256 KiB, nested at most 12 deep, plain integer literals only. Objects decode as
     * objects, so {} and {"0": …} can't pass for lists; empty objects and bad keys are rejected (R-CANON-3/4).
     *
     * @return array<string,mixed>
     */
    public static function parseGdf(string $bytes): array
    {
        $n = strlen($bytes);
        if ($n > self::MAX_GDF_BYTES) {
            throw new \RangeException('GDF too large');
        }
        if (str_starts_with($bytes, "\xEF\xBB\xBF")) {
            throw new \RangeException('GDF has a BOM');
        }
        if (!mb_check_encoding($bytes, 'UTF-8')) {
            throw new \RangeException('GDF is not UTF-8');
        }
        $depth = 0;
        for ($k = 0; $k < $n; $k++) {
            $c = $bytes[$k];
            if ($c === '"') {
                for ($k++; $k < $n && $bytes[$k] !== '"'; $k++) {
                    if ($bytes[$k] === '\\') {
                        $k++;
                    }
                }
                continue;
            }
            if ($c === '{' || $c === '[') {
                if (++$depth > self::MAX_GDF_DEPTH) {
                    throw new \RangeException('GDF nested too deep');
                }
            } elseif ($c === '}' || $c === ']') {
                $depth--;
            } elseif ($c === '-' || ($c >= '0' && $c <= '9')) {
                $e = $k + 1;
                while ($e < $n && strpbrk($bytes[$e], '0123456789.eE+-') !== false) {
                    $e++;
                }
                $tok = substr($bytes, $k, $e - $k);
                if (preg_match('/^-?(0|[1-9][0-9]*)$/D', $tok) !== 1 || $tok === '-0') {
                    throw new \RangeException('GDF number is not a plain integer');
                }
                $k = $e - 1;
            }
        }
        try {
            $v = json_decode($bytes, false, self::MAX_GDF_DEPTH + 2, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RangeException('GDF is not JSON: ' . $e->getMessage());
        }
        $gdf = self::plain($v);
        if (!is_array($gdf) || ($gdf !== [] && array_is_list($gdf))) {
            throw new \RangeException('GDF is not an object');
        }
        return $gdf;
    }

    /** JSON objects -> string-keyed arrays (non-empty, valid keys); arrays -> lists. */
    private static function plain(mixed $v): mixed
    {
        if ($v instanceof \stdClass) {
            $out = [];
            foreach (get_object_vars($v) as $key => $item) {
                if (preg_match(self::KEY_RE, (string) $key) !== 1) {
                    throw new \RangeException('GDF: bad key');
                }
                $out[$key] = self::plain($item);
            }
            if ($out === []) {
                throw new \RangeException('GDF: empty object');
            }
            return $out;
        }
        if (is_array($v)) {
            return array_map(self::plain(...), $v);
        }
        if (is_float($v)) {
            throw new \RangeException('GDF: number out of range');
        }
        return $v;
    }

    /** Sim::load(bytes): parse, then build the world. */
    public static function load(string $bytes): self
    {
        return self::fromGdf(self::parseGdf($bytes));
    }

    /** @param array<string,mixed> $gdf */
    private static function fromGdf(array $gdf): self
    {
        if (($gdf['gdf'] ?? null) !== 1) {
            throw new \InvalidArgumentException('unsupported GDF');
        }
        $g = $gdf['grid'] ?? null;
        if (!is_array($g)) {
            throw new \RangeException('grid missing');
        }
        $w = $g['w'] ?? null;
        $h = $g['h'] ?? null;
        if (!is_int($w) || !is_int($h) || $w < 3 || $h < 3 || $w > self::MAX_GRID || $h > self::MAX_GRID) {
            throw new \RangeException('grid size');
        }
        $grid = self::rleDecode(self::b64decode($g['cells'] ?? null), $w * $h);
        // R-WORLD-1: the border is wall.
        for ($i = 0; $i < $w; $i++) {
            if (ord($grid[$i]) !== self::WALL || ord($grid[($h - 1) * $w + $i]) !== self::WALL) {
                throw new \RangeException('grid not closed');
            }
        }
        for ($j = 0; $j < $h; $j++) {
            if (ord($grid[$j * $w]) !== self::WALL || ord($grid[$j * $w + $w - 1]) !== self::WALL) {
                throw new \RangeException('grid not closed');
            }
        }
        // R-WORLD-2: spawn at the centre of start.cell, which must be room or corridor.
        $sc = $gdf['start']['cell'] ?? null;
        if (!is_array($sc) || !array_is_list($sc) || count($sc) !== 2) {
            throw new \RangeException('start.cell');
        }
        [$si, $sj] = $sc;
        IntMath::assertInt($si);
        IntMath::assertInt($sj);
        if ($si < 0 || $sj < 0 || $si >= $w || $sj >= $h) {
            throw new \RangeException('start.cell outside grid');
        }
        $sk = ord($grid[$sj * $w + $si]);
        if ($sk !== self::ROOM && $sk !== self::CORR) {
            throw new \RangeException('start.cell is not floor');
        }
        // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
        $id = substr(hash('sha256', Canonical::encode($gdf)), 0, 32);
        return new self($id, $w, $h, $grid, $si, $sj);
    }

    /** R-MOVE-4: solid for collision. Outside the grid counts as solid. */
    public function solidCell(int $i, int $j): bool
    {
        if ($i < 0 || $j < 0 || $i >= $this->w || $j >= $this->h) {
            return true;
        }
        return ord($this->grid[$j * $this->w + $i]) === self::WALL;
    }
}
