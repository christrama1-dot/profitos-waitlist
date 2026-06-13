import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize/normalizer.js';
import { scoreAudit } from '../src/scoring/engine.js';
import { assembleReport } from '../src/report/assembler.js';
import { unavailable, ok } from '../src/enrichment/result.js';

function emptyEnrichment() {
  return {
    domain: 'acme.com',
    results: {
      apollo: unavailable('apollo', 'not configured'),
      lusha: unavailable('lusha', 'not configured'),
      semrush: unavailable('semrush', 'not configured'),
      clay: unavailable('clay', 'not configured'),
    },
  };
}

const payload = {
  business_name: 'Acme Widgets',
  email: 'owner@acme.com',
  industry: 'Manufacturing',
  revenue_range: '$1M-$5M',
  employee_count: '11-50',
  primary_concern: 'We keep losing deals at the quote stage',
  submitted_at: new Date().toISOString(),
};

test('produces 8 categories each scored 0-3', () => {
  const canonical = normalize(payload, emptyEnrichment());
  const scoring = scoreAudit(canonical);
  assert.equal(scoring.categories.length, 8);
  for (const c of scoring.categories) {
    assert.ok(c.score >= 0 && c.score <= 3, `${c.key} score in range`);
    assert.ok(c.annual_leak >= 0);
    assert.ok(Array.isArray(c.drivers) && c.drivers.length > 0);
  }
});

test('total leak is positive and capped under revenue', () => {
  const canonical = normalize(payload, emptyEnrichment());
  const scoring = scoreAudit(canonical);
  assert.ok(scoring.total_annual_leak > 0);
  assert.ok(scoring.total_annual_leak < scoring.revenue_basis);
  assert.ok(scoring.leak_as_pct_of_revenue <= 32);
  assert.ok(scoring.health_score >= 0 && scoring.health_score <= 100);
});

test('primary concern bumps the matching category (sales conversion)', () => {
  const canonical = normalize(payload, emptyEnrichment());
  const scoring = scoreAudit(canonical);
  const sales = scoring.categories.find((c) => c.key === 'sales_conversion');
  assert.ok(sales.score >= 3, 'concern should raise sales conversion to severe');
});

test('revenue falls back to a basis when unknown', () => {
  const canonical = normalize({ ...payload, revenue_range: 'unknown' }, emptyEnrichment());
  const scoring = scoreAudit(canonical);
  assert.equal(scoring.revenue_basis_known, false);
  assert.ok(scoring.total_annual_leak > 0);
});

test('apollo data raises confidence and drives revenue-per-employee logic', () => {
  const enrichment = {
    domain: 'acme.com',
    results: {
      apollo: ok('apollo', {
        employee_count: 40,
        estimated_annual_revenue: 2_000_000,
        technologies: ['HubSpot', 'Shopify'],
        founded_year: 2015,
      }),
      lusha: unavailable('lusha', 'x'),
      semrush: unavailable('semrush', 'x'),
      clay: unavailable('clay', 'x'),
    },
  };
  const canonical = normalize(payload, enrichment);
  assert.equal(canonical.business.employee_count, 40);
  assert.equal(canonical.business.employee_count_source, 'apollo');
  assert.equal(canonical.business.revenue_source, 'apollo');
  const scoring = scoreAudit(canonical);
  assert.equal(scoring.revenue_per_employee, 50000);
});

test('assembled report has headline, recommendations, and top opportunities', () => {
  const canonical = normalize(payload, emptyEnrichment());
  const scoring = scoreAudit(canonical);
  const report = assembleReport({ canonical, scoring, payload, runId: 'test-run' });
  assert.ok(report.headline.narrative.includes('Acme Widgets'));
  assert.equal(report.top_opportunities.length, 3);
  for (const c of report.categories) assert.ok(c.recommendation.length > 0);
  assert.equal(report.meta.run_id, 'test-run');
});
