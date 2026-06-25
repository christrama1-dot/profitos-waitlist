/**
 * api/flag-feedback.js — BUILD 05
 * Receives Flag This feedback from dashboard.html
 *
 * POST /api/flag-feedback
 * Body: { rating, task, stop, page }
 *
 * Logs to Vercel function logs (visible in Vercel dashboard → Functions tab).
 * No external API keys required.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const body   = req.body || {};
  const rating = typeof body.rating === 'number' ? body.rating : 0;
  const task   = typeof body.task   === 'string' ? body.task.trim().substring(0, 1000)   : '';
  const stop   = typeof body.stop   === 'string' ? body.stop.trim().substring(0, 1000)   : '';
  const page   = typeof body.page   === 'string' ? body.page.trim().substring(0, 200)    : '';

  const stars = rating > 0 ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : 'not rated';

  console.log('[flag-feedback] ========= NEW FLAG =========');
  console.log('[flag-feedback] Rating:', stars, `(${rating}/5)`);
  console.log('[flag-feedback] Page:  ', page || '(not provided)');
  console.log('[flag-feedback] Task:  ', task || '(not provided)');
  console.log('[flag-feedback] Stop:  ', stop || '(not provided)');
  console.log('[flag-feedback] Time:  ', new Date().toISOString());
  console.log('[flag-feedback] =============================');

  return res.status(200).json({ success: true });
};
