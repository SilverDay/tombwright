<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/**
 * The link engine: triggers, gates and effects (spec §4.3; rules R-LINK-*). Mirrors public/js/sim/links.js
 * check for check and step for step.
 */
final class Links
{
    public const MAX_LINKS = 64;
    public const MAX_PASSES = 8;
    private const MAX_EFFECTS = 16;
    private const MAX_TERMS = 8;
    private const MAX_DEPTH = 4;
    private const MAX_TRIGGERS = 16;
    private const MAX_MESSAGE_BYTES = 1000;
    private const EVENTS = ['interact', 'itemTaken', 'enterZone', 'leaveZone', 'bellsWrong', 'linkFired', 'foesDefeated'];
    private const CONDS = ['doorOpen', 'inZone', 'hasItem', 'lanternHooded', 'lanternHung', 'bellsSolved', 'beamHits', 'linkActive', 'foesAlive'];
    private const GATES = ['all', 'any', 'atLeast', 'sequence', 'not'];
    private const GATE_OPTS = ['all' => ['within'], 'any' => ['within'], 'atLeast' => ['k', 'within'], 'sequence' => ['within', 'strict', 'onWrong'], 'not' => []];
    private const EFFECTS = ['spawnFoes', 'openDoor', 'closeDoor', 'sealDoor', 'reveal', 'hide', 'damage', 'message'];
    private const LINK_KEYS = ['id', 'when', 'do', 'undo', 'repeat', 'delay'];

    private static function bad(string $what): never
    {
        throw new \RangeException('links: ' . $what);
    }

    private static function isObj(mixed $v): bool
    {
        return is_array($v) && $v !== [] && !array_is_list($v);
    }

    /**
     * R-LINK-1..3: validate and compile `links`. ctx: ['ents' => id => ref, 'zones' => id => index].
     *
     * @param array<string,mixed> $ctx
     * @return list<array<string,mixed>> in ascending id order
     */
    public static function compile(mixed $list, array $ctx): array
    {
        if (!is_array($list) || !array_is_list($list) || count($list) > self::MAX_LINKS) {
            self::bad('list');
        }
        $ids = [];
        foreach ($list as $l) {
            if (!self::isObj($l) || !is_int($l['id'] ?? null) || $l['id'] < 1 || $l['id'] > 65535) {
                self::bad('id');
            }
            if (isset($ids[$l['id']])) {
                self::bad('duplicate id');
            }
            $ids[$l['id']] = true;
        }
        $out = [];
        foreach ($list as $l) {
            foreach (array_keys($l) as $k) {
                if (!in_array($k, self::LINK_KEYS, true)) {
                    self::bad('key ' . $k);
                }
            }
            if (!array_key_exists('when', $l) || !array_key_exists('do', $l)) {
                self::bad('when/do');
            }
            if (array_key_exists('repeat', $l) && !is_bool($l['repeat'])) {
                self::bad('repeat');
            }
            if (array_key_exists('delay', $l) && (!is_int($l['delay']) || $l['delay'] < 0 || $l['delay'] > 600)) {
                self::bad('delay');
            }
            $c = ['ctx' => $ctx, 'links' => $ids, 'self' => $l['id'], 'slots' => 0, 'triggers' => 0];
            $when = self::term($l['when'], $c, 1);
            $ev = self::eventValued($when);
            if ($ev && array_key_exists('undo', $l)) {
                self::bad('undo on an event-valued when');
            }
            $init = [];
            self::initMemory($when, $init);
            ksort($init);
            $out[] = [
                'id' => $l['id'], 'when' => $when, 'ev' => $ev, 'slots' => $c['slots'], 'init' => array_values($init),
                'do' => self::effects($l['do'], $ctx),
                'undo' => array_key_exists('undo', $l) ? self::effects($l['undo'], $ctx) : null,
                'repeat' => ($l['repeat'] ?? false) === true,
                'delay' => array_key_exists('delay', $l) ? $l['delay'] : 0,
            ];
        }
        usort($out, static fn (array $a, array $b): int => $a['id'] <=> $b['id']);
        return $out;
    }

    /**
     * @param array<string,mixed> $ctx
     * @return list<array<string,mixed>>
     */
    private static function effects(mixed $list, array $ctx): array
    {
        if (!is_array($list) || !array_is_list($list) || count($list) < 1 || count($list) > self::MAX_EFFECTS) {
            self::bad('effects');
        }
        $out = [];
        foreach ($list as $e) {
            if (!self::isObj($e) || count($e) !== 1) {
                self::bad('effect');
            }
            $kind = (string) array_key_first($e);
            $v = $e[$kind];
            if (!in_array($kind, self::EFFECTS, true)) {
                self::bad('effect kind');
            }
            if ($kind === 'damage') {
                if (!is_int($v) || $v < 1 || $v > 1000) {
                    self::bad('damage');
                }
                $out[] = ['kind' => $kind, 'n' => $v];
            } elseif ($kind === 'message') {
                if (!is_string($v) || strlen($v) > self::MAX_MESSAGE_BYTES) {
                    self::bad('message');
                }
                $out[] = ['kind' => $kind, 'text' => $v];
            } elseif ($kind === 'spawnFoes') {
                $out[] = ['kind' => $kind, 'group' => self::group($v, $ctx)];
            } elseif ($kind === 'reveal' || $kind === 'hide') {
                $out[] = ['kind' => $kind, 'item' => self::entity($v, $ctx, static fn (array $r): bool => $r['type'] === 'item' && $r['hidden'])['n']];
            } else {
                $out[] = ['kind' => $kind, 'door' => self::entity($v, $ctx, static fn (array $r): bool => $r['type'] === 'door')['door']];
            }
        }
        return $out;
    }

    /**
     * @param array<string,mixed> $ctx
     * @param callable(array<string,mixed>):bool $ok
     * @return array<string,mixed>
     */
    private static function entity(mixed $id, array $ctx, callable $ok): array
    {
        $r = is_string($id) ? ($ctx['ents'][$id] ?? null) : null;
        if ($r === null || !$ok($r)) {
            self::bad('entity reference');
        }
        return $r;
    }

    /** @param array<string,mixed> $ctx */
    private static function group(mixed $id, array $ctx): int
    {
        $g = is_string($id) ? ($ctx['groups'][$id] ?? null) : null;
        if ($g === null) {
            self::bad('group reference');
        }
        return $g;
    }

    /** @param array<string,mixed> $ctx */
    private static function zone(mixed $id, array $ctx): int
    {
        $z = is_string($id) ? ($ctx['zones'][$id] ?? null) : null;
        if ($z === null) {
            self::bad('zone reference');
        }
        return $z;
    }

    /** @param array<string,mixed> $c */
    private static function linkRef(mixed $v, array $c): int
    {
        if (!is_int($v) || !isset($c['links'][$v]) || $v === $c['self']) {
            self::bad('link reference');
        }
        return $v;
    }

    /** @param array<string,mixed> $c */
    private static function triggerArg(string $kind, mixed $v, array $c): int|bool
    {
        $takeable = static fn (array $r): bool => $r['type'] === 'item' && $r['kind'] !== 'rubble';
        switch ($kind) {
            case 'interact':
                return self::entity($v, $c['ctx'], static fn (array $r): bool => in_array($r['type'], ['door', 'item', 'bell', 'lampHook', 'mirror', 'chest'], true))['n'];
            case 'itemTaken':
            case 'hasItem':
                return self::entity($v, $c['ctx'], $takeable)['n'];
            case 'enterZone':
            case 'leaveZone':
            case 'inZone':
                return self::zone($v, $c['ctx']);
            case 'bellsWrong':
            case 'bellsSolved':
                return self::entity($v, $c['ctx'], static fn (array $r): bool => $r['type'] === 'bellSet')['set'];
            case 'linkFired':
            case 'linkActive':
                return self::linkRef($v, $c);
            case 'doorOpen':
                return self::entity($v, $c['ctx'], static fn (array $r): bool => $r['type'] === 'door')['door'];
            case 'foesDefeated':
            case 'foesAlive':
                return self::group($v, $c['ctx']);
            case 'beamHits':
                return self::entity($v, $c['ctx'], static fn (array $r): bool => $r['type'] === 'crystal')['crystal'];
            case 'lanternHooded':
            case 'lanternHung':
                if (!is_bool($v)) {
                    self::bad($kind);
                }
                return $v;
        }
        self::bad('trigger');
    }

    /**
     * @param array<string,mixed> $t
     * @param array<string,mixed> $c
     * @return array<string,mixed>
     */
    private static function trigger(array $t, array &$c): array
    {
        if (count($t) !== 1) {
            self::bad('trigger keys');
        }
        $kind = (string) array_key_first($t);
        $isEvent = in_array($kind, self::EVENTS, true);
        if (!$isEvent && !in_array($kind, self::CONDS, true)) {
            self::bad('trigger kind');
        }
        if (++$c['triggers'] > self::MAX_TRIGGERS) {
            self::bad('too many triggers');
        }
        $arg = self::triggerArg($kind, $t[$kind], $c);
        if ($isEvent) {
            return ['t' => 'ev', 'kind' => $kind, 'arg' => $arg, 'slot' => $c['slots']++];
        }
        return ['t' => 'cond', 'kind' => $kind, 'arg' => $arg];
    }

    /** @param array<string,mixed> $n */
    private static function eventValued(array $n): bool
    {
        return $n['t'] === 'ev' || $n['t'] === 'seq';
    }

    /**
     * @param array<string,mixed> $c
     * @return array<string,mixed>
     */
    private static function term(mixed $t, array &$c, int $depth): array
    {
        if (!self::isObj($t)) {
            self::bad('term');
        }
        $keys = array_map('strval', array_keys($t));
        $gates = array_values(array_filter($keys, static fn (string $k): bool => in_array($k, self::GATES, true)));
        if ($gates === []) {
            return self::trigger($t, $c);
        }
        if (count($gates) !== 1) {
            self::bad('gate keys');
        }
        $g = $gates[0];
        foreach ($keys as $k) {
            if ($k !== $g && !in_array($k, self::GATE_OPTS[$g], true)) {
                self::bad('gate option ' . $k);
            }
        }
        if ($depth > self::MAX_DEPTH) {
            self::bad('gates nested too deep');
        }
        if ($g === 'not') {
            $inner = self::term($t['not'], $c, $depth + 1);
            if (self::eventValued($inner)) {
                self::bad('not needs a condition');
            }
            return ['t' => 'gate', 'g' => $g, 'terms' => [$inner], 'k' => 0, 'within' => 0];
        }
        $list = $t[$g];
        if (!is_array($list) || !array_is_list($list) || count($list) < 2 || count($list) > self::MAX_TERMS) {
            self::bad('gate terms');
        }
        $within = 90;
        if (array_key_exists('within', $t)) {
            if (!is_int($t['within']) || $t['within'] < 1 || $t['within'] > 1800) {
                self::bad('within');
            }
            $within = $t['within'];
        }
        if ($g === 'sequence') {
            $slot = $c['slots'];
            $c['slots'] += 3;
            $steps = [];
            foreach ($list as $s) {
                if (!self::isObj($s) || count($s) !== 1 || !in_array((string) array_key_first($s), self::EVENTS, true)) {
                    self::bad('sequence step');
                }
                if (++$c['triggers'] > self::MAX_TRIGGERS) {
                    self::bad('too many triggers');
                }
                $kind = (string) array_key_first($s);
                $steps[] = ['kind' => $kind, 'arg' => self::triggerArg($kind, $s[$kind], $c)];
            }
            if (array_key_exists('strict', $t) && !is_bool($t['strict'])) {
                self::bad('strict');
            }
            $strict = ($t['strict'] ?? false) === true;
            if (array_key_exists('onWrong', $t) && !$strict) {
                self::bad('onWrong needs strict');
            }
            return [
                't' => 'seq', 'steps' => $steps, 'within' => array_key_exists('within', $t) ? $within : 0, 'strict' => $strict,
                'onWrong' => array_key_exists('onWrong', $t) ? self::effects($t['onWrong'], $c['ctx']) : null, 'slot' => $slot,
            ];
        }
        $terms = [];
        foreach ($list as $x) {
            $terms[] = self::term($x, $c, $depth + 1);
        }
        $k = 0;
        if ($g === 'atLeast') {
            $kv = $t['k'] ?? null;
            if (!is_int($kv) || $kv < 1 || $kv > count($terms)) {
                self::bad('k');
            }
            $k = $kv;
        }
        return ['t' => 'gate', 'g' => $g, 'terms' => $terms, 'k' => $k, 'within' => $within];
    }

    /**
     * R-LINK-4: initial memory, depth-first.
     *
     * @param array<string,mixed> $n
     * @param array<int,int> $m
     */
    private static function initMemory(array $n, array &$m): void
    {
        if ($n['t'] === 'ev') {
            $m[$n['slot']] = -1;
        } elseif ($n['t'] === 'seq') {
            $m[$n['slot']] = 0;
            $m[$n['slot'] + 1] = -1;
            $m[$n['slot'] + 2] = -1;
        } elseif ($n['t'] === 'gate') {
            foreach ($n['terms'] as $x) {
                self::initMemory($x, $m);
            }
        }
    }

    /**
     * @param list<array<string,mixed>> $links
     * @return list<array<string,mixed>>
     */
    public static function initState(array $links): array
    {
        return array_map(static fn (array $l): array => ['val' => false, 'active' => false, 'spent' => false, 'pend' => [], 'm' => $l['init']], $links);
    }

    /**
     * R-LINK-5: deliver one batch of [kind, arg] events to one link's memory.
     *
     * @param array<string,mixed> $n
     * @param list<int> $m
     * @param list<array{string,int}> $batch
     * @param list<list<array<string,mixed>>> $wrong
     */
    private static function deliver(array $n, array &$m, array $batch, int $tick, array &$wrong): void
    {
        if ($n['t'] === 'ev') {
            foreach ($batch as [$k, $a]) {
                if ($k === $n['kind'] && $a === $n['arg']) {
                    $m[$n['slot']] = $tick;
                    break;
                }
            }
        } elseif ($n['t'] === 'seq') {
            $s = $n['slot'];
            $used = array_fill(0, count($batch), false);
            if ($m[$s] > 0 && $n['within'] > 0 && $tick - $m[$s + 1] > $n['within']) {
                $m[$s] = 0;
            }
            $done = false;
            for (;;) {
                $step = $n['steps'][$m[$s]];
                $at = -1;
                foreach ($batch as $x => [$k, $a]) {
                    if (!$used[$x] && $k === $step['kind'] && $a === $step['arg']) {
                        $at = $x;
                        break;
                    }
                }
                if ($at < 0) {
                    break;
                }
                $used[$at] = true;
                $m[$s] += 1;
                $m[$s + 1] = $tick;
                if ($m[$s] === count($n['steps'])) {
                    $m[$s + 2] = $tick;
                    $m[$s] = 0;
                    $done = true;
                    break;
                }
            }
            if (!$done && $n['strict']) {
                $hit = false;
                foreach ($batch as $x => [$k, $a]) {
                    if ($used[$x]) {
                        continue;
                    }
                    foreach ($n['steps'] as $st) {
                        if ($st['kind'] === $k && $st['arg'] === $a) {
                            $hit = true;
                            break 2;
                        }
                    }
                }
                if ($hit) {
                    $m[$s] = 0;
                    if ($n['onWrong'] !== null) {
                        $wrong[] = $n['onWrong'];
                    }
                }
            }
        } elseif ($n['t'] === 'gate') {
            foreach ($n['terms'] as $x) {
                self::deliver($x, $m, $batch, $tick, $wrong);
            }
        }
    }

    /**
     * R-LINK-6
     *
     * @param array<string,mixed> $n
     * @param list<int> $m
     */
    private static function value(array $n, array $m, int $tick, int $within, LinkHost $ws): bool
    {
        if ($n['t'] === 'ev' || $n['t'] === 'seq') {
            $last = $n['t'] === 'ev' ? $m[$n['slot']] : $m[$n['slot'] + 2];
            return $within === 0 ? $last === $tick : $last >= 0 && $tick - $last < $within;
        }
        if ($n['t'] === 'cond') {
            return $ws->cond($n['kind'], $n['arg']);
        }
        if ($n['g'] === 'not') {
            return !self::value($n['terms'][0], $m, $tick, $within, $ws);
        }
        $count = 0;
        foreach ($n['terms'] as $x) {
            if (self::value($x, $m, $tick, $n['within'], $ws)) {
                $count++;
            }
        }
        if ($n['g'] === 'all') {
            return $count === count($n['terms']);
        }
        if ($n['g'] === 'any') {
            return $count >= 1;
        }
        return $count >= $n['k'];
    }

    /** @param list<array{left:int,undo:bool}> $pend */
    private static function hasPending(array $pend, bool $undo): bool
    {
        foreach ($pend as $p) {
            if ($p['undo'] === $undo) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param list<array{left:int,undo:bool}> $pend
     * @return list<array{left:int,undo:bool}>
     */
    private static function without(array $pend, bool $undo): array
    {
        return array_values(array_filter($pend, static fn (array $p): bool => $p['undo'] !== $undo));
    }

    /**
     * R-LINK-7: evaluate the links once, at the end of a living tick.
     *
     * @param list<array<string,mixed>> $links
     * @param list<array<string,mixed>> $states
     * @param list<array{string,int}> $batch0
     */
    public static function run(array $links, array &$states, array $batch0, LinkHost $ws): void
    {
        if ($links === []) {
            return;
        }
        $tick = $ws->tick();
        foreach ($links as $n => $l) {
            if ($states[$n]['pend'] === []) {
                continue;
            }
            $due = [];
            $keep = [];
            foreach ($states[$n]['pend'] as $p) {
                $p['left'] -= 1;
                if ($p['left'] === 0) {
                    $due[] = $p;
                } else {
                    $keep[] = $p;
                }
            }
            $states[$n]['pend'] = $keep;
            foreach ($due as $p) {
                $ws->apply($p['undo'] ? $l['undo'] : $l['do']);
                if ($ws->dead()) {
                    return;
                }
            }
        }
        $batch = $batch0;
        for ($pass = 0; $pass < self::MAX_PASSES; $pass++) {
            $changed = false;
            $next = [];
            if ($batch !== []) {
                foreach ($links as $n => $l) {
                    $wrong = [];
                    self::deliver($l['when'], $states[$n]['m'], $batch, $tick, $wrong);
                    foreach ($wrong as $list) {
                        if ($ws->apply($list)) {
                            $changed = true;
                        }
                        if ($ws->dead()) {
                            return;
                        }
                    }
                }
            }
            foreach ($links as $n => $l) {
                $v = self::value($l['when'], $states[$n]['m'], $tick, 0, $ws);
                $st = &$states[$n];
                if ($v && !$st['val']) {
                    if (self::hasPending($st['pend'], true)) {
                        $st['pend'] = self::without($st['pend'], true);
                        $st['active'] = true;
                    } elseif (!$st['spent']) {
                        $st['active'] = true;
                        if (!$l['repeat']) {
                            $st['spent'] = true;
                        }
                        $next[] = ['linkFired', $l['id']];
                        $ws->fired($l['id']);
                        if ($l['delay'] === 0) {
                            unset($st);
                            if ($ws->apply($l['do'])) {
                                $changed = true;
                            }
                            $st = &$states[$n];
                        } else {
                            $st['pend'][] = ['left' => $l['delay'], 'undo' => false];
                        }
                    }
                } elseif (!$v && $st['val'] && $st['active']) {
                    $st['active'] = false;
                    if ($l['ev']) {
                        // event-valued: queued effects still land (decision #31)
                    } elseif (self::hasPending($st['pend'], false)) {
                        $st['pend'] = self::without($st['pend'], false);
                    } elseif ($l['undo'] !== null) {
                        if ($l['delay'] === 0) {
                            unset($st);
                            if ($ws->apply($l['undo'])) {
                                $changed = true;
                            }
                            $st = &$states[$n];
                        } else {
                            $st['pend'][] = ['left' => $l['delay'], 'undo' => true];
                        }
                    }
                }
                $st['val'] = $v;
                unset($st);
                if ($ws->dead()) {
                    return;
                }
            }
            if (!$changed && $next === []) {
                break;
            }
            $batch = $next;
        }
    }
}
