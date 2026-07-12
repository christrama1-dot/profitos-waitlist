# Tester Zero — automated e2e suite (#82, layer 1)

Internal test tooling for `profitos-waitlist`. Deterministic pipe/screen checks
only — it tests that pages load, links resolve, forms are wired, brand invariants
hold, the price disclosure matches an approved amount, and (on a real deploy) the
#42 dashboard auth gate holds. **It never judges value-of-findings, never submits
to a real backend, and contains no user testimonials or persona language.** Not
deployed (excluded via `../.vercelignore`).

## Run locally
```bash
cd tests
npm install
npx playwright install chromium
npm test            # serves the repo root statically on :8080 and runs the suite
```

## Target a real deployment (activates the #42 auth tests)
```bash
BASE_URL=https://<preview-url> npx playwright test
```
By default the suite runs against a local static server of the repo (`..`). Under a
static server the `/api/*` serverless functions don't run, so the auth tests
feature-detect `/api/dashboard-data` and **skip** (this keeps `main` green until the
#42 branch is merged/deployed). Point `BASE_URL` at the #42 preview to exercise them.

## What it covers
- `pages.spec.js` — all 9 V2 pages 200 + titled + no real console errors.
- `nav.spec.js` — every internal `.html` link resolves (no 404 / orphan regressions).
- `brand.spec.js` — no "fraud detection", no "AI agents", support@ is the only public email.
- `waitlist.spec.js` — form renders + posts to `/api/subscribe` (intercepted & aborted, never submitted).
- `price.spec.js` — beta disclosure equals one approved amount ($15 today → $29 after #83); logs which.
- `auth.spec.js` — #42 gate: `/api/dashboard-data` 401 + dashboard content hidden without a session (skips where auth isn't deployed).
- `mobile.spec.js` — no horizontal overflow at 390px / 768px.

## CI
`.github/workflows/tester-zero.yml` runs on every push/PR + manual dispatch. Failures block merge. (If the file is absent, the integration that opened the branch lacked GitHub 'workflows' permission — add it from `tests/tester-zero.ci.yml` or the PR body.)
