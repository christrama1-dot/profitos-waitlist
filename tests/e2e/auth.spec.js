// #42 server-side auth regression lock. Feature-detects the auth deployment:
//  - if /api/dashboard-data is ABSENT (404) — i.e. main / a static server where
//    the #42 branch isn't merged/deployed — the test SKIPS (main stays green).
//  - if PRESENT — asserts the gate: 401 unauthenticated + no content leak in the
//    dashboard page without a session.
// Point BASE_URL at the #42 preview deployment to activate these.
'use strict';
const { test, expect } = require('@playwright/test');

test('#42: dashboard is server-gated (401 + no content without a session)', async ({ page, request }) => {
  const probe = await request.get('/api/dashboard-data', { failOnStatusCode: false });

  test.skip(
    probe.status() === 404,
    '/api/dashboard-data not present here (main / static server) — activates on the #42 deployment',
  );

  // Auth API is present -> it MUST reject an unauthenticated request.
  expect([401, 403], 'unauthenticated /api/dashboard-data must be denied').toContain(probe.status());

  // The dashboard page must render nothing sensitive without a session:
  // the protected #dash-view stays hidden; the login view is what shows.
  await page.goto('/dashboard.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#dash-view'), 'protected view hidden without a session').toBeHidden();
  await expect(page.locator('#login-view'), 'login view shown instead').toBeVisible();
});
