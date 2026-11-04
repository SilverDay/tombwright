<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * Tombwright sim core (PHP verifier side). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
 * Mirrors public/js/sim/sim.js line for line; never use floats in state.
 */
final class Sim
{
    public const CORE_VERSION = 'm0.4';
    public const TICK_HZ = 30;
    public const CELL_MM = 2400;
    public const WALK_MM_S = 3200;
    public const RUN_MM_S = 5400;
    public const OIL_UNIT = 30000;
    public const OIL_BURN_OPEN = 80;
    public const OIL_BURN_HOODED = 25;
    public const PLAYER_R_MM = 360;
    /** R-ACT-1: interact reach, mm (Gloamhollow ia r 2.6 m). */
    public const REACH_MM = 2600;
    /** R-TRAP-1: only the inner part of a cell is armed (Gloamhollow 0.12-0.88 of 2.4 m). */
    public const TRAP_LO = 288;
    public const TRAP_HI = 2112;
    /** R-RISE-1: rise is accepted from 51 ticks after the death; rising tops the lantern up to 50 points. */
    public const RISE_TICKS = 51;
    public const RISE_OIL = 50 * 30000;

    public const BTN_STRIKE = 1 << 0;
    public const BTN_HOOD = 1 << 1;
    public const BTN_PROBE = 1 << 2;
    public const BTN_PEBBLE = 1 << 3;
    public const BTN_OIL = 1 << 4;
    public const BTN_INTERACT = 1 << 5;
    public const BTN_RUN = 1 << 6;
    public const BTN_RISE = 1 << 7;

    private const MODES = ['delve', 'ironman', 'practice'];

    /** @param array<string,mixed> $input */
    public static function checkInput(array $input): void
    {
        $move = $input['move'] ?? null;
        if (!is_array($move) || !array_is_list($move) || count($move) !== 2) {
            throw new \RangeException('input.move');
        }
        foreach ($move as $v) {
            if (!is_int($v) || $v < -127 || $v > 127) {
                throw new \RangeException('input.move range');
            }
        }
        $chk = static function (string $k, int $lo, int $hi) use ($input): void {
            $v = $input[$k] ?? null;
            if (!is_int($v) || $v < $lo || $v > $hi) {
                throw new \RangeException("input.$k");
            }
        };
        $chk('yaw', 0, 4095);
        $chk('pitch', -127, 127);
        $chk('buttons', 0, 0xFFFF);
        $chk('target', 0, 0xFFFF);
    }

    private static function cellCentre(int $c): int
    {
        return $c * self::CELL_MM + intdiv(self::CELL_MM, 2);
    }

    /** Sim::load(bytes) -> world: the immutable map, built once from the GDF file (R-GDF-0, R-WORLD-*). */
    public static function load(string $bytes): World
    {
        return World::load($bytes);
    }

    /** @return array<string,mixed> */
    public static function init(World $world, int $seed, string $mode): array
    {
        if (!in_array($mode, self::MODES, true)) {
            throw new \InvalidArgumentException('bad mode');
        }
        $ci = $world->startI;
        $cj = $world->startJ;
        $st = [
            'v' => 1,
            'core' => self::CORE_VERSION,
            'world' => $world->id,
            'mode' => $mode,
            'tick' => 0,
            'rng' => Rng::seed($seed),
            'player' => [
                'x' => self::cellCentre($ci), 'z' => self::cellCentre($cj),
                'vx' => 0, 'vz' => 0, 'rx' => 0, 'rz' => 0,
                'yaw' => 0, 'pitch' => 0,
                'hp' => 100, 'oil' => 100 * self::OIL_UNIT, 'hooded' => false,
            ],
            'doors' => array_map(static fn (): array => ['open' => false, 't' => 0], $world->doors), // R-DOOR-2
            'deaths' => 0,
            'dead' => null,       // R-DEATH-1
            'sprung' => [],       // R-CP-3 lessons
            'pits' => [],
            'checkpoints' => [],  // R-CP-1
            'cp' => 0,
            'prevButtons' => 0,
        ];
        $st['checkpoints'][] = [
            'zone' => $world->startZone, 'x' => $st['player']['x'], 'z' => $st['player']['z'], 'yaw' => 0, 'life' => self::lifeOf($st),
        ];
        return $st;
    }

    /**
     * R-CP-3: what a death rolls back.
     *
     * @param array<string,mixed> $state
     * @return array<string,mixed>
     */
    private static function lifeOf(array $state): array
    {
        $p = $state['player'];
        return [
            'hp' => $p['hp'], 'oil' => $p['oil'], 'hooded' => $p['hooded'],
            'doors' => array_map(static fn (array $d): bool => $d['open'], $state['doors']),
        ];
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $input
     * @return list<array<string,mixed>>
     */
    public static function step(World $world, array &$state, array $input): array
    {
        if ($state['world'] !== $world->id) {
            throw new \InvalidArgumentException('state belongs to another world');
        }
        if (($state['core'] ?? null) !== self::CORE_VERSION) {
            throw new \InvalidArgumentException('state from another core version'); // R-WORLD-3
        }
        if ($state['dead'] !== null && $state['mode'] === 'ironman') {
            throw new \InvalidArgumentException('the run is over'); // R-DEATH-3
        }
        self::checkInput($input);
        $events = [];
        $pressed = $input['buttons'] & ~$state['prevButtons'];

        if ($state['dead'] !== null) {
            // R-DEATH-2: while dead only rising and the doors go on.
            if (($pressed & self::BTN_RISE) && $state['tick'] >= $state['dead']['at'] + self::RISE_TICKS) {
                self::rise($world, $state, $input['target'], $events);
            }
            self::moveDoors($state);
        } else {
            self::live($world, $state, $input, $pressed, $events);
        }

        $state['prevButtons'] = $input['buttons'];
        $state['tick'] += 1;
        return $events;
    }

    /**
     * R-DOOR-3: opening doors move on.
     *
     * @param array<string,mixed> $state
     */
    private static function moveDoors(array &$state): void
    {
        foreach ($state['doors'] as &$d) {
            if ($d['open'] && $d['t'] < World::DOOR_FULL) {
                $d['t'] = min(World::DOOR_FULL, $d['t'] + World::DOOR_STEP);
            }
        }
        unset($d);
    }

    /**
     * One tick of a living player.
     *
     * @param array<string,mixed> $state
     * @param array<string,mixed> $input
     * @param list<array<string,mixed>> $events
     */
    private static function live(World $world, array &$state, array $input, int $pressed, array &$events): void
    {
        $p = &$state['player'];
        $p['yaw'] = $input['yaw'];
        $p['pitch'] = $input['pitch'];
        unset($p);

        // R-ACT-1: interact with the target entity, from where the player stood before moving.
        if (($pressed & self::BTN_INTERACT) && $input['target'] !== 0) {
            self::interact($world, $state, $input['target'], $events);
        }
        $p = &$state['player'];

        [$fw, $st] = $input['move'];
        $m2 = $fw * $fw + $st * $st;
        if ($m2 > 127 * 127) {
            $len = IntMath::isqrt($m2);
            $fw = IntMath::idiv($fw * 127, $len);
            $st = IntMath::idiv($st * 127, $len);
        }
        $speed = ($input['buttons'] & self::BTN_RUN) ? self::RUN_MM_S : self::WALK_MM_S;
        $sy = SineTable::sin($p['yaw']);
        $cy = SineTable::cos($p['yaw']);
        $den = 127 * SineTable::TRIG_ONE;
        $tx = IntMath::idiv($speed * (-$sy * $fw + $cy * $st), $den);
        $tz = IntMath::idiv($speed * (-$cy * $fw - $sy * $st), $den);
        $p['vx'] += IntMath::idiv(($tx - $p['vx']) * 2, 5);
        $p['vz'] += IntMath::idiv(($tz - $p['vz']) * 2, 5);
        $ax = $p['vx'] + $p['rx'];
        $az = $p['vz'] + $p['rz'];
        $dx = IntMath::idiv($ax, self::TICK_HZ);
        $dz = IntMath::idiv($az, self::TICK_HZ);
        $p['rx'] = $ax - $dx * self::TICK_HZ;
        $p['rz'] = $az - $dz * self::TICK_HZ;
        $ox = $p['x'];
        $oz = $p['z'];
        $p['x'] += $dx;
        $p['z'] += $dz;
        self::pushOut($world, $state, $p, self::PLAYER_R_MM, $ox, $oz);
        unset($p);
        self::moveDoors($state);
        self::checkpoint($world, $state, $events);
        $cause = self::trap($world, $state);
        if ($cause !== null) {
            self::die($state, $cause, $events);
            return;
        }
        $p = &$state['player'];

        if ($pressed & self::BTN_HOOD) {
            if ($p['oil'] > 0) {
                $p['hooded'] = !$p['hooded'];
                $events[] = ['e' => 'hood', 'on' => $p['hooded']];
            } else {
                $events[] = ['e' => 'msg', 'k' => 'lanternOut'];
            }
        }
        if ($p['oil'] > 0) {
            $p['oil'] = max(0, $p['oil'] - ($p['hooded'] ? self::OIL_BURN_HOODED : self::OIL_BURN_OPEN));
            if ($p['oil'] === 0) {
                $p['hooded'] = false;
                $events[] = ['e' => 'msg', 'k' => 'lanternOut'];
            }
        }
        unset($p);
    }

    /**
     * R-CP-2: entering a zone whose checkpoint lies further on than the current one.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function checkpoint(World $world, array &$state, array &$events): void
    {
        $p = $state['player'];
        $z = $world->zoneAt(IntMath::fdiv($p['z'], self::CELL_MM) * $world->w + IntMath::fdiv($p['x'], self::CELL_MM));
        if ($z < 0) {
            return;
        }
        $cp = $world->zones[$z]['cp'];
        if ($cp === null || !$cp['enter'] || $z <= $state['checkpoints'][$state['cp']]['zone']) {
            return;
        }
        $entry = ['zone' => $z, 'x' => $cp['x'], 'z' => $cp['z'], 'yaw' => $cp['yaw'], 'life' => self::lifeOf($state)];
        $n = -1;
        foreach ($state['checkpoints'] as $k => $c) {
            if ($c['zone'] === $z) {
                $n = $k;
                break;
            }
        }
        if ($n < 0) {
            $n = count($state['checkpoints']);
            $state['checkpoints'][] = $entry;
        } else {
            $state['checkpoints'][$n] = $entry;
        }
        $state['cp'] = $n;
        $events[] = ['e' => 'checkpoint', 'zone' => $world->zones[$z]['id']];
    }

    /**
     * R-TRAP-1: the trap under the player, if armed: returns the cause of death or null. Records lessons.
     *
     * @param array<string,mixed> $state
     */
    private static function trap(World $world, array &$state): ?string
    {
        $p = $state['player'];
        $i = IntMath::fdiv($p['x'], self::CELL_MM);
        $j = IntMath::fdiv($p['z'], self::CELL_MM);
        $lx = $p['x'] - $i * self::CELL_MM;
        $lz = $p['z'] - $j * self::CELL_MM;
        if ($lx <= self::TRAP_LO || $lx >= self::TRAP_HI || $lz <= self::TRAP_LO || $lz >= self::TRAP_HI) {
            return null;
        }
        $k = $j * $world->w + $i;
        $code = $world->cellCode($i, $j);
        if ($code === World::PLATE) {
            if ($world->slabAt($k) || in_array($k, $state['sprung'], true)) {
                return null;
            }
            $state['sprung'][] = $k;
            return 'slab';
        }
        if ($code === World::HPIT) {
            if (!in_array($k, $state['pits'], true)) {
                $state['pits'][] = $k;
            }
            return 'pit';
        }
        if ($code === World::VOID) {
            return 'chasm';
        }
        if ($code === World::VENT && self::ventFiring($world->ventAt($k), $state['tick'])) {
            return 'vent';
        }
        return null;
    }

    /**
     * R-VENT-2: is the vent firing on the step that starts at tick n?
     *
     * @param array{period:int,phase:int,warn:int,fire:int} $v
     */
    public static function ventFiring(array $v, int $n): bool
    {
        $u = ($n + $v['phase']) % $v['period'];
        return $u >= $v['warn'] && $u < $v['warn'] + $v['fire'];
    }

    /**
     * R-DEATH-1
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function die(array &$state, string $cause, array &$events): void
    {
        $state['dead'] = ['cause' => $cause, 'at' => $state['tick']];
        $state['deaths'] += 1;
        $state['player']['vx'] = 0;
        $state['player']['vz'] = 0;
        $state['player']['rx'] = 0;
        $state['player']['rz'] = 0;
        $events[] = ['e' => 'death', 'cause' => $cause];
    }

    /**
     * R-RISE-1: rise at the current checkpoint, or (practice) at a chosen one reached this run.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function rise(World $world, array &$state, int $target, array &$events): void
    {
        $n = $state['cp'];
        if ($state['mode'] === 'practice' && $target !== 0) {
            $n = -1;
            foreach ($state['checkpoints'] as $k => $c) {
                if ($c['zone'] === $target - 1) {
                    $n = $k;
                    break;
                }
            }
            if ($n < 0) {
                return;
            }
        }
        $c = $state['checkpoints'][$n];
        $life = $c['life'];
        $state['cp'] = $n;
        foreach ($state['doors'] as $k => &$d) {
            $d['open'] = $life['doors'][$k];
            $d['t'] = $d['open'] ? World::DOOR_FULL : 0;
        }
        unset($d);
        $p = &$state['player'];
        $p['hp'] = 100;
        $p['oil'] = max($life['oil'], self::RISE_OIL);
        $p['hooded'] = $life['hooded'];
        $p['x'] = $c['x'];
        $p['z'] = $c['z'];
        $p['yaw'] = $c['yaw'];
        $p['pitch'] = 0;
        $p['vx'] = 0;
        $p['vz'] = 0;
        $p['rx'] = 0;
        $p['rz'] = 0;
        unset($p);
        $state['dead'] = null;
        $events[] = ['e' => 'rise', 'zone' => $c['zone'] >= 0 ? $world->zones[$c['zone']]['id'] : null];
    }

    /**
     * R-ACT-1: open an interact door within reach. Anything else does nothing.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function interact(World $world, array &$state, int $n, array &$events): void
    {
        $ref = $world->entityRef($n);
        if ($ref === null || $ref['type'] !== 'door') {
            return;
        }
        $def = $world->doors[$ref['door']];
        $d = &$state['doors'][$ref['door']];
        if (!$def['interact'] || $d['open']) {
            return;
        }
        // |dx|, |dz| <= 64*2400, so the squares stay below 2^36.
        $dx = $state['player']['x'] - $def['cx'];
        $dz = $state['player']['z'] - $def['cz'];
        if ($dx * $dx + $dz * $dz > self::REACH_MM * self::REACH_MM) {
            return;
        }
        $d['open'] = true;
        $events[] = ['e' => 'door', 'id' => $def['id'], 'open' => true];
    }

    /**
     * R-MOVE-4: push a circle out of solid cells, then out of props (mirrors pushOut in sim.js).
     * Bounds (R-INT-2): cells: |dx|, |dz| <= 2400 + r, so dx*r and d2 stay below 2^23. Props: |dx|, |dz|
     * <= 64*2400, so d2 < 2^36; a push needs d2 < R^2 <= 910^2, so dx*R < 2^20.
     *
     * @param array<string,mixed> $state read only (doors, sprung)
     * @param array<string,mixed> $e
     */
    private static function pushOut(World $world, array $state, array &$e, int $r, int $ox, int $oz): void
    {
        for ($pass = 0; $pass < 3; $pass++) {
            $ci = IntMath::fdiv($e['x'], self::CELL_MM);
            $cj = IntMath::fdiv($e['z'], self::CELL_MM);
            for ($dj = -1; $dj <= 1; $dj++) {
                for ($di = -1; $di <= 1; $di++) {
                    $gi = $ci + $di;
                    $gj = $cj + $dj;
                    if (!$world->solidCell($state, $gi, $gj)) {
                        continue;
                    }
                    $minx = $gi * self::CELL_MM;
                    $minz = $gj * self::CELL_MM;
                    $qx = IntMath::clamp($e['x'], $minx, $minx + self::CELL_MM);
                    $qz = IntMath::clamp($e['z'], $minz, $minz + self::CELL_MM);
                    $dx = $e['x'] - $qx;
                    $dz = $e['z'] - $qz;
                    $d2 = $dx * $dx + $dz * $dz;
                    if ($d2 === 0) {
                        $e['x'] = $ox;
                        $e['z'] = $oz;
                    } elseif ($d2 < $r * $r) {
                        $d = IntMath::isqrt($d2);
                        $e['x'] = $qx + IntMath::idiv($dx * $r, $d);
                        $e['z'] = $qz + IntMath::idiv($dz * $r, $d);
                    }
                }
            }
            foreach ($world->props as $o) {
                if ($o['circle']) {
                    $dx = $e['x'] - $o['x'];
                    $dz = $e['z'] - $o['z'];
                    $d2 = $dx * $dx + $dz * $dz;
                    $rr = $r + $o['r'];
                    if ($d2 > 0 && $d2 < $rr * $rr) {
                        $d = IntMath::isqrt($d2);
                        $e['x'] = $o['x'] + IntMath::idiv($dx * $rr, $d);
                        $e['z'] = $o['z'] + IntMath::idiv($dz * $rr, $d);
                    }
                } else {
                    $qx = IntMath::clamp($e['x'], $o['x0'], $o['x1']);
                    $qz = IntMath::clamp($e['z'], $o['z0'], $o['z1']);
                    $dx = $e['x'] - $qx;
                    $dz = $e['z'] - $qz;
                    $d2 = $dx * $dx + $dz * $dz;
                    if ($d2 > 0 && $d2 < $r * $r) {
                        $d = IntMath::isqrt($d2);
                        $e['x'] = $qx + IntMath::idiv($dx * $r, $d);
                        $e['z'] = $qz + IntMath::idiv($dz * $r, $d);
                    }
                }
            }
        }
    }

    /** @param array<string,mixed> $state */
    public static function hash(array $state): string
    {
        return substr(hash('sha256', Canonical::encode($state)), 0, 32);
    }
}
