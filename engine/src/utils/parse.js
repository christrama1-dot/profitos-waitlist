// Pure helpers for coercing the messy free-text inputs that arrive from the
// WF-06 form into the numeric values the scoring engine needs. Kept pure and
// side-effect free so they're trivially unit-testable.

/**
 * Parse a revenue-range string into a representative annual USD midpoint.
 * Handles formats like "$1M-$5M", "500k-1m", "Under $250k", "$10M+".
 * Returns null when nothing numeric can be extracted.
 */
export function revenueRangeMidpoint(range) {
  if (!range || typeof range !== 'string') return null;
  const cleaned = range.toLowerCase().replace(/[, ]+/g, '');
  const matches = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/g)];
  if (matches.length === 0) return null;

  const toNumber = (numStr, unit) => {
    let n = Number.parseFloat(numStr);
    if (unit === 'k') n *= 1_000;
    else if (unit === 'm') n *= 1_000_000;
    else if (unit === 'b') n *= 1_000_000_000;
    return n;
  };

  const values = matches.map((m) => toNumber(m[1], m[2])).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;

  // "Under $X" / "less than" → treat as 60% of the cap.
  if (/under|less than|below|up to/.test(cleaned) && values.length === 1) {
    return Math.round(values[0] * 0.6);
  }
  // "$X+" / "over" / "more than" → treat as 1.5x of the floor.
  if (/\+|over|more than|above|plus/.test(cleaned) && values.length === 1) {
    return Math.round(values[0] * 1.5);
  }
  if (values.length >= 2) {
    return Math.round((values[0] + values[1]) / 2);
  }
  return Math.round(values[0]);
}

/**
 * Parse an employee-count string ("11-50", "200+", "10") into a number.
 * Returns null when nothing usable is present.
 */
export function employeeCountMidpoint(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const str = String(value).toLowerCase().replace(/[, ]+/g, '');
  const nums = [...str.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number.parseFloat(m[1]));
  if (nums.length === 0) return null;
  if (/\+|over|more than|above/.test(str) && nums.length === 1) return Math.round(nums[0] * 1.25);
  if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 2);
  return Math.round(nums[0]);
}

/** Parse a "years in business" string into an integer count of years. */
export function yearsInBusiness(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Math.round(value);
  const m = String(value).match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Best-effort derivation of a company web domain from a business name or an
 * email address. Email domains that look like free webmail are ignored so we
 * don't enrich gmail.com instead of the actual company.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'gmx.com', 'live.com', 'msn.com', 'me.com',
]);

export function deriveDomain({ email, businessName } = {}) {
  if (email && typeof email === 'string' && email.includes('@')) {
    const domain = email.split('@')[1]?.trim().toLowerCase();
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) return domain;
  }
  if (businessName && typeof businessName === 'string') {
    const slug = businessName
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|co|corp|company|group|the|and|&)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (slug.length >= 2) return `${slug}.com`;
  }
  return null;
}

export const isFreeEmailDomain = (domain) => FREE_EMAIL_DOMAINS.has(String(domain || '').toLowerCase());

/** Clamp a number into [min, max]. */
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Round to nearest whole dollar. */
export const usd = (n) => (Number.isFinite(n) ? Math.round(n) : 0);
