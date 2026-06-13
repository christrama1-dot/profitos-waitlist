// Apollo.io enrichment: organization enrich + people match.
// Outputs: employee_count, estimated_annual_revenue, technologies[], seniority.
// Timeout 20s (configurable). Never throws — returns an envelope.
import { config } from '../config.js';
import { request } from '../utils/http.js';
import { ok, unavailable } from './result.js';

const SOURCE = 'apollo';

export async function enrichApollo({ domain, email, businessName }, log) {
  const started = Date.now();
  if (!config.apollo.apiKey) {
    return unavailable(SOURCE, 'APOLLO_API_KEY not configured', { durationMs: 0 });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Api-Key': config.apollo.apiKey,
  };

  try {
    // Run org-enrich and people-match in parallel; tolerate either failing.
    const [orgRes, peopleRes] = await Promise.allSettled([
      request({
        label: 'apollo.org.enrich',
        timeoutMs: config.apollo.timeoutMs,
        method: 'POST',
        url: `${config.apollo.baseUrl}/v1/organizations/enrich`,
        headers,
        data: { domain, organization_name: businessName },
      }),
      email
        ? request({
            label: 'apollo.people.match',
            timeoutMs: config.apollo.timeoutMs,
            method: 'POST',
            url: `${config.apollo.baseUrl}/v1/people/match`,
            headers,
            data: { email, reveal_personal_emails: false },
          })
        : Promise.resolve({ status: 204, data: {} }),
    ]);

    const org = orgRes.status === 'fulfilled' && orgRes.value.status < 300 ? orgRes.value.data?.organization || {} : {};
    const person = peopleRes.status === 'fulfilled' && peopleRes.value.status < 300 ? peopleRes.value.data?.person || {} : {};

    const data = {
      employee_count: numeric(org.estimated_num_employees),
      estimated_annual_revenue: numeric(org.annual_revenue ?? org.organization_revenue),
      founded_year: numeric(org.founded_year),
      industry: org.industry || null,
      naics: firstString(org.naics_codes),
      technologies: extractTechnologies(org),
      seniority: person.seniority || null,
      title: person.title || null,
      domain: org.primary_domain || org.website_url || domain || null,
    };

    const anyData = Object.values(data).some((v) => v != null && (!Array.isArray(v) || v.length > 0));
    if (!anyData) {
      return unavailable(SOURCE, 'no match returned', { durationMs: Date.now() - started });
    }
    return ok(SOURCE, data, { durationMs: Date.now() - started });
  } catch (err) {
    log?.warn('apollo enrichment failed', { error: err.message, timeout: Boolean(err.timeout) });
    return unavailable(SOURCE, err, { durationMs: Date.now() - started });
  }
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstString(arr) {
  return Array.isArray(arr) && arr.length ? String(arr[0]) : null;
}

function extractTechnologies(org) {
  const tech = org.technology_names || org.technologies || org.current_technologies;
  if (!Array.isArray(tech)) return [];
  return tech.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
}
