// Semrush enrichment: domain overview + keyword data.
// Outputs: traffic_value_monthly, keyword_gap_count, paid_spend_estimate_monthly.
// The Semrush Analytics API returns semicolon-delimited CSV, not JSON.
// Timeout 20s (configurable). Never throws — returns an envelope.
import { config } from '../config.js';
import { request } from '../utils/http.js';
import { ok, unavailable } from './result.js';

const SOURCE = 'semrush';

export async function enrichSemrush({ domain }, log) {
  const started = Date.now();
  if (!config.semrush.apiKey) {
    return unavailable(SOURCE, 'SEMRUSH_API_KEY not configured', { durationMs: 0 });
  }
  if (!domain) {
    return unavailable(SOURCE, 'no domain to analyze', { durationMs: 0 });
  }

  try {
    const overviewRes = await request({
      label: 'semrush.domain_ranks',
      timeoutMs: config.semrush.timeoutMs,
      method: 'GET',
      url: `${config.semrush.baseUrl}/`,
      params: {
        type: 'domain_ranks',
        key: config.semrush.apiKey,
        domain,
        database: config.semrush.database,
        export_columns: 'Dn,Rk,Or,Ot,Oc,Ad,At,Ac',
      },
      responseType: 'text',
    });

    if (overviewRes.status >= 300 || isApiError(overviewRes.data)) {
      return unavailable(SOURCE, `overview error: ${truncate(overviewRes.data)}`, { durationMs: Date.now() - started });
    }

    const overview = parseCsv(overviewRes.data)[0] || {};

    const organicKeywords = numeric(overview.Or); // # organic keywords
    const organicTrafficCost = numeric(overview.Oc); // monthly organic traffic value (USD)
    const adwordsCost = numeric(overview.Ac); // monthly paid spend estimate (USD)

    const data = {
      traffic_value_monthly: organicTrafficCost,
      paid_spend_estimate_monthly: adwordsCost,
      organic_keywords: organicKeywords,
      organic_traffic_monthly: numeric(overview.Ot),
      paid_keywords: numeric(overview.Ad),
      // keyword_gap_count: opportunity proxy. Without a competitor set we
      // estimate untapped keywords as paid keywords the site doesn't rank
      // for organically; falls back to a fraction of organic footprint.
      keyword_gap_count: estimateKeywordGap(organicKeywords, numeric(overview.Ad)),
      rank: numeric(overview.Rk),
    };

    const anyData = [data.traffic_value_monthly, data.paid_spend_estimate_monthly, data.organic_keywords].some(
      (v) => v != null,
    );
    if (!anyData) {
      return unavailable(SOURCE, 'no domain data returned', { durationMs: Date.now() - started });
    }
    return ok(SOURCE, data, { durationMs: Date.now() - started });
  } catch (err) {
    log?.warn('semrush enrichment failed', { error: err.message, timeout: Boolean(err.timeout) });
    return unavailable(SOURCE, err, { durationMs: Date.now() - started });
  }
}

function isApiError(text) {
  return typeof text === 'string' && /^ERROR\b/i.test(text.trim());
}

function parseCsv(text) {
  if (typeof text !== 'string') return [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function estimateKeywordGap(organic, paid) {
  if (organic == null && paid == null) return null;
  const o = organic || 0;
  const p = paid || 0;
  // Rough opportunity proxy: paid terms not covered organically plus a slice
  // of the long-tail organic footprint that's under-optimized.
  return Math.round(p + o * 0.15);
}

function numeric(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function truncate(s) {
  return typeof s === 'string' ? s.slice(0, 120) : String(s);
}
