/**
 * api/plaid/create-link-token.js — WF-10 Phase 1
 * Generates a Plaid Link token so a member (or, for this internal test,
 * ProfitOS Engine LLC itself) can connect a bank/card account.
 *
 * Uses raw fetch to Plaid's REST API — no SDK — to match this repo's
 * zero-dependency convention (see api/check-capacity.js, api/subscribe.js).
 * There is no package.json in this repo today; adding the `plaid` npm
 * package would mean adding one. Deliberately avoided.
 *
 * Required Vercel env vars:
 *   PLAID_CLIENT_ID
 *   PLAID_SECRET_SANDBOX
 *   PLAID_SECRET_PRODUCTION
 *   PLAID_ENV — 'sandbox' or 'production'
 *
 * POST /api/plaid/create-link-token
 * Body: { member_id: string }
 * Returns: { link_token, expiration }
 *
 * STATUS: UNTESTED. Needs a live run against a real Plaid Link session
 * before this ships to any real member. Internal-test-only for now.
 */

function plaidBaseUrl() {
  return process.env.PLAID_ENV === 'production'
    ? 'https://production.plaid.com'
    : 'https://sandbox.plaid.com';
}

function plaidSecret() {
  return process.env.PLAID_ENV === 'production'
    ? process.env.PLAID_SECRET_PRODUCTION
    : process.env.PLAID_SECRET_SANDBOX;
}

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.PLAID_CLIENT_ID) {
    console.error('[create-link-token] Missing PLAID_CLIENT_ID');
    return res.status(500).json({ error: 'Plaid not configured' });
  }

  const memberId = (req.body && req.body.member_id) || 'profitos-engine-llc-internal-test';

  try {
    const plaidRes = await fetch(`${plaidBaseUrl()}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: plaidSecret(),
        user: { client_user_id: String(memberId) },
        client_name: 'ProfitOS Engine',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
        webhook: process.env.PLAID_WEBHOOK_URL || undefined,
      }),
    });

    const data = await plaidRes.json();

    if (!plaidRes.ok) {
      console.error('[create-link-token] Plaid error:', data);
      return res.status(500).json({ error: 'Failed to create link token', detail: data.error_message || null });
    }

    return res.status(200).json({ link_token: data.link_token, expiration: data.expiration });
  } catch (err) {
    console.error('[create-link-token] Error:', err.message);
    return res.status(500).json({ error: 'Failed to create link token' });
  }
};
