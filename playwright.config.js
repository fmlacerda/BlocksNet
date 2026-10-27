// End-to-end tests: `npm run test:e2e`. Starts a local copy of the Worker (game files + server)
// with an empty database for every run. Tests share the 7 public rooms, so they run one at a time.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const os = require('os');

// Outside the repo: wrangler watches the project folder and would restart on every database write.
const STATE = path.join(os.tmpdir(), 'rowbusters-test-state');
// Same for test recordings: written into the project they'd restart the server mid-test.
const OUT = process.env.RB_TEST_OUT || path.join(os.tmpdir(), 'rowbusters-test-results');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  outputDir: path.join(OUT, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 10000 },
  forbidOnly: !!process.env.CI,
  retries: 0,                                   // a failing test is a bug, not a flake
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: path.join(OUT, 'report') }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Safari's engine: run on CI (GitHub installs it); this sandbox only has Chromium.
    ...(process.env.CI ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@webkit/ }] : []),
  ],
  webServer: {
    command: `rm -rf "${STATE}" && npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to "${STATE}"`,
    url: 'http://127.0.0.1:8787/health',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'ignore',
  },
});
