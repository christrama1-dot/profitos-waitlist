// Centralized, validated configuration. All secrets come from the
// environment — never hard-coded. See .env.example for the full list.
import 'dotenv/config';

const num = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v, fallback = false) =>
  v == null ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Inbound auth
  wf06AuditSecret: process.env.WF06_AUDIT_SECRET || '',

  apollo: {
    apiKey: process.env.APOLLO_API_KEY || '',
    baseUrl: process.env.APOLLO_BASE_URL || 'https://api.apollo.io',
    timeoutMs: num(process.env.APOLLO_TIMEOUT_MS, 20000),
  },

  lusha: {
    apiKey: process.env.LUSHA_API_KEY || '',
    baseUrl: process.env.LUSHA_BASE_URL || 'https://api.lusha.com',
    timeoutMs: num(process.env.LUSHA_TIMEOUT_MS, 15000),
  },

  semrush: {
    apiKey: process.env.SEMRUSH_API_KEY || '',
    baseUrl: process.env.SEMRUSH_BASE_URL || 'https://api.semrush.com',
    database: process.env.SEMRUSH_DATABASE || 'us',
    timeoutMs: num(process.env.SEMRUSH_TIMEOUT_MS, 20000),
  },

  clay: {
    apiKey: process.env.CLAY_API_KEY || '',
    webhookUrl: process.env.CLAY_WEBHOOK_URL || '',
    timeoutMs: num(process.env.CLAY_TIMEOUT_MS, 25000),
  },

  drive: {
    serviceAccountJsonBase64: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '',
    serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '',
    reportsFolderId: process.env.GDRIVE_REPORTS_FOLDER_ID || '',
    impersonateSubject: process.env.GOOGLE_IMPERSONATE_SUBJECT || '',
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.EMAIL_FROM_NAME || 'ProfitOS Engine',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || '',
    bcc: process.env.EMAIL_BCC || '',
  },

  kit: {
    apiKey: process.env.KIT_API_KEY || '',
    apiSecret: process.env.KIT_API_SECRET || '',
    baseUrl: process.env.KIT_BASE_URL || 'https://api.kit.com/v4',
    auditCompletedTagId: process.env.KIT_AUDIT_COMPLETED_TAG_ID || '',
  },

  engine: {
    enrichmentDeadlineMs: num(process.env.ENRICHMENT_DEADLINE_MS, 90000),
    pdfOutputDir: process.env.PDF_OUTPUT_DIR || './tmp',
    pdfRenderer: (process.env.PDF_RENDERER || 'puppeteer').toLowerCase(),
  },
};

// Report (non-fatal) on configuration that will degrade functionality.
// The engine is designed to keep producing a report even when an
// individual integration is unconfigured — it simply marks that data
// source as unavailable.
export function configWarnings() {
  const warn = [];
  if (!config.wf06AuditSecret) warn.push('WF06_AUDIT_SECRET is empty — inbound auth is effectively disabled.');
  if (!config.apollo.apiKey) warn.push('APOLLO_API_KEY missing — Apollo enrichment will be skipped.');
  if (!config.lusha.apiKey) warn.push('LUSHA_API_KEY missing — Lusha enrichment will be skipped.');
  if (!config.semrush.apiKey) warn.push('SEMRUSH_API_KEY missing — Semrush enrichment will be skipped.');
  if (!config.clay.apiKey && !config.clay.webhookUrl) warn.push('Clay not configured — Clay enrichment will be skipped.');
  if (!config.drive.reportsFolderId) warn.push('GDRIVE_REPORTS_FOLDER_ID missing — PDF upload to Drive will be skipped.');
  if (!config.email.host) warn.push('SMTP_HOST missing — email delivery will be skipped.');
  if (!config.kit.auditCompletedTagId) warn.push('KIT_AUDIT_COMPLETED_TAG_ID missing — Kit tag callback will be skipped.');
  return warn;
}
