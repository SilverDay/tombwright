<?php

// PHP side of the differential fuzzer (tests/fuzz/run.mjs): replays every case of a JSONL file in the PHP
// core and prints one JSON line per case where it disagrees with the JS core's hashes (first tick named).
// Exit 0: all agree; 1: mismatches. Spec §6.4 point 2.
declare(strict_types=1);

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use Tombwright\Sim\Sim;

$file = $argv[1] ?? '';
$in = fopen($file, 'rb');
if ($in === false) {
    fwrite(STDERR, "cannot open $file\n");
    exit(2);
}
$bad = 0;
while (($line = fgets($in)) !== false) {
    if (trim($line) === '') {
        continue;
    }
    $c = json_decode($line, true, 64, JSON_THROW_ON_ERROR);
    $report = static function (string $what, array $extra = []) use ($c, &$bad): void {
        $bad++;
        echo json_encode(['n' => $c['n'], 'what' => $what] + $extra, JSON_THROW_ON_ERROR), "\n";
    };
    try {
        $world = Sim::load($c['gdf']);
        $st = Sim::init($world, $c['seed'], $c['mode']);
    } catch (\Throwable $e) {
        $report('load', ['php' => $e->getMessage()]);
        continue;
    }
    if (Sim::hash($st) !== $c['hashes']['0']) {
        $report('hash', ['tick' => 0]);
        continue;
    }
    $t = 0;
    $stop = null;
    $last = 0;
    foreach ($c['inputs'] as [$n, $inp]) {
        for ($k = 0; $k < $n; $k++) {
            try {
                Sim::step($world, $st, $inp);
            } catch (\Throwable $e) {
                $stop = $t;
                break 2;
            }
            $t++;
            if ($t % $c['hashEvery'] === 0) {
                if (Sim::hash($st) !== $c['hashes'][(string) $t]) {
                    $report('hash', ['tick' => $t, 'after' => $last]);
                    continue 3;
                }
                $last = $t;
            }
        }
    }
    $jsStop = $c['stop']['tick'] ?? null;
    if ($stop !== $jsStop) {
        $report('stop', ['php' => $stop, 'js' => $jsStop]);
    } elseif ($t !== $c['ticks'] || Sim::hash($st) !== $c['final']) {
        $report('final', ['tick' => $t, 'after' => $last]);
    }
}
exit($bad > 0 ? 1 : 0);
