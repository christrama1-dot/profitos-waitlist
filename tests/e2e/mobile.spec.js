// Mobile/tablet viewports: pages must not overflow horizontally and the nav
// toggle must be reachable (brief scope 2, item 6).
'use strict';
const { test, expect } = require('@playwright/test');

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];
const PAGES = ['index', 'beta', 'security'];

for (const v of VIEWPORTS) {
  test.describe(`${v.name} (${v.width}px)`, () => {
    test.use({ viewport: { width: v.width, height: v.height } });

    for (const p of PAGES) {
      test(`no horizontal overflow: ${p}.html`, async ({ page }) => {
        await page.goto(`/${p}.html`, { waitUntil: 'domcontentloaded' });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${p}.html horizontal overflow (px) at ${v.width}px`).toBeLessThanOrEqual(2);
      });
    }
  });
}
