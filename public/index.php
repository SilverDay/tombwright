<?php

declare(strict_types=1);

// Front controller (spec §5.4). Everything that isn't a static file comes through here.
// M0 scaffold: security headers and a health check. Routing, sessions, CSRF and rate limits follow in M3.
require dirname(__DIR__) . '/vendor/autoload.php';

use Tombwright\Http\SecurityHeaders;

$https = ($_SERVER['HTTPS'] ?? '') === 'on';
foreach (SecurityHeaders::all($https) as $name => $value) {
    header("$name: $value");
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && $path === '/healthz') {
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'core' => Tombwright\Sim\Sim::CORE_VERSION], JSON_THROW_ON_ERROR);
    return;
}

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_THROW_ON_ERROR);
