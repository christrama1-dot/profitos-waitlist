/**
 * netlify/functions/founding-crew-apply.js — Netlify port of api/founding-crew-apply.js
 * Founding Crew application handler — BACKUP PLATFORM ONLY (Netlify dry run)
 *
 * Ported from Vercel BUILD 03 (July 5, 2026, Fable 5 audit). Same validation,
 * same honeypot, same rate limit, same n8n forward, same honest-failure logging.
 * Only the request/response plumbing changed for Netlify's handler signature.
 *
 * Reachable at /.netlify/functions/founding-crew-apply — netlify.toml redirects
 * /api/founding-crew-apply to this path so founding-crew.html needs zero edits.
 *
 * POST /api/founding-crew-apply
 * Body: { name, email, answer, website? }
 */

const N8N_FC_WEBHOOK = 'https://profitos.app.n8n.cloud/webhook/founding-crew-apply';

const ALLOWED_ORIGINS = [
  'https://profitosengine.com',
  'https://www.profitosengine.com',
  'https://profitos-waitlist.vercel.app'
];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const RATE_LIMIT_MAX    = 3;    // requests
const RATE_LIMIT_WINDOW = 600;  // seconds (10 min)

function corsHeaders(originHeader) {
  // Netlify normalizes incoming header names to lowercase.
  const origin = originHeader;
  const headers = { Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin']  = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

function corsOk(originHeader) {
  // No Origin header = same-origin or non-browser client; CORS not needed.
  return !originHeader || ALLOWED_ORIGINS.includes(originHeader);
}

function clientIp(event) {
  const fwd = event.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  const nf = event.headers['x-nf-client-connection-ip'];
  if (typeof nf === 'string' && nf.length) return nf;
  return 'unknown';
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

/**
 * Returns true if this IP is over the limit.
 * Fails OPEN (returns false) if KV is unavailable — availability over strictness.
 */
async function rateLimited(ip) {
  try {
    const key   = `rl:fc:${ip}`;
    const data  = await kvCall(`/incr/${encodeURIComponent(key)}`);
    if (!data) return false; // KV not enabled
    const count = data.result;
    if (count === 1) {
      await kvCall(`/expire/${encodeURIComponent(key)}/${RATE_LIMIT_WINDOW}`);
    }
    if (count > RATE_LIMIT_MAX) {
      console.warn(`[fc-apply] Rate limit hit: ip=${ip} count=${count}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[fc-apply] Rate limit check error: ${err.message}`);
    return false; // fail open
  }
}

exports.handler = async function handler(event) {
  const originHeader = event.headers.origin || event.headers.Origin;
  const cors = corsHeaders(originHeader);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: corsOk(originHeader) ? 204 : 403, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!corsOk(originHeader)) {
    console.warn(`[fc-apply] Blocked origin: ${originHeader}`);
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // ── Parse body ─────────────────────────────────────────────────
  let body = {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    body = JSON.parse(raw);
  } catch (err) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const name     = typeof body.name    === 'string' ? body.name.trim()                : '';
  const email    = typeof body.email   === 'string' ? body.email.trim().toLowerCase() : '';
  const answer   = typeof body.answer  === 'string' ? body.answer.trim()              : '';
  const honeypot = typeof body.website === 'string' ? body.website.trim()             : '';

  // ── Honeypot: bots fill hidden fields. Pretend success, do nothing. ──
  if (honeypot) {
    console.warn(`[fc-apply] Honeypot tripped: ip=${clientIp(event)}`);
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ success: true, message: 'Application received.' })
    };
  }

  if (!name || name.length < 2) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Name required' }) };
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Valid email required' }) };
  }
  if (!answer || answer.length < 10) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Answer required (min 10 chars)' }) };
  }

  // ── Rate limit ────────────────────────────────────────────────
  if (await rateLimited(clientIp(event))) {
    return {
      statusCode: 429, headers: cors,
      body: JSON.stringify({ error: 'Too many requests. Try again in a few minutes.' })
    };
  }

  const timestamp = new Date().toISOString();

  // ── Forward to n8n WF-FC-01 ───────────────────────────────────
  // n8n handles: Kit tag, Google Sheets, Founder email, Slack #fc-applications
  let n8nSuccess = false;
  try {
    const n8nRes = await fetch(N8N_FC_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, answer, submitted_at: timestamp })
    });
    n8nSuccess = n8nRes.ok;
    if (!n8nSuccess) {
      const errText = await n8nRes.text().catch(() => '');
      console.error(`[fc-apply] n8n error (${n8nRes.status}): ${errText}`);
    } else {
      console.log(`[fc-apply] Forwarded to n8n WF-FC-01: ${email}`);
    }
  } catch (err) {
    console.error('[fc-apply] n8n fetch failed:', err.message);
  }

  // ── Failure preservation ──────────────────────────────────────
  // If n8n did not receive the application, it exists ONLY here.
  // The [ALERT] marker makes lost applications findable in Netlify logs
  // (Netlify → Logs & metrics → Functions) for manual recovery.
  if (!n8nSuccess) {
    console.error('[fc-apply][ALERT] APPLICATION NOT FORWARDED — MANUAL RECOVERY REQUIRED:', JSON.stringify({
      name, email, answer, timestamp
    }));
  } else {
    console.log('[fc-apply] Application received:', { name, email, timestamp, n8nForwarded: true });
  }

  // Always return 200 — never block the applicant on n8n status
  return {
    statusCode: 200, headers: cors,
    body: JSON.stringify({
      success: true,
      message: 'Application received. We review every one personally. You will hear from us within 48 hours.'
    })
  };
};
