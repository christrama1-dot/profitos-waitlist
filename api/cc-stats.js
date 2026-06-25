/**
 * api/cc-stats.js — BUILD 06
 * Command Center A/B conversion stats endpoint
 *
 * Required Vercel env vars:
 *   KV_REST_API_URL     — Auto-set when Vercel KV is enabled
 *   KV_REST_API_TOKEN   — Auto-set when Vercel KV is enabled
 *   FOUNDER_STATS_KEY   — Any secret string set by Founder (protects this endpoint)
 *
 * GET /api/cc-stats?key=YOUR_FOUNDER_STATS_KEY
 *
 * Returns:
 * {
 *   total: 42,
 *   chats: [
 *     { index: 0, count: 8, pct: "19.0" },
 *     ...
 *   ],
 *   kv_enabled: true
 * }
 */

const CC_COUNT = 22; // Total Command Center chat variants

/**
 * Reads multiple KV keys in one REST call using MGET pipeline.
 * Returns an array of values (null if key does not exist).
 */
async function kvMGet(keys) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null; // KV not enabled

  try {
    // Upstash Redis REST pipeline: POST /pipeline with array of commands
    const commands = keys.map(k => ['GET', k]);
    const res = await fetch(`${url}/pipeline`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });

    if (!res.ok) {
      console.error(`[cc-stats] KV pipeline failed: ${res.status}`);
      return null;
    }

    // Response is array of { result: value } objects
    const data = await res.json();
    return data.map(item => (item.result !== null ? parseInt(item.result, 10) || 0 : 0));

  } catch (err) {
    console.error(`[cc-stats] KV mget error: ${err.message}`);
    return null;
  }
}

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth — FOUNDER_STATS_KEY ──────────────────────────────────
  const statsKey    = process.env.FOUNDER_STATS_KEY;
  const providedKey = req.query.key || '';

  if (!statsKey) {
    return res.status(500).json({ error: 'FOUNDER_STATS_KEY not configured' });
  }
  if (providedKey !== statsKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Check KV availability ─────────────────────────────────────
  const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  if (!kvEnabled) {
    return res.status(200).json({
      total:      0,
      chats:      [],
      kv_enabled: false,
      message:    'Vercel KV not yet enabled. Enable KV in Vercel dashboard to start tracking.'
    });
  }

  // ── Fetch all counters in one pipeline call ───────────────────
  const keys    = Array.from({ length: CC_COUNT }, (_, i) => `cc:${i}`);
  const totKey  = ['cc:total'];
  const allKeys = totKey.concat(keys);

  const values = await kvMGet(allKeys);

  if (!values) {
    return res.status(500).json({ error: 'KV read failed' });
  }

  const total    = values[0]; // cc:total
  const perChat  = values.slice(1); // cc:0 through cc:21

  // ── Build response ────────────────────────────────────────────
  const chats = perChat.map((count, i) => ({
    index: i,
    count,
    pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
  }));

  // Sort by conversion count descending for easy reading
  const sorted = chats.slice().sort((a, b) => b.count - a.count);

  return res.status(200).json({
    total,
    chats:      sorted,
    kv_enabled: true,
    generated:  new Date().toISOString()
  });
};
