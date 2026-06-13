// Profit-leak scoring engine. Consumes the canonical audit object, runs all
// eight category scorers, and converts scores into dollar-figure annual leaks.
//
// Dollar model (per category):
//   categoryLeak = revenueBasis * maxLeakRate * (score / 3)
// where revenueBasis is the best available annual revenue estimate. The total
// is the sum across categories, with a sanity cap so the headline figure can
// never exceed a plausible share of revenue.
import { CATEGORIES } from './categories.js';
import { benchmarkFor } from './benchmarks.js';
import { usd, clamp } from '../utils/parse.js';

// When revenue is entirely unknown we fall back to this conservative basis so
// the report still produces a concrete dollar figure rather than "$0".
const FALLBACK_REVENUE_BASIS = 750_000;

// The summed category leaks are capped at this share of annual revenue — no
// credible audit claims a business is leaking, say, 80% of revenue.
const TOTAL_LEAK_CAP_RATE = 0.32;

export function scoreAudit(canonical) {
  const revenueKnown = canonical.business.revenue_estimate != null;
  const revenueBasis = revenueKnown ? canonical.business.revenue_estimate : FALLBACK_REVENUE_BASIS;

  const employees = canonical.business.employee_count;
  const revenuePerEmployee = employees && employees > 0 ? revenueBasis / employees : null;
  const benchmark = benchmarkFor(canonical.business.industry);

  const ctx = {
    b: canonical.business,
    m: canonical.marketing,
    contact: canonical.contact,
    signals: canonical.signals,
    primaryConcern: canonical.inputs?.primary_concern || null,
    revenuePerEmployee,
    benchmark,
  };

  const categories = CATEGORIES.map((cat) => {
    const { score, confidence, drivers } = cat.score(ctx);
    const rawLeak = revenueBasis * cat.maxLeakRate * (score / 3);
    return {
      key: cat.key,
      label: cat.label,
      description: cat.description,
      score, // 0-3
      severity: SEVERITY[score],
      confidence, // 0-1
      max_leak_rate: cat.maxLeakRate,
      annual_leak: usd(rawLeak),
      drivers,
    };
  });

  // Apply the total cap proportionally if the raw sum is implausibly high.
  const rawTotal = categories.reduce((s, c) => s + c.annual_leak, 0);
  const cap = revenueBasis * TOTAL_LEAK_CAP_RATE;
  const scale = rawTotal > cap && rawTotal > 0 ? cap / rawTotal : 1;
  if (scale < 1) {
    for (const c of categories) c.annual_leak = usd(c.annual_leak * scale);
  }

  const totalAnnualLeak = categories.reduce((s, c) => s + c.annual_leak, 0);
  const monthlyLeak = usd(totalAnnualLeak / 12);

  // Composite health score: 100 = no leaks, 0 = every category maxed out.
  const maxPoints = CATEGORIES.length * 3;
  const points = categories.reduce((s, c) => s + c.score, 0);
  const healthScore = Math.round((1 - points / maxPoints) * 100);

  const sorted = [...categories].sort((a, b) => b.annual_leak - a.annual_leak);
  const topOpportunities = sorted.slice(0, 3).map((c) => c.key);

  return {
    revenue_basis: usd(revenueBasis),
    revenue_basis_known: revenueKnown,
    revenue_per_employee: revenuePerEmployee != null ? usd(revenuePerEmployee) : null,
    benchmark_revenue_per_employee: benchmark.revenuePerEmployee,
    total_annual_leak: totalAnnualLeak,
    total_monthly_leak: monthlyLeak,
    leak_as_pct_of_revenue: round1((totalAnnualLeak / revenueBasis) * 100),
    health_score: clamp(healthScore, 0, 100),
    categories,
    top_opportunities: topOpportunities,
  };
}

const SEVERITY = ['Healthy', 'Minor', 'Moderate', 'Severe'];
const round1 = (n) => Math.round(n * 10) / 10;
