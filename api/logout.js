/**
 * api/logout.js — clears the Founder dashboard session cookie.
 * POST /api/logout  -> 200, Set-Cookie expiring the session immediately.
 */
'use strict';
const auth = require('../lib/auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', auth.clearCookie());
  return res.status(200).json({ ok: true });
};
