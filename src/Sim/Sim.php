<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * Tombwright sim core (PHP verifier side). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
 * Mirrors public/js/sim/sim.js line for line; never use floats in state.
 */
final class Sim
{
    public const CORE_VERSION = 'm0.5';
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
    /** R-TOOL-2 cooldowns (ticks), R-PEB-1 pouch, R-PEB-4 pick-up radius. */
    public const PROBE_CD = 21;
    public const PEBBLE_CD = 15;
    public const PEBBLE_MAX = 12;
    public const PICKUP_MM = 750;

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
                'flasks' => 1, 'pebbles' => 10, 'probeCd' => 0, 'pebbleCd' => 0, // R-OIL-3, R-PEB-1, R-TOOL-2
            ],
            'doors' => array_map(static fn (): array => ['open' => false, 't' => 0], $world->doors), // R-DOOR-2
            'deaths' => 0,
            'dead' => null,       // R-DEATH-1
            'sprung' => [],       // R-CP-3 lessons
            'pits' => [],
            'marked' => [],
            'bridge' => [],
            'floor' => [],        // R-PEB-3
            'flying' => [],       // R-PEB-2
            'taken' => [],        // R-ITEM-2
            'eyes' => array_map(static fn (): int => 0, $world->eyes), // R-EYES-1
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
            'hp' => $p['hp'], 'oil' => $p['oil'], 'hooded' => $p['hooded'], 'flasks' => $p['flasks'], 'pebbles' => $p['pebbles'],
            'doors' => array_map(static fn (array $d): bool => $d['open'], $state['doors']),
            'floor' => $state['floor'], 'taken' => $state['taken'],
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
        self::landPebbles($world, $state, $events);

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
        // R-TOOL-1: tool presses, in button order, from where the player stood before moving.
        if ($pressed & self::BTN_HOOD) {
            if ($p['oil'] > 0) { // R-OIL-2
                $p['hooded'] = !$p['hooded'];
                $events[] = ['e' => 'hood', 'on' => $p['hooded']];
            } else {
                $events[] = ['e' => 'msg', 'k' => 'lanternOut'];
            }
        }
        unset($p);
        if ($pressed & self::BTN_PROBE) {
            self::probe($world, $state, $events);
        }
        if ($pressed & self::BTN_PEBBLE) {
            self::throwPebble($world, $state, $events);
        }
        if ($pressed & self::BTN_OIL) {
            self::pourOil($state['player'], $events);
        }
        if (($pressed & self::BTN_INTERACT) && $input['target'] !== 0) {
            self::interact($world, $state, $input['target'], $events); // R-ACT-1
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
        if (self::wakeEyes($world, $state, $events)) {
            self::die($state, 'eyes', $events);
            return;
        }
        self::pickPebbles($state);
        $p = &$state['player'];
        // R-OIL-1/2: the lantern burns; at 0 it goes out and un-hoods.
        if ($p['oil'] > 0) {
            $p['oil'] = max(0, $p['oil'] - ($p['hooded'] ? self::OIL_BURN_HOODED : self::OIL_BURN_OPEN));
            if ($p['oil'] === 0) {
                $p['hooded'] = false;
                $events[] = ['e' => 'msg', 'k' => 'lanternOut'];
            }
        }
        // R-TOOL-2: cooldowns.
        if ($p['probeCd'] > 0) {
            $p['probeCd'] -= 1;
        }
        if ($p['pebbleCd'] > 0) {
            $p['pebbleCd'] -= 1;
        }
        unset($p);
    }

    /**
     * R-TOOL-1: the point at distance d (mm) ahead of the player, for yaw sine/cosine sy, cy.
     *
     * @param array<string,mixed> $p
     * @return array{int,int}
     */
    private static function ahead(array $p, int $sy, int $cy, int $d): array
    {
        // |sy·d| <= 2^14 · 8600 < 2^28 (R-INT-2)
        return [$p['x'] + IntMath::idiv(-$sy * $d, SineTable::TRIG_ONE), $p['z'] + IntMath::idiv(-$cy * $d, SineTable::TRIG_ONE)];
    }

    /**
     * A slab from the GDF or a plate sprung during play, at (i, j); false outside the grid.
     *
     * @param array<string,mixed> $state
     */
    private static function slabOrSprung(World $world, array $state, int $i, int $j): bool
    {
        if ($i < 0 || $j < 0 || $i >= $world->w || $j >= $world->h) {
            return false;
        }
        $k = $j * $world->w + $i;
        return $world->slabAt($k) || in_array($k, $state['sprung'], true);
    }

    /**
     * R-PROBE-1, R-PROBE-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function probe(World $world, array &$state, array &$events): void
    {
        $p = $state['player'];
        if ($p['probeCd'] > 0) {
            return;
        }
        $state['player']['probeCd'] = self::PROBE_CD;
        $sy = SineTable::sin($p['yaw']);
        $cy = SineTable::cos($p['yaw']);
        $pi = IntMath::fdiv($p['x'], self::CELL_MM);
        $pj = IntMath::fdiv($p['z'], self::CELL_MM);
        $r = 2050;
        [$tx, $tz] = self::ahead($p, $sy, $cy, $r);
        if (IntMath::fdiv($tx, self::CELL_MM) === $pi && IntMath::fdiv($tz, self::CELL_MM) === $pj) {
            $r = 2600;
            [$tx, $tz] = self::ahead($p, $sy, $cy, $r);
        }
        for ($s = 1; $s <= 8; $s++) {
            [$qx, $qz] = self::ahead($p, $sy, $cy, IntMath::idiv($r * $s, 8)); // r·s <= 2600·8
            $a = IntMath::fdiv($qx, self::CELL_MM);
            $b = IntMath::fdiv($qz, self::CELL_MM);
            if ($world->solidCell($state, $a, $b) && !self::slabOrSprung($world, $state, $a, $b)) {
                $events[] = ['e' => 'probe', 'k' => 'wall'];
                return;
            }
        }
        $i = IntMath::fdiv($tx, self::CELL_MM);
        $j = IntMath::fdiv($tz, self::CELL_MM);
        $k = $j * $world->w + $i;
        $code = $world->cellCode($i, $j);
        $what = 'stone';
        if ($code === World::PLATE) {
            if (self::slabOrSprung($world, $state, $i, $j)) {
                $what = 'slab';
            } elseif (in_array($k, $state['marked'], true)) {
                $what = 'plateKnown';
            } else {
                $state['marked'][] = $k;
                $what = 'plate';
            }
        } elseif ($code === World::HPIT) {
            if (in_array($k, $state['pits'], true)) {
                $what = 'pitKnown';
            } else {
                $state['pits'][] = $k;
                $what = 'pit';
            }
        } elseif ($code === World::VOID) {
            $what = 'void';
        } elseif ($code === World::BRIDGE) {
            if (!in_array($k, $state['bridge'], true)) {
                $state['bridge'][] = $k;
            }
            $what = 'bridge';
        } elseif ($code === World::VENT) {
            $what = 'vent';
        } elseif ($code === World::ALCOVE) {
            $what = 'alcove';
        }
        $events[] = ['e' => 'probe', 'k' => $what];
    }

    /**
     * R-PEB-1, R-PEB-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function throwPebble(World $world, array &$state, array &$events): void
    {
        $p = $state['player'];
        if ($p['pebbleCd'] > 0) {
            return;
        }
        if ($p['pebbles'] <= 0) {
            $events[] = ['e' => 'msg', 'k' => 'pouchEmpty'];
            return;
        }
        $state['player']['pebbles'] -= 1;
        $state['player']['pebbleCd'] = self::PEBBLE_CD;
        $want = IntMath::clamp(6200 + IntMath::idiv(6000 * $p['pitch'], 127), 1600, 8500);
        $sy = SineTable::sin($p['yaw']);
        $cy = SineTable::cos($p['yaw']);
        $d = 400;
        $lx = $p['x'];
        $lz = $p['z'];
        while ($d < $want) {
            [$nx, $nz] = self::ahead($p, $sy, $cy, $d);
            $i = IntMath::fdiv($nx, self::CELL_MM);
            $j = IntMath::fdiv($nz, self::CELL_MM);
            if (self::slabOrSprung($world, $state, $i, $j)) {
                $lx = $nx;
                $lz = $nz;
                break;
            }
            if ($world->solidCell($state, $i, $j)) {
                break;
            }
            $lx = $nx;
            $lz = $nz;
            $d += 120;
        }
        $flight = IntMath::idiv(21000 + 3 * $d + 1999, 2000);
        $state['flying'][] = ['x' => $lx, 'z' => $lz, 'at' => $state['tick'] + $flight - 1];
        $events[] = ['e' => 'throw'];
    }

    /**
     * R-PEB-3: pebbles due this tick land, in list order.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function landPebbles(World $world, array &$state, array &$events): void
    {
        if ($state['flying'] === []) {
            return;
        }
        $keep = [];
        foreach ($state['flying'] as $f) {
            if ($f['at'] !== $state['tick']) {
                $keep[] = $f;
                continue;
            }
            $i = IntMath::fdiv($f['x'], self::CELL_MM);
            $j = IntMath::fdiv($f['z'], self::CELL_MM);
            $k = $j * $world->w + $i;
            $code = $world->cellCode($i, $j);
            $what = 'floor';
            $rests = true;
            if (self::slabOrSprung($world, $state, $i, $j)) {
                $what = 'slab';
            } elseif ($code === World::PLATE) {
                $state['sprung'][] = $k;
                $what = 'plate';
                $rests = false;
            } elseif ($code === World::HPIT) {
                if (!in_array($k, $state['pits'], true)) {
                    $state['pits'][] = $k;
                }
                $what = 'pit';
                $rests = false;
            } elseif ($code === World::VOID) {
                $what = 'void';
                $rests = false;
            } elseif ($code === World::BRIDGE) {
                if (!in_array($k, $state['bridge'], true)) {
                    $state['bridge'][] = $k;
                }
                $what = 'bridge';
            }
            if ($rests) {
                $state['floor'][] = ['x' => $f['x'], 'z' => $f['z']];
            }
            $events[] = ['e' => 'land', 'k' => $what];
        }
        $state['flying'] = $keep;
    }

    /**
     * R-PEB-4
     *
     * @param array<string,mixed> $state
     */
    private static function pickPebbles(array &$state): void
    {
        for ($n = count($state['floor']) - 1; $n >= 0; $n--) {
            $f = $state['floor'][$n];
            $dx = $f['x'] - $state['player']['x'];
            $dz = $f['z'] - $state['player']['z'];
            if ($state['player']['pebbles'] >= self::PEBBLE_MAX || $dx * $dx + $dz * $dz > self::PICKUP_MM * self::PICKUP_MM) {
                continue;
            }
            array_splice($state['floor'], $n, 1);
            $state['player']['pebbles'] += 1;
        }
    }

    /**
     * R-OIL-3
     *
     * @param array<string,mixed> $p
     * @param list<array<string,mixed>> $events
     */
    private static function pourOil(array &$p, array &$events): void
    {
        if ($p['flasks'] <= 0) {
            $events[] = ['e' => 'msg', 'k' => 'noFlasks'];
            return;
        }
        if ($p['oil'] >= 96 * self::OIL_UNIT) {
            $events[] = ['e' => 'msg', 'k' => 'lanternFull'];
            return;
        }
        $relit = $p['oil'] === 0;
        $p['flasks'] -= 1;
        $p['oil'] = min(100 * self::OIL_UNIT, $p['oil'] + 60 * self::OIL_UNIT);
        $events[] = ['e' => 'oil', 'relit' => $relit];
    }

    /**
     * R-EYES-2: returns true if any eyes meter reached its wake time.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function wakeEyes(World $world, array &$state, array &$events): bool
    {
        if ($world->eyes === []) {
            return false;
        }
        $p = $state['player'];
        $z = $world->zoneAt(IntMath::fdiv($p['z'], self::CELL_MM) * $world->w + IntMath::fdiv($p['x'], self::CELL_MM));
        $lit = $p['oil'] > 0 && !$p['hooded'];
        foreach ($world->eyes as $n => $ey) {
            if ($z === $ey['zone'] && $lit) {
                if ($state['eyes'][$n] === 0) {
                    $events[] = ['e' => 'eyes', 'id' => $ey['id']];
                }
                $state['eyes'][$n] += 5;
            } else {
                $state['eyes'][$n] = max(0, $state['eyes'][$n] - 7);
            }
        }
        foreach ($world->eyes as $n => $ey) {
            if ($state['eyes'][$n] >= 5 * $ey['wake']) {
                return true;
            }
        }
        return false;
    }

    /**
     * R-LOS-1
     *
     * @param array<string,mixed> $state
     */
    private static function lineOfSight(World $world, array $state, int $ix, int $iz): bool
    {
        // R-INT-2: every coordinate lies in the 64·2400 mm grid, so |ex|, |vx| < 2^18: squares < 2^36; |v·s| < 2^18 · n.
        $px = $state['player']['x'];
        $pz = $state['player']['z'];
        $ex = $ix - $px;
        $ez = $iz - $pz;
        $e = IntMath::isqrt($ex * $ex + $ez * $ez);
        $ax = $e > 0 ? $ix - IntMath::idiv($ex * 300, $e) : $ix;
        $az = $e > 0 ? $iz - IntMath::idiv($ez * 300, $e) : $iz;
        $vx = $ax - $px;
        $vz = $az - $pz;
        $n = IntMath::idiv(IntMath::isqrt($vx * $vx + $vz * $vz) + 599, 600);
        for ($s = 1; $s < $n; $s++) {
            $i = IntMath::fdiv($px + IntMath::idiv($vx * $s, $n), self::CELL_MM);
            $j = IntMath::fdiv($pz + IntMath::idiv($vz * $s, $n), self::CELL_MM);
            if ($world->sightBlocked($state, $i, $j)) {
                return false;
            }
        }
        return true;
    }

    /**
     * R-ITEM-2
     *
     * @param array<string,mixed> $state
     * @param array{id:string,kind:string,k:int,x:int,z:int,reach:int} $it
     * @param list<array<string,mixed>> $events
     */
    private static function takeItem(World $world, array &$state, int $n, array $it, array &$events): void
    {
        $p = $state['player'];
        if ($it['kind'] === 'rubble' ? $p['pebbles'] >= self::PEBBLE_MAX : in_array($n, $state['taken'], true)) {
            return;
        }
        $dx = $p['x'] - $it['x'];
        $dz = $p['z'] - $it['z'];
        if ($dx * $dx + $dz * $dz > $it['reach'] * $it['reach'] || !self::lineOfSight($world, $state, $it['x'], $it['z'])) {
            return;
        }
        if ($it['kind'] === 'rubble') {
            $state['player']['pebbles'] = self::PEBBLE_MAX;
        } else {
            $state['taken'][] = $n;
            if ($it['kind'] === 'flask') {
                $state['player']['flasks'] += 1;
            }
        }
        $events[] = ['e' => 'item', 'id' => $it['id'], 'kind' => $it['kind']];
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
        $p['flasks'] = $life['flasks'];
        $p['pebbles'] = $life['pebbles'];
        $p['x'] = $c['x'];
        $p['z'] = $c['z'];
        $p['yaw'] = $c['yaw'];
        $p['pitch'] = 0;
        $p['vx'] = 0;
        $p['vz'] = 0;
        $p['rx'] = 0;
        $p['rz'] = 0;
        unset($p);
        $state['floor'] = $life['floor'];
        $state['taken'] = $life['taken'];
        $state['flying'] = [];
        $state['eyes'] = array_map(static fn (): int => 0, $state['eyes']);
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
        if ($ref !== null && $ref['type'] === 'item') {
            self::takeItem($world, $state, $n, $world->items[$ref['item']], $events);
            return;
        }
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
