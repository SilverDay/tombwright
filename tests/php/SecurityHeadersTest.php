<?php

declare(strict_types=1);

namespace Tombwright\Tests;

use PHPUnit\Framework\TestCase;
use Tombwright\Http\SecurityHeaders;

final class SecurityHeadersTest extends TestCase
{
    public function testCspHasNoUnsafeSources(): void
    {
        $csp = SecurityHeaders::all()['Content-Security-Policy'];
        self::assertStringNotContainsString('unsafe-inline', $csp);
        self::assertStringNotContainsString('unsafe-eval', $csp);
        self::assertStringContainsString("frame-ancestors 'none'", $csp);
    }

    public function testHstsOnlyOverHttps(): void
    {
        self::assertArrayHasKey('Strict-Transport-Security', SecurityHeaders::all(true));
        self::assertArrayNotHasKey('Strict-Transport-Security', SecurityHeaders::all(false));
    }
}
