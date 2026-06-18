/**
 * api/subscribe.js
 * Vercel serverless function — Kit (ConvertKit) waitlist subscription proxy
 *
 * Required Vercel environment variables (set in Vercel dashboard):
 *   KIT_API_KEY  — API key from Kit account (Settings > Advanced > API Key)
 *   KIT_FORM_ID  — Kit form ID for the waitlist form
 *
 * Endpoint: POST /api/subscribe
 * Body:     { "email": "user@example.com" }
 * Returns:  { "success": true } on success
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
  const apiKey = process.env.KIT_API_KEY;
  const formId = process.env.KIT_FORM_ID;

  if (!apiKey || !formId) {
    console.error('[subscribe] Missing KIT_API_KEY or KIT_FORM_ID env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Kit (ConvertKit) API call ─────────────────────────────────
  // Docs: https://developers.kit.com/v3#subscribe-to-a-form
  // Note: Kit API key goes in the request body, not the Authorization header
  try {
    const kitRes = await fetch(
      'https://api.convertkit.com/v3/forms/' + formId + '/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, email: email })
      }
    );

    // Kit returns 200 for new subscribers and existing subscribers alike
    if (kitRes.ok) {
      return res.status(200).json({ success: true });
    }

    // Log server-side only — never expose API details to client
    const errBody = await kitRes.text();
    console.error('[subscribe] Kit API error', kitRes.status, errBody);
    return res.status(502).json({ error: 'Subscription service error' });

  } catch (err) {
    console.error('[subscribe] Fetch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
