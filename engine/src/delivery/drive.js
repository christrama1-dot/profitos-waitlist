// Uploads the generated PDF to a Google Drive folder via a service account.
// Credentials come from the environment (base64 JSON or a key file path) —
// never hard-coded. Returns a shareable link, or a degraded result if Drive
// is not configured. Never throws into the pipeline.
import { createReadStream } from 'node:fs';
import { config } from '../config.js';

let cachedClient = null;

async function getDriveClient(log) {
  if (cachedClient) return cachedClient;
  const { google } = await import('googleapis');

  let credentials;
  if (config.drive.serviceAccountJsonBase64) {
    credentials = JSON.parse(Buffer.from(config.drive.serviceAccountJsonBase64, 'base64').toString('utf8'));
  }

  const authOptions = {
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  };
  if (credentials) authOptions.credentials = credentials;
  else if (config.drive.serviceAccountKeyFile) authOptions.keyFile = config.drive.serviceAccountKeyFile;
  else throw new Error('no Google service account credentials configured');

  if (config.drive.impersonateSubject) authOptions.clientOptions = { subject: config.drive.impersonateSubject };

  const auth = new google.auth.GoogleAuth(authOptions);
  cachedClient = google.drive({ version: 'v3', auth });
  log?.debug('google drive client initialized');
  return cachedClient;
}

export async function uploadToDrive({ filePath, fileName }, log) {
  if (!config.drive.reportsFolderId || (!config.drive.serviceAccountJsonBase64 && !config.drive.serviceAccountKeyFile)) {
    return { ok: false, skipped: true, reason: 'Drive not configured', link: null };
  }
  try {
    const drive = await getDriveClient(log);
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [config.drive.reportsFolderId],
        mimeType: 'application/pdf',
      },
      media: { mimeType: 'application/pdf', body: createReadStream(filePath) },
      fields: 'id, webViewLink, webContentLink',
    });

    const fileId = res.data.id;
    // Make the file link-accessible so it can be referenced from the email.
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (permErr) {
      log?.warn('could not set Drive public permission (continuing)', { error: permErr.message });
    }

    log?.info('PDF uploaded to Drive', { fileId });
    return {
      ok: true,
      skipped: false,
      fileId,
      link: res.data.webViewLink || res.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`,
    };
  } catch (err) {
    log?.error('Drive upload failed (continuing)', { error: err.message });
    return { ok: false, skipped: false, reason: err.message, link: null };
  }
}
