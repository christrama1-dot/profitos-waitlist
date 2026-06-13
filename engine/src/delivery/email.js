// Emails the finished report to the submitter with the PDF attached (and a
// Drive link when available). SMTP transport configured from the environment.
// Never throws into the pipeline — returns a result envelope.
import { config } from '../config.js';

let cachedTransport = null;

async function getTransport() {
  if (cachedTransport) return cachedTransport;
  const nodemailer = (await import('nodemailer')).default;
  cachedTransport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  return cachedTransport;
}

export async function sendReportEmail({ report, pdf, driveLink }, log) {
  if (!config.email.host || !config.email.fromAddress) {
    return { ok: false, skipped: true, reason: 'SMTP not configured' };
  }
  try {
    const transport = await getTransport();
    const to = report.contact.email;
    const subject = `Your ProfitOS Audit: $${report.headline.total_annual_leak.toLocaleString('en-US')}/yr in recoverable profit`;

    const info = await transport.sendMail({
      from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
      to,
      bcc: config.email.bcc || undefined,
      subject,
      text: buildText(report, driveLink),
      html: buildHtml(report, driveLink),
      attachments: pdf?.filePath
        ? [{ filename: pdf.fileName, path: pdf.filePath, contentType: 'application/pdf' }]
        : [],
    });

    log?.info('report email sent', { to, messageId: info.messageId });
    return { ok: true, skipped: false, messageId: info.messageId };
  } catch (err) {
    log?.error('email delivery failed (continuing)', { error: err.message });
    return { ok: false, skipped: false, reason: err.message };
  }
}

function buildText(report, driveLink) {
  const h = report.headline;
  const top = report.top_opportunities
    .map((t, i) => `  ${i + 1}. ${t.label}: $${t.annual_leak.toLocaleString('en-US')}/yr`)
    .join('\n');
  return [
    `Hi,`,
    ``,
    `Your ProfitOS profit-leak audit for ${report.business.name} is ready.`,
    ``,
    `Estimated annual profit leak: $${h.total_annual_leak.toLocaleString('en-US')} (~$${h.total_monthly_leak.toLocaleString('en-US')}/mo).`,
    `Profit health score: ${h.health_score}/100.`,
    ``,
    `Top recoverable opportunities:`,
    top,
    ``,
    driveLink ? `Full report: ${driveLink}` : `Your full PDF report is attached.`,
    ``,
    `— The ProfitOS Engine`,
  ].join('\n');
}

function buildHtml(report, driveLink) {
  const h = report.headline;
  const esc = (s) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const top = report.top_opportunities
    .map(
      (t, i) =>
        `<tr><td style="padding:6px 0;color:#9F8FEF;font-weight:700">#${i + 1} ${esc(t.label)}</td><td style="padding:6px 0;text-align:right;color:#F472B6;font-weight:800">$${t.annual_leak.toLocaleString('en-US')}/yr</td></tr>`,
    )
    .join('');
  return `<div style="background:#0D0F1A;color:#E8E9F0;font-family:Arial,Helvetica,sans-serif;padding:32px;border-radius:14px;max-width:600px">
    <div style="font-family:monospace;letter-spacing:.2em;color:#00FF88;font-size:11px">PROFITOS ENGINE</div>
    <h1 style="font-size:22px;margin:8px 0 4px">${esc(report.business.name)} — Profit Leak Audit</h1>
    <p style="color:rgba(232,233,240,.7);font-size:14px;line-height:1.6">${esc(h.narrative)}</p>
    <div style="margin:20px 0;padding:20px;border:1px solid rgba(0,255,136,.3);border-radius:12px">
      <div style="font-size:11px;color:rgba(232,233,240,.5);text-transform:uppercase;letter-spacing:.1em">Estimated annual profit leak</div>
      <div style="font-size:34px;font-weight:900;color:#00FF88">$${h.total_annual_leak.toLocaleString('en-US')}<span style="font-size:14px;color:rgba(232,233,240,.5)"> /yr</span></div>
      <div style="color:#9F8FEF;font-weight:700;margin-top:4px">≈ $${h.total_monthly_leak.toLocaleString('en-US')}/mo · Health score ${h.health_score}/100</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${top}</table>
    <p style="margin-top:24px">
      ${driveLink ? `<a href="${esc(driveLink)}" style="background:#00FF88;color:#0D0F1A;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:800">View full report →</a>` : 'Your full PDF report is attached to this email.'}
    </p>
    <p style="color:rgba(232,233,240,.4);font-size:11px;margin-top:28px;line-height:1.5">${esc(report.disclaimer)}</p>
  </div>`;
}
