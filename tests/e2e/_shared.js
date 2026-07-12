// Shared constants for the Tester Zero suite. Internal tooling only.
'use strict';

// Live V2 pages that must all load (per the #82 brief + session scope).
const CORE_PAGES = [
  'index', 'security', 'integrations', 'use-cases', 'docs', 'team',
  'beta', 'privacy', 'terms',
];

// Funnel/legal pages included in brand-invariant sweeps.
const EXTRA_PAGES = ['founding-crew', 'founding-crew-agreement'];

// #83 transition: the beta price disclosure must match EXACTLY ONE of these.
// Live copy is $15 today; Founder pushes $29 on execution. When $29 lands,
// tighten price.spec.js to expect '$29/month' only.
const APPROVED_BETA_PRICES = ['$15/month', '$29/month'];

module.exports = { CORE_PAGES, EXTRA_PAGES, APPROVED_BETA_PRICES };
