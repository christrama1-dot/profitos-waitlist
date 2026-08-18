# Deploying the ProfitOS Audit Engine (WF-08)

This guide takes you from "merged code" to "live engine generating reports."
No prior DevOps experience needed. Plan on ~20–30 minutes.

There are three things to do, in order:

1. **Deploy** the engine to a host (Render — recommended)
2. **Add** your API keys as environment variables
3. **Wire** WF-06 (n8n) to the live URL

---

## Why not Vercel?

Your landing page is on Vercel, which is great for websites. But this engine is
a long-running server: it replies to WF-06 in under a second, then keeps working
for several minutes (enrichment, PDF, email). Vercel's serverless functions shut
down right after the reply, which would kill the report mid-generation. So the
engine needs an **always-on host**. Render is the easiest one that fits.

---

## Step 1 — Deploy to Render

1. Go to **<https://render.com>** and sign up (you can log in with GitHub).
2. Click **New → Blueprint**.
3. Connect your GitHub and pick the **`profitos-waitlist`** repository.
4. Render automatically finds the [`render.yaml`](../render.yaml) file in the
   repo and shows a service called **`profitos-audit-engine`**. Click **Apply**.
5. Render builds the engine (this uses the `engine/Dockerfile` and takes a few
   minutes the first time — it's installing Chromium for the PDF renderer).
6. When it finishes you'll get a public URL like
   **`https://profitos-audit-engine.onrender.com`**. Copy it.

> ✅ **Quick test:** open `https://YOUR-URL/health` in a browser. You should see
> `{"ok":true,"service":"profitos-audit-engine",...}`. That means it's live.

At this point the engine runs but skips every integration (no keys yet). That's
expected — on to Step 2.

> **Alternative host (Railway):** the steps are nearly identical — New Project →
> Deploy from GitHub → set **Root Directory** to `engine` → it auto-detects the
> Dockerfile. Then add the same environment variables from Step 2.

---

## Step 2 — Add your API keys (environment variables)

In Render, open your service → **Environment** tab. The `render.yaml` already
created the variable **names** for you; you just fill in the **values**. Click
each one marked "set value" and paste it in. Never put keys in the code.

Here's what each key is and where to get it:

| Variable | What it's for | Where to get it |
| --- | --- | --- |
| `WF06_AUDIT_SECRET` | Shared password between WF-06 and the engine. **Make one up** — any long random string. You'll paste the same value into n8n in Step 3. | Invent it (e.g. a password generator) |
| `APOLLO_API_KEY` | Company/people enrichment | Apollo.io → Settings → API |
| `LUSHA_API_KEY` | Contact phone/title/email status | Lusha → API settings |
| `SEMRUSH_API_KEY` | Traffic value, keyword gap, paid spend | Semrush → Subscription → API units |
| `CLAY_API_KEY` + `CLAY_WEBHOOK_URL` | Tech stack, intent, signals | Clay → your table's webhook |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` + `GDRIVE_REPORTS_FOLDER_ID` | Saves the PDF to Google Drive | Google Cloud service account (see below) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM_ADDRESS` | Emails the report to the submitter | Your email provider (Gmail SMTP, SendGrid, Postmark, etc.) |
| `KIT_API_KEY` + `KIT_AUDIT_COMPLETED_TAG_ID` | Tags the contact in Kit (ConvertKit) | Kit → Settings → Advanced → API; tag ID from the tag's URL |

**You don't need all of them to go live.** Any key you leave blank simply gets
skipped — the engine still produces and (if email is set) delivers a report.
The two highest-value to set first are **`WF06_AUDIT_SECRET`** (so WF-06 can
talk to it) and your **SMTP email** keys (so the report actually reaches people).

After saving, Render redeploys automatically.

<details>
<summary><b>Google Drive setup (optional, click to expand)</b></summary>

1. In Google Cloud Console, create a **service account** and download its JSON key.
2. Base64-encode the JSON file and paste the result into
   `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`:
   - Mac/Linux: `base64 -w0 key.json` (or `base64 key.json` on Mac)
3. Create/choose a Drive folder, **share it with the service account's email**
   (found inside the JSON, ends in `...gserviceaccount.com`), and put the
   folder's ID (from its URL) into `GDRIVE_REPORTS_FOLDER_ID`.

</details>

---

## Step 3 — Wire WF-06 (n8n) to the engine

In your WF-06 workflow, the final step hands the audit off to the engine.
Point it at your live URL:

- **Method:** `POST`
- **URL:** `https://YOUR-RENDER-URL/api/audit`
- **Headers:**
  - `Content-Type: application/json`
  - `X-ProfitOS-Source: wf06-audit-handler`
  - `X-ProfitOS-Audit-Secret:` → the **exact same value** you set for
    `WF06_AUDIT_SECRET` in Step 2
- **Body (JSON):**
  ```json
  {
    "business_name": "{{ $json.business_name }}",
    "email": "{{ $json.email }}",
    "industry": "{{ $json.industry }}",
    "revenue_range": "{{ $json.revenue_range }}",
    "business_type": "{{ $json.business_type }}",
    "years_in_business": "{{ $json.years_in_business }}",
    "employee_count": "{{ $json.employee_count }}",
    "primary_concern": "{{ $json.primary_concern }}",
    "submitted_at": "{{ $json.submitted_at }}",
    "source": "audit-submit-wf06"
  }
  ```

The engine replies **`202 Accepted`** in under a second, so WF-06 won't hang —
the report is built and delivered in the background.

---

## How to know it's working

- `GET /health` returns `{"ok":true,...}` → server is up.
- Submit a real audit through WF-06 → within ~5 minutes the submitter gets an
  email with the PDF (and a Drive link if Drive is configured).
- Watch **Render → Logs**. Each run logs `audit pipeline started` →
  `scoring complete` → `audit pipeline complete` with a total duration and which
  data sources came back live vs. unavailable.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| WF-06 gets `401` | The `X-ProfitOS-Audit-Secret` header doesn't match `WF06_AUDIT_SECRET`. Make them identical. |
| WF-06 gets `422` | A required field is missing/empty (`business_name`, `email`, `industry`, `revenue_range`). |
| No email arrives | SMTP keys missing or wrong. Check Render logs for `email delivery failed`. The PDF is still generated and saved. |
| Report shows estimated figures | Some enrichment keys are blank, so the engine fell back to industry benchmarks (by design). Add the keys to sharpen the numbers. |
| Service sleeps / first request slow | Render's free tier idles after inactivity. The `starter` plan in `render.yaml` avoids this and has the memory headroom Chromium needs. |
| PDF fails on a tiny instance | Headless Chromium needs memory. The engine auto-falls back to the lighter `pdfkit` renderer, so you still get a PDF — but `starter` or larger is recommended. |

---

That's it. Once Step 1–3 are done, every WF-06 submission turns into a
dollar-figure profit-leak report in the submitter's inbox, automatically.
