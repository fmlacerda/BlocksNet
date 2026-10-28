// End-to-end tests: `npm run test:e2e`. Starts a local copy of the Worker (game files + server)
// with an empty database for every run. Tests share the 7 public rooms, so they run one at a time.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// Outside the repo: wrangler watches the project folder and would restart on every database write.
const STATE = path.join(os.tmpdir(), 'rowbusters-test-state');
// Same for test recordings: written into the project they'd restart the server mid-test.
const OUT = process.env.RB_TEST_OUT || path.join(os.tmpdir(), 'rowbusters-test-results');
// Sign-in tests: a throwaway "test" provider. Its key pair is made here (kept in the temp folder
// so every Playwright process signs with the same key); the local server gets the public half.
const AUTH_KEY = path.join(os.tmpdir(), 'rowbusters-test-auth.json');
if (!fs.existsSync(AUTH_KEY)) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(AUTH_KEY, JSON.stringify({ private: privateKey.export({ format: 'jwk' }), public: { ...publicKey.export({ format: 'jwk' }), kid: 'test1', alg: 'RS256', use: 'sig' } }));
}
const TEST_JWKS = Buffer.from(JSON.stringify({ keys: [JSON.parse(fs.readFileSync(AUTH_KEY, 'utf8')).public] })).toString('base64');

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
    // CI machines have no graphics chip, and the Linux build of Safari's engine crashed now and
    // then drawing through the software GPU driver ("Target crashed"); it draws on the CPU here.
    ...(process.env.CI ? [{ name: 'webkit', use: { ...devices['Desktop Safari'],
      launchOptions: { env: { ...process.env, WEBKIT_SKIA_ENABLE_CPU_RENDERING: '1' } } }, grep: /@webkit/ }] : []),
  ],
  webServer: {
    command: `rm -rf "${STATE}" && npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to "${STATE}" --var AUTH_TEST_JWKS:${TEST_JWKS} --var GOOGLE_CLIENT_ID:test-google-client --var APPLE_CLIENT_IDS:test-apple-client --var MICROSOFT_CLIENT_ID:test-microsoft-client`,
    url: 'http://127.0.0.1:8787/health',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'ignore',
  },
});
