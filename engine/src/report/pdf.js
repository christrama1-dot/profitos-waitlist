// PDF generation. Puppeteer is preferred (renders the branded HTML template
// faithfully); pdfkit is the fallback when a headless browser is unavailable
// (e.g. constrained container). Both produce a file on disk and return its
// path + bytes. A failure in puppeteer automatically degrades to pdfkit.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { renderReportHtml } from './template.js';

export async function generatePdf(report, log) {
  await mkdir(config.engine.pdfOutputDir, { recursive: true });
  const fileName = `profitos-audit-${slug(report.business.name)}-${report.meta.run_id}.pdf`;
  const filePath = join(config.engine.pdfOutputDir, fileName);

  const preferPuppeteer = config.engine.pdfRenderer !== 'pdfkit';
  if (preferPuppeteer) {
    try {
      const bytes = await renderWithPuppeteer(report, filePath, log);
      return { filePath, fileName, bytes, renderer: 'puppeteer' };
    } catch (err) {
      log?.warn('puppeteer PDF render failed; falling back to pdfkit', { error: err.message });
    }
  }
  const bytes = await renderWithPdfkit(report, filePath);
  return { filePath, fileName, bytes, renderer: 'pdfkit' };
}

async function renderWithPuppeteer(report, filePath, log) {
  // Lazy import so the (heavy) dependency only loads when actually used.
  const puppeteer = (await import('puppeteer')).default;
  const html = renderReportHtml(report);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(filePath));
    log?.debug('puppeteer pdf rendered', { bytes: size });
    return size;
  } finally {
    await browser.close();
  }
}

async function renderWithPdfkit(report, filePath) {
  const PDFDocument = (await import('pdfkit')).default;
  const fs = await import('node:fs');
  const { headline, business, contact, categories, top_opportunities, meta, disclaimer } = report;

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    let bytes = 0;
    doc.on('data', (chunk) => (bytes += chunk.length));
    stream.on('error', reject);
    stream.on('finish', () => resolve(bytes));
    doc.pipe(stream);

    const BG = '#0D0F1A';
    const GREEN = '#00FF88';
    const PURPLE = '#9F8FEF';
    const PINK = '#F472B6';
    const WHITE = '#E8E9F0';
    const W = doc.page.width;
    const H = doc.page.height;

    doc.rect(0, 0, W, H).fill(BG);
    doc.fillColor(GREEN).fontSize(10).font('Courier-Bold').text('PROFITOS ENGINE · PROFIT LEAK AUDIT', 50, 50);
    doc.fillColor(WHITE).fontSize(26).font('Helvetica-Bold').text(business.name || 'Profit Leak Report', 50, 70);
    doc
      .fillColor(WHITE)
      .opacity(0.6)
      .fontSize(11)
      .font('Helvetica')
      .text(`${business.industry || 'Business'} · Prepared for ${contact.email} · ${meta.generated_at.slice(0, 10)}`)
      .opacity(1);

    // Hero figure
    let y = 130;
    doc.roundedRect(50, y, W - 100, 130, 14).fill('#11142400');
    doc.fillColor(WHITE).opacity(0.5).fontSize(10).font('Courier-Bold').text('ESTIMATED ANNUAL PROFIT LEAK', 66, y + 16).opacity(1);
    doc.fillColor(GREEN).fontSize(40).font('Helvetica-Bold').text(money(headline.total_annual_leak) + ' /yr', 64, y + 32);
    doc
      .fillColor(PURPLE)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(`≈ ${money(headline.total_monthly_leak)} every month · ${headline.leak_as_pct_of_revenue}% of revenue`, 66, y + 84);

    y += 150;
    doc.fillColor(WHITE).opacity(0.85).fontSize(11).font('Helvetica').text(headline.narrative, 50, y, { width: W - 100, lineGap: 3 }).opacity(1);
    y = doc.y + 18;

    // Stats line
    doc.fillColor(WHITE).fontSize(11).font('Helvetica-Bold');
    doc.text(`Profit Health Score: ${headline.health_score}/100    Revenue basis: ${money(headline.revenue_basis)}${headline.revenue_basis_known ? '' : '*'}`, 50, y);
    y = doc.y + 16;

    // Top opportunities
    doc.fillColor(PURPLE).fontSize(11).font('Courier-Bold').text('TOP 3 RECOVERABLE OPPORTUNITIES', 50, y);
    y = doc.y + 8;
    top_opportunities.forEach((t, i) => {
      doc.fillColor(PINK).fontSize(13).font('Helvetica-Bold').text(`#${i + 1} ${t.label} — ${money(t.annual_leak)}/yr`, 50, y);
      y = doc.y + 2;
      doc.fillColor(WHITE).opacity(0.75).fontSize(10).font('Helvetica').text(t.recommendation, 60, y, { width: W - 120, lineGap: 2 }).opacity(1);
      y = doc.y + 10;
    });

    // Full breakdown
    y += 6;
    doc.fillColor(PURPLE).fontSize(11).font('Courier-Bold').text('FULL PROFIT-LEAK BREAKDOWN', 50, y);
    y = doc.y + 10;
    categories.forEach((c) => {
      if (y > H - 110) {
        doc.addPage();
        doc.rect(0, 0, W, H).fill(BG);
        y = 60;
      }
      doc.fillColor(WHITE).fontSize(12).font('Helvetica-Bold').text(c.label, 50, y, { continued: true });
      doc.fillColor(severityColor(c.score)).text(`   ${money(c.annual_leak)}/yr · ${c.severity}`);
      y = doc.y + 2;
      doc.fillColor(WHITE).opacity(0.6).fontSize(9.5).font('Helvetica').text(c.description, 50, y, { width: W - 100 }).opacity(1);
      y = doc.y + 2;
      doc.fillColor(GREEN).fontSize(9.5).font('Helvetica').text(`→ ${c.recommendation}`, 60, y, { width: W - 120, lineGap: 1 });
      y = doc.y + 12;
    });

    if (y > H - 90) {
      doc.addPage();
      doc.rect(0, 0, W, H).fill(BG);
      y = 60;
    }
    doc
      .fillColor(WHITE)
      .opacity(0.45)
      .fontSize(8.5)
      .font('Helvetica')
      .text(`${disclaimer}\nReport ${meta.run_id} · ${meta.engine} · ${meta.generated_at}`, 50, H - 80, { width: W - 100, lineGap: 2 })
      .opacity(1);

    doc.end();
  });
}

function severityColor(score) {
  return ['#00FF88', '#9F8FEF', '#F472B6', '#FF5C5C'][score] || '#9F8FEF';
}

const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

function slug(s) {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'report';
}
