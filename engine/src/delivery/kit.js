// Kit (ConvertKit) callback: applies the "audit-completed" tag to the
// submitter so downstream automations in Kit can fire. Supports both the v4
// API (Authorization: Bearer / X-Kit-Api-Key) and the legacy v3 endpoint
// (api_secret in body). Never throws into the pipeline.
import { config } from '../config.js';
import { request } from '../utils/http.js';

export async function applyAuditCompletedTag({ email }, log) {
  const tagId = config.kit.auditCompletedTagId;
  if (!tagId || (!config.kit.apiKey && !config.kit.apiSecret)) {
    return { ok: false, skipped: true, reason: 'Kit not configured' };
  }
  try {
    const isV4 = /\/v4(?:\/|$)/.test(config.kit.baseUrl);
    let res;
    if (isV4) {
      res = await request({
        label: 'kit.tag.v4',
        timeoutMs: 10000,
        method: 'POST',
        url: `${config.kit.baseUrl}/tags/${encodeURIComponent(tagId)}/subscribers`,
        headers: {
          'Content-Type': 'application/json',
          'X-Kit-Api-Key': config.kit.apiKey,
          Authorization: `Bearer ${config.kit.apiKey}`,
        },
        data: { email_address: email },
      });
    } else {
      // Legacy v3 ConvertKit: POST /tags/:id/subscribe with api_secret.
      res = await request({
        label: 'kit.tag.v3',
        timeoutMs: 10000,
        method: 'POST',
        url: `${config.kit.baseUrl}/tags/${encodeURIComponent(tagId)}/subscribe`,
        headers: { 'Content-Type': 'application/json' },
        data: { api_secret: config.kit.apiSecret || config.kit.apiKey, email },
      });
    }

    if (res.status >= 300) {
      log?.warn('Kit tag callback non-2xx (continuing)', { status: res.status });
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }
    log?.info('Kit audit-completed tag applied', { email });
    return { ok: true, skipped: false };
  } catch (err) {
    log?.error('Kit tag callback failed (continuing)', { error: err.message });
    return { ok: false, skipped: false, reason: err.message };
  }
}
