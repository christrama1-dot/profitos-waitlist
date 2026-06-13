// Report assembly. Combines the canonical audit object and the scoring output
// into a single self-contained report model that the PDF renderer and the
// email template both consume. Adds human-readable recommendations per
// category and a headline narrative.
import { usd } from '../utils/parse.js';

// One concrete, action-oriented recommendation per category, selected by
// severity. Kept here (not in the scorer) so copy can evolve independently of
// the math.
const RECOMMENDATIONS = {
  pricing_margin: {
    high: 'Run a value-based pricing review and introduce a 5–10% increase on your top offers; most SMBs see zero churn from a single-digit lift.',
    low: 'Audit discounting discipline quarterly to protect the margin you already command.',
  },
  lead_generation: {
    high: 'Stand up an always-on inbound engine (SEO + a single paid channel) targeting your highest-intent keywords to fix the visibility gap.',
    low: 'Double down on the channels already producing organic traffic before adding new ones.',
  },
  sales_conversion: {
    high: 'Implement a 5-minute speed-to-lead follow-up and a structured quote-to-close cadence; conversion gains here are the fastest dollars.',
    low: 'Tighten proposal follow-up SLAs to recover the last few points of win rate.',
  },
  marketing_waste: {
    high: 'Pause or restructure paid campaigns that are spending above the organic value they return, and reallocate to proven keywords.',
    low: 'Add conversion tracking so every marketing dollar is attributable.',
  },
  retention_churn: {
    high: 'Launch a structured retention/renewal program and win-back sequence — protecting existing LTV is cheaper than net-new acquisition.',
    low: 'Formalize a quarterly customer check-in to keep churn suppressed.',
  },
  operational_tech: {
    high: 'Map your top three manual workflows and automate them; consolidate overlapping tools to cut both labor and license waste.',
    low: 'Review your stack annually for redundant subscriptions.',
  },
  cashflow_ar: {
    high: 'Tighten payment terms, automate invoice reminders, and offer early-pay incentives to pull cash forward and cut DSO.',
    low: 'Automate AR reminders so collections never depend on manual follow-up.',
  },
  team_productivity: {
    high: 'Reassign or automate low-leverage tasks so output per head climbs toward the industry benchmark.',
    low: 'Introduce light productivity metrics to sustain your above-benchmark efficiency.',
  },
};

export function assembleReport({ canonical, scoring, payload, runId, generatedAt = new Date() }) {
  const categories = scoring.categories.map((c) => ({
    ...c,
    recommendation: RECOMMENDATIONS[c.key]?.[c.score >= 2 ? 'high' : 'low'] || '',
    monthly_leak: usd(c.annual_leak / 12),
  }));

  const top = categories
    .filter((c) => scoring.top_opportunities.includes(c.key))
    .sort((a, b) => b.annual_leak - a.annual_leak);

  return {
    meta: {
      run_id: runId,
      generated_at: generatedAt.toISOString(),
      engine: 'ProfitOS Engine — WF-08',
      version: 1,
    },
    business: canonical.business,
    contact: canonical.contact,
    headline: {
      total_annual_leak: scoring.total_annual_leak,
      total_monthly_leak: scoring.total_monthly_leak,
      leak_as_pct_of_revenue: scoring.leak_as_pct_of_revenue,
      health_score: scoring.health_score,
      revenue_basis: scoring.revenue_basis,
      revenue_basis_known: scoring.revenue_basis_known,
      narrative: buildNarrative(canonical, scoring),
    },
    benchmarks: {
      revenue_per_employee: scoring.revenue_per_employee,
      benchmark_revenue_per_employee: scoring.benchmark_revenue_per_employee,
    },
    categories,
    top_opportunities: top.map((c) => ({
      key: c.key,
      label: c.label,
      annual_leak: c.annual_leak,
      recommendation: c.recommendation,
    })),
    data_sources: canonical.data_sources,
    disclaimer:
      'Figures are directional estimates derived from third-party firmographic data and industry benchmarks, intended to size opportunity — not audited financials. Connecting your accounting and CRM systems sharpens every number in this report.',
  };
}

function buildNarrative(canonical, scoring) {
  const name = canonical.business.name || 'Your business';
  const total = `$${scoring.total_annual_leak.toLocaleString('en-US')}`;
  const monthly = `$${scoring.total_monthly_leak.toLocaleString('en-US')}`;
  const topLabels = scoring.categories
    .filter((c) => scoring.top_opportunities.includes(c.key))
    .sort((a, b) => b.annual_leak - a.annual_leak)
    .map((c) => c.label);
  const basisNote = scoring.revenue_basis_known
    ? ''
    : ' (estimated, since exact revenue was not available)';
  return (
    `${name} is leaking an estimated ${total} per year${basisNote} — about ${monthly} every month — ` +
    `across eight profit categories. The largest recoverable opportunities are ${listify(topLabels)}. ` +
    `Closing even half of this gap would be the equivalent of giving yourself a meaningful raise without adding a single new customer.`
  );
}

function listify(items) {
  if (!items.length) return 'several areas';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
