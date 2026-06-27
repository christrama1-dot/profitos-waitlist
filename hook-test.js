/**
 * hook-test.js — Hero Hook A/B Split Test
 * Runs with defer. Assigns visitor to variant A or D and swaps hero copy.
 * Intercepts /api/subscribe fetch to inject hook_shown without modifying index.html.
 *
 * Variants:
 *   0 = A (CONTROL) — default index.html copy
 *   1 = D           — "Your profit is LEAKING. / The Controller would have caught it."
 *
 * Variant B ("You just got a Controller. / Without the salary.") removed by Founder, June 27, 2026.
 * Force a variant for testing: ?h=0 | ?h=1
 */

(function () {
  var HOOKS = [
    {
      // A — CONTROL — default index.html H1, no DOM swap performed
    },
    {
      // D — Challenger (previously index 2)
      line1: 'Your profit is LEAKING.',
      line2: 'The Controller would have caught it.',
      sub:   'Now you have one. Over 50 watchdogs. Results in about a minute. No credit card.'
    }
  ];

  // ── Assign variant ──────────────────────────────────────────────
  var params = new URLSearchParams(window.location.search);
  var forced = parseInt(params.get('h'), 10);
  var idx    = (!isNaN(forced) && forced >= 0 && forced < HOOKS.length)
    ? forced
    : Math.floor(Math.random() * HOOKS.length);

  window.HOOK_IDX = idx;

  // ── Swap DOM ────────────────────────────────────────────────────
  // Variant 0 is the default index.html copy — no swap needed.
  if (idx !== 0) {
    var hook  = HOOKS[idx];
    var line1 = document.querySelector('.hero-left h1 .gradient-text');
    var line2 = document.querySelector('.hero-left h1 .line2');
    var sub   = document.querySelector('.hero-left .hero-sub');
    if (line1) line1.textContent = hook.line1;
    if (line2) line2.textContent = hook.line2;
    if (sub)   sub.textContent   = hook.sub;
  }

  // ── Intercept /api/subscribe to inject hook_shown ──────────────
  // No modification to index.html go() function required.
  var _fetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url === 'string' && url.includes('/api/subscribe') && options && options.body) {
      try {
        var body        = JSON.parse(options.body);
        body.hook_shown = window.HOOK_IDX || 0;
        options         = Object.assign({}, options, { body: JSON.stringify(body) });
      } catch (e) { /* leave body unchanged if parse fails */ }
    }
    return _fetch.apply(this, arguments);
  };

})();
