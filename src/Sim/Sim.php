<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * Tombwright sim core (PHP verifier side). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
 * Mirrors public/js/sim/sim.js line for line; never use floats in state.
 */
final class Sim
{
    public const CORE_VERSION = 'm0.2';
    public const TICK_HZ = 30;
    public const CELL_MM = 2400;
    public const WALK_MM_S = 3200;
    public const RUN_MM_S = 5400;
    public const OIL_UNIT = 30000;
    public const OIL_BURN_OPEN = 80;
    public const OIL_BURN_HOODED = 25;
    public const PLAYER_R_MM = 360;

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
        return [
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
            'prevButtons' => 0,
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
        self::checkInput($input);
        $p = &$state['player'];
        $events = [];
        $pressed = $input['buttons'] & ~$state['prevButtons'];

        $p['yaw'] = $input['yaw'];
        $p['pitch'] = $input['pitch'];

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
        self::pushOut($world, $p, self::PLAYER_R_MM, $ox, $oz);

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

        $state['prevButtons'] = $input['buttons'];
        $state['tick'] += 1;
        return $events;
    }

    /**
     * R-MOVE-4: push a circle out of solid cells (mirrors pushOut in sim.js).
     * Bounds (R-INT-2): |dx|, |dz| <= 2400 + r, so dx*r and d2 stay below 2^23.
     *
     * @param array<string,mixed> $e
     */
    private static function pushOut(World $world, array &$e, int $r, int $ox, int $oz): void
    {
        for ($pass = 0; $pass < 3; $pass++) {
            $ci = IntMath::fdiv($e['x'], self::CELL_MM);
            $cj = IntMath::fdiv($e['z'], self::CELL_MM);
            for ($dj = -1; $dj <= 1; $dj++) {
                for ($di = -1; $di <= 1; $di++) {
                    $gi = $ci + $di;
                    $gj = $cj + $dj;
                    if (!$world->solidCell($gi, $gj)) {
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
        }
    }

    /** @param array<string,mixed> $state */
    public static function hash(array $state): string
    {
        return substr(hash('sha256', Canonical::encode($state)), 0, 32);
    }
}
