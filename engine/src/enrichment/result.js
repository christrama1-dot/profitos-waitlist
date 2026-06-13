// Uniform envelope returned by every enrichment provider. The orchestrator
// only ever inspects this shape, so adding/removing a provider never touches
// downstream code.

export function ok(source, data, meta = {}) {
  return { source, available: true, ok: true, data, error: null, ...meta };
}

export function unavailable(source, error, meta = {}) {
  return {
    source,
    available: false,
    ok: false,
    data: null,
    error: typeof error === 'string' ? error : error?.message || 'unknown error',
    timeout: Boolean(error?.timeout),
    ...meta,
  };
}
