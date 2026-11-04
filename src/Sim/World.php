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
    public const MAX_ENTITIES = 400;
    public const MAX_ZONES = 16;
    public const MAX_CHECKPOINTS = 12;
    /** R-DOOR-2..4: door travel in [0, DOOR_FULL], +DOOR_STEP per tick while opening; solid while 20*t < 17*DOOR_FULL. */
    public const DOOR_FULL = 693;
    public const DOOR_STEP = 21;
    private const CELL_MM = 2400;
    private const KEY_RE = '/^[A-Za-z_][A-Za-z0-9_]*$/D';
    private const ID_RE = '/^[A-Za-z_][A-Za-z0-9_]{0,31}$/D';
    /** R-PROP-1: footprints per kind, mm. Circles: r. Boxes: half-extents at yaw 0 (swap at 1024/3072). */
    private const PROP_KINDS = [
        'statue' => ['r' => 500], 'stele' => ['r' => 550], 'tree' => ['r' => 450], 'post' => ['r' => 160],
        'plinth' => ['r' => 500], 'lectern' => ['r' => 500], 'sarcophagus' => ['hx' => 750, 'hz' => 1150],
    ];
    private const KEYS_DOOR = ['id', 'type', 'cell', 'style', 'opens'];
    private const KEYS_DOOR_MASK = ['id', 'type', 'cell', 'style', 'opens', 'face'];
    private const KEYS_SLAB = ['id', 'type', 'cell'];
    private const KEYS_PROP = ['id', 'type', 'kind', 'pos', 'yaw'];
    private const KEYS_VENT = ['id', 'type', 'cells', 'period', 'phase', 'warn', 'fire'];
    private const KEYS_ITEM = ['id', 'type', 'kind', 'cell'];
    private const KEYS_TREASURE = ['id', 'type', 'kind', 'cell', 'value'];
    private const KEYS_EYES = ['id', 'type', 'zone', 'wake'];
    private const KEYS_BELL = ['id', 'type', 'cell', 'size', 'patina', 'note'];
    private const KEYS_BELL_SET = ['id', 'type', 'bells', 'order'];
    /** R-BELL-1, R-BELL-3: footprint radius and reach by size 1..3. */
    private const BELL_R = [470, 650, 830];
    private const BELL_REACH = [2420, 2600, 2780];
    public const DOOR_CLOSE_STEP = 33;
    private const ITEM_KINDS = ['flask', 'rubble', 'treasure'];
    private const KEYS_ZONE = ['id', 'name', 'rects', 'ceil'];
    private const KEYS_ZONE_CP = ['id', 'name', 'rects', 'ceil', 'checkpoint'];
    private const KEYS_CP = ['cell', 'yaw'];
    private const KEYS_CP_REACH = ['cell', 'yaw', 'reach'];
    private const DOOR_STYLES = ['stone', 'grate', 'mask'];
    private const DOOR_OPENS = ['interact', 'trigger'];
    private const MASK_FACES = ['weep', 'laugh', 'sleep', 'blank'];

    /**
     * @param string $grid one byte per cell, row-major
     * @param array<int,int> $doorAt cell index -> door index
     * @param array<int,true> $slab cell indices holding a slab
     * @param list<array{id:string,k:int,cx:int,cz:int,interact:bool}> $doors in entity order
     * @param list<array{circle:bool,x:int,z:int,r:int,x0:int,x1:int,z0:int,z1:int}> $props in entity order
     * @param list<array{type:string,door?:int}> $refs one per entity (R-ENT-3)
     * @param array<int,int> $ventAt cell index -> vent index
     * @param list<array{period:int,phase:int,warn:int,fire:int}> $vents
     * @param array<int,int> $zoneOf cell index -> zone index (absent: no zone)
     * @param list<array{id:string,cp:array{x:int,z:int,yaw:int,enter:bool}|null}> $zones
     * @param list<array{id:string,kind:string,k:int,x:int,z:int,reach:int}> $items in entity order
     * @param list<array{id:string,zone:int,wake:int}> $eyes in entity order
     * @param list<array{id:string,k:int,x:int,z:int,reach:int,set:int,index:int}> $bells
     * @param list<array{id:string,bells:list<int>,order:list<int>}> $bellSets
     * @param list<array<string,mixed>> $links compiled, ascending id
     */
    private function __construct(
        public readonly string $id,
        public readonly int $w,
        public readonly int $h,
        private readonly string $grid,
        public readonly int $startI,
        public readonly int $startJ,
        private readonly array $doorAt,
        private readonly array $slab,
        public readonly array $doors,
        public readonly array $props,
        private readonly array $refs,
        private readonly array $ventAt,
        private readonly array $vents,
        private readonly array $zoneOf,
        public readonly array $zones,
        public readonly int $startZone,
        public readonly array $items,
        public readonly array $eyes,
        public readonly array $bells,
        public readonly array $bellSets,
        public readonly array $links,
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
        $startK = $sj * $w + $si;
        $zs = self::loadZones($gdf, $grid, $w, $h);
        $ents = self::loadEntities($gdf, $grid, $w, $h, $startK, $zs['cpCells'], array_column($zs['zones'], 'id'));
        // R-ZONE-2: checkpoint cells hold no door or slab (props were checked in loadEntities).
        foreach ($zs['cpCells'] as $k) {
            if (isset($ents['doorAt'][$k]) || isset($ents['slab'][$k])) {
                throw new \RangeException('checkpoint cell taken');
            }
        }
        // R-LINK-*: compile the links against the entity and zone ids.
        $links = Links::compile(array_key_exists('links', $gdf) ? $gdf['links'] : [], [
            'ents' => $ents['byId'], 'zones' => array_flip(array_column($zs['zones'], 'id')),
        ]);
        // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
        $id = substr(hash('sha256', Canonical::encode($gdf)), 0, 32);
        return new self(
            $id, $w, $h, $grid, $si, $sj, $ents['doorAt'], $ents['slab'], $ents['doors'], $ents['props'], $ents['refs'],
            $ents['ventAt'], $ents['vents'], $zs['zoneOf'], $zs['zones'], $zs['zoneOf'][$startK] ?? -1,
            $ents['items'], $ents['eyes'], $ents['bells'], $ents['bellSets'], $links,
        );
    }

    /** @param array<mixed> $e @param list<string> $keys */
    private static function hasExactKeys(array $e, array $keys): bool
    {
        if (count($e) !== count($keys)) {
            return false;
        }
        foreach ($keys as $k) {
            if (!array_key_exists($k, $e)) {
                return false;
            }
        }
        return true;
    }

    /** R-ENT-2: [i, j] inside the grid -> cell index. */
    private static function cellIndex(mixed $v, int $w, int $h): int
    {
        if (!is_array($v) || !array_is_list($v) || count($v) !== 2 || !is_int($v[0]) || !is_int($v[1])) {
            throw new \RangeException('entity cell');
        }
        [$i, $j] = $v;
        if ($i < 0 || $j < 0 || $i >= $w || $j >= $h) {
            throw new \RangeException('entity cell outside grid');
        }
        return $j * $w + $i;
    }

    /**
     * R-ZONE-1, R-ZONE-2: zones, their cells and checkpoints (mirrors loadZones in world.js).
     *
     * @param array<string,mixed> $gdf
     * @return array{zoneOf:array<int,int>,zones:list<array{id:string,cp:array{x:int,z:int,yaw:int,enter:bool}|null}>,cpCells:list<int>}
     */
    private static function loadZones(array $gdf, string $grid, int $w, int $h): array
    {
        $list = array_key_exists('zones', $gdf) ? $gdf['zones'] : [];
        if (!is_array($list) || !array_is_list($list) || count($list) > self::MAX_ZONES) {
            throw new \RangeException('zones');
        }
        $zoneOf = [];
        $ids = [];
        $zones = [];
        $cpCells = [];
        foreach ($list as $zi => $z) {
            if (!is_array($z) || array_is_list($z) || !is_string($z['id'] ?? null) || preg_match(self::ID_RE, $z['id']) !== 1) {
                throw new \RangeException('zone id');
            }
            if (isset($ids[$z['id']])) {
                throw new \RangeException('duplicate zone id');
            }
            $ids[$z['id']] = true;
            if (!self::hasExactKeys($z, array_key_exists('checkpoint', $z) ? self::KEYS_ZONE_CP : self::KEYS_ZONE)) {
                throw new \RangeException('zone keys');
            }
            if (!is_string($z['name'])) {
                throw new \RangeException('zone name');
            }
            if (!is_int($z['ceil']) || $z['ceil'] < 3000 || $z['ceil'] > 6500) {
                throw new \RangeException('zone ceil');
            }
            $rects = $z['rects'];
            if (!is_array($rects) || !array_is_list($rects) || count($rects) < 1 || count($rects) > 8) {
                throw new \RangeException('zone rects');
            }
            foreach ($rects as $r) {
                if (!is_array($r) || !array_is_list($r) || count($r) !== 4 || count(array_filter($r, 'is_int')) !== 4) {
                    throw new \RangeException('zone rect');
                }
                [$x, $y, $rw, $rh] = $r;
                if ($rw < 1 || $rh < 1 || $x < 0 || $y < 0 || $x > $w - $rw || $y > $h - $rh) {
                    throw new \RangeException('zone rect outside grid');
                }
                for ($j = $y; $j < $y + $rh; $j++) {
                    for ($i = $x; $i < $x + $rw; $i++) {
                        if (isset($zoneOf[$j * $w + $i])) {
                            throw new \RangeException('zones overlap');
                        }
                        $zoneOf[$j * $w + $i] = $zi;
                    }
                }
            }
            $cp = null;
            if (array_key_exists('checkpoint', $z)) {
                $c = $z['checkpoint'];
                if (!is_array($c) || array_is_list($c) || !self::hasExactKeys($c, array_key_exists('reach', $c) ? self::KEYS_CP_REACH : self::KEYS_CP)) {
                    throw new \RangeException('checkpoint keys');
                }
                if (!is_int($c['yaw']) || $c['yaw'] < 0 || $c['yaw'] > 4095) {
                    throw new \RangeException('checkpoint yaw');
                }
                if (array_key_exists('reach', $c) && $c['reach'] !== 'enter' && $c['reach'] !== 'effect') {
                    throw new \RangeException('checkpoint reach');
                }
                $k = self::cellIndex($c['cell'], $w, $h);
                $code = ord($grid[$k]);
                if (($zoneOf[$k] ?? -1) !== $zi || ($code !== self::ROOM && $code !== self::CORR)) {
                    throw new \RangeException('checkpoint cell');
                }
                if (count($cpCells) >= self::MAX_CHECKPOINTS) {
                    throw new \RangeException('too many checkpoints');
                }
                $cpCells[] = $k;
                [$ci, $cj] = $c['cell'];
                $cp = [
                    'x' => $ci * self::CELL_MM + intdiv(self::CELL_MM, 2), 'z' => $cj * self::CELL_MM + intdiv(self::CELL_MM, 2),
                    'yaw' => $c['yaw'], 'enter' => ($c['reach'] ?? 'enter') !== 'effect',
                ];
            }
            $zones[] = ['id' => $z['id'], 'cp' => $cp];
        }
        return ['zoneOf' => $zoneOf, 'zones' => $zones, 'cpCells' => $cpCells];
    }

    /**
     * R-ENT-*, R-DOOR-1, R-SLAB-1, R-PROP-*, R-VENT-1: validate the entity list and build the collision tables
     * (mirrors loadEntities in world.js, check for check).
     *
     * @param array<string,mixed> $gdf
     * @return array{doorAt:array<int,int>,slab:array<int,true>,doors:list<array{id:string,k:int,cx:int,cz:int,interact:bool}>,props:list<array{circle:bool,x:int,z:int,r:int,x0:int,x1:int,z0:int,z1:int}>,refs:list<array{type:string,door?:int}>}
     */
    private static function loadEntities(array $gdf, string $grid, int $w, int $h, int $startK, array $cpCells, array $zoneIds): array
    {
        $list = array_key_exists('entities', $gdf) ? $gdf['entities'] : [];
        if (!is_array($list) || !array_is_list($list) || count($list) > self::MAX_ENTITIES) {
            throw new \RangeException('entities');
        }
        $ids = [];
        $doorAt = [];
        $slab = [];
        $doors = [];
        $props = [];
        $refs = [];
        $vents = [];
        $ventAt = [];
        $items = [];
        $eyes = [];
        $bells = [];
        $bellSets = [];
        $byId = [];
        foreach ($list as $e) {
            if (!is_array($e) || array_is_list($e) || !is_string($e['id'] ?? null) || preg_match(self::ID_RE, $e['id']) !== 1) {
                throw new \RangeException('entity id');
            }
            if (isset($ids[$e['id']])) {
                throw new \RangeException('duplicate entity id');
            }
            $ids[$e['id']] = true;
            $type = $e['type'] ?? null;
            if ($type === 'door') {
                $style = $e['style'] ?? null;
                if (!self::hasExactKeys($e, $style === 'mask' ? self::KEYS_DOOR_MASK : self::KEYS_DOOR)) {
                    throw new \RangeException('door keys');
                }
                if (!in_array($style, self::DOOR_STYLES, true) || !in_array($e['opens'], self::DOOR_OPENS, true)) {
                    throw new \RangeException('door style/opens');
                }
                if ($style === 'mask' && !in_array($e['face'], self::MASK_FACES, true)) {
                    throw new \RangeException('door face');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if (($code !== self::ROOM && $code !== self::CORR) || $k === $startK) {
                    throw new \RangeException('door cell');
                }
                if (isset($doorAt[$k]) || isset($slab[$k])) {
                    throw new \RangeException('cell already taken');
                }
                $doorAt[$k] = count($doors);
                $refs[] = ['type' => 'door', 'door' => count($doors)];
                [$ci, $cj] = $e['cell'];
                $doors[] = [
                    'id' => $e['id'], 'k' => $k,
                    'cx' => $ci * self::CELL_MM + intdiv(self::CELL_MM, 2), 'cz' => $cj * self::CELL_MM + intdiv(self::CELL_MM, 2),
                    'interact' => $e['opens'] === 'interact',
                ];
            } elseif ($type === 'slab') {
                if (!self::hasExactKeys($e, self::KEYS_SLAB)) {
                    throw new \RangeException('slab keys');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                if (ord($grid[$k]) !== self::PLATE) {
                    throw new \RangeException('slab not on a plate');
                }
                if (isset($doorAt[$k]) || isset($slab[$k])) {
                    throw new \RangeException('cell already taken');
                }
                $slab[$k] = true;
                $refs[] = ['type' => 'slab'];
            } elseif ($type === 'prop') {
                if (!self::hasExactKeys($e, self::KEYS_PROP)) {
                    throw new \RangeException('prop keys');
                }
                $kind = $e['kind'];
                $fp = is_string($kind) ? (self::PROP_KINDS[$kind] ?? null) : null;
                if ($fp === null) {
                    throw new \RangeException('prop kind');
                }
                $pos = $e['pos'];
                if (!is_array($pos) || !array_is_list($pos) || count($pos) !== 2 || !is_int($pos[0]) || !is_int($pos[1])) {
                    throw new \RangeException('prop pos');
                }
                $yaw = $e['yaw'];
                if (!is_int($yaw) || $yaw < 0 || $yaw > 4095) {
                    throw new \RangeException('prop yaw');
                }
                [$x, $z] = $pos;
                if ($x < 0 || $z < 0 || $x > $w * self::CELL_MM || $z > $h * self::CELL_MM) {
                    throw new \RangeException('prop pos outside grid');
                }
                if (isset($fp['r'])) {
                    $r = $fp['r'];
                    $props[] = ['circle' => true, 'x' => $x, 'z' => $z, 'r' => $r, 'x0' => $x - $r, 'x1' => $x + $r, 'z0' => $z - $r, 'z1' => $z + $r];
                } else {
                    if ($yaw % 1024 !== 0) {
                        throw new \RangeException('box prop yaw');
                    }
                    $turned = $yaw === 1024 || $yaw === 3072;
                    $hx = $turned ? $fp['hz'] : $fp['hx'];
                    $hz = $turned ? $fp['hx'] : $fp['hz'];
                    $props[] = ['circle' => false, 'x' => $x, 'z' => $z, 'r' => 0, 'x0' => $x - $hx, 'x1' => $x + $hx, 'z0' => $z - $hz, 'z1' => $z + $hz];
                }
                $refs[] = ['type' => 'prop'];
            } elseif ($type === 'vent') {
                if (!self::hasExactKeys($e, self::KEYS_VENT)) {
                    throw new \RangeException('vent keys');
                }
                $period = $e['period'];
                $phase = $e['phase'];
                $warn = $e['warn'];
                $fire = $e['fire'];
                if (!is_int($period) || !is_int($phase) || !is_int($warn) || !is_int($fire)) {
                    throw new \RangeException('vent timing');
                }
                if ($period < 2 || $period > 1800 || $phase < 0 || $phase >= $period || $warn < 0 || $fire < 1
                    || $warn + $fire > $period || 5 * $fire > 3 * $period) {
                    throw new \RangeException('vent timing');
                }
                $cells = $e['cells'];
                if (!is_array($cells) || !array_is_list($cells) || count($cells) < 1 || count($cells) > 64) {
                    throw new \RangeException('vent cells');
                }
                foreach ($cells as $c) {
                    $k = self::cellIndex($c, $w, $h);
                    if (ord($grid[$k]) !== self::VENT || isset($ventAt[$k])) {
                        throw new \RangeException('vent cell');
                    }
                    $ventAt[$k] = count($vents);
                }
                $vents[] = ['period' => $period, 'phase' => $phase, 'warn' => $warn, 'fire' => $fire];
                $refs[] = ['type' => 'vent'];
            } elseif ($type === 'item') {
                $kind = $e['kind'] ?? null;
                if (!self::hasExactKeys($e, $kind === 'treasure' ? self::KEYS_TREASURE : self::KEYS_ITEM)) {
                    throw new \RangeException('item keys');
                }
                if (!in_array($kind, self::ITEM_KINDS, true)) {
                    throw new \RangeException('item kind');
                }
                if ($kind === 'treasure' && (!is_int($e['value']) || $e['value'] < 1 || $e['value'] > 100000)) {
                    throw new \RangeException('item value');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR && $code !== self::BRIDGE) {
                    throw new \RangeException('item cell');
                }
                [$ci, $cj] = $e['cell'];
                $off = $kind === 'rubble' ? 300 : 0;
                $refs[] = ['type' => 'item', 'item' => count($items)];
                $items[] = [
                    'id' => $e['id'], 'kind' => $kind, 'k' => $k,
                    'x' => $ci * self::CELL_MM + intdiv(self::CELL_MM, 2) - $off, 'z' => $cj * self::CELL_MM + intdiv(self::CELL_MM, 2) - $off,
                    'reach' => $kind === 'rubble' ? 1600 : 1700,
                ];
            } elseif ($type === 'eyes') {
                if (!self::hasExactKeys($e, self::KEYS_EYES)) {
                    throw new \RangeException('eyes keys');
                }
                $zi = is_string($e['zone']) ? array_search($e['zone'], $zoneIds, true) : false;
                if ($zi === false || in_array($zi, array_column($eyes, 'zone'), true)) {
                    throw new \RangeException('eyes zone');
                }
                if (!is_int($e['wake']) || $e['wake'] < 18 || $e['wake'] > 1800) {
                    throw new \RangeException('eyes wake');
                }
                $refs[] = ['type' => 'eyes'];
                $eyes[] = ['id' => $e['id'], 'zone' => $zi, 'wake' => $e['wake']];
            } elseif ($type === 'bell') {
                if (!self::hasExactKeys($e, self::KEYS_BELL)) {
                    throw new \RangeException('bell keys');
                }
                if (!is_int($e['size']) || $e['size'] < 1 || $e['size'] > 3) {
                    throw new \RangeException('bell size');
                }
                if (!is_int($e['patina']) || $e['patina'] < 0 || $e['patina'] > 2) {
                    throw new \RangeException('bell patina');
                }
                if (!is_int($e['note']) || $e['note'] < 20 || $e['note'] > 20000) {
                    throw new \RangeException('bell note');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR) {
                    throw new \RangeException('bell cell');
                }
                [$ci, $cj] = $e['cell'];
                $x = $ci * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $z = $cj * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $r = self::BELL_R[$e['size'] - 1];
                $props[] = ['circle' => true, 'x' => $x, 'z' => $z, 'r' => $r, 'x0' => $x - $r, 'x1' => $x + $r, 'z0' => $z - $r, 'z1' => $z + $r];
                $refs[] = ['type' => 'bell', 'bell' => count($bells)];
                $bells[] = ['id' => $e['id'], 'k' => $k, 'x' => $x, 'z' => $z, 'reach' => self::BELL_REACH[$e['size'] - 1], 'set' => -1, 'index' => -1];
            } elseif ($type === 'bellSet') {
                if (!self::hasExactKeys($e, self::KEYS_BELL_SET)) {
                    throw new \RangeException('bellSet keys');
                }
                $bl = $e['bells'];
                if (!is_array($bl) || !array_is_list($bl) || count($bl) < 2 || count($bl) > 5 || count(array_filter($bl, 'is_string')) !== count($bl)) {
                    throw new \RangeException('bellSet bells');
                }
                $order = $e['order'];
                if (!is_array($order) || !array_is_list($order) || count($order) !== count($bl) || count(array_filter($order, 'is_int')) !== count($order)) {
                    throw new \RangeException('bellSet order');
                }
                for ($x = 0; $x < count($order); $x++) {
                    if (!in_array($x, $order, true)) {
                        throw new \RangeException('bellSet order');
                    }
                }
                $refs[] = ['type' => 'bellSet', 'set' => count($bellSets)];
                $bellSets[] = ['id' => $e['id'], 'names' => $bl, 'order' => $order];
            } else {
                throw new \RangeException('unknown entity type');
            }
            $byId[$e['id']] = $refs[count($refs) - 1] + ['n' => count($refs), 'kind' => $type === 'item' ? $e['kind'] : null];
        }
        // R-BELL-1, R-BELL-2: bells on free cells; every bell in exactly one set, named by bell id.
        foreach ($bells as $b) {
            if (isset($doorAt[$b['k']]) || isset($slab[$b['k']])) {
                throw new \RangeException('bell cell taken');
            }
        }
        foreach ($bellSets as $si => &$set) {
            $set['bells'] = [];
            foreach ($set['names'] as $i => $name) {
                $r = $byId[$name] ?? null;
                if ($r === null || $r['type'] !== 'bell' || $bells[$r['bell']]['set'] >= 0) {
                    throw new \RangeException('bellSet bell');
                }
                $bells[$r['bell']]['set'] = $si;
                $bells[$r['bell']]['index'] = $i;
                $set['bells'][] = $r['bell'];
            }
            unset($set['names']);
        }
        unset($set);
        foreach ($bells as $b) {
            if ($b['set'] < 0) {
                throw new \RangeException('bell without a set');
            }
        }
        // R-ITEM-1: no item on a door or slab cell (checked after the loop, whatever the order).
        foreach ($items as $it) {
            if (isset($doorAt[$it['k']]) || isset($slab[$it['k']])) {
                throw new \RangeException('item cell taken');
            }
        }
        // R-VENT-1: every vent cell belongs to a vent.
        for ($k = 0; $k < $w * $h; $k++) {
            if (ord($grid[$k]) === self::VENT && !isset($ventAt[$k])) {
                throw new \RangeException('vent cell without a vent');
            }
        }
        // R-PROP-2: every cell under the footprint's bounds is inside the grid and free floor.
        foreach ($props as $p) {
            $i0 = IntMath::fdiv($p['x0'], self::CELL_MM);
            $i1 = IntMath::fdiv($p['x1'] - 1, self::CELL_MM);
            $j0 = IntMath::fdiv($p['z0'], self::CELL_MM);
            $j1 = IntMath::fdiv($p['z1'] - 1, self::CELL_MM);
            for ($j = $j0; $j <= $j1; $j++) {
                for ($i = $i0; $i <= $i1; $i++) {
                    if ($i < 0 || $j < 0 || $i >= $w || $j >= $h) {
                        throw new \RangeException('prop outside grid');
                    }
                    $k = $j * $w + $i;
                    if (ord($grid[$k]) === self::WALL || isset($doorAt[$k]) || isset($slab[$k]) || $k === $startK || in_array($k, $cpCells, true)) {
                        throw new \RangeException('prop footprint blocked');
                    }
                }
            }
        }
        return ['doorAt' => $doorAt, 'slab' => $slab, 'doors' => $doors, 'props' => $props, 'refs' => $refs, 'ventAt' => $ventAt, 'vents' => $vents, 'items' => $items, 'eyes' => $eyes,
            'bells' => $bells, 'bellSets' => $bellSets, 'byId' => $byId];
    }

    /**
     * R-MOVE-4: solid for collision. Outside the grid, wall, a door cell while R-DOOR-4 holds, a slab,
     * a plate sprung during play (state.sprung, R-TRAP-2).
     *
     * @param array<string,mixed> $state
     */
    public function solidCell(array $state, int $i, int $j): bool
    {
        if ($i < 0 || $j < 0 || $i >= $this->w || $j >= $this->h) {
            return true;
        }
        $k = $j * $this->w + $i;
        if (ord($this->grid[$k]) === self::WALL || isset($this->slab[$k]) || in_array($k, $state['sprung'], true)) {
            return true;
        }
        $d = $this->doorAt[$k] ?? -1;
        return $d >= 0 && 20 * $state['doors'][$d]['t'] < 17 * self::DOOR_FULL;
    }

    /** The cell code at (i, j), which must be inside the grid. */
    public function cellCode(int $i, int $j): int
    {
        return ord($this->grid[$j * $this->w + $i]);
    }

    /** True if cell index k holds a slab from the GDF (R-SLAB-1). */
    public function slabAt(int $k): bool
    {
        return isset($this->slab[$k]);
    }

    /**
     * R-VENT-*: the vent covering cell index k, or null.
     *
     * @return array{period:int,phase:int,warn:int,fire:int}|null
     */
    public function ventAt(int $k): ?array
    {
        return isset($this->ventAt[$k]) ? $this->vents[$this->ventAt[$k]] : null;
    }

    /**
     * R-LOS-1: blocks sight: wall, or a door cell while R-DOOR-4 holds. Outside the grid blocks.
     *
     * @param array<string,mixed> $state
     */
    public function sightBlocked(array $state, int $i, int $j): bool
    {
        if ($i < 0 || $j < 0 || $i >= $this->w || $j >= $this->h) {
            return true;
        }
        $k = $j * $this->w + $i;
        if (ord($this->grid[$k]) === self::WALL) {
            return true;
        }
        $d = $this->doorAt[$k] ?? -1;
        return $d >= 0 && 20 * $state['doors'][$d]['t'] < 17 * self::DOOR_FULL;
    }

    /** R-ZONE-1: zone index of cell index k, or -1. */
    public function zoneAt(int $k): int
    {
        return $this->zoneOf[$k] ?? -1;
    }

    /**
     * R-ENT-3: the entity with number n (1-based), or null.
     *
     * @return array{type:string,door?:int}|null
     */
    public function entityRef(int $n): ?array
    {
        return $n >= 1 ? ($this->refs[$n - 1] ?? null) : null;
    }
}
