/**
 * api/subscribe.js
 * Vercel serverless function — MailerLite waitlist subscription proxy
 *
 * Required Vercel environment variables (set in Vercel dashboard):
 *   MAILERLITE_API_KEY   — API token from MailerLite account 2372433
 *   MAILERLITE_GROUP_ID  — Group/list ID for the waitlist subscribers
 *
 * Endpoint: POST /api/subscribe
 * Body:     { "email": "user@example.com" }
 * Returns:  { "success": true } on 200/201/422 (duplicate = success)
 */

module.exports = async function handler(req, res) {
  // ── CORS headers ──────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Input validation ──────────────────────────────────────────
  const body  = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email || !email.includes('@') || !email.includes('.') || email.indexOf('@') < 1) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  // ── Environment check ─────────────────────────────────────────
  const apiKey  = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_ID;

  if (!apiKey) {
    console.error('[subscribe] Missing MAILERLITE_API_KEY env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── MailerLite API v3 call ────────────────────────────────────
  try {
    const payload = { email };
    if (groupId) payload.groups = [groupId];

    const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload)
    });

    // 200 / 201 = subscribed, 422 = already subscribed — all treated as success
    if (mlRes.status === 200 || mlRes.status === 201 || mlRes.status === 422) {
      return res.status(200).json({ success: true });
    }

    // Log unexpected errors server-side only — never leak to client
    const errBody = await mlRes.text();
    console.error('[subscribe] MailerLite error', mlRes.status, errBody);
    return res.status(502).json({ error: 'Subscription service error' });

  } catch (err) {
    console.error('[subscribe] Fetch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
