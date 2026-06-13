// Minimal structured logger. Emits single-line JSON in production so logs
// are machine-parseable, and human-friendly text in development.
import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const record = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  const line =
    config.env === 'development'
      ? `[${record.ts}] ${level.toUpperCase().padEnd(5)} ${msg}` +
        (meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '')
      : JSON.stringify(record);
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  // Returns a logger bound to a correlation id (one per audit run).
  child(bindings) {
    return {
      debug: (msg, meta) => emit('debug', msg, { ...bindings, ...meta }),
      info: (msg, meta) => emit('info', msg, { ...bindings, ...meta }),
      warn: (msg, meta) => emit('warn', msg, { ...bindings, ...meta }),
      error: (msg, meta) => emit('error', msg, { ...bindings, ...meta }),
    };
  },
};
