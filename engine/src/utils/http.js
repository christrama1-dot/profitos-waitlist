// HTTP helper built on axios with a hard per-call timeout. Each enrichment
// provider passes its own timeout so a slow vendor can never block the
// overall report past its budget.
import axios from 'axios';

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.timeout = true;
  }
}

/**
 * Perform an HTTP request with an enforced timeout.
 * Rejects with TimeoutError when the deadline is exceeded so callers can
 * distinguish a timeout (mark data unavailable) from other failures.
 */
export async function request({ label, timeoutMs, ...axiosOpts }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await axios({
      ...axiosOpts,
      signal: controller.signal,
      timeout: timeoutMs,
      // Don't throw on 4xx/5xx — let callers inspect status and degrade.
      validateStatus: () => true,
    });
    return res;
  } catch (err) {
    if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || err.code === 'ECONNABORTED') {
      throw new TimeoutError(label || 'request', timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a promise with an overall wall-clock deadline. Used to cap the
 * combined enrichment phase regardless of individual provider timeouts.
 */
export function withDeadline(promise, ms, label = 'task') {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
