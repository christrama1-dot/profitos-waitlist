// Every live V2 page loads with HTTP 200, a title, and no real console errors.
'use strict';
const { test, expect } = require('@playwright/test');
const { CORE_PAGES } = require('./_shared');

// External font/CDN failures (offline local server) are noise, not site bugs.
const NOISE = /fonts\.googleapis|fonts\.gstatic|gstatic|plaid\.com|n8n\.cloud|favicon|net::ERR_|Failed to load resource/i;

for (const p of CORE_PAGES) {
  test(`loads clean: ${p}.html`, async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    const resp = await page.goto(`/${p}.html`, { waitUntil: 'domcontentloaded' });
    expect(resp, `${p}.html response`).not.toBeNull();
    expect(resp.status(), `${p}.html HTTP status`).toBe(200);
    await expect(page, `${p}.html has a <title>`).toHaveTitle(/.+/);

    const realErrors = errors.filter((e) => !NOISE.test(e));
    expect(realErrors, `console/page errors on ${p}.html`).toEqual([]);
  });
}
