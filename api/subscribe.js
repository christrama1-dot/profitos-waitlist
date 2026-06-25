/**
 * api/subscribe.js — BUILD 06
 * Kit waitlist subscription + Command Center A/B logging
 *
 * Required Vercel env vars:
 *   KIT_API_KEY         — Kit account API key
 *   KIT_FORM_ID         — Kit form UID or numeric ID
 *   KV_REST_API_URL     — Auto-set when Vercel KV is enabled
 *   KV_REST_API_TOKEN   — Auto-set when Vercel KV is enabled
 *
 * POST /api/subscribe
 * Body: { "email": "user@example.com", "cc_shown": 3 }
 */

/**
 * Resolves alphanumeric form UID to numeric Kit form ID.
 * Skipped automatically when KIT_FORM_ID is already numeric.
 */
async function resolveFormId(apiKey, formUid) {
  const listRes = await fetch(
    `https://api.convertkit.com/v3/forms?api_key=${encodeURIComponent(apiKey)}`
  );
  if (!listRes.ok) {
    throw new Error(`Kit forms list request failed: ${listRes.status}`);
  }
  const data  = await listRes.json();
  const forms = data.forms || [];

  console.log(`[subscribe] Kit returned ${forms.length} form(s) for UID lookup`);

  const match = forms.find(f => {
    if (f.uid && f.uid === formUid)             return true;
    if (String(f.id) === formUid)               return true;
    if (f.embed_js  && f.embed_js.includes(formUid))  return true;
    if (f.embed_url && f.embed_url.includes(formUid)) return true;
    return false;
  });

  if (!match) {
    const ids = forms.map(f => `${f.id}:${f.name}`).join(', ');
    throw new Error(`No Kit form matched UID "${formUid}". Available: ${ids}`);
  }

  console.log(`[subscribe] Resolved UID ${formUid} → form ID ${match.id} (${match.name})`);
  return String(match.id);
}

/**
 * Increments a KV counter via Vercel KV REST API (Upstash Redis).
 * Silently skips if KV env vars are not present (KV not yet enabled).
 */
async function kvIncr(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.log(`[subscribe] KV not enabled — skipping counter for key: ${key}`);
    return;
  }
  try {
    const res = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[subscribe] KV incr failed (${res.status}): ${body}`);
    } else {
      const data = await res.json();
      console.log(`[subscribe] KV incr ${key} → ${data.result}`);
    }
  } catch (err) {
    console.error(`[subscribe] KV incr error: ${err.message}`);
  }
}

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Input ─────────────────────────────────────────────────────
  const body    = req.body || {};
  const email   = typeof body.email    === 'string' ? body.email.trim().toLowerCase() : '';
  const ccShown = typeof body.cc_shown === 'number' ? Math.floor(body.cc_shown)       : -1;

  if (!email || !email.includes('@') || !email.includes('.') || email.indexOf('@') < 1) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  // ── Env check ─────────────────────────────────────────────────
  const apiKey = process.env.KIT_API_KEY;
  let   formId = process.env.KIT_FORM_ID;

  if (!apiKey || !formId) {
    console.error('[subscribe] Missing KIT_API_KEY or KIT_FORM_ID');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Resolve UID → numeric ID ──────────────────────────────────
  try {
    if (!/^\d+$/.test(formId)) {
      formId = await resolveFormId(apiKey, formId);
    }
  } catch (err) {
    console.error('[subscribe] Form ID resolution failed:', err.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Kit subscribe ─────────────────────────────────────────────
  try {
    const kitRes = await fetch(
      `https://api.convertkit.com/v3/forms/${formId}/subscribe`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: apiKey, email })
      }
    );

    if (kitRes.ok) {
      // ── A/B logging — fire and forget ────────────────────────
      if (ccShown >= 0 && ccShown <= 21) {
        // Total signups counter
        kvIncr('cc:total');
        // Per-chat counter
        kvIncr(`cc:${ccShown}`);
        console.log(`[subscribe] cc_shown=${ccShown} email=${email}`);
      }
      return res.status(200).json({ success: true });
    }

    const errBody = await kitRes.text();
    console.error('[subscribe] Kit API error', kitRes.status, errBody);
    return res.status(502).json({ error: 'Subscription service error' });

  } catch (err) {
    console.error('[subscribe] Fetch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
