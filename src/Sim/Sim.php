<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * Tombwright sim core (PHP verifier side). Contract: docs/spec.md §6.3. Rules: docs/sim-rules.md.
 * Mirrors public/js/sim/sim.js line for line; never use floats in state.
 */
final class Sim
{
    public const CORE_VERSION = 'm0.8';
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
    /** R-HP-1: hp in 1/30-hp units; regeneration +4 a tick once calm > 150. */
    public const HP_UNIT = 30;
    public const HP_FULL = 3000;
    public const HP_REGEN = 4;
    public const CALM_MAX = 151;

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
                'hp' => self::HP_FULL, 'calm' => self::CALM_MAX, 'oil' => 100 * self::OIL_UNIT, 'hooded' => false, 'hung' => -1, // R-HP-1, R-HOOK-1
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
            'zone' => $world->startZone, // R-ZONE-3
            'sealed' => [],       // R-DOOR-5 (a lesson)
            'revealed' => [],     // R-LINK-8
            'mirrors' => array_map(static fn (array $m): int => $m['start'], $world->mirrors), // R-MIRROR-1
            'chests' => array_map(static fn (): array => ['look' => false, 'sprung' => false, 'open' => false], $world->chests), // R-CHEST-1
            'sealing' => [],      // R-ALCOVE-2
            'bellSets' => array_map(static fn (): array => ['seq' => [], 'solved' => false], $world->bellSets), // R-BELL-2
            'links' => Links::initState($world->links), // R-LINK-4
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
            'hp' => $p['hp'], 'oil' => $p['oil'], 'hooded' => $p['hooded'], 'hung' => $p['hung'], 'flasks' => $p['flasks'], 'pebbles' => $p['pebbles'],
            'revealed' => $state['revealed'], 'mirrors' => $state['mirrors'], 'chests' => $state['chests'],
            'doors' => array_map(static fn (array $d): bool => $d['open'], $state['doors']),
            'floor' => $state['floor'], 'taken' => $state['taken'],
            'bellSets' => $state['bellSets'], 'links' => $state['links'],
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
            self::landPebbles($world, $state, $events);
        } else {
            $batch = [];                                  // R-LINK-5: batch 0
            self::live($world, $state, $input, $pressed, $events, $batch);
            self::landPebbles($world, $state, $events);
            if ($state['dead'] === null) {
                self::links($world, $state, $batch, $events); // R-LINK-7
            }
            if ($state['dead'] === null) {
                // R-HP-1: regeneration once calm, then calm counts on (after the links, so a hurt tick doesn't heal).
                if ($state['player']['hp'] < self::HP_FULL && $state['player']['calm'] > 150) {
                    $state['player']['hp'] = min(self::HP_FULL, $state['player']['hp'] + self::HP_REGEN);
                }
                $state['player']['calm'] = min(self::CALM_MAX, $state['player']['calm'] + 1);
            }
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
            } elseif (!$d['open'] && $d['t'] > 0) {
                $d['t'] = max(0, $d['t'] - World::DOOR_CLOSE_STEP);
            }
        }
        unset($d);
    }

    /**
     * R-LINK-7, R-LINK-8: run the links with the sim's conditions and effects.
     *
     * @param array<string,mixed> $state
     * @param list<array{string,int}> $batch
     * @param list<array<string,mixed>> $events
     */
    private static function links(World $world, array &$state, array $batch, array &$events): void
    {
        if ($world->links === []) {
            return;
        }
        $host = new SimLinkHost($world, $state, $events);
        Links::run($world->links, $state['links'], $batch, $host);
    }

    /**
     * R-HP-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    public static function hurt(array &$state, int $n, array &$events): void
    {
        $state['player']['hp'] = max(0, $state['player']['hp'] - self::HP_UNIT * $n);
        $state['player']['calm'] = 0;
        $events[] = ['e' => 'hurt', 'hp' => intdiv($state['player']['hp'], self::HP_UNIT)];
        if ($state['player']['hp'] === 0) {
            self::die($state, 'damage', $events);
        }
    }

    /**
     * R-LINK-8: apply effects in order; true if the state changed.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $list
     * @param list<array<string,mixed>> $events
     */
    public static function applyEffects(World $world, array &$state, array $list, array &$events): bool
    {
        $changed = false;
        foreach ($list as $fx) {
            if ($fx['kind'] === 'message') {
                $events[] = ['e' => 'message', 'text' => $fx['text']];
                continue;
            }
            if ($fx['kind'] === 'reveal') {
                if (!in_array($fx['item'], $state['revealed'], true)) {
                    $state['revealed'][] = $fx['item'];
                    $changed = true;
                }
                continue;
            }
            if ($fx['kind'] === 'hide') {
                $at = array_search($fx['item'], $state['revealed'], true);
                if ($at !== false) {
                    array_splice($state['revealed'], $at, 1);
                    $changed = true;
                }
                continue;
            }
            if ($fx['kind'] === 'damage') {
                self::hurt($state, $fx['n'], $events);
                $changed = true;
                if ($state['dead'] !== null) {
                    return true;
                }
                continue;
            }
            $n = $fx['door'];
            $id = $world->doors[$n]['id'];
            $sealed = in_array($n, $state['sealed'], true);
            if ($fx['kind'] === 'openDoor') {
                if (!$sealed && !$state['doors'][$n]['open']) {
                    $state['doors'][$n]['open'] = true;
                    $changed = true;
                    $events[] = ['e' => 'door', 'id' => $id, 'open' => true];
                }
            } elseif ($fx['kind'] === 'closeDoor') {
                if ($state['doors'][$n]['open']) {
                    $state['doors'][$n]['open'] = false;
                    $changed = true;
                    $events[] = ['e' => 'door', 'id' => $id, 'open' => false];
                }
            } elseif (!$sealed) {
                $state['sealed'][] = $n;
                $state['doors'][$n]['open'] = false;
                $changed = true;
                $events[] = ['e' => 'door', 'id' => $id, 'open' => false, 'sealed' => true];
            }
        }
        return $changed;
    }

    /**
     * R-LINK-6: a condition trigger's value.
     *
     * @param array<string,mixed> $state
     */
    public static function linkCond(World $world, array $state, string $kind, int|bool $arg): bool
    {
        $p = $state['player'];
        switch ($kind) {
            case 'doorOpen':
                return $state['doors'][$arg]['open'];
            case 'inZone':
                return $world->zoneAt(IntMath::fdiv($p['z'], self::CELL_MM) * $world->w + IntMath::fdiv($p['x'], self::CELL_MM)) === $arg;
            case 'hasItem':
                return in_array($arg, $state['taken'], true);
            case 'lanternHooded':
                return $p['hooded'] === $arg;
            case 'bellsSolved':
                return $state['bellSets'][$arg]['solved'];
            case 'beamHits':
                return self::beamHits($world, $state, $arg);
            case 'linkActive':
                foreach ($world->links as $n => $l) {
                    if ($l['id'] === $arg) {
                        return $state['links'][$n]['active'];
                    }
                }
        }
        throw new \LogicException('cond');
    }

    /**
     * One tick of a living player.
     *
     * @param array<string,mixed> $state
     * @param array<string,mixed> $input
     * @param list<array<string,mixed>> $events
     */
    private static function live(World $world, array &$state, array $input, int $pressed, array &$events, array &$batch): void
    {
        $p = &$state['player'];
        $p['yaw'] = $input['yaw'];
        $p['pitch'] = $input['pitch'];
        unset($p);
        // R-ALCOVE-2: sprung alcoves' doors close after their delay.
        if ($state['sealing'] !== []) {
            $keep = [];
            foreach ($state['sealing'] as $sl) {
                $sl['left'] -= 1;
                if ($sl['left'] > 0) {
                    $keep[] = $sl;
                    continue;
                }
                if ($state['doors'][$sl['door']]['open']) {
                    $state['doors'][$sl['door']]['open'] = false;
                    $events[] = ['e' => 'door', 'id' => $world->doors[$sl['door']]['id'], 'open' => false, 'sealed' => true];
                }
            }
            $state['sealing'] = $keep;
        }
        $p = &$state['player'];
        // R-TOOL-1: tool presses, in button order, from where the player stood before moving.
        if ($pressed & self::BTN_HOOD) {
            if ($p['hung'] >= 0) { // R-HOOK-2
                $events[] = ['e' => 'msg', 'k' => 'lanternHung'];
            } elseif ($p['oil'] > 0) { // R-OIL-2
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
            self::interact($world, $state, $input['target'], $events, $batch); // R-ACT-1
        }
        if ($state['dead'] !== null) {
            self::moveDoors($state); // R-CHEST-2: the needles (doors still move, R-DEATH-2)
            return;
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
        if ($p['hung'] >= 0) { // R-HOOK-3: the lantern holds you to its zone
            $hz = $world->zoneAt($world->hooks[$p['hung']]['k']);
            if ($world->zoneAt(IntMath::fdiv($p['z'], self::CELL_MM) * $world->w + IntMath::fdiv($p['x'], self::CELL_MM)) !== $hz) {
                $p['x'] = $ox;
                $p['z'] = $oz;
                $p['vx'] = 0;
                $p['vz'] = 0;
                $p['rx'] = 0;
                $p['rz'] = 0;
                $events[] = ['e' => 'msg', 'k' => 'lanternHung'];
            }
        }
        unset($p);
        self::moveDoors($state);
        self::checkpoint($world, $state, $events);
        $zNow = $world->zoneAt(IntMath::fdiv($state['player']['z'], self::CELL_MM) * $world->w + IntMath::fdiv($state['player']['x'], self::CELL_MM)); // R-ZONE-3
        if ($zNow !== $state['zone']) {
            if ($state['zone'] >= 0) {
                $batch[] = ['leaveZone', $state['zone']];
            }
            if ($zNow >= 0) {
                $batch[] = ['enterZone', $zNow];
            }
            $state['zone'] = $zNow;
        }
        $cause = self::trap($world, $state, $events);
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
        if (self::probeChest($world, $state, $events)) {
            return;
        }
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
            $a = $world->alcoveAt($k);
            if ($a !== null && !$a['drown'] && !in_array($a['door'], $state['sealed'], true)) {
                self::springAlcove($state, $a, false, $events);
                $what = 'tip';
            } else {
                $what = 'alcove';
            }
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
            $al = $code === World::ALCOVE ? $world->alcoveAt($k) : null;
            if (self::slabOrSprung($world, $state, $i, $j)) {
                $what = 'slab';
            } elseif ($al !== null && !in_array($al['door'], $state['sealed'], true) && $state['doors'][$al['door']]['open']) {
                self::springAlcove($state, $al, false, $events);
                $what = 'alcove';
                $rests = false;
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
        $lit = $p['oil'] > 0 && !$p['hooded'] && $p['hung'] < 0;
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
    private static function takeItem(World $world, array &$state, int $n, array $it, array &$events, array &$batch): void
    {
        $p = $state['player'];
        if ($it['kind'] === 'rubble' ? $p['pebbles'] >= self::PEBBLE_MAX : in_array($n, $state['taken'], true)) {
            return;
        }
        if ($it['hidden'] && !in_array($n, $state['revealed'], true)) { // R-ITEM-1
            return;
        }
        if ($it['k'] < 0) { // in a chest: R-CHEST-2
            return;
        }
        $dx = $p['x'] - $it['x'];
        $dz = $p['z'] - $it['z'];
        if ($dx * $dx + $dz * $dz > $it['reach'] * $it['reach'] || !self::lineOfSight($world, $state, $it['x'], $it['z'])) {
            return;
        }
        $batch[] = ['interact', $n];
        if ($it['kind'] === 'rubble') {
            $state['player']['pebbles'] = self::PEBBLE_MAX;
        } else {
            $state['taken'][] = $n;
            if ($it['kind'] === 'flask') {
                $state['player']['flasks'] += 1;
            }
            $batch[] = ['itemTaken', $n];
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
    private static function trap(World $world, array &$state, array &$events): ?string
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
        if ($code === World::ALCOVE) {
            $a = $world->alcoveAt($k);
            if ($a !== null && !in_array($a['door'], $state['sealed'], true)) {
                self::springAlcove($state, $a, true, $events);
                return $a['drown'] ? 'drown' : 'tip';
            }
        }
        return null;
    }

    /**
     * R-ALCOVE-2: spring an armed alcove; inside = the player is in it.
     *
     * @param array<string,mixed> $state
     * @param array{id:string,k:int,drown:bool,door:int} $a
     * @param list<array<string,mixed>> $events
     */
    private static function springAlcove(array &$state, array $a, bool $inside, array &$events): void
    {
        if (!in_array($a['door'], $state['sealed'], true)) {
            $state['sealed'][] = $a['door'];
        }
        $state['sealing'][] = ['door' => $a['door'], 'left' => $inside ? 45 : ($a['drown'] ? 78 : 66)];
        $events[] = ['e' => 'alcove', 'id' => $a['id'], 'inside' => $inside];
    }

    /**
     * R-CHEST-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     * @param list<array{string,int}> $batch
     */
    private static function openChest(World $world, array &$state, int $n, int $ci, array &$events, array &$batch): void
    {
        $c = $world->chests[$ci];
        $dx = $state['player']['x'] - $c['x'];
        $dz = $state['player']['z'] - $c['z'];
        if ($state['chests'][$ci]['open'] || $dx * $dx + $dz * $dz > $c['reach'] * $c['reach'] || !self::lineOfSight($world, $state, $c['x'], $c['z'])) {
            return;
        }
        $batch[] = ['interact', $n];
        if ($c['needles'] && !$state['chests'][$ci]['look']) {
            $state['chests'][$ci]['look'] = true;
            $events[] = ['e' => 'chest', 'id' => $c['id'], 'look' => true];
            return;
        }
        if ($c['needles'] && !$state['chests'][$ci]['sprung']) {
            self::die($state, 'needles', $events);
            return;
        }
        $state['chests'][$ci]['open'] = true;
        foreach ($c['contents'] as $ii) {
            $it = $world->items[$ii];
            $state['taken'][] = $it['n'];
            if ($it['kind'] === 'flask') {
                $state['player']['flasks'] += 1;
            }
            $batch[] = ['itemTaken', $it['n']];
            $events[] = ['e' => 'item', 'id' => $it['id'], 'kind' => $it['kind']];
        }
        $events[] = ['e' => 'chest', 'id' => $c['id'], 'open' => true];
    }

    /**
     * R-CHEST-3: a trapped chest in front of the player takes the probe. Returns true if it did.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function probeChest(World $world, array &$state, array &$events): bool
    {
        $p = $state['player'];
        $sy = SineTable::sin($p['yaw']);
        $cy = SineTable::cos($p['yaw']);
        $z = $world->zoneAt(IntMath::fdiv($p['z'], self::CELL_MM) * $world->w + IntMath::fdiv($p['x'], self::CELL_MM));
        foreach ($world->chests as $ci => $c) {
            if (!$c['needles'] || $state['chests'][$ci]['open'] || $world->zoneAt($c['k']) !== $z) {
                continue;
            }
            $dx = $c['x'] - $p['x'];
            $dz = $c['z'] - $p['z'];
            $d = IntMath::isqrt($dx * $dx + $dz * $dz);
            // In front: 2·(d · forward) > d·2^14, forward = (-sin, -cos)·2^14.
            if ($d === 0 || $d >= 2600 || 2 * ($dx * -$sy + $dz * -$cy) <= $d * SineTable::TRIG_ONE) {
                continue;
            }
            if (!$state['chests'][$ci]['sprung']) {
                $state['chests'][$ci]['sprung'] = true;
                $events[] = ['e' => 'probe', 'k' => 'needles'];
            } else {
                $events[] = ['e' => 'probe', 'k' => 'needlesSpent'];
            }
            return true;
        }
        return false;
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
            $d['open'] = $life['doors'][$k] && !in_array($k, $state['sealed'], true);
            $d['t'] = $d['open'] ? World::DOOR_FULL : 0;
        }
        unset($d);
        $state['bellSets'] = $life['bellSets'];
        $state['revealed'] = $life['revealed'];
        $state['mirrors'] = $life['mirrors'];
        $state['chests'] = $life['chests'];
        $state['sealing'] = [];
        $state['links'] = $life['links'];
        $p = &$state['player'];
        $p['hp'] = self::HP_FULL;
        $p['calm'] = self::CALM_MAX;
        $p['oil'] = max($life['oil'], self::RISE_OIL);
        $p['hooded'] = $life['hooded'];
        $p['hung'] = $life['hung'];
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
        $state['zone'] = $world->zoneAt(IntMath::fdiv($c['z'], self::CELL_MM) * $world->w + IntMath::fdiv($c['x'], self::CELL_MM));
        $state['dead'] = null;
        $events[] = ['e' => 'rise', 'zone' => $c['zone'] >= 0 ? $world->zones[$c['zone']]['id'] : null];
    }

    /**
     * R-ACT-1: open an interact door within reach. Anything else does nothing.
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     */
    private static function interact(World $world, array &$state, int $n, array &$events, array &$batch): void
    {
        $ref = $world->entityRef($n);
        if ($ref !== null && $ref['type'] === 'item') {
            self::takeItem($world, $state, $n, $world->items[$ref['item']], $events, $batch);
            return;
        }
        if ($ref !== null && $ref['type'] === 'bell') {
            self::ringBell($world, $state, $n, $world->bells[$ref['bell']], $events, $batch);
            return;
        }
        if ($ref !== null && $ref['type'] === 'lampHook') {
            self::useHook($world, $state, $n, $ref['hook'], $events, $batch);
            return;
        }
        if ($ref !== null && $ref['type'] === 'mirror') {
            self::turnMirror($world, $state, $n, $ref['mirror'], $events, $batch);
            return;
        }
        if ($ref !== null && $ref['type'] === 'chest') {
            self::openChest($world, $state, $n, $ref['chest'], $events, $batch);
            return;
        }
        if ($ref === null || $ref['type'] !== 'door') {
            return;
        }
        $def = $world->doors[$ref['door']];
        if ($state['doors'][$ref['door']]['open']) {
            return;
        }
        // |dx|, |dz| <= 64*2400, so the squares stay below 2^36.
        $dx = $state['player']['x'] - $def['cx'];
        $dz = $state['player']['z'] - $def['cz'];
        if ($dx * $dx + $dz * $dz > self::REACH_MM * self::REACH_MM) {
            return;
        }
        $batch[] = ['interact', $n];
        if (in_array($ref['door'], $state['sealed'], true)) {
            return;
        }
        if (!$def['interact'] && !($def['key'] > 0 && in_array($def['key'], $state['taken'], true))) { // R-DOOR-1: interact or key
            return;
        }
        $state['doors'][$ref['door']]['open'] = true;
        $events[] = ['e' => 'door', 'id' => $def['id'], 'open' => true];
    }

    /**
     * R-HOOK-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     * @param list<array{string,int}> $batch
     */
    private static function useHook(World $world, array &$state, int $n, int $h, array &$events, array &$batch): void
    {
        $hook = $world->hooks[$h];
        $dx = $state['player']['x'] - $hook['x'];
        $dz = $state['player']['z'] - $hook['z'];
        if ($dx * $dx + $dz * $dz > $hook['reach'] * $hook['reach'] || !self::lineOfSight($world, $state, $hook['x'], $hook['z'])) {
            return;
        }
        $batch[] = ['interact', $n];
        $p = &$state['player'];
        if ($p['hung'] === $h) {
            $p['hung'] = -1;
        } elseif ($p['hung'] >= 0) {
            unset($p);
            return;
        } elseif ($p['oil'] > 0) {
            $p['hung'] = $h;
            $p['hooded'] = false;
        } else {
            unset($p);
            $events[] = ['e' => 'msg', 'k' => 'lanternOut'];
            return;
        }
        $events[] = ['e' => 'hook', 'id' => $hook['id'], 'hung' => $p['hung'] === $h];
        unset($p);
    }

    /**
     * R-MIRROR-2
     *
     * @param array<string,mixed> $state
     * @param list<array<string,mixed>> $events
     * @param list<array{string,int}> $batch
     */
    private static function turnMirror(World $world, array &$state, int $n, int $mi, array &$events, array &$batch): void
    {
        $m = $world->mirrors[$mi];
        $dx = $state['player']['x'] - $m['x'];
        $dz = $state['player']['z'] - $m['z'];
        if ($dx * $dx + $dz * $dz > $m['reach'] * $m['reach'] || !self::lineOfSight($world, $state, $m['x'], $m['z'])) {
            return;
        }
        $batch[] = ['interact', $n];
        $state['mirrors'][$mi] = 1 - $state['mirrors'][$mi];
        $events[] = ['e' => 'mirror', 'id' => $m['id'], 'turn' => $state['mirrors'][$mi]];
    }

    /**
     * R-BEAM-1, R-BEAM-2: does the hung lantern's beam end on crystal c?
     *
     * @param array<string,mixed> $state
     */
    private static function beamHits(World $world, array $state, int $c): bool
    {
        $h = $state['player']['hung'];
        if ($h < 0) {
            return false;
        }
        $hook = $world->hooks[$h];
        $cr = $world->crystals[$c];
        $i = $hook['i'];
        $j = $hook['j'];
        $di = $hook['di'];
        $dj = $hook['dj'];
        for ($n = 0; $n < 80; $n++) {
            if ($world->solidCell($state, $i + $di, $j + $dj)) {
                return $j * $world->w + $i === $cr['k'] && $di === $cr['di'] && $dj === $cr['dj'];
            }
            $i += $di;
            $j += $dj;
            $k = $j * $world->w + $i;
            foreach ($world->mirrors as $m => $mir) {
                if ($mir['k'] === $k) {
                    [$di, $dj] = $state['mirrors'][$m] === 0 ? [-$dj, -$di] : [$dj, $di];
                    break;
                }
            }
        }
        return false;
    }

    /**
     * R-BELL-3
     *
     * @param array<string,mixed> $state
     * @param array{id:string,k:int,x:int,z:int,reach:int,set:int,index:int} $b
     * @param list<array<string,mixed>> $events
     * @param list<array{string,int}> $batch
     */
    private static function ringBell(World $world, array &$state, int $n, array $b, array &$events, array &$batch): void
    {
        $dx = $state['player']['x'] - $b['x'];
        $dz = $state['player']['z'] - $b['z'];
        if ($dx * $dx + $dz * $dz > $b['reach'] * $b['reach'] || !self::lineOfSight($world, $state, $b['x'], $b['z'])) {
            return;
        }
        $batch[] = ['interact', $n];
        $events[] = ['e' => 'bell', 'id' => $b['id']];
        $set = $world->bellSets[$b['set']];
        $st = &$state['bellSets'][$b['set']];
        if ($st['solved']) {
            return;
        }
        $st['seq'][] = $b['index'];
        $wrong = false;
        foreach ($st['seq'] as $k => $x) {
            if ($x !== $set['order'][$k]) {
                $wrong = true;
                break;
            }
        }
        if ($wrong) {
            $st['seq'] = [];
            $batch[] = ['bellsWrong', $b['set']];
            $events[] = ['e' => 'bellsWrong', 'id' => $set['id']];
        } elseif (count($st['seq']) === count($set['order'])) {
            $st['solved'] = true;
            $events[] = ['e' => 'bellsSolved', 'id' => $set['id']];
        }
        unset($st);
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
