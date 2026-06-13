// Clay enrichment via a Clay REST/webhook endpoint.
// Outputs: tech_stack_count, headcount_trend, intent_topics[], recent_events[].
// Clay tables are async by nature; this calls a synchronous-style webhook that
// is expected to return the enriched record (or an immediate acknowledgement).
// Timeout 25s (configurable). Never throws — returns an envelope.
import { config } from '../config.js';
import { request } from '../utils/http.js';
import { ok, unavailable } from './result.js';

const SOURCE = 'clay';

export async function enrichClay({ domain, email, businessName, industry }, log) {
  const started = Date.now();
  if (!config.clay.webhookUrl) {
    return unavailable(SOURCE, 'CLAY_WEBHOOK_URL not configured', { durationMs: 0 });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    // Clay webhooks accept either a bearer token or an x-clay-api-key header
    // depending on workspace config; send the key in both common forms.
    if (config.clay.apiKey) {
      headers.Authorization = `Bearer ${config.clay.apiKey}`;
      headers['x-clay-api-key'] = config.clay.apiKey;
    }

    const res = await request({
      label: 'clay.enrich',
      timeoutMs: config.clay.timeoutMs,
      method: 'POST',
      url: config.clay.webhookUrl,
      headers,
      data: { domain, email, business_name: businessName, industry },
    });

    if (res.status >= 300) {
      return unavailable(SOURCE, `HTTP ${res.status}`, { durationMs: Date.now() - started });
    }

    // A webhook that only acknowledges (202/empty) means data will land
    // asynchronously — we can't wait, so mark unavailable for this run.
    const body = res.data;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return unavailable(SOURCE, 'acknowledged but no synchronous data', { durationMs: Date.now() - started });
    }

    const record = body.data || body.record || body;
    const data = {
      tech_stack_count: numeric(record.tech_stack_count ?? record.technologies?.length),
      tech_stack: Array.isArray(record.technologies) ? record.technologies.filter(Boolean) : [],
      headcount_trend: record.headcount_trend ?? record.headcount_growth ?? null,
      intent_topics: arr(record.intent_topics ?? record.intent),
      recent_events: arr(record.recent_events ?? record.signals),
    };

    const anyData =
      data.tech_stack_count != null ||
      data.headcount_trend != null ||
      data.intent_topics.length > 0 ||
      data.recent_events.length > 0;
    if (!anyData) {
      return unavailable(SOURCE, 'no enrichment fields returned', { durationMs: Date.now() - started });
    }
    return ok(SOURCE, data, { durationMs: Date.now() - started });
  } catch (err) {
    log?.warn('clay enrichment failed', { error: err.message, timeout: Boolean(err.timeout) });
    return unavailable(SOURCE, err, { durationMs: Date.now() - started });
  }
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function arr(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
