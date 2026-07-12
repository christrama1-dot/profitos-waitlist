// Every internal .html link across the V2 nav pages resolves (no broken links /
// no orphan-class regressions like the #75 the-controller.html finding).
'use strict';
const { test, expect } = require('@playwright/test');

const NAV_PAGES = ['index', 'security', 'integrations', 'use-cases', 'docs', 'team'];

test('internal .html links all resolve (no 404s)', async ({ page, request }) => {
  const targets = new Set();
  for (const p of NAV_PAGES) {
    await page.goto(`/${p}.html`, { waitUntil: 'domcontentloaded' });
    const hrefs = await page.$$eval('a[href$=".html"]', (els) =>
      els.map((e) => e.getAttribute('href')).filter(Boolean),
    );
    for (const h of hrefs) {
      // internal links only (skip absolute http(s) and anchors)
      if (/^https?:/i.test(h)) continue;
      targets.add(h.replace(/^\.?\//, '').split('#')[0]);
    }
  }
  expect(targets.size, 'found internal links to check').toBeGreaterThan(0);

  const broken = [];
  for (const t of targets) {
    const r = await request.get(`/${t}`);
    if (r.status() !== 200) broken.push(`${t} -> ${r.status()}`);
  }
  expect(broken, 'internal links returning non-200').toEqual([]);
});
