// Inbound auth + payload validation for POST /api/audit. WF-06 must present
// the shared secret in X-ProfitOS-Audit-Secret; the body must carry the
// required fields. Validation is intentionally lenient on optional fields so a
// slightly-off WF-06 payload still produces a report.
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED = ['business_name', 'email', 'industry', 'revenue_range'];

/** Constant-time secret comparison to avoid timing leaks. */
function secretMatches(provided) {
  const expected = config.wf06AuditSecret;
  if (!expected) return true; // auth disabled (logged as a config warning)
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authenticate(req, res, next) {
  const provided = req.get('X-ProfitOS-Audit-Secret');
  if (!secretMatches(provided)) {
    return res.status(401).json({ ok: false, error: 'invalid or missing audit secret' });
  }
  // Source header is advisory — log a mismatch but don't reject.
  next();
}

export function validatePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['request body must be a JSON object'], value: null };
  }
  for (const field of REQUIRED) {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      errors.push(`missing or empty required field: ${field}`);
    }
  }
  if (body.email && !EMAIL_RE.test(String(body.email).trim())) {
    errors.push('email is not a valid address');
  }
  if (errors.length) return { valid: false, errors, value: null };

  // Whitelist + trim into a clean payload.
  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? null : String(v));
  const value = {
    business_name: str(body.business_name),
    email: str(body.email).toLowerCase(),
    industry: str(body.industry),
    revenue_range: str(body.revenue_range),
    business_type: str(body.business_type),
    years_in_business: str(body.years_in_business),
    employee_count: str(body.employee_count),
    primary_concern: str(body.primary_concern),
    submitted_at: str(body.submitted_at) || new Date().toISOString(),
    source: str(body.source) || 'audit-submit-wf06',
  };
  return { valid: true, errors: [], value };
}
