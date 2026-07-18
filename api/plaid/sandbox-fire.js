/**
 * api/plaid/sandbox-fire.js — WF-10 Phase 1 SANDBOX TEST HARNESS (TEMPORARY)
 *
 * PURPOSE: Drive the full WF-10 pipe end-to-end in Plaid SANDBOX without a
 * Plaid Link UI (none exists yet). One POST does the whole dance server-side
 * so no secret ever leaves Vercel's environment:
 *   1. /sandbox/public_token/create  (webhook set to PLAID_WEBHOOK_URL)
 *   2. /item/public_token/exchange   -> access_token, item_id
 *   3. /accounts/get                 -> account list
 *   4. encrypt access_token + store plaid_tokens + connected_accounts
 *      (byte-identical to exchange-token.js so n8n can decrypt)
 *   5. /sandbox/item/fire_webhook    (TRANSACTIONS / DEFAULT_UPDATE)
 * Plaid then POSTs a signed TRANSACTIONS webhook to /api/plaid/webhook,
 * which forwards to n8n WF-10.
 *
 * SAFETY:
 *   - Refuses to run if PLAID_ENV === 'production' (sandbox-only, fail-closed).
 *   - Requires header x-sandbox-token to equal env SANDBOX_FIRE_TOKEN. If that
 *     env var is unset the endpoint is disabled. Token is never logged.
 *   - Writes only to the internal test member cus_UsuIp3iO8DPocB.
 *   - Returns NO secrets (no access_token, no public_token) — only item_id,
 *     account count, and the webhook_fired flag.
 *
 * Required Vercel env vars (all already used elsewhere except SANDBOX_FIRE_TOKEN):
 *   PLAID_CLIENT_ID, PLAID_SECRET_SANDBOX, PLAID_ENV
 *   MEMBER_TOKEN_ENCRYPTION_KEY, SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PLAID_WEBHOOK_URL
 *   SANDBOX_FIRE_TOKEN  (new — random gate value, sandbox test only)
 *
 * POST /api/plaid/sandbox-fire   Header: x-sandbox-token: <SANDBOX_FIRE_TOKEN>
 *
 * DELETE THIS FILE once to-do #67 is verified. It is a test harness, not a
 * product endpoint.
 */

const crypto = require('crypto');

const MEMBER_ID = 'cus_UsuIp3iO8DPocB';         // internal test member (not a real customer)
const INSTITUTION_ID = 'ins_109508';            // First Platypus Bank — sandbox, supports transactions

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

// AES-256-GCM — copied verbatim from exchange-token.js so the stored ciphertext
// format (iv + authTag + ciphertext, base64) is identical and n8n can decrypt it.
function encryptToken(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
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

async function plaidPost(path, body) {
  const res = await fetch(`${plaidBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: plaidSecret(),
      ...body,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

module.exports = async function handler(req, res) {
  // ── Guard 1: sandbox only, fail-closed ────────────────────────
  if (process.env.PLAID_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled: PLAID_ENV is production. Sandbox-only endpoint.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — POST only' });
  }

  // ── Guard 2: shared-secret token gate, fail-closed ────────────
  const expected = process.env.SANDBOX_FIRE_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'Endpoint disabled: SANDBOX_FIRE_TOKEN not set' });
  }
  const provided = req.headers['x-sandbox-token'];
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Env preflight ─────────────────────────────────────────────
  const missing = [];
  if (!process.env.PLAID_CLIENT_ID) missing.push('PLAID_CLIENT_ID');
  if (!plaidSecret()) missing.push('PLAID_SECRET_SANDBOX');
  if (!process.env.MEMBER_TOKEN_ENCRYPTION_KEY) missing.push('MEMBER_TOKEN_ENCRYPTION_KEY');
  if (!process.env.SUPABASE_PROJECT_URL) missing.push('SUPABASE_PROJECT_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.PLAID_WEBHOOK_URL) missing.push('PLAID_WEBHOOK_URL');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing env vars', missing });
  }

  try {
    // ── 1. Create sandbox Item, register OUR webhook on it ──────
    const create = await plaidPost('/sandbox/public_token/create', {
      institution_id: INSTITUTION_ID,
      initial_products: ['transactions'],
      options: { webhook: process.env.PLAID_WEBHOOK_URL },
    });
    if (!create.ok) {
      return res.status(502).json({ step: 'public_token/create', plaid_error: create.data });
    }
    const publicToken = create.data.public_token;

    // ── 2. Exchange for access_token ────────────────────────────
    const exch = await plaidPost('/item/public_token/exchange', { public_token: publicToken });
    if (!exch.ok) {
      return res.status(502).json({ step: 'public_token/exchange', plaid_error: exch.data });
    }
    const accessToken = exch.data.access_token;
    const itemId = exch.data.item_id;

    // ── 3. Fetch accounts ───────────────────────────────────────
    const acctRes = await plaidPost('/accounts/get', { access_token: accessToken });
    if (!acctRes.ok) {
      return res.status(502).json({ step: 'accounts/get', plaid_error: acctRes.data });
    }
    const accounts = acctRes.data.accounts || [];
    const institutionName = (acctRes.data.item && acctRes.data.item.institution_id) || null;

    // ── 4. Encrypt + store (parent connected_accounts first) ────
    const encrypted = encryptToken(accessToken, process.env.MEMBER_TOKEN_ENCRYPTION_KEY);

    const accountRows = accounts.map(acct => ({
      member_id: MEMBER_ID,
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

    await supabaseInsert('plaid_tokens', [{
      member_id: MEMBER_ID,
      plaid_item_id: itemId,
      access_token_encrypted: encrypted,
    }]);

    // ── 5. Fire the TRANSACTIONS webhook at OUR endpoint ────────
    const fire = await plaidPost('/sandbox/item/fire_webhook', {
      access_token: accessToken,
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'DEFAULT_UPDATE',
    });
    if (!fire.ok) {
      return res.status(502).json({ step: 'fire_webhook', plaid_error: fire.data, item_id: itemId });
    }

    console.log(`[sandbox-fire] item=${itemId} accounts=${accounts.length} webhook_fired=${!!fire.data.webhook_fired}`);

    return res.status(200).json({
      ok: true,
      item_id: itemId,
      accounts_connected: accounts.length,
      webhook_fired: !!fire.data.webhook_fired,
      note: 'Webhook fired at PLAID_WEBHOOK_URL. Watch n8n WF-10 executions and Supabase.',
    });
  } catch (err) {
    console.error('[sandbox-fire] Error:', err.message);
    return res.status(500).json({ error: 'sandbox-fire failed', detail: err.message });
  }
};
