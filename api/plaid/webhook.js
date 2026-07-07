/**
 * api/plaid/webhook.js — WF-10 Phase 1
 * Receives Plaid TRANSACTIONS webhooks, verifies the signature using
 * Node's built-in crypto (no jsonwebtoken/jwk-to-pem packages — this
 * repo has zero npm dependencies today and that was deliberately kept),
 * then forwards the raw event to n8n's WF-10 webhook for processing.
 *
 * Plaid webhooks are registered to hit THIS endpoint (not n8n directly)
 * so a bad signature never reaches n8n at all.
 *
 * Required Vercel env vars:
 *   PLAID_CLIENT_ID, PLAID_SECRET_SANDBOX, PLAID_SECRET_PRODUCTION, PLAID_ENV
 *   N8N_WF10_WEBHOOK_URL — the live n8n webhook URL for WF-10
 *
 * POST /api/plaid/webhook
 *
 * STATUS: UNTESTED. Plaid's webhook signature verification is finicky —
 * confirm with a real Plaid sandbox webhook before trusting this in
 * production. If verification keeps failing, check Plaid's current docs
 * (plaid.com/docs/api/webhooks/#webhook-verification) rather than
 * assuming this code is wrong — Plaid has changed key formats before.
 * Requires Node 16+ for crypto.createPublicKey({format:'jwk'}) — Vercel's
 * default runtime is well past that, but confirm if this ever fails.
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

function base64UrlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// B4 fix (July 6): Vercel's default body parser consumes and re-serializes the
// request body, changing the bytes (key order/whitespace) so Plaid's
// request_body_sha256 check fails on real events. We disable the parser (see the
// config export at the bottom) and read the exact raw bytes off the stream here.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Cache verification keys by kid — they rotate rarely. Cold starts just re-fetch.
const keyCache = new Map();

async function getVerificationKey(kid) {
  if (keyCache.has(kid)) return keyCache.get(kid);

  const res = await fetch(`${plaidBaseUrl()}/webhook_verification_key/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: plaidSecret(),
      key_id: kid,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Plaid key fetch failed: ${JSON.stringify(data)}`);

  keyCache.set(kid, data.key);
  return data.key;
}

async function verifyPlaidWebhook(rawBody, signedJwt) {
  const parts = signedJwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed webhook JWT');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  if (header.alg !== 'ES256') throw new Error(`Unexpected alg: ${header.alg}`);

  const jwk = await getVerificationKey(header.kid);
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(sigB64);

  const verified = crypto.verify(
    'sha256',
    signingInput,
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    signature
  );
  if (!verified) throw new Error('Signature verification failed');

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));

  // Confirm body hash matches — prevents replay with a swapped payload.
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  if (bodyHash !== payload.request_body_sha256) {
    throw new Error('Webhook body hash mismatch');
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signedJwt = req.headers['plaid-verification'];
  if (!signedJwt) {
    console.error('[plaid-webhook] Missing Plaid-Verification header');
    return res.status(400).json({ error: 'Missing verification header' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[plaid-webhook] Failed to read raw body:', err.message);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  try {
    await verifyPlaidWebhook(rawBody, signedJwt);
  } catch (err) {
    console.error('[plaid-webhook] Verification failed:', err.message);
    return res.status(401).json({ error: 'Webhook verification failed' });
  }

  if (!process.env.N8N_WF10_WEBHOOK_URL) {
    console.error('[plaid-webhook] Missing N8N_WF10_WEBHOOK_URL — cannot forward');
    // Still 200 to Plaid so it doesn't retry-storm us; the miss gets caught
    // by not seeing any WF-10 executions in n8n.
    return res.status(200).json({ received: true, forwarded: false });
  }

  try {
    await fetch(process.env.N8N_WF10_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    });
  } catch (err) {
    console.error('[plaid-webhook] Forward to n8n failed:', err.message);
    // Still 200 — Plaid webhook already verified and logged; don't make
    // Plaid retry over a downstream n8n hiccup. Fix and replay manually.
  }

  return res.status(200).json({ received: true, forwarded: true });
};

// B4 fix (July 6): disable Vercel's body parser so we can read the exact raw
// bytes Plaid signed — JSON.stringify(req.body) does NOT reproduce them.
module.exports.config = { api: { bodyParser: false } };
