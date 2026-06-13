# ProfitOS Audit Engine — WF-08

The core computation engine of ProfitOS Engine. It receives a validated audit
payload from **WF-06 (n8n)**, enriches it in parallel across four data
providers, scores eight categories of profit leak, calculates a dollar-figure
leak report, renders a branded PDF, and delivers it to the submitter — targeting
**under 5 minutes** end-to-end.

> **Classification:** Proprietary IP. This is the scoring/computation core and
> is designed to live in a private repository — **never in n8n**.

---

## Flow

```
WF-06 (n8n) ──POST /api/audit──▶ WF-08 API (Express)
                                   │  202 Accepted (immediate, fire-and-forget)
                                   ▼
        ┌─ Parallel enrichment (Promise.allSettled, ~90s budget) ─┐
        │   Apollo.io · Lusha · Semrush · Clay                    │
        └────────────────────────┬───────────────────────────────┘
                                  ▼
                       Data normalization (canonical audit object)
                                  ▼
                       Profit-leak scoring (8 categories × 0–3)
                                  ▼
                       Dollar-figure leak calculation
                                  ▼
                       Report assembly  ▶  PDF (Puppeteer → pdfkit fallback)
                                  ▼
              ┌────────────┬──────────────┬─────────────────┐
              ▼            ▼              ▼                 ▼
        Google Drive   Email to       Kit (ConvertKit)   (all fault-tolerant,
          upload       submitter      audit-completed     run concurrently)
                                      tag callback
```

Every stage past enrichment is independently fault-tolerant: a failure in one
side-effect (e.g. Drive down) never blocks the others. The engine is built to
**always deliver something**.

---

## Endpoints

### `POST /api/audit`

Handoff from WF-06.

**Headers**

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-ProfitOS-Source` | `wf06-audit-handler` (advisory) |
| `X-ProfitOS-Audit-Secret` | shared secret, must equal `WF06_AUDIT_SECRET` |

**Body**

```json
{
  "business_name": "Acme Widgets",
  "email": "owner@acme.com",
  "industry": "Manufacturing",
  "revenue_range": "$1M-$5M",
  "business_type": "B2B",
  "years_in_business": "8",
  "employee_count": "11-50",
  "primary_concern": "We keep losing deals at the quote stage",
  "submitted_at": "2026-06-13T21:00:00.000Z",
  "source": "audit-submit-wf06"
}
```

Required: `business_name`, `email` (validated), `industry`, `revenue_range`.
All others optional.

**Responses**

| Status | Meaning |
| --- | --- |
| `202 Accepted` | Payload valid; report is being generated fire-and-forget. Returns `{ runId }`. |
| `401 Unauthorized` | Missing/invalid `X-ProfitOS-Audit-Secret`. |
| `422 Unprocessable Entity` | Validation errors (returned in `errors[]`). |
| `400 Bad Request` | Malformed JSON. |

### `GET /health`

Liveness/readiness probe.

---

## The 8 profit-leak categories

Each is scored **0–3** (0 = healthy, 3 = severe). Dollar leak per category =
`revenueBasis × maxLeakRate × (score / 3)`. The summed total is capped at 32%
of revenue so the headline figure stays credible.

| Category | Max leak rate | Primary signals used |
| --- | --- | --- |
| Pricing & Margin Leakage | 6% | revenue/employee vs benchmark |
| Demand Generation & Lead Flow | 5% | organic traffic, keyword gap |
| Sales Conversion Efficiency | 7% | intent signals, primary concern |
| Marketing & Paid-Spend Waste | 4% | paid spend vs organic value |
| Customer Retention & Churn | 8% | headcount trend, benchmarks |
| Operational & Tech-Stack Inefficiency | 3% | tech-stack count |
| Cash Flow & Receivables | 4% | industry DSO benchmark |
| Team Productivity & Labor Cost | 5% | revenue/employee vs benchmark |

The submitter's `primary_concern` lifts the matching category's severity and
confidence — they usually know where it hurts. When firmographic enrichment is
thin, each category degrades to defensible industry benchmarks at reduced
confidence rather than failing.

---

## Configuration

All secrets are read from the environment — **never hard-coded**. Copy
[`.env.example`](./.env.example) to `.env` and fill it in. The engine starts and
runs even with integrations unconfigured: each missing provider is logged as a
warning and that data source is simply marked unavailable.

Key groups: inbound auth (`WF06_AUDIT_SECRET`), the four enrichment providers
(Apollo / Lusha / Semrush / Clay), Google Drive (service account), SMTP email,
and Kit (ConvertKit). See `.env.example` for the full list.

---

## Running

```bash
npm install            # use PUPPETEER_SKIP_DOWNLOAD=true to skip Chromium
npm start              # production
npm run dev            # watch mode
npm test               # unit tests (parsing, scoring, normalization, assembly)
npm run smoke          # offline end-to-end pipeline test (uses pdfkit fallback)
```

### PDF rendering

Puppeteer is preferred (renders the branded HTML template). In constrained
environments without a headless browser, set `PDF_RENDERER=pdfkit` (or rely on
the automatic fallback) to render the same data without Chromium.

---

## Project layout

```
src/
  server.js              Express app, /api/audit (202 fire-and-forget)
  config.js              env-driven config + startup warnings
  middleware/validate.js inbound auth + payload validation
  enrichment/            apollo · lusha · semrush · clay + parallel index
  normalize/             canonical audit object
  scoring/               categories · benchmarks · engine (dollar calc)
  report/                assembler · template (HTML) · pdf (puppeteer/pdfkit)
  delivery/              drive · email · kit
  pipeline/orchestrator  ties the whole flow together
  utils/                 logger · http (timeouts) · parse
test/                    unit tests + offline smoke test
```

---

## Design guarantees

- **Non-blocking:** WF-06 gets `202` immediately; the report is produced async.
- **No single point of failure:** enrichment uses `Promise.allSettled` with
  per-provider timeouts and an overall ~90s deadline; delivery side-effects are
  each independently fault-tolerant.
- **Always a number:** revenue and every category fall back to benchmarks so the
  report never renders `$0` or crashes on missing data.
- **Secret-safe:** every credential is an env reference; `.env` is gitignored.
