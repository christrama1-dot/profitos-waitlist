/**
 * api/hook-stats.js — Hero Hook A/B conversion stats
 *
 * Required Vercel env vars:
 *   KV_REST_API_URL     — Auto-set when Vercel KV is enabled
 *   KV_REST_API_TOKEN   — Auto-set when Vercel KV is enabled
 *   FOUNDER_STATS_KEY   — Same key used for cc-stats
 *
 * GET /api/hook-stats?key=YOUR_FOUNDER_STATS_KEY
 *
 * Returns:
 * {
 *   total: 42,
 *   hooks: [
 *     { index: 0, label: "A (Control) — default index.html hero copy", count: 18, pct: "42.9" },
 *     ...
 *   ],
 *   winner: { index: 1, label: "...", pct: "..." },
 *   kv_enabled: true
 * }
 *
 * FIXED July 1, 2026: this file still had 3 hook variants on record (A/B/D) after
 * Variant B was retired from hook-test.js on June 27, 2026. The live script only
 * ever sends index 0 or 1 now, with index 1 meaning D — but this file still labeled
 * index 1 as "B." Every D-variant hit since June 27 was being mislabeled as B in
 * the stats below. HOOK_LABELS and HOOK_COUNT updated to match the live 2-variant
 * script exactly. Historical hits recorded under index 1 between June 27 and July 1
 * are a blended B+D count with no clean way to separate them after the fact —
 * flagged to Founder, not corrected retroactively. Going forward this is accurate.
 */

var HOOK_LABELS = [
  'A (Control) — default index.html hero copy',
  'D — Your profit is LEAKING. / The Controller would have caught it.'
];

var HOOK_COUNT = 2;

async function kvMGet(keys) {
  var url   = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    var commands = keys.map(function(k) { return ['GET', k]; });
    var res = await fetch(url + '/pipeline', {
      method:  'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    JSON.stringify(commands)
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data.map(function(item) {
      return item.result !== null ? parseInt(item.result, 10) || 0 : 0;
    });
  } catch (err) {
    console.error('[hook-stats] KV error:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  var statsKey    = process.env.FOUNDER_STATS_KEY;
  var providedKey = req.query.key || '';

  if (!statsKey)              return res.status(500).json({ error: 'FOUNDER_STATS_KEY not configured' });
  if (providedKey !== statsKey) return res.status(401).json({ error: 'Unauthorized' });

  var kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  if (!kvEnabled) {
    return res.status(200).json({
      total:      0,
      hooks:      [],
      kv_enabled: false,
      message:    'Vercel KV not yet enabled.'
    });
  }

  var keys   = ['hook:total'].concat(
    Array.from({ length: HOOK_COUNT }, function(_, i) { return 'hook:' + i; })
  );
  var values = await kvMGet(keys);

  if (!values) return res.status(500).json({ error: 'KV read failed' });

  var total = values[0];
  var hooks = values.slice(1).map(function(count, i) {
    return {
      index: i,
      label: HOOK_LABELS[i] || ('Variant ' + i),
      count: count,
      pct:   total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
    };
  });

  var sorted = hooks.slice().sort(function(a, b) { return b.count - a.count; });
  var winner = sorted[0] && sorted[0].count > 0 ? sorted[0] : null;

  return res.status(200).json({
    total,
    hooks:      sorted,
    winner,
    kv_enabled: true,
    generated:  new Date().toISOString()
  });
};
