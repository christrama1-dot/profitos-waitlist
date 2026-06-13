// Offline end-to-end smoke test. Runs the full pipeline with NO external
// integrations configured to prove graceful degradation: enrichment is all
// "unavailable", scoring still produces a dollar figure, and a real PDF is
// written to disk via the pdfkit fallback. Run with: npm run smoke
import { mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force the pdfkit fallback and an isolated output dir before importing config.
process.env.PDF_RENDERER = 'pdfkit';
process.env.PDF_OUTPUT_DIR = mkdtempSync(join(tmpdir(), 'profitos-smoke-'));
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const { processAudit } = await import('../src/pipeline/orchestrator.js');

const payload = {
  business_name: 'Northwind Trading Co',
  email: 'owner@northwindtrading.com',
  industry: 'Retail',
  revenue_range: '$2M-$5M',
  employee_count: '25-50',
  business_type: 'B2C',
  years_in_business: '8',
  primary_concern: 'Cash flow is tight and we discount too much',
  submitted_at: new Date().toISOString(),
  source: 'audit-submit-wf06',
};

const summary = await processAudit(payload, { runId: 'smoke-test' });

console.log('\n=== SMOKE SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
};

check('pipeline completed ok', summary.ok === true);
check('scoring produced a positive annual leak', summary.stages.scoring?.total_annual_leak > 0);
check('all 4 enrichment sources reported (degraded, not crashed)', Object.keys(summary.stages.enrichment?.sources || {}).length === 4);
check('PDF was generated via pdfkit fallback', summary.stages.pdf?.renderer === 'pdfkit');
check('Drive upload skipped cleanly (unconfigured)', summary.stages.drive?.skipped === true || summary.stages.drive?.ok === false);
check('email skipped cleanly (unconfigured)', summary.stages.email?.skipped === true || summary.stages.email?.ok === false);
check('Kit tag skipped cleanly (unconfigured)', summary.stages.kit?.skipped === true || summary.stages.kit?.ok === false);
check('total pipeline well under 5 min', summary.totalDurationMs < 5 * 60 * 1000);

if (summary.stages.pdf?.bytes) {
  const f = join(process.env.PDF_OUTPUT_DIR, '');
  console.log('PDF output dir:', f);
}

// Sanity: the smoke PDF file should be non-trivial in size.
try {
  const files = await import('node:fs/promises').then((fs) => fs.readdir(process.env.PDF_OUTPUT_DIR));
  const pdf = files.find((n) => n.endsWith('.pdf'));
  if (pdf) {
    const s = await stat(join(process.env.PDF_OUTPUT_DIR, pdf));
    check('PDF file on disk is > 1KB', s.size > 1024);
  } else {
    check('PDF file present on disk', false);
  }
} catch {
  check('PDF output dir readable', false);
}

console.log(`\n${failures === 0 ? 'ALL SMOKE CHECKS PASSED' : failures + ' SMOKE CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
