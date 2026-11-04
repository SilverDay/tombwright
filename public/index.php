<?php

declare(strict_types=1);

// Front controller (spec §5.4). Everything that isn't a static file comes through here.
// M0 scaffold: security headers and a health check. Routing, sessions, CSRF and rate limits follow in M3.
require dirname(__DIR__) . '/vendor/autoload.php';

use Tombwright\Http\SecurityHeaders;

const OFFICIAL_TOMBS = ['/tombs/gloamhollow.gdf.json' => 'gloamhollow.gdf.json'];
const PAGES = ['/' => 'home.php', '/play/gloamhollow' => 'game.php'];

$https = ($_SERVER['HTTPS'] ?? '') === 'on';
foreach (SecurityHeaders::all($https) as $name => $value) {
    header("$name: $value");
}

$uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
$path = (string) strtok($uri, '?');
if ($path === '' || $path[0] !== '/' || str_starts_with($path, '//')) {
    $path = '';  // never a route; parse_url would read '//x' as a host
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$read = $method === 'GET' || $method === 'HEAD';
if ($read && $path === '/healthz') {
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'core' => Tombwright\Sim\Sim::CORE_VERSION], JSON_THROW_ON_ERROR);
    return;
}

// The landing page, the game pages and the official tombs they play. Fixed routes only (the PAGES and
// OFFICIAL_TOMBS allow-lists); nothing from the path reaches the file system. HEAD is answered like GET
// (headers only).
if ($read && isset(PAGES[$path])) {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    if ($method === 'GET') {
        $siteUrl = 'https://tombwright.silverday.de'; // the canonical URL (open question Q9: the final name and domain)
        require dirname(__DIR__) . '/templates/' . PAGES[$path];
    }
    return;
}
if ($read && isset(OFFICIAL_TOMBS[$path])) {
    $file = dirname(__DIR__) . '/dungeons/' . OFFICIAL_TOMBS[$path];
    $size = is_file($file) ? filesize($file) : false;
    if ($size === false) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => 'unavailable'], JSON_THROW_ON_ERROR);
        return;
    }
    header('Content-Type: application/json');
    header('Cache-Control: no-cache');
    header('Content-Length: ' . (string) $size);
    if ($method === 'GET') {
        readfile($file);
    }
    return;
}

// Known paths with another method: 405 (RFC 9110).
if ($path === '/healthz' || isset(PAGES[$path]) || isset(OFFICIAL_TOMBS[$path])) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed'], JSON_THROW_ON_ERROR);
    return;
}

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_THROW_ON_ERROR);
