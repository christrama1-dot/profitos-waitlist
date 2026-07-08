/**
 * api/dashboard-data.js — the SERVER-SIDE GATE for the Founder dashboard (#42)
 *
 * GET /api/dashboard-data
 *   - No valid session cookie  -> 401 (this is the real gate; the browser
 *     cannot forge a session without SESSION_SECRET).
 *   - Valid session            -> 200 with the authenticated dashboard payload.
 *
 * ARCHITECTURE NOTE (the whole point of #42): sensitive dashboard content must
 * be delivered by THIS endpoint, never embedded in the static dashboard.html.
 * The old design shipped everything to the browser and "hid" it with a
 * client-side hash — bypassable in devtools. Any real findings/points/member
 * data added later goes in the payload below (read from Supabase via the
 * service role, server-side only — never a Supabase key in the browser, RLS
 * Path B per the brief). Today that data surface is not built yet, so the
 * payload is intentionally minimal — but the 200/401 gate is fully real.
 */
'use strict';
const auth = require('../lib/auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return res.status(500).json({ error: 'Auth not configured' });

  const session = auth.requireSession(req, secret);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  // Authenticated. Real findings/points/member data attaches here in future
  // (server-side Supabase service-role reads keyed on session.sub). Empty today.
  return res.status(200).json({
    ok: true,
    role: session.role || 'founder',
    sub: session.sub,
    session_expires: session.exp,
    findings: [],
    note: 'Authenticated. Findings/points surfaces are not built yet — this endpoint is the server-side gate they will flow through.',
    generated: new Date().toISOString()
  });
};
