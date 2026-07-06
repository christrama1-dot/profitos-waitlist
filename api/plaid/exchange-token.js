/**
 * api/plaid/exchange-token.js — WF-10 Phase 1
 * Exchanges a Plaid Link public_token for a permanent access_token,
 * encrypts it, and stores it + the connected account list in Supabase.
 *
 * Raw fetch to Plaid + Supabase REST APIs — no SDK, no new npm
 * dependency. Matches this repo's existing zero-dependency convention.
 *
 * Required Vercel env vars:
 *   PLAID_CLIENT_ID, PLAID_SECRET_SANDBOX, PLAID_SECRET_PRODUCTION, PLAID_ENV
 *   MEMBER_TOKEN_ENCRYPTION_KEY — 32-byte hex, generated locally, never in chat
 *   SUPABASE_PROJECT_URL
 *   SUPABASE_SERVICE_ROLE_KEY — server-only, bypasses RLS (Path B, see
 *     workflows/WF-10-supabase-schema.md)
 *
 * POST /api/plaid/exchange-token
 * Body: { public_token: string, member_id: string }
 * Returns: { success: true, accounts_connected: number }
 *
 * STATUS: UNTESTED. Needs a live run before this ships to any real member.
 */

const crypto = require('crypto');

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

// AES-256-GCM. Key must be a 32-byte hex string from Bitwarden — never hardcoded.
function encryptToken(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, base64, so decrypt has everything it needs.
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

async function supabaseInsert(table, rows) {
  const url = `${process.env.SUPABASE_PROJECT_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert into ${table} failed: ${res.status} ${text}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { public_token, member_id } = req.body || {};
  if (!public_token || !member_id) {
    return res.status(400).json({ error: 'public_token and member_id are required' });
  }

  if (!process.env.MEMBER_TOKEN_ENCRYPTION_KEY) {
    console.error('[exchange-token] Missing MEMBER_TOKEN_ENCRYPTION_KEY');
    return res.status(500).json({ error: 'Encryption not configured' });
  }
  if (!process.env.SUPABASE_PROJECT_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[exchange-token] Missing Supabase config');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  try {
    const exchangeRes = await fetch(`${plaidBaseUrl()}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: plaidSecret(),
        public_token,
      }),
    });
    const exchangeData = await exchangeRes.json();
    if (!exchangeRes.ok) {
      console.error('[exchange-token] Plaid exchange error:', exchangeData);
      return res.status(500).json({ error: 'Failed to exchange token' });
    }
    const accessToken = exchangeData.access_token;
    const itemId = exchangeData.item_id;

    const accountsRes = await fetch(`${plaidBaseUrl()}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: plaidSecret(),
        access_token: accessToken,
      }),
    });
    const accountsData = await accountsRes.json();
    if (!accountsRes.ok) {
      console.error('[exchange-token] Plaid accounts error:', accountsData);
      return res.status(500).json({ error: 'Failed to fetch accounts' });
    }
    const accounts = accountsData.accounts || [];
    const institutionName = (accountsData.item && accountsData.item.institution_id) || null;

    const encrypted = encryptToken(accessToken, process.env.MEMBER_TOKEN_ENCRYPTION_KEY);

    await supabaseInsert('plaid_tokens', [{
      member_id: String(member_id),
      plaid_item_id: itemId,
      access_token_encrypted: encrypted,
    }]);

    const accountRows = accounts.map(acct => ({
      member_id: String(member_id),
      plaid_item_id: itemId,
      institution_name: institutionName,
      account_id: acct.account_id,
      account_name: acct.name,
      account_type: acct.type,
      account_subtype: acct.subtype,
      mask: acct.mask,
    }));

    if (accountRows.length > 0) {
      await supabaseInsert('connected_accounts', accountRows);
    }

    console.log(`[exchange-token] member=${member_id} item=${itemId} accounts=${accounts.length}`);

    return res.status(200).json({ success: true, accounts_connected: accounts.length });
  } catch (err) {
    console.error('[exchange-token] Error:', err.message);
    return res.status(500).json({ error: 'Failed to exchange token' });
  }
};
