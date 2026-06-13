// The eight profit-leak categories. Each declares:
//  - key/label/description for the report
//  - maxLeakRate: the share of ANNUAL revenue lost in this category at the
//    worst score (3). Dollar leak scales linearly with score (score/3).
//  - score(ctx): pure function returning { score 0-3, confidence, drivers[] }
//
// Every score() degrades gracefully: when enrichment data is missing it falls
// back to industry/self-reported heuristics at reduced confidence rather than
// failing. Scores are integers 0..3 (0 = healthy, 3 = severe leak).

const CONCERN = {
  // Maps free-text primary_concern keywords to the category they implicate.
  pricing_margin: /pric|margin|discount|profit|cost of goods|cogs/i,
  lead_generation: /lead|pipeline|demand|new business|prospect|top of funnel|awareness/i,
  sales_conversion: /clos|conver|sales|win rate|follow.?up|quote|proposal/i,
  marketing_waste: /market|ad spend|ads|seo|traffic|roi|cac|acquisition/i,
  retention_churn: /churn|retention|repeat|loyal|cancel|renew|ltv/i,
  operational_tech: /operation|efficien|process|tech|tool|automat|manual|software/i,
  cashflow_ar: /cash.?flow|receivable|invoice|collect|payment|late|ar\b|dso/i,
  team_productivity: /team|staff|productiv|labor|payroll|hir|overhead|utiliz/i,
};

const concernHit = (ctx, key) =>
  ctx.primaryConcern && CONCERN[key]?.test(ctx.primaryConcern);

// Bump a base score by 1 (capped at 3) when the submitter flagged this exact
// area as their primary concern — they're usually right that it's leaking.
const withConcern = (base, ctx, key) => Math.min(3, base + (concernHit(ctx, key) ? 1 : 0));

export const CATEGORIES = [
  {
    key: 'pricing_margin',
    label: 'Pricing & Margin Leakage',
    description: 'Underpricing, unmanaged discounting, and thin gross margins relative to peers.',
    maxLeakRate: 0.06,
    score(ctx) {
      const drivers = [];
      let base = 2; // most SMBs under-price; assume moderate until proven otherwise
      let confidence = 0.4;
      if (ctx.revenuePerEmployee != null) {
        confidence = 0.7;
        if (ctx.revenuePerEmployee < ctx.benchmark.revenuePerEmployee * 0.7) {
          base = 3;
          drivers.push(`Revenue per employee ($${fmt(ctx.revenuePerEmployee)}) is well below the ~$${fmt(ctx.benchmark.revenuePerEmployee)} industry benchmark, a classic underpricing signal.`);
        } else if (ctx.revenuePerEmployee > ctx.benchmark.revenuePerEmployee * 1.1) {
          base = 1;
          drivers.push('Revenue per employee is at or above benchmark, suggesting healthy pricing power.');
        } else {
          drivers.push('Revenue per employee is near the industry benchmark — modest margin upside likely.');
        }
      } else {
        drivers.push('No firmographic revenue/headcount data available; assuming typical SMB underpricing exposure.');
      }
      return finalize(withConcern(base, ctx, 'pricing_margin'), confidence, drivers, ctx, 'pricing_margin');
    },
  },
  {
    key: 'lead_generation',
    label: 'Demand Generation & Lead Flow',
    description: 'Insufficient inbound demand and weak top-of-funnel visibility.',
    maxLeakRate: 0.05,
    score(ctx) {
      const drivers = [];
      let base = 2;
      let confidence = 0.4;
      const traffic = ctx.m.organic_traffic_monthly;
      if (traffic != null) {
        confidence = 0.65;
        if (traffic < 250) {
          base = 3;
          drivers.push(`Organic search traffic is minimal (~${fmt(traffic)} visits/mo), so the business is largely invisible to in-market buyers.`);
        } else if (traffic < 2000) {
          base = 2;
          drivers.push(`Organic traffic (~${fmt(traffic)} visits/mo) is modest — meaningful demand is being left on the table.`);
        } else {
          base = 1;
          drivers.push(`Healthy organic footprint (~${fmt(traffic)} visits/mo); lead flow appears reasonably strong.`);
        }
      } else {
        drivers.push('No web traffic data available; assuming a typical lead-flow gap for a business of this size.');
      }
      if (ctx.m.keyword_gap_count && ctx.m.keyword_gap_count > 500) {
        drivers.push(`~${fmt(ctx.m.keyword_gap_count)} keyword opportunities are uncaptured versus the visible search market.`);
      }
      return finalize(withConcern(base, ctx, 'lead_generation'), confidence, drivers, ctx, 'lead_generation');
    },
  },
  {
    key: 'sales_conversion',
    label: 'Sales Conversion Efficiency',
    description: 'Leads and quotes that never close due to slow or leaky follow-up.',
    maxLeakRate: 0.07,
    score(ctx) {
      const drivers = [];
      // Conversion efficiency is rarely in firmographic data — lean on
      // concern signal and a moderate default, but read intent signals.
      let base = 2;
      let confidence = 0.35;
      if (ctx.signals.intent_topics?.length) {
        confidence = 0.5;
        drivers.push(`Active buying-intent signals detected (${ctx.signals.intent_topics.slice(0, 3).join(', ')}) that are likely going unworked.`);
        base = Math.max(base, 2);
      }
      drivers.push('Without a CRM connection, conversion leakage is estimated from typical SMB quote-to-close drop-off.');
      return finalize(withConcern(base, ctx, 'sales_conversion'), confidence, drivers, ctx, 'sales_conversion');
    },
  },
  {
    key: 'marketing_waste',
    label: 'Marketing & Paid-Spend Waste',
    description: 'Ad budget and SEO effort that is not converting to profitable revenue.',
    maxLeakRate: 0.04,
    score(ctx) {
      const drivers = [];
      let base = 1;
      let confidence = 0.4;
      const paid = ctx.m.paid_spend_estimate_monthly;
      const trafficValue = ctx.m.traffic_value_monthly;
      if (paid != null) {
        confidence = 0.65;
        if (paid > 0 && (trafficValue == null || trafficValue < paid)) {
          base = 3;
          drivers.push(`Estimated paid spend (~$${fmt(paid)}/mo) exceeds the organic traffic value it is generating — a sign of inefficient acquisition.`);
        } else if (paid > 0) {
          base = 2;
          drivers.push(`Paid spend of ~$${fmt(paid)}/mo detected; optimization upside is likely but not severe.`);
        } else {
          base = 2;
          drivers.push('No measurable paid investment — but that also means no paid pipeline, an opportunity cost.');
        }
      } else {
        drivers.push('No paid-media data available; assuming average channel inefficiency.');
      }
      return finalize(withConcern(base, ctx, 'marketing_waste'), confidence, drivers, ctx, 'marketing_waste');
    },
  },
  {
    key: 'retention_churn',
    label: 'Customer Retention & Churn',
    description: 'Lost lifetime value from customers who do not return or renew.',
    maxLeakRate: 0.08,
    score(ctx) {
      const drivers = [];
      let base = 2;
      let confidence = 0.35;
      if (ctx.signals.headcount_trend != null && Number(ctx.signals.headcount_trend) < 0) {
        base = 3;
        confidence = 0.5;
        drivers.push('Declining headcount trend often accompanies revenue/retention pressure.');
      }
      drivers.push('Retention leakage is the single largest profit lever for most SMBs and is estimated from category benchmarks.');
      return finalize(withConcern(base, ctx, 'retention_churn'), confidence, drivers, ctx, 'retention_churn');
    },
  },
  {
    key: 'operational_tech',
    label: 'Operational & Tech-Stack Inefficiency',
    description: 'Manual work and tool sprawl (or tool gaps) draining margin.',
    maxLeakRate: 0.03,
    score(ctx) {
      const drivers = [];
      let base = 2;
      let confidence = 0.45;
      const tech = ctx.b.tech_stack_count;
      if (tech != null) {
        confidence = 0.6;
        if (tech <= 3) {
          base = 3;
          drivers.push(`A very thin tech stack (${tech} tools detected) points to heavy manual processes and automation upside.`);
        } else if (tech > 25) {
          base = 3;
          drivers.push(`A sprawling stack (${tech} tools) signals overlap, redundant spend, and integration drag.`);
        } else if (tech > 15) {
          base = 2;
          drivers.push(`A moderately large stack (${tech} tools) carries some redundancy risk.`);
        } else {
          base = 1;
          drivers.push(`Tech footprint (${tech} tools) looks proportionate.`);
        }
      } else {
        drivers.push('No tech-stack visibility; assuming typical operational drag.');
      }
      return finalize(withConcern(base, ctx, 'operational_tech'), confidence, drivers, ctx, 'operational_tech');
    },
  },
  {
    key: 'cashflow_ar',
    label: 'Cash Flow & Receivables',
    description: 'Profit trapped in slow collections, late invoices, and weak payment terms.',
    maxLeakRate: 0.04,
    score(ctx) {
      const drivers = [];
      let base = 2;
      let confidence = 0.35;
      drivers.push('Days-sales-outstanding is estimated from industry norms; a QuickBooks connection would sharpen this materially.');
      return finalize(withConcern(base, ctx, 'cashflow_ar'), confidence, drivers, ctx, 'cashflow_ar');
    },
  },
  {
    key: 'team_productivity',
    label: 'Team Productivity & Labor Cost',
    description: 'Output per head and overhead efficiency relative to peers.',
    maxLeakRate: 0.05,
    score(ctx) {
      const drivers = [];
      let base = 2;
      let confidence = 0.4;
      if (ctx.revenuePerEmployee != null) {
        confidence = 0.7;
        if (ctx.revenuePerEmployee < ctx.benchmark.revenuePerEmployee * 0.75) {
          base = 3;
          drivers.push(`Output per employee ($${fmt(ctx.revenuePerEmployee)}) trails the ~$${fmt(ctx.benchmark.revenuePerEmployee)} benchmark, indicating labor-cost drag.`);
        } else if (ctx.revenuePerEmployee > ctx.benchmark.revenuePerEmployee * 1.15) {
          base = 1;
          drivers.push('Output per employee exceeds benchmark — the team is running lean.');
        } else {
          drivers.push('Output per employee is near benchmark; incremental productivity upside remains.');
        }
      } else {
        drivers.push('No headcount data; assuming average labor efficiency.');
      }
      return finalize(withConcern(base, ctx, 'team_productivity'), confidence, drivers, ctx, 'team_productivity');
    },
  },
];

function finalize(score, confidence, drivers, ctx, key) {
  // A flagged primary concern always lifts confidence a little — the owner is
  // telling us where it hurts.
  const conf = Math.min(0.95, confidence + (concernHit(ctx, key) ? 0.1 : 0));
  return { score: clampScore(score), confidence: round2(conf), drivers };
}

const clampScore = (n) => Math.max(0, Math.min(3, Math.round(n)));
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');
