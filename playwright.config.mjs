// Playwright config for end-to-end walkthroughs (spec §15, "Gameplay").
// Chromium only for now; the tests drive the game through its fixed-tick test hook.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  workers: 1, // one php -S serves every test; parallel workers starve the walkthroughs and make them time out
  reporter: [['list']],
  // The Tombwright client is served by PHP's built-in server through the front controller (spec §5.4).
  webServer: {
    command: 'php -S 127.0.0.1:8765 -t public tests/e2e/lib/dev-router.php',
    url: 'http://127.0.0.1:8765/healthz',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30 * 1000,
  },
  use: {
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
});
