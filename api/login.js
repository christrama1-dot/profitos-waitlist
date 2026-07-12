/**
 * api/login.js — server-side login for the Founder dashboard (#42)
 *
 * POST /api/login   Body: { code }
 *   - Verifies `code` against DASH_ACCESS_HASH (scrypt) server-side.
 *   - On success: sets an httpOnly, Secure, SameSite=Strict signed session
 *     cookie and returns 200. The code never travels back; nothing is stored
 *     client-side; the cookie is not readable by JavaScript.
 *   - On failure: 401 (generic — no username/timing oracle).
 *   - Rate-limited per IP via Vercel KV (defense-in-depth).
 *
 * Required env vars (Vercel — Founder-gated, see AUTH-42-NOTES.md):
 *   SESSION_SECRET, DASH_ACCESS_HASH   (+ KV_REST_API_URL / KV_REST_API_TOKEN
 *   for rate limiting — auto-set when Vercel KV is enabled).
 */
'use strict';
const auth = require('../lib/auth.js');

const WINDOW_SECONDS = 900; // 15 min
const MAX_ATTEMPTS = 8;

async function rateLimit(ip) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return { ok: true, degraded: true }; // KV off -> allow (rate limit is defense-in-depth, not the gate)
  const key = 'rl:dashlogin:' + ip;
  try {
    const r = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key]])
    });
    if (!r.ok) return { ok: true, degraded: true };
    const data = await r.json();
    const count = parseInt((data[0] && data[0].result), 10) || 1;
    if (count === 1) {
      // first attempt in a new window — set expiry
      await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['EXPIRE', key, WINDOW_SECONDS]])
      });
    }
    return { ok: count <= MAX_ATTEMPTS, count };
  } catch (_e) {
    return { ok: true, degraded: true };
  }
}

module.exports = async function handler(req, res) {
  // Same-origin only: do NOT emit a permissive CORS header on an auth endpoint.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.SESSION_SECRET;
  const storedHash = process.env.DASH_ACCESS_HASH;
  if (!secret || !storedHash) {
    // Misconfigured -> fail closed. Never grant access without both secrets.
    return res.status(500).json({ error: 'Auth not configured' });
  }

  const ip = (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || 'unknown';
  const rl = await rateLimit(ip);
  if (!rl.ok) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code) return res.status(400).json({ error: 'Missing access code' });

  const valid = auth.verifyAccessCode(code, storedHash);
  if (!valid) {
    // Do not log the attempted code.
    console.warn('[login] failed attempt ip=' + ip + (rl.count ? ' n=' + rl.count : ''));
    return res.status(401).json({ error: 'Invalid access code' });
  }

  const token = auth.signSession({ sub: 'founder', role: 'founder' }, secret);
  res.setHeader('Set-Cookie', auth.sessionCookie(token));
  return res.status(200).json({ ok: true });
};
