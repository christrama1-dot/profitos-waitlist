// Data normalization layer. Merges the raw WF-06 input with the four
// enrichment envelopes into a single canonical audit object. Enriched values
// take precedence over self-reported input where available; every derived
// field records its provenance so the report (and scoring) can be honest
// about confidence.
import {
  revenueRangeMidpoint,
  employeeCountMidpoint,
  yearsInBusiness,
} from '../utils/parse.js';

/**
 * @param {object} payload Inbound WF-06 payload.
 * @param {object} enrichment { results, domain } from runEnrichment().
 * @returns {object} Canonical audit object.
 */
export function normalize(payload, enrichment) {
  const { results, domain } = enrichment;
  const apollo = pick(results.apollo);
  const lusha = pick(results.lusha);
  const semrush = pick(results.semrush);
  const clay = pick(results.clay);

  // ---- Employee count: prefer Apollo, then self-reported input ----------
  let employeeCount = apollo.employee_count ?? null;
  let employeeSource = employeeCount != null ? 'apollo' : 'unavailable';
  if (employeeCount == null) {
    const fromInput = employeeCountMidpoint(payload.employee_count);
    if (fromInput != null) {
      employeeCount = fromInput;
      employeeSource = 'input';
    }
  }

  // ---- Revenue: prefer Apollo estimate, then input-range midpoint -------
  let revenueEstimate = apollo.estimated_annual_revenue ?? null;
  let revenueSource = revenueEstimate != null ? 'apollo' : 'unavailable';
  if (revenueEstimate == null) {
    const fromRange = revenueRangeMidpoint(payload.revenue_range);
    if (fromRange != null) {
      revenueEstimate = fromRange;
      revenueSource = 'input_range_midpoint';
    }
  }

  // ---- Tech stack: union of Apollo + Clay -------------------------------
  const techStack = uniqueStrings([...(apollo.technologies || []), ...(clay.tech_stack || [])]);
  const techStackCount = techStack.length || clay.tech_stack_count || 0;

  const foundedYear = apollo.founded_year ?? null;
  const years = yearsInBusiness(payload.years_in_business) ?? (foundedYear ? new Date().getFullYear() - foundedYear : null);

  return {
    business: {
      name: payload.business_name,
      industry: payload.industry || apollo.industry || null,
      industry_code: apollo.naics || null,
      business_type: payload.business_type || null,
      employee_count: employeeCount,
      employee_count_source: employeeSource,
      revenue_estimate: revenueEstimate,
      revenue_source: revenueSource,
      revenue_range_input: payload.revenue_range || null,
      founded_year: foundedYear,
      years_in_business: years,
      domain: apollo.domain || domain || null,
      tech_stack: techStack,
      tech_stack_count: techStackCount,
    },
    contact: {
      email: payload.email,
      phone: lusha.phone ?? null,
      title: lusha.title || apollo.title || null,
      email_status: lusha.email_status || null,
      seniority: apollo.seniority || null,
      full_name: lusha.full_name || null,
    },
    marketing: {
      traffic_value_monthly: semrush.traffic_value_monthly ?? null,
      paid_spend_estimate_monthly: semrush.paid_spend_estimate_monthly ?? null,
      organic_keywords: semrush.organic_keywords ?? null,
      organic_traffic_monthly: semrush.organic_traffic_monthly ?? null,
      paid_keywords: semrush.paid_keywords ?? null,
      keyword_gap_count: semrush.keyword_gap_count ?? null,
      domain_rank: semrush.rank ?? null,
    },
    signals: {
      intent_topics: clay.intent_topics || [],
      recent_events: clay.recent_events || [],
      headcount_trend: clay.headcount_trend ?? null,
    },
    inputs: {
      primary_concern: payload.primary_concern || null,
      submitted_at: payload.submitted_at || null,
      source: payload.source || null,
    },
    data_sources: Object.fromEntries(
      Object.entries(results).map(([source, env]) => [
        source,
        { available: env.available, timeout: Boolean(env.timeout), error: env.error, duration_ms: env.durationMs ?? null },
      ]),
    ),
  };
}

function pick(envelope) {
  return envelope && envelope.available && envelope.data ? envelope.data : {};
}

function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
