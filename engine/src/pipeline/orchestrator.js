// The WF-08 pipeline. Runs AFTER the 202 has been returned to WF-06
// (fire-and-forget). Orchestrates: parallel enrichment → normalization →
// scoring → report assembly → PDF → Drive upload → email → Kit tag.
//
// Every stage past enrichment is wrapped so that one failing side-effect
// (e.g. Drive down) never prevents the others (e.g. email) from running. The
// goal is "always deliver something" within the 5-minute target.
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { runEnrichment } from '../enrichment/index.js';
import { normalize } from '../normalize/normalizer.js';
import { scoreAudit } from '../scoring/engine.js';
import { assembleReport } from '../report/assembler.js';
import { generatePdf } from '../report/pdf.js';
import { uploadToDrive } from '../delivery/drive.js';
import { sendReportEmail } from '../delivery/email.js';
import { applyAuditCompletedTag } from '../delivery/kit.js';

/**
 * @param {object} payload Validated WF-06 payload.
 * @param {object} [opts] { runId } optional correlation id.
 * @returns {Promise<object>} run summary (also useful for tests).
 */
export async function processAudit(payload, opts = {}) {
  const runId = opts.runId || randomUUID();
  const log = logger.child({ runId, business: payload.business_name });
  const startedAt = Date.now();
  log.info('audit pipeline started', { email: payload.email });

  const summary = { runId, startedAt: new Date(startedAt).toISOString(), stages: {} };

  try {
    // 1. Parallel enrichment (Apollo + Lusha + Semrush + Clay).
    const enrichment = await runEnrichment(payload, log);
    summary.stages.enrichment = {
      durationMs: enrichment.durationMs,
      sources: Object.fromEntries(
        Object.entries(enrichment.results).map(([k, v]) => [k, v.available ? 'ok' : v.timeout ? 'timeout' : 'unavailable']),
      ),
    };

    // 2. Normalize into the canonical audit object.
    const canonical = normalize(payload, enrichment);

    // 3. Profit-leak scoring + dollar calculation.
    const scoring = scoreAudit(canonical);
    summary.stages.scoring = {
      total_annual_leak: scoring.total_annual_leak,
      health_score: scoring.health_score,
    };
    log.info('scoring complete', summary.stages.scoring);

    // 4. Assemble the report model.
    const report = assembleReport({ canonical, scoring, payload, runId });

    // 5. PDF generation (puppeteer → pdfkit fallback).
    let pdf = null;
    try {
      pdf = await generatePdf(report, log);
      summary.stages.pdf = { renderer: pdf.renderer, bytes: pdf.bytes };
    } catch (err) {
      log.error('PDF generation failed entirely', { error: err.message });
      summary.stages.pdf = { error: err.message };
    }

    // 6-8. Side-effects run concurrently; each is independently fault-tolerant.
    const [drive, kit] = await Promise.all([
      pdf ? uploadToDrive(pdf, log) : Promise.resolve({ ok: false, skipped: true, reason: 'no pdf', link: null }),
      applyAuditCompletedTag({ email: payload.email }, log),
    ]);
    summary.stages.drive = drive;
    summary.stages.kit = kit;

    // Email last so it can include the Drive link.
    const email = await sendReportEmail({ report, pdf, driveLink: drive.link }, log);
    summary.stages.email = email;

    summary.totalDurationMs = Date.now() - startedAt;
    summary.ok = true;
    log.info('audit pipeline complete', {
      totalDurationMs: summary.totalDurationMs,
      total_annual_leak: scoring.total_annual_leak,
      emailed: email.ok,
      drive: drive.ok,
    });
    return summary;
  } catch (err) {
    summary.ok = false;
    summary.error = err.message;
    summary.totalDurationMs = Date.now() - startedAt;
    log.error('audit pipeline failed', { error: err.message, stack: err.stack });
    return summary;
  }
}
