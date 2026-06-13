// Parallel enrichment fan-out. Runs Apollo, Lusha, Semrush, and Clay
// concurrently with Promise.allSettled so no single failure (or timeout) can
// block report generation. A wall-clock deadline caps the whole phase; any
// provider still pending at the deadline is recorded as unavailable.
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { deriveDomain } from '../utils/parse.js';
import { unavailable } from './result.js';
import { enrichApollo } from './apollo.js';
import { enrichLusha } from './lusha.js';
import { enrichSemrush } from './semrush.js';
import { enrichClay } from './clay.js';

const PROVIDERS = [
  { source: 'apollo', fn: enrichApollo },
  { source: 'lusha', fn: enrichLusha },
  { source: 'semrush', fn: enrichSemrush },
  { source: 'clay', fn: enrichClay },
];

/**
 * @param {object} payload Validated inbound audit payload from WF-06.
 * @param {object} log Correlation-bound logger.
 * @returns {Promise<{results: object, domain: string|null, durationMs: number}>}
 */
export async function runEnrichment(payload, log = logger) {
  const started = Date.now();
  const domain = deriveDomain({ email: payload.email, businessName: payload.business_name });
  const ctx = {
    domain,
    email: payload.email,
    businessName: payload.business_name,
    industry: payload.industry,
  };

  log.info('enrichment started', { domain, providers: PROVIDERS.map((p) => p.source) });

  // Each provider is wrapped so that even an unexpected throw resolves to an
  // "unavailable" envelope rather than rejecting the settled batch.
  const tasks = PROVIDERS.map(({ source, fn }) =>
    safeProvider(source, fn, ctx, log).then((res) => ({ source, res })),
  );

  // Race the whole batch against the enrichment deadline. allSettled never
  // rejects, so the deadline only matters if a provider ignores its own
  // timeout; we still resolve with whatever completed.
  const settled = await raceDeadline(tasks, config.engine.enrichmentDeadlineMs, log);

  const results = {};
  for (const { source } of PROVIDERS) {
    results[source] = settled[source] || unavailable(source, 'did not complete before enrichment deadline');
  }

  const durationMs = Date.now() - started;
  log.info('enrichment complete', {
    durationMs,
    summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.available ? 'ok' : v.timeout ? 'timeout' : 'unavailable'])),
  });

  return { results, domain, durationMs };
}

async function safeProvider(source, fn, ctx, log) {
  try {
    return await fn(ctx, log.child ? log.child({ provider: source }) : log);
  } catch (err) {
    log.error('provider threw unexpectedly', { provider: source, error: err.message });
    return unavailable(source, err);
  }
}

// Collects whatever has settled by the deadline into a {source: envelope} map.
function raceDeadline(tasks, deadlineMs, log) {
  return new Promise((resolve) => {
    const collected = {};
    let remaining = tasks.length;
    let settledOut = false;

    const finish = () => {
      if (settledOut) return;
      settledOut = true;
      resolve(collected);
    };

    const timer = setTimeout(() => {
      if (!settledOut) log.warn('enrichment deadline reached', { deadlineMs, collected: Object.keys(collected) });
      finish();
    }, deadlineMs);

    for (const task of tasks) {
      task.then(({ source, res }) => {
        collected[source] = res;
        remaining -= 1;
        if (remaining === 0) {
          clearTimeout(timer);
          finish();
        }
      });
    }
  });
}
