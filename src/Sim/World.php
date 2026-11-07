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
    private const KEYS_CHEST = ['id', 'type', 'cell', 'wall', 'style', 'trap'];
    private const KEYS_ALCOVE = ['id', 'type', 'cell', 'kind', 'door'];
    private const KEYS_FOE = ['id', 'type', 'kind', 'cell', 'start'];
    private const KEYS_BRAZIER = ['id', 'type', 'cell', 'lit'];
    private const KEYS_BOSS = ['id', 'type', 'kind', 'pos', 'zone'];
    private const FOE_STARTS = ['asleep', 'idle', 'hunting', 'dormant'];
    public const MAX_FOES = 24;
    public const MAX_AWAKE = 8;
    public const THREAT_BUDGET = 100;
    private const KEYS_PROP = ['id', 'type', 'kind', 'pos', 'yaw'];
    private const KEYS_VENT = ['id', 'type', 'cells', 'period', 'phase', 'warn', 'fire'];
    private const KEYS_ITEM = ['id', 'type', 'kind', 'cell'];
    private const KEYS_TREASURE = ['id', 'type', 'kind', 'cell', 'value'];
    private const KEYS_EYES = ['id', 'type', 'zone', 'wake'];
    private const KEYS_BELL = ['id', 'type', 'cell', 'size', 'patina', 'note'];
    private const KEYS_HOOK = ['id', 'type', 'cell', 'dir'];
    private const KEYS_MIRROR = ['id', 'type', 'cell', 'start'];
    private const KEYS_CRYSTAL = ['id', 'type', 'cell', 'wall'];
    /** R-BEAM-1: directions as [di, dj]. */
    public const DIRS = ['n' => [0, -1], 'e' => [1, 0], 's' => [0, 1], 'w' => [-1, 0]];
    private const KEYS_BELL_SET = ['id', 'type', 'bells', 'order'];
    /** R-BELL-1, R-BELL-3: footprint radius and reach by size 1..3. */
    private const BELL_R = [470, 650, 830];
    private const BELL_REACH = [2420, 2600, 2780];
    public const DOOR_CLOSE_STEP = 33;
    private const ITEM_KINDS = ['flask', 'rubble', 'treasure', 'key'];
    private const KEYS_ZONE = ['id', 'name', 'rects', 'ceil'];
    // R-DRESS-*: renderer-only entities and zone keys; validated, never read by a rule.
    private const KEYS_TORCH = ['id', 'type', 'cell', 'wall'];
    private const KEYS_MARKS = ['id', 'type', 'cells'];
    private const KEYS_DECOR = ['id', 'type', 'kind', 'pos', 'yaw'];
    private const INSCRIPTION_STYLES = ['plaque', 'carving', 'scrawl', 'stele', 'book', 'look'];
    private const DECOR_KINDS = ['bones', 'burnt', 'scorch', 'candles', 'stair'];
    private const ZONE_WALLS = ['brick', 'shelves'];
    private const MAX_INSCRIPTIONS = 24;
    private const BAD_TEXT = '/[\x{0}-\x{1F}\x{7F}-\x{9F}]/u';
    private const BAD_PAGE = '/[\x{0}-\x{9}\x{B}-\x{1F}\x{7F}-\x{9F}]/u';
    private const KEYS_CP = ['cell', 'yaw'];
    private const KEYS_CP_REACH = ['cell', 'yaw', 'reach'];
    private const DOOR_STYLES = ['stone', 'grate', 'mask'];
    private const DOOR_OPENS = ['interact', 'trigger', 'key'];
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
     * @param list<array<string,mixed>> $hooks
     * @param list<array<string,mixed>> $mirrors
     * @param list<array<string,mixed>> $crystals
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
        public readonly array $hooks,
        public readonly array $mirrors,
        public readonly array $crystals,
        public readonly array $chests,
        public readonly array $alcoves,
        private readonly array $alcoveAt,
        public readonly array $foes,
        public readonly array $groups,
        public readonly array $braziers,
        public readonly ?array $boss,
        public readonly ?array $bossBox,
        public readonly ?array $exit,
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
        // R-BOSS-2: the boss starts inside her zone; her box is the zone's bounding box inset by 700 mm.
        $bossBox = null;
        if ($ents['boss'] !== null) {
            $b = $ents['boss'];
            $x0 = PHP_INT_MAX;
            $z0 = PHP_INT_MAX;
            $x1 = PHP_INT_MIN;
            $z1 = PHP_INT_MIN;
            foreach ($gdf['zones'][$b['zone']]['rects'] as [$rx, $ry, $rw, $rh]) {
                $x0 = min($x0, $rx * self::CELL_MM);
                $z0 = min($z0, $ry * self::CELL_MM);
                $x1 = max($x1, ($rx + $rw) * self::CELL_MM);
                $z1 = max($z1, ($ry + $rh) * self::CELL_MM);
            }
            $bossBox = ['x0' => $x0 + 700, 'z0' => $z0 + 700, 'x1' => $x1 - 700, 'z1' => $z1 - 700];
            if ($b['x'] < $bossBox['x0'] || $b['x'] > $bossBox['x1'] || $b['z'] < $bossBox['z0'] || $b['z'] > $bossBox['z1']) {
                throw new \RangeException('boss outside her zone');
            }
        }
        // R-EXIT-1: the exit cell and its requirement.
        $exit = null;
        if (array_key_exists('exit', $gdf)) {
            $e = $gdf['exit'];
            if (!is_array($e) || array_is_list($e) || !self::hasExactKeys($e, array_key_exists('requires', $e) ? ['cell', 'requires'] : ['cell'])) {
                throw new \RangeException('exit keys');
            }
            $k = self::cellIndex($e['cell'], $w, $h);
            $code = ord($grid[$k]);
            if ($code !== self::ROOM && $code !== self::CORR) {
                throw new \RangeException('exit cell');
            }
            $item = 0;
            $boss = false;
            if (array_key_exists('requires', $e)) {
                if ($e['requires'] === 'bossDefeated') {
                    if ($ents['boss'] === null) {
                        throw new \RangeException('exit requires a boss');
                    }
                    $boss = true;
                } else {
                    $r = is_string($e['requires']) ? ($ents['byId'][$e['requires']] ?? null) : null;
                    if ($r === null || $r['type'] !== 'item' || $r['kind'] === 'rubble') {
                        throw new \RangeException('exit requires');
                    }
                    $item = $r['n'];
                }
            }
            $exit = ['x' => $e['cell'][0] * self::CELL_MM + intdiv(self::CELL_MM, 2), 'z' => $e['cell'][1] * self::CELL_MM + intdiv(self::CELL_MM, 2), 'item' => $item, 'boss' => $boss];
        }
        // R-FOE-2: a GDF with foes names its bestiary version.
        if (($ents['foes'] !== [] || $ents['boss'] !== null || array_key_exists('bestiary', $gdf)) && ($gdf['bestiary'] ?? null) !== Bestiary::VERSION) {
            throw new \RangeException('bestiary version');
        }
        // R-LINK-*: compile the links against the entity and zone ids.
        $links = Links::compile(array_key_exists('links', $gdf) ? $gdf['links'] : [], [
            'ents' => $ents['byId'], 'zones' => array_flip(array_column($zs['zones'], 'id')), 'groups' => $ents['groupIds'],
            'cpZones' => array_map(static fn (array $z): bool => $z['cp'] !== null, $zs['zones']),
        ]);
        // R-WORLD-3: world id = first 16 bytes of SHA-256 over the canonical GDF, as hex.
        $id = substr(hash('sha256', Canonical::encode($gdf)), 0, 32);
        return new self(
            $id, $w, $h, $grid, $si, $sj, $ents['doorAt'], $ents['slab'], $ents['doors'], $ents['props'], $ents['refs'],
            $ents['ventAt'], $ents['vents'], $zs['zoneOf'], $zs['zones'], $zs['zoneOf'][$startK] ?? -1,
            $ents['items'], $ents['eyes'], $ents['bells'], $ents['bellSets'], $links,
            $ents['hooks'], $ents['mirrors'], $ents['crystals'], $ents['chests'], $ents['alcoves'], $ents['alcoveAt'],
            $ents['foes'], $ents['groups'], $ents['braziers'], $ents['boss'], $bossBox, $exit,
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

    /** R-DRESS-*: text of 1..$max code points without control characters (pages may break lines). */
    private static function dressText(mixed $v, int $max, bool $page): bool
    {
        if (!is_string($v)) {
            return false;
        }
        $n = mb_strlen($v, 'UTF-8');
        return $n >= 1 && $n <= $max && preg_match($page ? self::BAD_PAGE : self::BAD_TEXT, $v) === 0;
    }

    private static function dressPos(mixed $pos, int $w, int $h): void
    {
        if (!is_array($pos) || !array_is_list($pos) || count($pos) !== 2 || !is_int($pos[0]) || !is_int($pos[1])) {
            throw new \RangeException('dressing pos');
        }
        if ($pos[0] < 0 || $pos[1] < 0 || $pos[0] > $w * self::CELL_MM || $pos[1] > $h * self::CELL_MM) {
            throw new \RangeException('dressing pos outside grid');
        }
    }

    /** R-DRESS-1, R-DRESS-2: a floor cell whose neighbour on $side is wall. */
    private static function dressWall(mixed $cell, mixed $side, string $grid, int $w, int $h): void
    {
        $k = self::cellIndex($cell, $w, $h);
        $d = is_string($side) ? (self::DIRS[$side] ?? null) : null;
        if ($d === null) {
            throw new \RangeException('dressing wall side');
        }
        $c = ord($grid[$k]);
        if ($c !== self::ROOM && $c !== self::CORR) {
            throw new \RangeException('dressing wall cell');
        }
        if (ord($grid[$k + $d[1] * $w + $d[0]]) !== self::WALL) {
            throw new \RangeException('dressing not on a wall');
        }
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
            $zk = self::KEYS_ZONE;
            foreach (['checkpoint', 'tint', 'walls'] as $opt) {
                if (array_key_exists($opt, $z)) {
                    $zk[] = $opt;
                }
            }
            if (!self::hasExactKeys($z, $zk)) {
                throw new \RangeException('zone keys');
            }
            // R-ZONE-1, R-DRESS-*: tint and walls are renderer only.
            if (array_key_exists('tint', $z)) {
                $t = $z['tint'];
                if (!is_array($t) || !array_is_list($t) || count($t) !== 3 || count(array_filter($t, static fn (mixed $c): bool => is_int($c) && $c >= 0 && $c <= 255)) !== 3) {
                    throw new \RangeException('zone tint');
                }
            }
            if (array_key_exists('walls', $z) && !in_array($z['walls'], self::ZONE_WALLS, true)) {
                throw new \RangeException('zone walls');
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
        $hooks = [];
        $mirrors = [];
        $crystals = [];
        $chests = [];
        $alcoves = [];
        $alcoveAt = [];
        $foes = [];
        $groups = [];
        $groupIds = [];
        $braziers = [];
        $bosses = [];
        $inscriptions = 0;
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
                $dk = array_merge($style === 'mask' ? self::KEYS_DOOR_MASK : self::KEYS_DOOR, ($e['opens'] ?? null) === 'key' ? ['key'] : []);
                if (!self::hasExactKeys($e, $dk)) {
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
                    'interact' => $e['opens'] === 'interact', 'keyName' => $e['opens'] === 'key' ? $e['key'] : null, 'key' => -1,
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
                $hidden = array_key_exists('hidden', $e);
                $inChest = array_key_exists('in', $e);
                $base = array_values(array_filter($kind === 'treasure' ? self::KEYS_TREASURE : self::KEYS_ITEM, static fn (string $x): bool => !$inChest || $x !== 'cell'));
                $named = array_key_exists('name', $e);
                $keys = array_merge($base, $hidden ? ['hidden'] : [], $inChest ? ['in'] : [], $named ? ['name'] : []);
                if (!self::hasExactKeys($e, $keys)) {
                    throw new \RangeException('item keys');
                }
                if ($named && (($kind !== 'treasure' && $kind !== 'key') || !self::dressText($e['name'], 40, false))) {
                    throw new \RangeException('item name');   // R-ITEM-1
                }
                if (!in_array($kind, self::ITEM_KINDS, true)) {
                    throw new \RangeException('item kind');
                }
                if ($hidden && ($e['hidden'] !== true || $kind === 'rubble' || $inChest)) {
                    throw new \RangeException('item hidden');
                }
                if ($inChest && (!is_string($e['in']) || $kind === 'rubble')) {
                    throw new \RangeException('item in');
                }
                if ($kind === 'treasure' && (!is_int($e['value']) || $e['value'] < 1 || $e['value'] > 100000)) {
                    throw new \RangeException('item value');
                }
                $k = -1;
                $x = 0;
                $z = 0;
                if (!$inChest) {
                    $k = self::cellIndex($e['cell'], $w, $h);
                    $code = ord($grid[$k]);
                    if ($code !== self::ROOM && $code !== self::CORR && $code !== self::BRIDGE) {
                        throw new \RangeException('item cell');
                    }
                    [$ci, $cj] = $e['cell'];
                    $off = $kind === 'rubble' ? 300 : 0;
                    $x = $ci * self::CELL_MM + intdiv(self::CELL_MM, 2) - $off;
                    $z = $cj * self::CELL_MM + intdiv(self::CELL_MM, 2) - $off;
                }
                $refs[] = ['type' => 'item', 'item' => count($items)];
                $items[] = [
                    'id' => $e['id'], 'n' => count($refs), 'kind' => $kind, 'hidden' => $hidden, 'k' => $k, 'x' => $x, 'z' => $z,
                    'reach' => $kind === 'rubble' ? 1600 : 1700, 'chestName' => $inChest ? $e['in'] : null, 'value' => $kind === 'treasure' ? $e['value'] : 0,
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
            } elseif ($type === 'chest') {
                if (!self::hasExactKeys($e, self::KEYS_CHEST)) {
                    throw new \RangeException('chest keys');
                }
                $d = is_string($e['wall']) ? (self::DIRS[$e['wall']] ?? null) : null;
                if ($d === null || ($e['style'] !== 'plain' && $e['style'] !== 'gilded') || ($e['trap'] !== 'none' && $e['trap'] !== 'needles')) {
                    throw new \RangeException('chest wall/style/trap');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR) {
                    throw new \RangeException('chest cell');
                }
                [$ci, $cj] = $e['cell'];
                $x = $ci * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $z = $cj * self::CELL_MM + intdiv(self::CELL_MM, 2);
                [$di, $dj] = $d;
                // R-CHEST-1: 600 along the wall, 650 towards it, 150 away from it.
                $x0 = $di === 0 ? $x - 600 : ($di > 0 ? $x - 150 : $x - 650);
                $x1 = $di === 0 ? $x + 600 : ($di > 0 ? $x + 650 : $x + 150);
                $z0 = $dj === 0 ? $z - 600 : ($dj > 0 ? $z - 150 : $z - 650);
                $z1 = $dj === 0 ? $z + 600 : ($dj > 0 ? $z + 650 : $z + 150);
                $props[] = ['circle' => false, 'x' => $x, 'z' => $z, 'r' => 0, 'x0' => $x0, 'x1' => $x1, 'z0' => $z0, 'z1' => $z1];
                $refs[] = ['type' => 'chest', 'chest' => count($chests)];
                $chests[] = ['id' => $e['id'], 'k' => $k, 'x' => $x + 250 * $di, 'z' => $z + 250 * $dj, 'reach' => 2200, 'needles' => $e['trap'] === 'needles', 'contents' => []];
            } elseif ($type === 'foe') {
                $grouped = array_key_exists('group', $e);
                $disguised = array_key_exists('disguise', $e);
                if (!self::hasExactKeys($e, array_merge(self::KEYS_FOE, $grouped ? ['group'] : [], $disguised ? ['disguise'] : []))) {
                    throw new \RangeException('foe keys');
                }
                $kind = Bestiary::kind($e['kind']);
                if ($kind === null) {
                    throw new \RangeException('foe kind');
                }
                if (!in_array($e['start'], self::FOE_STARTS, true)) {
                    throw new \RangeException('foe start');
                }
                // R-MIMIC-1: only a mimic may be disguised, and it starts asleep.
                if ($disguised && ($kind['power'] !== 'mimic' || $e['start'] !== 'asleep' || !in_array($e['disguise'], ['treasure', 'flask', 'chest'], true))) {
                    throw new \RangeException('foe disguise');
                }
                if ($grouped && (!is_string($e['group']) || preg_match(self::ID_RE, $e['group']) !== 1)) {
                    throw new \RangeException('foe group');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR && $code !== self::BRIDGE) {
                    throw new \RangeException('foe cell');
                }
                $gname = $grouped ? $e['group'] : $e['id'];
                if (!isset($groupIds[$gname])) {
                    $groupIds[$gname] = count($groups);
                    $groups[] = ['id' => $gname, 'foes' => [], 'dormant' => true];
                }
                $g = $groupIds[$gname];
                $groups[$g]['foes'][] = count($foes);
                if ($e['start'] !== 'dormant') {
                    $groups[$g]['dormant'] = false;
                }
                [$ci, $cj] = $e['cell'];
                $refs[] = ['type' => 'foe', 'foe' => count($foes)];
                $foes[] = [
                    'id' => $e['id'], 'k' => $k, 'x' => $ci * self::CELL_MM + intdiv(self::CELL_MM, 2), 'z' => $cj * self::CELL_MM + intdiv(self::CELL_MM, 2),
                    'kind' => $kind, 'start' => $e['start'], 'group' => $g, 'disguise' => $disguised ? $e['disguise'] : null,
                ];
            } elseif ($type === 'brazier') {
                if (!self::hasExactKeys($e, self::KEYS_BRAZIER)) {
                    throw new \RangeException('brazier keys');
                }
                if (!is_bool($e['lit'])) {
                    throw new \RangeException('brazier lit');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR) {
                    throw new \RangeException('brazier cell');
                }
                [$ci, $cj] = $e['cell'];
                $x = $ci * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $z = $cj * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $props[] = ['circle' => true, 'x' => $x, 'z' => $z, 'r' => 550, 'x0' => $x - 550, 'x1' => $x + 550, 'z0' => $z - 550, 'z1' => $z + 550];
                $refs[] = ['type' => 'brazier', 'brazier' => count($braziers)];
                $braziers[] = ['id' => $e['id'], 'k' => $k, 'x' => $x, 'z' => $z, 'reach' => 2300, 'lit' => $e['lit']];
            } elseif ($type === 'boss') {
                $calls = array_key_exists('summons', $e);   // R-WARDEN-3 (decision #77)
                if (!self::hasExactKeys($e, $calls ? [...self::KEYS_BOSS, 'summons'] : self::KEYS_BOSS)) {
                    throw new \RangeException('boss keys');
                }
                $kind = Bestiary::boss($e['kind']);
                if ($kind === null) {
                    throw new \RangeException('boss kind');
                }
                $pos = $e['pos'];
                if (!is_array($pos) || !array_is_list($pos) || count($pos) !== 2 || !is_int($pos[0]) || !is_int($pos[1])) {
                    throw new \RangeException('boss pos');
                }
                $zi = is_string($e['zone']) ? array_search($e['zone'], $zoneIds, true) : false;
                if ($zi === false || $bosses !== []) {
                    throw new \RangeException('boss zone / count');
                }
                if ($calls && ($kind['behaviour'] !== 'warden' || !is_string($e['summons']) || preg_match(self::ID_RE, $e['summons']) !== 1)) {
                    throw new \RangeException('boss summons');
                }
                $refs[] = ['type' => 'boss'];
                $bosses[] = ['id' => $e['id'], 'kind' => $kind, 'x' => $pos[0], 'z' => $pos[1], 'zone' => $zi,
                    'summonsName' => $calls ? $e['summons'] : null, 'summons' => -1];
            } elseif ($type === 'alcove') {
                if (!self::hasExactKeys($e, self::KEYS_ALCOVE)) {
                    throw new \RangeException('alcove keys');
                }
                if ($e['kind'] !== 'drown' && $e['kind'] !== 'tip') {
                    throw new \RangeException('alcove kind');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                if (ord($grid[$k]) !== self::ALCOVE || isset($alcoveAt[$k])) {
                    throw new \RangeException('alcove cell');
                }
                $alcoveAt[$k] = count($alcoves);
                $refs[] = ['type' => 'alcove', 'alcove' => count($alcoves)];
                $alcoves[] = ['id' => $e['id'], 'k' => $k, 'drown' => $e['kind'] === 'drown', 'doorName' => $e['door'], 'door' => -1];
            } elseif ($type === 'lampHook' || $type === 'mirror' || $type === 'crystal') {
                if (!self::hasExactKeys($e, $type === 'lampHook' ? self::KEYS_HOOK : ($type === 'mirror' ? self::KEYS_MIRROR : self::KEYS_CRYSTAL))) {
                    throw new \RangeException($type . ' keys');
                }
                $k = self::cellIndex($e['cell'], $w, $h);
                $code = ord($grid[$k]);
                if ($code !== self::ROOM && $code !== self::CORR) {
                    throw new \RangeException($type . ' cell');
                }
                [$ci, $cj] = $e['cell'];
                $x = $ci * self::CELL_MM + intdiv(self::CELL_MM, 2);
                $z = $cj * self::CELL_MM + intdiv(self::CELL_MM, 2);
                if ($type === 'lampHook') {
                    $d = is_string($e['dir']) ? (self::DIRS[$e['dir']] ?? null) : null;
                    if ($d === null) {
                        throw new \RangeException('lampHook dir');
                    }
                    $refs[] = ['type' => 'lampHook', 'hook' => count($hooks)];
                    $hooks[] = ['id' => $e['id'], 'k' => $k, 'i' => $ci, 'j' => $cj, 'di' => $d[0], 'dj' => $d[1], 'x' => $x - 900 * $d[0], 'z' => $z - 900 * $d[1], 'reach' => 2200];
                } elseif ($type === 'mirror') {
                    if ($e['start'] !== '/' && $e['start'] !== '\\') {
                        throw new \RangeException('mirror start');
                    }
                    foreach ($mirrors as $m) {
                        if ($m['k'] === $k) {
                            throw new \RangeException('two mirrors on one cell');
                        }
                    }
                    $props[] = ['circle' => true, 'x' => $x, 'z' => $z, 'r' => 420, 'x0' => $x - 420, 'x1' => $x + 420, 'z0' => $z - 420, 'z1' => $z + 420];
                    $refs[] = ['type' => 'mirror', 'mirror' => count($mirrors)];
                    $mirrors[] = ['id' => $e['id'], 'k' => $k, 'x' => $x, 'z' => $z, 'reach' => 2150, 'start' => $e['start'] === '/' ? 0 : 1];
                } else {
                    $d = is_string($e['wall']) ? (self::DIRS[$e['wall']] ?? null) : null;
                    if ($d === null) {
                        throw new \RangeException('crystal wall');
                    }
                    if (ord($grid[($cj + $d[1]) * $w + $ci + $d[0]]) !== self::WALL) {
                        throw new \RangeException('crystal not on a wall');
                    }
                    $refs[] = ['type' => 'crystal', 'crystal' => count($crystals)];
                    $crystals[] = ['id' => $e['id'], 'k' => $k, 'di' => $d[0], 'dj' => $d[1]];
                }
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
            } elseif ($type === 'torch') {
                if (!self::hasExactKeys($e, self::KEYS_TORCH)) {
                    throw new \RangeException('torch keys');
                }
                self::dressWall($e['cell'], $e['wall'], $grid, $w, $h); // R-DRESS-1
                $refs[] = ['type' => 'torch'];
            } elseif ($type === 'inscription') {
                // R-DRESS-2
                $place = array_values(array_filter(['wall', 'pos', 'on'], static fn (string $k): bool => array_key_exists($k, $e)));
                if (count($place) !== 1) {
                    throw new \RangeException('inscription placement');
                }
                $ik = ['id', 'type', 'style', 'title', 'pages', $place[0]];
                foreach (['caption', 'sig'] as $opt) {
                    if (array_key_exists($opt, $e)) {
                        $ik[] = $opt;
                    }
                }
                if (!self::hasExactKeys($e, $ik)) {
                    throw new \RangeException('inscription keys');
                }
                if (!in_array($e['style'], self::INSCRIPTION_STYLES, true)) {
                    throw new \RangeException('inscription style');
                }
                if (!self::dressText($e['title'], 80, false)) {
                    throw new \RangeException('inscription title');
                }
                foreach (['caption', 'sig'] as $opt) {
                    if (array_key_exists($opt, $e) && !self::dressText($e[$opt], 80, false)) {
                        throw new \RangeException('inscription ' . $opt);
                    }
                }
                $pages = $e['pages'];
                if (!is_array($pages) || !array_is_list($pages) || count($pages) < 1 || count($pages) > 8) {
                    throw new \RangeException('inscription pages');
                }
                $total = 0;
                foreach ($pages as $pg) {
                    if (!self::dressText($pg, 1500, true)) {
                        throw new \RangeException('inscription page');
                    }
                    $total += mb_strlen($pg, 'UTF-8');
                }
                if ($total > 1500) {
                    throw new \RangeException('inscription too long');
                }
                if ($place[0] === 'wall') {
                    $wl = $e['wall'];
                    if (!is_array($wl) || !array_is_list($wl) || count($wl) !== 2) {
                        throw new \RangeException('inscription wall');
                    }
                    self::dressWall($wl[0], $wl[1], $grid, $w, $h);
                } elseif ($place[0] === 'pos') {
                    self::dressPos($e['pos'], $w, $h);
                } elseif (!is_string($e['on'])) {
                    throw new \RangeException('inscription on');
                }
                if (++$inscriptions > self::MAX_INSCRIPTIONS) {
                    throw new \RangeException('too many inscriptions');
                }
                $refs[] = ['type' => 'inscription', 'on' => $place[0] === 'on' ? $e['on'] : null];
            } elseif ($type === 'marks') {
                if (!self::hasExactKeys($e, self::KEYS_MARKS)) {
                    throw new \RangeException('marks keys');
                }
                $mc = $e['cells'];
                if (!is_array($mc) || !array_is_list($mc) || count($mc) < 1 || count($mc) > 256) {
                    throw new \RangeException('marks cells');
                }
                $seen = [];
                foreach ($mc as $c) {
                    $k = self::cellIndex($c, $w, $h); // R-DRESS-3
                    if (ord($grid[$k]) === self::WALL || isset($seen[$k])) {
                        throw new \RangeException('marks cell');
                    }
                    $seen[$k] = true;
                }
                $refs[] = ['type' => 'marks'];
            } elseif ($type === 'decor') {
                if (!self::hasExactKeys($e, self::KEYS_DECOR)) {
                    throw new \RangeException('decor keys');
                }
                if (!in_array($e['kind'], self::DECOR_KINDS, true)) {
                    throw new \RangeException('decor kind'); // R-DRESS-4
                }
                self::dressPos($e['pos'], $w, $h);
                if (!is_int($e['yaw']) || $e['yaw'] < 0 || $e['yaw'] > 4095) {
                    throw new \RangeException('decor yaw');
                }
                $refs[] = ['type' => 'decor'];
            } else {
                throw new \RangeException('unknown entity type');
            }
            $byId[$e['id']] = $refs[count($refs) - 1] + ['n' => count($refs), 'kind' => $type === 'item' ? $e['kind'] : null, 'hidden' => $type === 'item' && array_key_exists('hidden', $e)];
        }
        // R-DRESS-2: an inscription `on` names a chest.
        foreach ($refs as $r) {
            if ($r['type'] === 'inscription' && $r['on'] !== null && (($byId[$r['on']] ?? null)['type'] ?? null) !== 'chest') {
                throw new \RangeException('inscription on');
            }
        }
        // R-HOOK-1, R-MIRROR-1: hooks and mirrors on free cells.
        foreach (array_merge($hooks, $mirrors) as $x) {
            if (isset($doorAt[$x['k']]) || isset($slab[$x['k']])) {
                throw new \RangeException('hook or mirror cell taken');
            }
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
        // R-ITEM-1: no item on a door or slab cell (checked after the loop, whatever the order); `in` names a chest.
        foreach ($items as $n => $it) {
            if ($it['chestName'] === null) {
                if (isset($doorAt[$it['k']]) || isset($slab[$it['k']])) {
                    throw new \RangeException('item cell taken');
                }
                continue;
            }
            $r = $byId[$it['chestName']] ?? null;
            if ($r === null || $r['type'] !== 'chest') {
                throw new \RangeException('item in: not a chest');
            }
            $chests[$r['chest']]['contents'][] = $n;
        }
        // R-DOOR-1: a key door names a key item. R-ALCOVE-1: an alcove names a door. R-CHEST-1: chests on free cells.
        foreach ($doors as &$d) {
            if ($d['keyName'] !== null) {
                $r = is_string($d['keyName']) ? ($byId[$d['keyName']] ?? null) : null;
                if ($r === null || $r['type'] !== 'item' || $r['kind'] !== 'key') {
                    throw new \RangeException('door key');
                }
                $d['key'] = $r['n'];
            }
            unset($d['keyName']);
        }
        unset($d);
        foreach ($alcoves as &$a) {
            $r = is_string($a['doorName']) ? ($byId[$a['doorName']] ?? null) : null;
            if ($r === null || $r['type'] !== 'door') {
                throw new \RangeException('alcove door');
            }
            $a['door'] = $r['door'];
            unset($a['doorName']);
        }
        unset($a);
        // R-WARDEN-3: the group a boss calls is resolved after the loop, so it may be named before its foes appear.
        foreach ($bosses as &$bs) {
            if ($bs['summonsName'] !== null) {
                if (!array_key_exists($bs['summonsName'], $groupIds)) {
                    throw new \RangeException('boss summons group');
                }
                $bs['summons'] = $groupIds[$bs['summonsName']];
            }
            unset($bs['summonsName']);
        }
        unset($bs);
        foreach ($chests as $c) {
            if (isset($doorAt[$c['k']]) || isset($slab[$c['k']])) {
                throw new \RangeException('chest cell taken');
            }
        }
        foreach ($braziers as $b) {
            if (isset($doorAt[$b['k']]) || isset($slab[$b['k']])) {
                throw new \RangeException('brazier cell taken');
            }
        }
        // R-FOE-2: foes on free cells (walkers not on lethal ones), the caps and the threat budget.
        $threat = 0;
        $awake = 0;
        foreach ($foes as $f) {
            if (isset($doorAt[$f['k']]) || isset($slab[$f['k']])) {
                throw new \RangeException('foe cell taken');
            }
            $code = ord($grid[$f['k']]);
            $armed = isset($alcoveAt[$f['k']]);
            if (!$f['kind']['fly'] && ($code === self::PLATE || $code === self::HPIT || $code === self::VOID || $code === self::VENT || ($code === self::ALCOVE && $armed))) {
                throw new \RangeException('foe on a lethal cell');
            }
            $threat += $f['kind']['tier'] * $f['kind']['tier'];
            if ($f['start'] === 'idle' || $f['start'] === 'hunting') {
                $awake++;
            }
        }
        if (count($foes) > self::MAX_FOES || $awake > self::MAX_AWAKE || $threat > self::THREAT_BUDGET) {
            throw new \RangeException('foe limits');
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
            'bells' => $bells, 'bellSets' => $bellSets, 'byId' => $byId,
            'hooks' => $hooks, 'mirrors' => $mirrors, 'crystals' => $crystals,
            'chests' => $chests, 'alcoves' => $alcoves, 'alcoveAt' => $alcoveAt,
            'foes' => $foes, 'groups' => $groups, 'groupIds' => $groupIds,
            'braziers' => $braziers, 'boss' => $bosses[0] ?? null];
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

    /**
     * R-FOE-5: Sim::enterable() for every cell at once, with sets for sprung and sealed (the same answers, faster).
     *
     * @param array<string,mixed> $state
     * @return list<bool>
     */
    public function passable(array $state, bool $fly): array
    {
        $sprung = array_flip($state['sprung']);
        $sealed = array_flip($state['sealed']);
        $doors = $state['doors'];
        $out = [];
        $n = $this->w * $this->h;
        for ($k = 0; $k < $n; $k++) {
            $code = ord($this->grid[$k]);
            if ($code === self::WALL || isset($this->slab[$k]) || isset($sprung[$k])) {
                $out[] = false;
                continue;
            }
            $d = $this->doorAt[$k] ?? -1;
            if ($d >= 0 && 20 * $doors[$d]['t'] < 17 * self::DOOR_FULL) {
                $out[] = false;
                continue;
            }
            if ($fly) {
                $out[] = true;
                continue;
            }
            if ($code === self::PLATE) {
                $out[] = false; // a plate with a slab or sprung is solid (above), so this one is armed
            } elseif ($code === self::HPIT || $code === self::VOID || $code === self::VENT) {
                $out[] = false;
            } elseif ($code === self::ALCOVE) {
                $a = $this->alcoveAt[$k] ?? null;
                $out[] = $a === null || isset($sealed[$this->alcoves[$a]['door']]);
            } else {
                $out[] = true;
            }
        }
        return $out;
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

    /**
     * R-ALCOVE-*: the alcove on cell index k, or null.
     *
     * @return array{id:string,k:int,drown:bool,door:int}|null
     */
    public function alcoveAt(int $k): ?array
    {
        return isset($this->alcoveAt[$k]) ? $this->alcoves[$this->alcoveAt[$k]] : null;
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
