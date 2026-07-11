# #42 — Dashboard server-side auth (implementation notes)

**Branch:** `feat/42-dashboard-server-auth` (NOT merged to main — no production deploy without Founder go, per the brief).
**Status:** code complete + security core unit-tested locally. Env vars set July 11, 2026. **NOT live, NOT end-to-end verified.** #42 stays OPEN.
**Brief:** `workflows/CLAUDE-CODE-BRIEF-42-82-2026-07-07.md` (in profitos-hq-claude).

**July 11, 2026 update:** Vercel 2FA lockout resolved (see hq_knowledge build-status). `SESSION_SECRET`, `DASH_ACCESS_HASH`, and `MEMBER_TOKEN_ENCRYPTION_KEY` (#64, separate item) all added to Vercel Production + Preview env vars. This commit triggers a fresh branch deploy so the new env vars actually take effect (Vercel does not hot-reload env vars into already-running deployments). Live end-to-end verification (section below) still needed before #42 can close.

## What changed (this branch)
- **Removed** dashboard.html's client-side SHA-256 gate (hardcoded hash + `sessionStorage.pa`). It was bypassable in devtools and shipped all content to the browser regardless.
- **Added** real server-side session auth (zero-dependency Node core, matching the repo style):
  - `lib/auth.js` — HMAC-SHA256 signed, expiring session tokens; scrypt access-code hashing; httpOnly/Secure/SameSite=Strict cookie helpers; `requireSession()`.
  - `api/login.js` — POST `{code}` -> verifies against `DASH_ACCESS_HASH` (scrypt) -> sets the signed session cookie. Per-IP rate limit via Vercel KV. Generic 401; never logs the code.
  - `api/dashboard-data.js` — the real gate: no valid session cookie -> **401**; valid -> 200 with the authenticated payload. All future sensitive dashboard data flows through here (server-side Supabase service-role reads keyed on `session.sub`; RLS Path B — no Supabase key in the browser).
  - `api/logout.js` — clears the cookie.
  - `dashboard.html` — renders nothing until `/api/dashboard-data` returns 200; shows a login form (posts the code to the server) on 401. No code/hash/secret in the client.
  - `tools/gen-dash-access-hash.js` — Founder generates `DASH_ACCESS_HASH` locally (code never touches repo/chat).
  - `test/auth.test.js` (10 unit tests) + `test/handlers.smoke.js` (6 in-process route tests). Run: `node test/auth.test.js && node test/handlers.smoke.js`.

## Threat-model delta
- Old: content in static HTML, "hidden" by a client hash -> **any visitor reads it via devtools / `sessionStorage.setItem('pa','1')`.**
- New: the browser holds only an httpOnly signed cookie it cannot read or forge (no `SESSION_SECRET` client-side). Sensitive data comes only from an endpoint that returns 401 without a valid session. Session expires (12h). Login is rate-limited and the code is scrypt-hashed server-side.

## 🔒 REQUIRED to go live — Founder-gated, cannot be done from this session
1. ✅ **DONE July 11, 2026** — env vars added to Vercel (Production + Preview): `SESSION_SECRET` (Bitwarden `DASH_SESSION_SECRET`), `DASH_ACCESS_HASH` (Bitwarden `DASH_ACCESS_CODE` holds the plaintext code). `KV_REST_API_URL` / `KV_REST_API_TOKEN` already auto-set (Vercel KV enabled). If either of the first two were missing at runtime, login would fail closed (500 "Auth not configured") — never grants access on missing config.
2. **Deploy the branch** (preview) and **merge to main** only after live verification. No auto-deploy of auth to prod unverified.
3. **Live end-to-end verification** (must pass before #42 closes — this is the real gate, not the unit tests):
   - `curl -i https://<preview>/api/dashboard-data` -> **401** (no cookie).
   - `curl -i -X POST .../api/login -d '{"code":"WRONG"}' -H 'content-type: application/json'` -> **401**, no `Set-Cookie`.
   - Correct code -> **200 + Set-Cookie** (httpOnly/Secure/SameSite=Strict); reusing that cookie on `/api/dashboard-data` -> **200**.
   - Confirm devtools bypass is dead: `sessionStorage`/`localStorage` tricks and reading page source reveal **no dashboard data**.

## Founder decisions to confirm
- **Credential model:** dashboard.html is the single-admin **Founder** dashboard, so this implements a Founder **access-code** session (not per-member magic-link). The brief's per-member magic-link / Stripe-customer-ID model applies to the future **member findings dashboard**, a separate surface — the same `lib/auth.js` session carries `sub=<stripe_customer_id>` there with no redesign. Confirm this scoping.
- **Password hashing:** used Node-core **scrypt** (memory-hard, OWASP-accepted, zero-dependency) rather than argon2id/bcrypt, to avoid adding an npm build step to the currently static site. Say the word if you want argon2id (adds a dependency + build).
- **Login-page copy** is unchanged wording from the old gate ("Founder Dashboard - Private", "Access code", "Access Dashboard") — filed for approval per the brief; nothing new/marketing.

## Explicitly NOT done this session
- Not deployed, not live, not end-to-end verified (Founder-gated above). **#42 NOT closed.**
- `api/flag-feedback.js` still accepts anonymous POSTs (it's a write, not a findings read) — deferred; decide whether to session-gate it.
- **#82 Playwright suite** (brief Scope 2, including the auth regression test that would automate the verification above) — separate scope, not built this session.
