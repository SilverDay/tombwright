<?php

declare(strict_types=1);

// Usage: php bin/migrate.php status|up [--test]
require dirname(__DIR__) . '/vendor/autoload.php';

use Tombwright\Db\Connection;
use Tombwright\Db\Migrator;

$cmd = $argv[1] ?? 'status';
$test = in_array('--test', $argv, true);
$config = require dirname(__DIR__) . '/config/config.php';
$m = new Migrator(Connection::make($config['db'], 'migrate', $test), dirname(__DIR__) . '/migrations');

switch ($cmd) {
    case 'status':
        $applied = $m->applied();
        foreach ($m->available() as $a) {
            printf("%s %-40s %s\n", $a['version'], $a['name'], isset($applied[$a['version']]) ? 'applied' : 'pending');
        }
        echo count($applied) . " applied\n";
        break;
    case 'up':
        $ran = $m->up();
        echo $ran ? 'applied: ' . implode(', ', $ran) . "\n" : "nothing to apply\n";
        break;
    default:
        fwrite(STDERR, "usage: php bin/migrate.php status|up [--test]\n");
        exit(64);
}
