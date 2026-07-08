/**
 * lib/auth.js — server-side session auth for the ProfitOS dashboard (#42)
 *
 * Zero external dependencies (Node core `crypto` only), matching the repo's
 * dependency-free serverless style. NOT a Vercel route — lives outside /api so
 * it is never exposed as an endpoint; imported by api/login, api/logout,
 * api/dashboard-data.
 *
 * Model (per workflows/CLAUDE-CODE-BRIEF-42-82-2026-07-07.md):
 *   - Login verifies a secret access code server-side (scrypt hash in an env
 *     var) and issues an httpOnly, Secure, SameSite=Strict signed session
 *     cookie. No secret ever travels in a URL; no token in localStorage.
 *   - Protected endpoints call requireSession(req); no valid cookie => 401.
 *   - Session token is an HMAC-SHA256 signed, expiring payload. The browser
 *     cannot forge one without SESSION_SECRET, which never leaves the server.
 *   - The payload carries `sub` + `role`. Today sub='founder'. The exact same
 *     machinery carries sub=<stripe_customer_id> when the per-member findings
 *     dashboard is built (brief scope 1, member identity) — no redesign needed.
 *
 * Required env vars (set in Vercel — Founder-gated, see AUTH-42-NOTES.md):
 *   SESSION_SECRET   — >=32 random bytes (hex). Signs/verifies sessions.
 *   DASH_ACCESS_HASH — scrypt hash of the Founder access code (format below).
 *                      Generated locally via tools/gen-dash-access-hash.js;
 *                      the plaintext code is NEVER stored in the repo or chat.
 */

'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'dash_session';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // 12h founder session

// ── base64url helpers (Node 16+ supports 'base64url') ─────────────────────
function b64uEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}
function b64uDecodeToString(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

// ── constant-time string compare over equal-length buffers ────────────────
function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(String(aHex), 'utf8');
  const b = Buffer.from(String(bHex), 'utf8');
  if (a.length !== b.length) return false; // length is not secret here
  return crypto.timingSafeEqual(a, b);
}

// ── SESSION TOKEN ─────────────────────────────────────────────────────────
// Format: "v1.<b64url(payloadJSON)>.<b64url(hmacSha256)>"
function _sign(signingInput, secret) {
  return crypto.createHmac('sha256', secret).update(signingInput).digest();
}

/**
 * Create a signed session token. Throws if SESSION_SECRET is missing so a
 * misconfigured server fails CLOSED (no unsigned/forgeable tokens).
 */
function signSession(payload, secret, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!secret || String(secret).length < 32) {
    throw new Error('SESSION_SECRET missing or too short (need >=32 chars)');
  }
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + ttlSeconds });
  const b64Payload = b64uEncode(JSON.stringify(body));
  const signingInput = 'v1.' + b64Payload;
  const sig = b64uEncode(_sign(signingInput, secret));
  return signingInput + '.' + sig;
}

/**
 * Verify a session token. Returns the payload object if the signature is valid
 * AND the token is not expired; otherwise returns null. Never throws on bad
 * input.
 */
function verifySession(token, secret) {
  try {
    if (!token || !secret) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const signingInput = 'v1.' + parts[1];
    const expectedSig = b64uEncode(_sign(signingInput, secret));
    if (!safeEqualHex(parts[2], expectedSig)) return null; // bad/forged signature
    const payload = JSON.parse(b64uDecodeToString(parts[1]));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || now >= payload.exp) return null; // expired
    return payload;
  } catch (_e) {
    return null;
  }
}

// ── ACCESS CODE HASHING (scrypt, Node core — no bcrypt/argon2 dep) ─────────
// Stored format: "scrypt$<N>$<r>$<p>$<saltHex>$<keyHex>"
// scrypt is a standardized, memory-hard KDF in Node core (OWASP-accepted).
// See AUTH-42-NOTES.md for the argon2id-vs-scrypt note (kept dependency-free).
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashAccessCode(code, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const key = crypto.scryptSync(String(code), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join('$');
}

function verifyAccessCode(code, stored) {
  try {
    if (!stored) return false;
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    const got = crypto.scryptSync(String(code), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    if (got.length !== expected.length) return false;
    return crypto.timingSafeEqual(got, expected);
  } catch (_e) {
    return false;
  }
}

// ── COOKIE HELPERS ────────────────────────────────────────────────────────
function parseCookies(req) {
  const header = (req && req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(token, ttlSeconds = DEFAULT_TTL_SECONDS) {
  return [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=' + ttlSeconds
  ].join('; ');
}

function clearCookie() {
  return [COOKIE_NAME + '=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=0'].join('; ');
}

/**
 * Read + verify the session from the request cookie. Returns the payload or
 * null. This is the single gate used by every protected endpoint.
 */
function requireSession(req, secret) {
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME], secret);
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  signSession,
  verifySession,
  hashAccessCode,
  verifyAccessCode,
  parseCookies,
  sessionCookie,
  clearCookie,
  requireSession
};
