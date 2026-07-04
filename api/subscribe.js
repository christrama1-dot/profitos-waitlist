/**
 * api/subscribe.js — BUILD 07 (hardened)
 * Kit waitlist subscription + Command Center A/B logging + Hook A/B logging
 *
 * BUILD 07 changes (July 3, 2026 — Founder To-Do #40):
 *   - CORS locked to production origins (was wildcard '*')
 *   - Per-IP rate limit via Vercel KV (5 requests / 10 min)
 *   - Honeypot field check ("website" — hidden field in index.html)
 *   - Real email regex validation (was substring checks)
 *
 * Required Vercel env vars:
 *   KIT_API_KEY         — Kit account API key
 *   KIT_FORM_ID         — Kit form UID or numeric ID
 *   KV_REST_API_URL     — Auto-set when Vercel KV is enabled
 *   KV_REST_API_TOKEN   — Auto-set when Vercel KV is enabled
 *
 * POST /api/subscribe
 * Body: { "email": "user@example.com", "cc_shown": 3, "hook_shown": 1, "website": "" }
 */

const ALLOWED_ORIGINS = [
  'https://profitosengine.com',
  'https://www.profitosengine.com',
  'https://profitos-waitlist.vercel.app'
];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const RATE_LIMIT_MAX    = 5;    // requests
const RATE_LIMIT_WINDOW = 600;  // seconds (10 min)

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin',  origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }
  // No Origin header = same-origin or non-browser client; CORS headers not needed.
  return !origin;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function kvCall(path) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null; // KV not enabled — caller decides fallback
  const res = await fetch(`${url}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`KV ${path} failed: ${res.status}`);
  return res.json();
}

async function kvIncr(key) {
  try {
    const data = await kvCall(`/incr/${encodeURIComponent(key)}`);
    if (data) console.log(`[subscribe] KV incr ${key} → ${data.result}`);
    else      console.log(`[subscribe] KV not enabled — skipping: ${key}`);
    return data ? data.result : null;
  } catch (err) {
    console.error(`[subscribe] KV incr error: ${err.message}`);
    return null;
  }
}

/**
 * Returns true if this IP is over the limit.
 * Fails OPEN (returns false) if KV is unavailable — availability over strictness.
 */
async function rateLimited(ip) {
  try {
    const key   = `rl:sub:${ip}`;
    const data  = await kvCall(`/incr/${encodeURIComponent(key)}`);
    if (!data) return false; // KV not enabled
    const count = data.result;
    if (count === 1) {
      await kvCall(`/expire/${encodeURIComponent(key)}/${RATE_LIMIT_WINDOW}`);
    }
    if (count > RATE_LIMIT_MAX) {
      console.warn(`[subscribe] Rate limit hit: ip=${ip} count=${count}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[subscribe] Rate limit check error: ${err.message}`);
    return false; // fail open
  }
}

async function resolveFormId(apiKey, formUid) {
  const listRes = await fetch(
    `https://api.convertkit.com/v3/forms?api_key=${encodeURIComponent(apiKey)}`
  );
  if (!listRes.ok) throw new Error(`Kit forms list request failed: ${listRes.status}`);
  const data  = await listRes.json();
  const forms = data.forms || [];
  console.log(`[subscribe] Kit returned ${forms.length} form(s) for UID lookup`);
  const match = forms.find(f => {
    if (f.uid && f.uid === formUid)                    return true;
    if (String(f.id) === formUid)                      return true;
    if (f.embed_js  && f.embed_js.includes(formUid))   return true;
    if (f.embed_url && f.embed_url.includes(formUid))  return true;
    return false;
  });
  if (!match) {
    const ids = forms.map(f => `${f.id}:${f.name}`).join(', ');
    throw new Error(`No Kit form matched UID "${formUid}". Available: ${ids}`);
  }
  console.log(`[subscribe] Resolved UID ${formUid} → form ID ${match.id} (${match.name})`);
  return String(match.id);
}

module.exports = async function handler(req, res) {
  const corsOk = applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(corsOk ? 204 : 403).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  if (!corsOk) {
    console.warn(`[subscribe] Blocked origin: ${req.headers.origin}`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── Input ─────────────────────────────────────────────────────
  const body      = req.body || {};
  const email     = typeof body.email      === 'string' ? body.email.trim().toLowerCase()  : '';
  const ccShown   = typeof body.cc_shown   === 'number' ? Math.floor(body.cc_shown)        : -1;
  const hookShown = typeof body.hook_shown === 'number' ? Math.floor(body.hook_shown)      : -1;
  const honeypot  = typeof body.website    === 'string' ? body.website.trim()              : '';

  // ── Honeypot: bots fill hidden fields. Pretend success, do nothing. ──
  if (honeypot) {
    console.warn(`[subscribe] Honeypot tripped: ip=${clientIp(req)}`);
    return res.status(200).json({ success: true });
  }

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  // ── Rate limit ────────────────────────────────────────────────
  if (await rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
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
    if (!/^\d+$/.test(formId)) formId = await resolveFormId(apiKey, formId);
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
      // ── Command Center A/B logging ────────────────────────────
      if (ccShown >= 0 && ccShown <= 21) {
        kvIncr('cc:total');
        kvIncr(`cc:${ccShown}`);
        console.log(`[subscribe] cc_shown=${ccShown}`);
      }

      // ── Hook A/B logging ──────────────────────────────────────
      if (hookShown >= 0 && hookShown <= 2) {
        kvIncr('hook:total');
        kvIncr(`hook:${hookShown}`);
        console.log(`[subscribe] hook_shown=${hookShown}`);
      }

      console.log(`[subscribe] OK email=${email} cc=${ccShown} hook=${hookShown}`);
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
