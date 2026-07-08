/**
 * test/handlers.smoke.js — in-process end-to-end smoke of the auth ROUTES.
 * Exercises api/login + api/dashboard-data with mocked req/res and test env.
 * (KV absent -> rate limiter degrades to allow, which is fine for this smoke.)
 * Run: node test/handlers.smoke.js
 */
'use strict';
const assert = require('assert');
const auth = require('../lib/auth.js');

// test env
process.env.SESSION_SECRET = 'z'.repeat(48);
process.env.DASH_ACCESS_HASH = auth.hashAccessCode('unit-test-access-code-123');

const login = require('../api/login.js');
const dash = require('../api/dashboard-data.js');

function mkRes() {
  return {
    _status: 0, _json: null, _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; }
  };
}
function mkReq(method, body, cookie) {
  return { method, body: body || {}, headers: Object.assign({ 'x-forwarded-for': '203.0.113.9' }, cookie ? { cookie } : {}) };
}

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); } }

(async function () {
  await t('login wrong code -> 401, no Set-Cookie', async () => {
    const res = mkRes();
    await login(mkReq('POST', { code: 'WRONG' }), res);
    assert.strictEqual(res._status, 401);
    assert(!res._headers['set-cookie'], 'must not set a cookie on failure');
  });

  let goodCookie = null;
  await t('login correct code -> 200 + httpOnly Secure SameSite cookie', async () => {
    const res = mkRes();
    await login(mkReq('POST', { code: 'unit-test-access-code-123' }), res);
    assert.strictEqual(res._status, 200);
    const sc = res._headers['set-cookie'];
    assert(sc && /dash_session=/.test(sc), 'no session cookie');
    assert(/HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Strict/.test(sc), 'cookie flags: ' + sc);
    goodCookie = sc.split(';')[0]; // "dash_session=<token>"
  });

  await t('dashboard-data with NO cookie -> 401', async () => {
    const res = mkRes();
    await dash(mkReq('GET'), res);
    assert.strictEqual(res._status, 401);
  });

  await t('dashboard-data with forged cookie -> 401', async () => {
    const res = mkRes();
    await dash(mkReq('GET', {}, 'dash_session=v1.forged.forged'), res);
    assert.strictEqual(res._status, 401);
  });

  await t('dashboard-data with valid session cookie -> 200 authed', async () => {
    const res = mkRes();
    await dash(mkReq('GET', {}, goodCookie), res);
    assert.strictEqual(res._status, 200);
    assert(res._json && res._json.ok === true && res._json.role === 'founder', 'payload: ' + JSON.stringify(res._json));
  });

  await t('login missing env -> 500 fail-closed', async () => {
    const saved = process.env.DASH_ACCESS_HASH; delete process.env.DASH_ACCESS_HASH;
    const res = mkRes();
    await login(mkReq('POST', { code: 'unit-test-access-code-123' }), res);
    process.env.DASH_ACCESS_HASH = saved;
    assert.strictEqual(res._status, 500);
    assert(!res._headers['set-cookie'], 'must not grant access when misconfigured');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
