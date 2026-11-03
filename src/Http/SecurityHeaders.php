<?php

declare(strict_types=1);

namespace Tombwright\Http;

/** Response security headers (spec §11.4). */
final class SecurityHeaders
{
    public const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
        . "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

    /** @return array<string,string> */
    public static function all(bool $https = true): array
    {
        $h = [
            'Content-Security-Policy' => self::CSP,
            'Referrer-Policy' => 'strict-origin-when-cross-origin',
            'X-Content-Type-Options' => 'nosniff',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
            'Cross-Origin-Opener-Policy' => 'same-origin',
        ];
        if ($https) {
            // Add "; preload" only once the domain is stable (spec §11.4).
            $h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
        }
        return $h;
    }
}
