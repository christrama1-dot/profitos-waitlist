// #83-aware beta price assertion. Does NOT hardcode $15 (breaks the day $29
// ships) or $29 (not live yet). Asserts the beta-membership disclosure exists
// and equals one of the two Founder-approved amounts, and logs which it found.
// When $29 goes live, tighten APPROVED_BETA_PRICES / this test to $29 only.
'use strict';
const { test, expect } = require('@playwright/test');
const { APPROVED_BETA_PRICES } = require('./_shared');

test('beta price disclosure matches an approved amount', async ({ page }) => {
  await page.goto('/beta.html', { waitUntil: 'domcontentloaded' });
  const text = await page.locator('body').innerText();

  // Target the BETA membership price specifically (not the $197 Charter rate).
  const m = text.match(/beta membership is \$(\d+)\/month/i)
        || text.match(/\$(\d+)\/month beta membership/i);
  expect(m, 'beta-membership price disclosure line is present on beta.html').not.toBeNull();

  const found = `$${m[1]}/month`;
  console.log(`[price] beta membership disclosure found: ${found}`);
  test.info().annotations.push({ type: 'beta-price', description: found });

  expect(
    APPROVED_BETA_PRICES,
    `beta price must be a Founder-approved amount (found ${found})`,
  ).toContain(found);

  // The Charter conversion rate must still be disclosed and unchanged.
  expect(text, 'Charter $197 conversion rate present').toContain('$197');
});
