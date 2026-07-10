// Brand invariants that must hold on every public page (locked rules):
//  - never "fraud detection" (FTC discipline)
//  - never "AI agents" (say "watchdogs")
//  - the ONLY public ProfitOS email is support@profitosengine.com
//    (admin@profitos* is retired from public copy — email canon #43-3)
'use strict';
const { test, expect } = require('@playwright/test');
const { CORE_PAGES, EXTRA_PAGES } = require('./_shared');

const PAGES = [...CORE_PAGES, ...EXTRA_PAGES];

for (const p of PAGES) {
  test(`brand invariants: ${p}.html`, async ({ page }) => {
    await page.goto(`/${p}.html`, { waitUntil: 'domcontentloaded' });
    const raw = await page.content();
    const lower = raw.toLowerCase();

    expect(lower, 'must not say "fraud detection"').not.toContain('fraud detection');
    expect(lower, 'must not say "AI agents"').not.toContain('ai agents');
    expect(lower, 'retired admin@profitos email must not appear in public copy').not.toContain('admin@profitos');

    // Any profitosengine.com email that appears must be the support address.
    const emails = raw.match(/[a-z0-9._%+-]+@profitosengine\.com/gi) || [];
    for (const e of emails) {
      expect(e.toLowerCase(), 'public ProfitOS email must be support@profitosengine.com').toBe('support@profitosengine.com');
    }
  });
}
