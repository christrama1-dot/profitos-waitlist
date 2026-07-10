// The waitlist form renders and is wired to POST /api/subscribe with the
// honeypot field. The request is INTERCEPTED AND ABORTED so the suite never
// writes to a real backend (brief hard limit: never spam production endpoints).
'use strict';
const { test, expect } = require('@playwright/test');

test('waitlist form renders and posts to /api/subscribe (never submitted)', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#wl-email'), 'email input renders').toBeVisible();
  await expect(page.locator('#wl-btn'), 'join button renders').toBeVisible();
  // honeypot field is present, named "website", and hidden from real users
  await expect(page.locator('#wl-hp'), 'honeypot present').toHaveAttribute('name', 'website');

  let captured = null;
  await page.route('**/api/subscribe', (route) => {
    const req = route.request();
    captured = {
      method: req.method(),
      url: req.url(),
      body: (() => { try { return req.postDataJSON(); } catch { return null; } })(),
    };
    route.abort(); // do NOT let the submission reach any real endpoint
  });

  await page.fill('#wl-email', 'tester-zero+ci@example.com');
  await page.click('#wl-btn');

  await expect.poll(() => captured, { message: 'subscribe request was attempted' }).not.toBeNull();
  expect(captured.method).toBe('POST');
  expect(captured.url).toContain('/api/subscribe');
  expect(captured.body && captured.body.email).toBe('tester-zero+ci@example.com');
  // honeypot value is sent through as "website" (empty for a real user)
  expect(captured.body).toHaveProperty('website');
});
