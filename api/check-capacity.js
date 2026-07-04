/**
 * api/check-capacity.js — BUILD 03
 * Charter Member cap check — silent, never displays count to user
 *
 * Required Vercel env vars:
 *   KIT_API_KEY — Kit account API key
 *
 * GET /api/check-capacity
 * Returns: { open: true } if < 100 charter members, { open: false } if capped
 *
 * Logic: counts Kit subscribers tagged "charter-member"
 * Cap: 100 (INTERNAL ONLY — never show count to user)
 *
 * Updated July 4, 2026: switched from "member-active" (counted every paid
 * member, any tier) to "charter-member" (Charter tier only). The 100-member
 * cap applies to Charter specifically, not to all active members — see
 * CLAUDE.md Section 2 and Founder To-Do #44. Done after WF-04 Task 2 was
 * live, tested, and Published, per plan.
 */

const CHARTER_CAP = 100;

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache response for 5 minutes — reduces Kit API calls
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey) {
    console.error('[check-capacity] Missing KIT_API_KEY');
    // Default open on misconfiguration — don't accidentally block signups
    return res.status(200).json({ open: true });
  }

  try {
    // Kit v3: fetch all subscribers with 'charter-member' tag
    // We only need the count — fetch page 1 with 1 result to get total_count
    const tagsRes = await fetch(
      `https://api.convertkit.com/v3/tags?api_key=${encodeURIComponent(apiKey)}`
    );

    if (!tagsRes.ok) {
      console.error('[check-capacity] Kit tags fetch failed:', tagsRes.status);
      return res.status(200).json({ open: true }); // default open on API error
    }

    const tagsData = await tagsRes.json();
    const tags     = tagsData.tags || [];
    const cmTag    = tags.find(t => t.name === 'charter-member');

    if (!cmTag) {
      // Tag doesn't exist yet — no charter members yet, definitely open
      console.log('[check-capacity] charter-member tag not found → open');
      return res.status(200).json({ open: true });
    }

    // Fetch subscribers for this tag — page 1, 1 per page to get total
    const subRes = await fetch(
      `https://api.convertkit.com/v3/tags/${cmTag.id}/subscriptions?api_key=${encodeURIComponent(apiKey)}&page=1&per_page=1`
    );

    if (!subRes.ok) {
      console.error('[check-capacity] Kit subscriptions fetch failed:', subRes.status);
      return res.status(200).json({ open: true });
    }

    const subData = await subRes.json();
    const count   = subData.total_subscriptions || 0;

    const open = count < CHARTER_CAP;
    console.log(`[check-capacity] charter-member count=${count} cap=${CHARTER_CAP} open=${open}`);

    return res.status(200).json({ open });

  } catch (err) {
    console.error('[check-capacity] Error:', err.message);
    return res.status(200).json({ open: true }); // default open on unexpected error
  }
};
