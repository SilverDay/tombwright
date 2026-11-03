// Playwright config for end-to-end walkthroughs (spec §15, "Gameplay").
// Chromium only for now; the tests drive the game through its fixed-tick test hook.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
});
