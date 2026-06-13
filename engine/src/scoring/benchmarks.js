// Industry benchmarks used by the scoring engine. These are deliberately
// coarse, defensible SMB averages — the engine degrades to them whenever
// firmographic enrichment is thin. Values are approximate annual
// revenue-per-employee figures in USD by broad industry bucket.

const DEFAULT_REVENUE_PER_EMPLOYEE = 180_000;

const INDUSTRY_RPE = [
  { match: /software|saas|tech|it\b|information technology/i, rpe: 250_000 },
  { match: /finance|financial|account|bank|insurance/i, rpe: 300_000 },
  { match: /legal|law|attorney/i, rpe: 220_000 },
  { match: /real estate|property/i, rpe: 260_000 },
  { match: /consult|agency|marketing|advertis|professional service/i, rpe: 175_000 },
  { match: /health|medical|dental|clinic|wellness/i, rpe: 200_000 },
  { match: /manufactur|industrial|fabricat/i, rpe: 230_000 },
  { match: /construct|contractor|trades|hvac|plumb|electric|roofing/i, rpe: 200_000 },
  { match: /retail|ecommerce|e-commerce|shop|store/i, rpe: 210_000 },
  { match: /restaurant|food|hospitality|hotel|cafe/i, rpe: 75_000 },
  { match: /logistics|transport|freight|trucking|shipping/i, rpe: 190_000 },
  { match: /education|training|coaching|school/i, rpe: 120_000 },
  { match: /non.?profit|charity/i, rpe: 110_000 },
  { match: /fitness|gym|salon|spa|beauty/i, rpe: 90_000 },
];

export function benchmarkFor(industry) {
  const found = INDUSTRY_RPE.find((b) => industry && b.match.test(industry));
  return {
    revenuePerEmployee: found ? found.rpe : DEFAULT_REVENUE_PER_EMPLOYEE,
    matchedIndustry: Boolean(found),
  };
}
