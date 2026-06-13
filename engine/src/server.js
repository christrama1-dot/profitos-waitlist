// WF-08 API server. Receives the validated audit handoff from WF-06 (n8n),
// acknowledges with 202 immediately, and processes the audit fire-and-forget
// so WF-06 never blocks. Target end-to-end delivery: under 5 minutes.
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { config, configWarnings } from './config.js';
import { logger } from './utils/logger.js';
import { authenticate, validatePayload } from './middleware/validate.js';
import { processAudit } from './pipeline/orchestrator.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

// Health/readiness probe.
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'profitos-audit-engine', version: 1, env: config.env, ts: new Date().toISOString() });
});

// Main handoff endpoint.
app.post('/api/audit', authenticate, (req, res) => {
  const runId = randomUUID();
  const source = req.get('X-ProfitOS-Source') || null;

  const { valid, errors, value } = validatePayload(req.body);
  if (!valid) {
    logger.warn('rejected invalid audit payload', { runId, errors, source });
    return res.status(422).json({ ok: false, runId, errors });
  }

  // Acknowledge immediately — WF-06 does not wait for the report.
  res.status(202).json({
    ok: true,
    runId,
    accepted_at: new Date().toISOString(),
    message: 'Audit accepted; report will be generated and delivered to the submitter.',
  });

  // Fire-and-forget. Errors are handled inside the pipeline and logged; we
  // attach a catch as a final safety net so an unhandled rejection can never
  // crash the process.
  setImmediate(() => {
    processAudit(value, { runId }).catch((err) => {
      logger.error('unhandled pipeline error', { runId, error: err.message, stack: err.stack });
    });
  });
});

// 404 + error handlers.
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('request error', { error: err.message });
  res.status(err.status === 400 || err.type === 'entity.parse.failed' ? 400 : 500).json({
    ok: false,
    error: err.type === 'entity.parse.failed' ? 'invalid JSON body' : 'internal error',
  });
});

// Only start listening when run directly (so tests can import the app).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const warnings = configWarnings();
  if (warnings.length) warnings.forEach((w) => logger.warn(`config: ${w}`));
  app.listen(config.port, () => {
    logger.info('ProfitOS Audit Engine (WF-08) listening', {
      port: config.port,
      env: config.env,
      enrichmentDeadlineMs: config.engine.enrichmentDeadlineMs,
      pdfRenderer: config.engine.pdfRenderer,
    });
  });
}

export { app };
