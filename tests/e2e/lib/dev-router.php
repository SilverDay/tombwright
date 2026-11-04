<?php

// Router for `php -S` in the end-to-end tests: real files under public/ are served as they are
// (Apache does the same), everything else goes through the front controller.
declare(strict_types=1);

$root = dirname(__DIR__, 3) . '/public';
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if ($path !== '/' && !str_contains($path, '..') && is_file($root . $path)) {
    return false;
}
require $root . '/index.php';
