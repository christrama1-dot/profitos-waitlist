/**
 * api/subscribe.js
 * Vercel serverless function — Kit (ConvertKit) waitlist subscription proxy
 *
 * Required Vercel environment variables (set in Vercel dashboard):
 *   KIT_API_KEY  — API key from Kit account (Settings > Advanced > API Key)
 *   KIT_FORM_ID  — Kit form ID or embed UID (numeric ID or alphanumeric data-uid)
 *
 * Endpoint: POST /api/subscribe
 * Body:     { "email": "user@example.com" }
 * Returns:  { "success": true } on success
 */

/**
 * Resolves an alphanumeric form UID (e.g. 'b7ca7a165b') to its numeric Kit form ID.
 * Kit v3 API does not return a uid field directly — the UID appears inside
 * the embed_js and embed_url URLs for each form. We match on that.
 * Skipped automatically when KIT_FORM_ID is already numeric.
 */
async function resolveFormId(apiKey, formUid) {
  const listRes = await fetch(
    `https://api.convertkit.com/v3/forms?api_key=${encodeURIComponent(apiKey)}`
  );
  if (!listRes.ok) {
    throw new Error(`Kit forms list request failed: ${listRes.status}`);
  }
  const data = await listRes.json();
  const forms = data.forms || [];

  console.log(`[subscribe] Kit returned ${forms.length} form(s) for UID lookup`);

  const match = forms.find(f => {
    // Direct uid field (Kit v4 / future proofing)
    if (f.uid && f.uid === formUid) return true;
    // Numeric ID string match
    if (String(f.id) === formUid) return true;
    // UID embedded in embed_js URL: https://profitos.kit.com/{uid}/index.js
    if (f.embed_js && f.embed_js.includes(formUid)) return true;
    // UID embedded in embed_url
    if (f.embed_url && f.embed_url.includes(formUid)) return true;
    return false;
  });

  if (!match) {
    const ids = forms.map(f => `${f.id}:${f.name}`).join(', ');
    throw new Error(`No Kit form matched UID "${formUid}". Available: ${ids}`);
  }

  console.log(`[subscribe] Resolved UID ${formUid} → form ID ${match.id} (${match.name})`);
  return String(match.id);
}

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
  let   formId = process.env.KIT_FORM_ID;

  if (!apiKey || !formId) {
    console.error('[subscribe] Missing KIT_API_KEY or KIT_FORM_ID env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Resolve UID → numeric ID if needed ───────────────────────
  try {
    if (!/^\d+$/.test(formId)) {
      formId = await resolveFormId(apiKey, formId);
    }
  } catch (err) {
    console.error('[subscribe] Form ID resolution failed:', err.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Kit (ConvertKit) API subscribe call ───────────────────────
  // Docs: https://developers.kit.com/v3#subscribe-to-a-form
  // API key goes in the request body (Kit v3 — not Authorization header)
  try {
    const kitRes = await fetch(
      `https://api.convertkit.com/v3/forms/${formId}/subscribe`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: apiKey, email: email })
      }
    );

    // Kit returns 200 for both new and existing subscribers
    if (kitRes.ok) {
      return res.status(200).json({ success: true });
    }

    const errBody = await kitRes.text();
    console.error('[subscribe] Kit API error', kitRes.status, errBody);
    return res.status(502).json({ error: 'Subscription service error' });

  } catch (err) {
    console.error('[subscribe] Fetch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
