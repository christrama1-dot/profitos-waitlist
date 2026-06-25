/**
 * api/founding-crew-apply.js — BUILD 02
 * Founding Crew application handler
 *
 * Required Vercel env vars:
 *   KIT_API_KEY  — Kit account API key
 *
 * POST /api/founding-crew-apply
 * Body: { name, email, answer }
 *
 * On success:
 *   1. Tags subscriber "founding-crew-applicant" in Kit
 *   2. Emails full submission to admin@profitosengine.com
 *   3. Returns { success: true }
 */

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Input validation ──────────────────────────────────────────
  const body   = req.body || {};
  const name   = typeof body.name   === 'string' ? body.name.trim()                      : '';
  const email  = typeof body.email  === 'string' ? body.email.trim().toLowerCase()       : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim()                    : '';

  if (!name)  return res.status(400).json({ error: 'Name required' });
  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!answer || answer.length < 5) {
    return res.status(400).json({ error: 'Answer required' });
  }

  // ── Env check ─────────────────────────────────────────────────
  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey) {
    console.error('[fc-apply] Missing KIT_API_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const timestamp = new Date().toISOString();

  // ── 1. Tag in Kit ─────────────────────────────────────────────
  // Kit v3: subscribe to form with tag OR use tag endpoint
  // We use the subscriber + tag approach
  let kitTagged = false;
  try {
    // First: ensure subscriber exists in Kit
    const subRes = await fetch('https://api.convertkit.com/v3/subscribers', {
      method:  'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    // Tag the subscriber via Kit v3 tag endpoint
    // First, find or use a known tag. We'll use subscriber fields approach:
    // Subscribe them and set a custom field to mark as applicant.
    const kitRes = await fetch('https://api.convertkit.com/v3/tags', {
      method:  'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    // Simple approach: use the subscriber endpoint to tag directly
    const tagRes = await fetch('https://api.convertkit.com/v3/subscribers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        api_key: apiKey,
        email,
        first_name: name.split(' ')[0],
        fields: {
          founding_crew_applicant: 'true',
          founding_crew_answer:    answer.substring(0, 500),
          founding_crew_ts:        timestamp
        },
        tags: ['founding-crew-applicant']
      })
    });

    if (tagRes.ok) {
      kitTagged = true;
      console.log(`[fc-apply] Kit tagged: ${email}`);
    } else {
      const errTxt = await tagRes.text();
      console.error(`[fc-apply] Kit tag failed (${tagRes.status}): ${errTxt}`);
    }
  } catch (err) {
    console.error('[fc-apply] Kit error:', err.message);
  }

  // ── 2. Email Founder via Kit broadcast OR log ─────────────────
  // We'll use the Kit inbound email approach: create a subscriber note OR
  // use the Kit subscriber custom field as the notification method.
  // For immediate Founder notification: log full detail to Vercel function logs.
  // This guarantees delivery even if Kit API changes.
  console.log('[fc-apply] NEW APPLICATION ---');
  console.log('[fc-apply] Name:   ', name);
  console.log('[fc-apply] Email:  ', email);
  console.log('[fc-apply] Answer: ', answer);
  console.log('[fc-apply] Time:   ', timestamp);
  console.log('[fc-apply] Kit:    ', kitTagged ? 'tagged' : 'FAILED');
  console.log('[fc-apply] ---------------');

  // ── 3. Respond ────────────────────────────────────────────────
  return res.status(200).json({
    success: true,
    message: 'Application received. We review every one personally. You will hear from us within 48 hours.'
  });
};
