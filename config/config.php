<?php

declare(strict_types=1);

/**
 * Configuration. Values come from, in order of precedence:
 *   1. real environment variables (PHP-FPM pool env[...], Apache SetEnv, CI),
 *   2. a KEY=VALUE file: $TW_CONFIG_FILE, or config/local.env next to this file.
 * The file lives outside the web root (public/ is the document root) and must be
 * readable only by the PHP user (chmod 600). No secrets are ever committed:
 * config/local.env is git-ignored; config/local.env.example is the template.
 *
 * @return array<string,mixed>
 */
return (static function (): array {
    $file = getenv('TW_CONFIG_FILE') ?: __DIR__ . '/local.env';
    $fromFile = [];
    if (is_file($file)) {
        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $n => $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            if (preg_match('/^([A-Z][A-Z0-9_]*)=(.*)$/D', $line, $m) !== 1) {
                throw new RuntimeException(sprintf('%s line %d: expected KEY=VALUE', basename($file), $n + 1));
            }
            // Values are literal: no quotes, no variable expansion, no shell.
            $fromFile[$m[1]] = $m[2];
        }
    }
    $env = static function (string $k, ?string $default = null) use ($fromFile): string {
        $v = getenv($k);
        if ($v === false || $v === '') {
            $v = $fromFile[$k] ?? '';
        }
        if ($v === '') {
            if ($default === null) {
                throw new RuntimeException("Missing required setting $k");
            }
            return $default;
        }
        return $v;
    };
    return [
        'env' => $env('TW_ENV', 'prod'),
        'db' => [
            'host' => $env('TW_DB_HOST', '127.0.0.1'),
            'port' => (int) $env('TW_DB_PORT', '3306'),
            'name' => $env('TW_DB_NAME', 'tombwright-db'),
            'test_name' => $env('TW_DB_TEST_NAME', 'tombwright_test'),
            'app_user' => $env('TW_DB_APP_USER', 'tw_app'),
            'app_pass' => $env('TW_DB_APP_PASS', ''),
            'migrate_user' => $env('TW_DB_MIGRATE_USER', 'tw_migrate'),
            'migrate_pass' => $env('TW_DB_MIGRATE_PASS', ''),
        ],
    ];
})();
