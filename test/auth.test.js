/**
 * test/auth.test.js — local unit tests for the session-auth security core.
 * Run: node test/auth.test.js   (zero deps; Node 18+)
 * These verify the security-critical logic that cannot be end-to-end tested
 * without a live deploy: signing, forgery rejection, expiry, and access-code
 * hashing. A green run here does NOT mean the gate is live — see AUTH-42-NOTES.
 */
'use strict';
const assert = require('assert');
const auth = require('../lib/auth.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '  -> ' + e.message); }
}

const SECRET = 'a'.repeat(64); // 64-char test secret (>=32 required)

t('sign+verify roundtrip returns payload', () => {
  const tok = auth.signSession({ sub: 'founder', role: 'founder' }, SECRET, 3600);
  const p = auth.verifySession(tok, SECRET);
  assert(p && p.sub === 'founder' && p.role === 'founder', 'payload not returned');
  assert(typeof p.iat === 'number' && typeof p.exp === 'number', 'iat/exp missing');
});

t('tampered payload is rejected', () => {
  const tok = auth.signSession({ sub: 'founder', role: 'founder' }, SECRET, 3600);
  const parts = tok.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'founder', iat: 1, exp: 9999999999 })).toString('base64url');
  const forged = 'v1.' + forgedPayload + '.' + parts[2];
  assert.strictEqual(auth.verifySession(forged, SECRET), null, 'forged payload accepted!');
});

t('tampered signature is rejected', () => {
  const tok = auth.signSession({ sub: 'founder' }, SECRET, 3600);
  const parts = tok.split('.');
  const badSig = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.strictEqual(auth.verifySession('v1.' + parts[1] + '.' + badSig, SECRET), null, 'bad sig accepted!');
});

t('wrong secret is rejected', () => {
  const tok = auth.signSession({ sub: 'founder' }, SECRET, 3600);
  assert.strictEqual(auth.verifySession(tok, 'b'.repeat(64)), null, 'wrong-secret token accepted!');
});

t('expired token is rejected', () => {
  const tok = auth.signSession({ sub: 'founder' }, SECRET, -10); // already expired
  assert.strictEqual(auth.verifySession(tok, SECRET), null, 'expired token accepted!');
});

t('garbage / absent tokens return null (no throw)', () => {
  assert.strictEqual(auth.verifySession('', SECRET), null);
  assert.strictEqual(auth.verifySession(null, SECRET), null);
  assert.strictEqual(auth.verifySession('not.a.token', SECRET), null);
  assert.strictEqual(auth.verifySession('v1.only-two', SECRET), null);
  assert.strictEqual(auth.verifySession('v2.' + 'x.'.repeat(1), SECRET), null);
});

t('signSession throws on missing/short secret (fails closed)', () => {
  assert.throws(() => auth.signSession({ sub: 'x' }, '', 3600));
  assert.throws(() => auth.signSession({ sub: 'x' }, 'short', 3600));
});

t('access code hash: correct code verifies, wrong code fails', () => {
  const stored = auth.hashAccessCode('correct horse battery staple');
  assert(/^scrypt\$16384\$8\$1\$[0-9a-f]+\$[0-9a-f]+$/.test(stored), 'unexpected hash format: ' + stored);
  assert.strictEqual(auth.verifyAccessCode('correct horse battery staple', stored), true, 'correct code rejected');
  assert.strictEqual(auth.verifyAccessCode('wrong code', stored), false, 'wrong code accepted!');
  assert.strictEqual(auth.verifyAccessCode('', stored), false);
  assert.strictEqual(auth.verifyAccessCode('correct horse battery staple', 'garbage'), false);
});

t('cookie parse + serialize flags (httpOnly/Secure/SameSite=Strict)', () => {
  const c = auth.sessionCookie('TOKENVALUE', 3600);
  assert(c.includes('dash_session=TOKENVALUE'), 'name/value');
  assert(c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=Strict') && c.includes('Path=/'), 'flags missing: ' + c);
  assert(c.includes('Max-Age=3600'), 'max-age missing');
  const parsed = auth.parseCookies({ headers: { cookie: 'a=1; dash_session=XYZ; b=2' } });
  assert.strictEqual(parsed.dash_session, 'XYZ', 'cookie parse failed');
  assert(auth.clearCookie().includes('Max-Age=0'), 'clear cookie max-age');
});

t('requireSession end-to-end: valid cookie -> payload, none -> null', () => {
  const tok = auth.signSession({ sub: 'founder', role: 'founder' }, SECRET, 3600);
  const reqOk = { headers: { cookie: auth.COOKIE_NAME + '=' + encodeURIComponent(tok) } };
  const p = auth.requireSession(reqOk, SECRET);
  assert(p && p.role === 'founder', 'valid session not accepted');
  assert.strictEqual(auth.requireSession({ headers: {} }, SECRET), null, 'no-cookie accepted!');
  assert.strictEqual(auth.requireSession({ headers: { cookie: 'dash_session=forged' } }, SECRET), null, 'forged cookie accepted!');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
