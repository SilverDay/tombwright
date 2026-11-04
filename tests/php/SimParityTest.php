<?php

declare(strict_types=1);

namespace Tombwright\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tombwright\Sim\Canonical;
use Tombwright\Sim\IntMath;
use Tombwright\Sim\Rng;
use Tombwright\Sim\Sim;
use Tombwright\Sim\SineTable;

/**
 * The PHP core must reproduce, bit for bit, every vector the JS core generated
 * (tests/golden/vectors). This is the project's central invariant (spec §6.3).
 */
final class SimParityTest extends TestCase
{
    private const DIR = __DIR__ . '/../golden/vectors/';

    /** @return array<string,mixed> */
    private static function prim(): array
    {
        return json_decode((string) file_get_contents(self::DIR . 'primitives.json'), true, 64, JSON_THROW_ON_ERROR);
    }

    public function testSineTableMatches(): void
    {
        SineTable::load();
        foreach (self::prim()['sine'] as [$a, $v]) {
            self::assertSame($v, SineTable::sin($a), "sin($a)");
        }
    }

    public function testIdivAndIsqrt(): void
    {
        $p = self::prim();
        foreach ($p['idiv'] as [$a, $b, $q]) {
            self::assertSame($q, IntMath::idiv($a, $b), "idiv($a,$b)");
        }
        foreach ($p['isqrt'] as [$n, $r]) {
            self::assertSame($r, IntMath::isqrt($n), "isqrt($n)");
        }
    }

    public function testRng(): void
    {
        $p = self::prim();
        foreach ($p['fmix32'] as [$x, $h]) {
            self::assertSame($h, Rng::fmix32($x));
        }
        foreach ($p['rng'] as $case) {
            $s = Rng::seed($case['seed']);
            self::assertSame($case['state0'], $s);
            foreach ($case['out'] as $k => $want) {
                self::assertSame($want, Rng::next($s), "seed {$case['seed']} draw $k");
            }
        }
        $s = Rng::seed(7);
        foreach ($p['below'] as [$n, $want]) {
            self::assertSame($want, Rng::below($s, $n));
        }
    }

    public function testCanonical(): void
    {
        foreach (self::prim()['canon'] as $c) {
            // JSON objects decode to assoc arrays; the empty JS array decodes to [] as well.
            $text = Canonical::encode($c['value']);
            self::assertSame($c['text'], $text);
            self::assertSame($c['sha256'], hash('sha256', $text));
        }
    }

    public function testFdiv(): void
    {
        foreach (self::prim()['fdiv'] as [$a, $b, $q]) {
            self::assertSame($q, IntMath::fdiv($a, $b), "fdiv($a,$b)");
        }
    }

    public function testGdfLoadingMatchesJs(): void
    {
        foreach (self::prim()['gdf'] as $c) {
            try {
                $id = Sim::load((string) base64_decode($c['bytes'], true))->id;
                self::assertTrue($c['ok'], "{$c['name']}: PHP accepted what JS rejected");
                self::assertSame($c['id'], $id, $c['name']);
            } catch (\RangeException | \InvalidArgumentException $e) {
                self::assertFalse($c['ok'], "{$c['name']}: PHP rejected what JS accepted ({$e->getMessage()})");
            }
        }
    }

    public function testStepRejectsOutOfRangeInput(): void
    {
        $world = Sim::load((string) file_get_contents(__DIR__ . '/../../dungeons/gloamhollow.gdf.json'));
        $st = Sim::init($world, 1, 'delve');
        $ok = ['move' => [0, 0], 'yaw' => 0, 'pitch' => 0, 'buttons' => 0, 'target' => 0];
        foreach ([['move' => [128, 0]], ['move' => [0]], ['yaw' => 4096], ['yaw' => 1.5], ['pitch' => -128], ['buttons' => 65536], ['target' => -1]] as $bad) {
            try {
                Sim::step($world, $st, array_replace($ok, $bad));
                self::fail('accepted ' . json_encode($bad));
            } catch (\RangeException) {
                // expected
            }
        }
        self::assertSame(0, $st['tick'], 'a rejected input must not advance the sim');
    }

    public function testStepRefusesAnotherWorld(): void
    {
        $text = (string) file_get_contents(__DIR__ . '/../../dungeons/gloamhollow.gdf.json');
        $a = Sim::load($text);
        $b = Sim::load(str_replace('"Gloamhollow"', '"Other"', $text));
        $st = Sim::init($a, 1, 'delve');
        $this->expectException(\InvalidArgumentException::class);
        Sim::step($b, $st, ['move' => [0, 0], 'yaw' => 0, 'pitch' => 0, 'buttons' => 0, 'target' => 0]);
    }

    public function testCanonicalRejectsFloats(): void
    {
        $this->expectException(\TypeError::class);
        Canonical::encode(['x' => 1.5]);
    }

    public function testStepRefusesAnotherCoreVersion(): void
    {
        $world = Sim::load((string) file_get_contents(__DIR__ . '/../../dungeons/gloamhollow.gdf.json'));
        $st = Sim::init($world, 1, 'delve');
        $st['core'] = 'm0.3';
        $this->expectExceptionMessage('state from another core version');
        Sim::step($world, $st, ['move' => [127, 0], 'yaw' => 0, 'pitch' => 0, 'buttons' => 0, 'target' => 0]);
    }

    /** R-VENT-2: same window as the JS test (period 60, phase 10, warn 15, fire 20). */
    public function testVentFiring(): void
    {
        $on = [];
        for ($n = 0; $n < 120; $n++) {
            if (Sim::ventFiring(['period' => 60, 'phase' => 10, 'warn' => 15, 'fire' => 20], $n)) {
                $on[] = $n;
            }
        }
        self::assertSame(array_merge(range(5, 24), range(65, 84)), $on);
    }

    /** R-DEATH-3: an Ironman run is over after its death; the vector ends on that tick. */
    public function testIronmanRefusesStepAfterDeath(): void
    {
        $v = json_decode((string) file_get_contents(self::DIR . '0009-ironman.json'), true, 64, JSON_THROW_ON_ERROR);
        $world = Sim::load($v['gdf']);
        $st = Sim::init($world, $v['seed'], $v['mode']);
        foreach ($v['inputs'] as [$n, $inp]) {
            for ($k = 0; $k < $n; $k++) {
                Sim::step($world, $st, $inp);
            }
        }
        self::assertSame('slab', $st['dead']['cause']);
        $this->expectExceptionMessage('the run is over');
        Sim::step($world, $st, ['move' => [0, 0], 'yaw' => 0, 'pitch' => 0, 'buttons' => Sim::BTN_RISE, 'target' => 0]);
    }

    /** @return iterable<string,array{string}> */
    public static function vectors(): iterable
    {
        foreach (glob(self::DIR . '0*.json') ?: [] as $f) {
            yield basename($f, '.json') => [$f];
        }
    }

    #[DataProvider('vectors')]
    public function testGoldenReplay(string $file): void
    {
        $v = json_decode((string) file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
        self::assertSame(Sim::CORE_VERSION, $v['core'], 'vector was generated by a different core version');
        $world = Sim::load($v['gdf']);  // the GDF's exact text (R-GDF-0)
        $st = Sim::init($world, $v['seed'], $v['mode']);
        self::assertSame($v['hashes']['0'], Sim::hash($st), 'tick 0');
        $t = 0;
        foreach ($v['inputs'] as [$n, $inp]) {
            for ($k = 0; $k < $n; $k++) {
                Sim::step($world, $st, $inp);
                $t++;
                if ($t % $v['hashEvery'] === 0) {
                    // First mismatching checkpoint names the tick (desync forensics, spec §6.4).
                    self::assertSame($v['hashes'][(string) $t], Sim::hash($st), "state hash at tick $t");
                }
            }
        }
        self::assertSame($v['ticks'], $t);
        self::assertSame($v['final'], Sim::hash($st), 'final hash');
    }
}
