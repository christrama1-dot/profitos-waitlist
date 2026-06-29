/**
 * api/founding-crew-apply.js — BUILD 02 (v2 — June 28, 2026)
 * Founding Crew application handler
 *
 * POST /api/founding-crew-apply
 * Body: { name, email, answer }
 *
 * Flow:
 *   1. Validate input
 *   2. Forward to n8n WF-FC-01 webhook
 *      → n8n handles: Kit tag (20710414), Google Sheets, Founder email, Slack
 *   3. Return 200 to user regardless of n8n status (n8n retries internally)
 *
 * No Vercel env vars required — n8n webhook URL is non-sensitive.
 */

const N8N_FC_WEBHOOK = 'https://profitos.app.n8n.cloud/webhook/founding-crew-apply';

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Input validation ──────────────────────────────────────────
  const body   = req.body || {};
  const name   = typeof body.name   === 'string' ? body.name.trim()                : '';
  const email  = typeof body.email  === 'string' ? body.email.trim().toLowerCase() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim()              : '';

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Name required' });
  }
  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!answer || answer.length < 10) {
    return res.status(400).json({ error: 'Answer required (min 10 chars)' });
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

  // Always log locally as backup audit trail
  console.log('[fc-apply] Application received:', {
    name, email, timestamp, n8nForwarded: n8nSuccess
  });

  // Always return 200 — never block user on n8n status
  return res.status(200).json({
    success: true,
    message: 'Application received. We review every one personally. You will hear from us within 48 hours.'
  });
};
