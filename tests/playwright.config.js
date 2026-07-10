// @ts-check
// Tester Zero (#82 layer 1) — Playwright config for profitos-waitlist.
// Default target: a local static server of the repo root (`..`) — deterministic,
// no Cloudflare bot-challenge flakiness, and impossible to write to a real backend
// (the /api/* serverless functions don't run under a static server, so the
// auth/subscribe tests feature-detect and stay safe). Point BASE_URL at a real
// deployment (e.g. the #42 preview URL) to exercise the auth-active tests.
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL && process.env.BASE_URL.trim()
  ? process.env.BASE_URL.trim()
  : 'http://localhost:8080';
const useLocalServer = /localhost|127\.0\.0\.1/.test(BASE_URL);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Only stand up the local static server when targeting localhost.
  ...(useLocalServer
    ? {
        webServer: {
          command: 'python3 -m http.server 8080 --directory ..',
          port: 8080,
          reuseExistingServer: !process.env.CI,
          timeout: 30000,
        },
      }
    : {}),
});
