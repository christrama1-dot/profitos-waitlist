/**
 * api/founding-crew-apply.js — BUILD 05 (PAUSED — Aug 18, 2026, Founder ruling)
 * Founding Crew application handler
 *
 * BUILD 05 changes (Founder ruling Aug 18, 2026):
 *   - APPLICATIONS_PAUSED gate at the top of the handler. Beta + waitlist
 *     launch postponed until further notice. Intake closed at the server so
 *     direct POSTs cannot create Kit tags, sheet rows, or sequence fires.
 *     Flip APPLICATIONS_PAUSED to false to reopen. Nothing else changed.
 *
 * BUILD 03 changes (Founder-approved Pick 7):
 *   - CORS locked to production origins (was wildcard '*')
 *   - Real email regex validation (was substring checks)
 *   - Per-IP rate limit via Vercel KV (3 requests / 10 min)
 *   - Honeypot field check ("website")
 *   - HONEST failure handling: if the n8n forward fails, the full application
 *     is logged with an [ALERT] marker for manual recovery. The old comment
 *     claiming "n8n retries internally" was false and has been removed.
 *
 * POST /api/founding-crew-apply
 * Body: { name, email, answer, website?, phone?, founder_call_optin? }
 *
 * BUILD 04 changes (Founder-ruled July 13, 2026 — Founder Call Program):
 *   - Optional `phone` field, loosely validated, forwarded to n8n as-is.
 *     Canonical storage is the Supabase `members` table (see WF-04), NOT
 *     Stripe — this handler only carries the value through to that record,
 *     it does not write Supabase directly (no member_id exists pre-payment;
 *     member_id = Stripe customer ID per the July 6, 2026 ruling in
 *     workflows/WF-10-supabase-schema.md).
 *   - Optional `founder_call_optin` boolean — first-8/month scarcity slot
 *     for a weekly 1:1 with the Founder (1 month's fee waived). Forwarded
 *     to n8n for logging; does not affect the application decision.
 *
 * Flow:
 *   1. Validate input (+ honeypot + rate limit)
 *   2. Forward to n8n WF-FC-01 webhook
 *      → n8n handles: Kit tag (20710414), Google Sheets, Founder email, Slack
 *   3. Return 200 to user regardless of n8n status (application is preserved
 *      in Vercel logs via [ALERT] entry if the forward fails)
 */

const APPLICATIONS_PAUSED = true; // Founder ruling Aug 18, 2026 — flip to false to reopen intake

const N8N_FC_WEBHOOK = 'https://profitos.app.n8n.cloud/webhook/founding-crew-apply';

const ALLOWED_ORIGINS = [
  'https://profitosengine.com',
  'https://www.profitosengine.com',
  'https://profitos-waitlist.vercel.app'
];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const RATE_LIMIT_MAX    = 3;    // requests
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

module.exports = async function handler(req, res) {
  const corsOk = applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(corsOk ? 204 : 403).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  if (!corsOk) {
    console.warn(`[fc-apply] Blocked origin: ${req.headers.origin}`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── PAUSE GATE (BUILD 05, Aug 18, 2026) ───────────────────────
  // Beta + waitlist postponed until further notice (Founder ruling).
  // Closing intake here — not just on the page — so direct POSTs to this
  // endpoint cannot trigger WF-FC-01 (Kit tag, sheet row, sequence fire).
  if (APPLICATIONS_PAUSED) {
    console.warn(`[fc-apply] Application blocked — intake paused: ip=${clientIp(req)}`);
    return res.status(503).json({
      error: 'Founding Crew applications are temporarily paused. Email support@profitosengine.com with any questions.'
    });
  }

  // ── Input validation ──────────────────────────────────────────
  const body     = req.body || {};
  const name     = typeof body.name    === 'string' ? body.name.trim()                : '';
  const email    = typeof body.email   === 'string' ? body.email.trim().toLowerCase() : '';
  const answer   = typeof body.answer  === 'string' ? body.answer.trim()              : '';
  const honeypot = typeof body.website === 'string' ? body.website.trim()             : '';
  // Optional — Founder Call Program (July 13, 2026). Loose validation only:
  // this is a lead-capture field, not a billing/SMS system, so we don't
  // hard-reject on format. Length cap guards against garbage/abuse input.
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone    = phoneRaw.length > 0 && phoneRaw.length <= 32 ? phoneRaw : '';
  const founderCallOptin = body.founder_call_optin === true;

  // ── Honeypot: bots fill hidden fields. Pretend success, do nothing. ──
  if (honeypot) {
    console.warn(`[fc-apply] Honeypot tripped: ip=${clientIp(req)}`);
    return res.status(200).json({ success: true, message: 'Application received.' });
  }

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Name required' });
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!answer || answer.length < 10) {
    return res.status(400).json({ error: 'Answer required (min 10 chars)' });
  }

  // ── Rate limit ────────────────────────────────────────────────
  if (await rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
  }

  const timestamp = new Date().toISOString();

  // ── Forward to n8n WF-FC-01 ───────────────────────────────────
  // n8n handles: Kit tag, Google Sheets, Founder email, Slack #fc-applications
  let n8nSuccess = false;
  try {
    const n8nRes = await fetch(N8N_FC_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name, email, answer, submitted_at: timestamp,
        phone: phone || null,
        founder_call_optin: founderCallOptin
      })
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
  // The [ALERT] marker makes lost applications findable in Vercel logs
  // (Vercel → profitos-waitlist → Logs → Functions) for manual recovery.
  if (!n8nSuccess) {
    console.error('[fc-apply][ALERT] APPLICATION NOT FORWARDED — MANUAL RECOVERY REQUIRED:', JSON.stringify({
      name, email, answer, phone: phone || null, founder_call_optin: founderCallOptin, timestamp
    }));
  } else {
    console.log('[fc-apply] Application received:', { name, email, phone: phone || null, founder_call_optin: founderCallOptin, timestamp, n8nForwarded: true });
  }

  // Always return 200 — never block the applicant on n8n status
  return res.status(200).json({
    success: true,
    message: 'Application received. We review every one personally. You will hear from us within 48 hours.'
  });
};
