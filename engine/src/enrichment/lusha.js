// Lusha enrichment: person lookup. Outputs: email_status, phone, title.
// Timeout 15s (configurable). Never throws — returns an envelope.
import { config } from '../config.js';
import { request } from '../utils/http.js';
import { ok, unavailable } from './result.js';

const SOURCE = 'lusha';

export async function enrichLusha({ email, domain, businessName }, log) {
  const started = Date.now();
  if (!config.lusha.apiKey) {
    return unavailable(SOURCE, 'LUSHA_API_KEY not configured', { durationMs: 0 });
  }
  if (!email) {
    return unavailable(SOURCE, 'no email to look up', { durationMs: 0 });
  }

  try {
    const res = await request({
      label: 'lusha.person',
      timeoutMs: config.lusha.timeoutMs,
      method: 'POST',
      url: `${config.lusha.baseUrl}/v1/person`,
      headers: {
        'Content-Type': 'application/json',
        api_key: config.lusha.apiKey,
      },
      data: {
        email,
        ...(domain ? { companyDomain: domain } : {}),
        ...(businessName ? { companyName: businessName } : {}),
      },
    });

    if (res.status >= 300) {
      return unavailable(SOURCE, `HTTP ${res.status}`, { durationMs: Date.now() - started });
    }

    const body = res.data || {};
    const contact = body.data || body.contact || body;
    const phoneNumbers = contact.phoneNumbers || contact.phones || [];
    const emails = contact.emailAddresses || contact.emails || [];

    const data = {
      email_status: firstStatus(emails) || contact.emailStatus || null,
      phone: firstValue(phoneNumbers, ['number', 'phoneNumber', 'internationalNumber']),
      title: contact.jobTitle || contact.title || null,
      full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.fullName || null,
    };

    if (!data.email_status && !data.phone && !data.title) {
      return unavailable(SOURCE, 'no contact data returned', { durationMs: Date.now() - started });
    }
    return ok(SOURCE, data, { durationMs: Date.now() - started });
  } catch (err) {
    log?.warn('lusha enrichment failed', { error: err.message, timeout: Boolean(err.timeout) });
    return unavailable(SOURCE, err, { durationMs: Date.now() - started });
  }
}

function firstStatus(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return null;
  const e = emails[0];
  return typeof e === 'string' ? null : e.emailStatus || e.status || null;
}

function firstValue(list, keys) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const item = list[0];
  if (typeof item === 'string') return item;
  for (const k of keys) if (item?.[k]) return item[k];
  return null;
}
