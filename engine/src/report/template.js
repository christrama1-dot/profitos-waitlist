// Renders the assembled report model into a standalone HTML document matching
// the ProfitOS dark brand. Puppeteer rasterizes this to PDF. The pdfkit
// fallback renders the same data without HTML. All values are HTML-escaped.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
const SEVERITY_COLOR = { 0: '#00FF88', 1: '#9F8FEF', 2: '#F472B6', 3: '#FF5C5C' };

export function renderReportHtml(report) {
  const { business, headline, categories, top_opportunities, benchmarks, meta, contact, disclaimer, data_sources } = report;

  const sourceBadges = Object.entries(data_sources || {})
    .map(([src, info]) => {
      const color = info.available ? '#00FF88' : '#6b6f82';
      const state = info.available ? 'live' : info.timeout ? 'timed out' : 'n/a';
      return `<span class="badge" style="border-color:${color};color:${color}">${esc(src)} · ${esc(state)}</span>`;
    })
    .join('');

  const categoryRows = categories
    .map((c) => {
      const color = SEVERITY_COLOR[c.score] || '#9F8FEF';
      const bars = [0, 1, 2, 3]
        .map((i) => `<span class="dot" style="background:${i <= c.score ? color : 'rgba(255,255,255,.12)'}"></span>`)
        .join('');
      return `
      <tr>
        <td>
          <div class="cat-label">${esc(c.label)}</div>
          <div class="cat-desc">${esc(c.description)}</div>
        </td>
        <td class="nowrap"><div class="dots">${bars}</div><div class="sev" style="color:${color}">${esc(c.severity)}</div></td>
        <td class="amt">${money(c.annual_leak)}<span class="per">/yr</span></td>
      </tr>
      <tr class="rec-row"><td colspan="3"><span class="rec-arrow">→</span> ${esc(c.recommendation)}</td></tr>`;
    })
    .join('');

  const topCards = top_opportunities
    .map(
      (t, i) => `
      <div class="op-card">
        <div class="op-rank">#${i + 1}</div>
        <div class="op-label">${esc(t.label)}</div>
        <div class="op-amt">${money(t.annual_leak)}<span class="per">/yr</span></div>
        <div class="op-rec">${esc(t.recommendation)}</div>
      </div>`,
    )
    .join('');

  const rpe = benchmarks.revenue_per_employee;
  const benchRow = rpe
    ? `<div class="bench"><span>Revenue / employee</span><strong>${money(rpe)}</strong><span class="vs">vs ${money(benchmarks.benchmark_revenue_per_employee)} benchmark</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; background:#0D0F1A; color:#E8E9F0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { padding: 48px 56px; }
  .wm { font-family:'Courier New', monospace; letter-spacing:.25em; font-size:11px; color:#00FF88; text-transform:uppercase; }
  h1 { font-size:30px; font-weight:900; margin:6px 0 4px; line-height:1.1; }
  .sub { color:rgba(232,233,240,.55); font-size:13px; }
  .hero { margin:30px 0; padding:28px 32px; border:1px solid rgba(0,255,136,.25); border-radius:16px; background:linear-gradient(135deg, rgba(0,255,136,.06), rgba(159,143,239,.06)); }
  .hero .big { font-size:46px; font-weight:900; color:#00FF88; line-height:1; }
  .hero .big .per { font-size:18px; color:rgba(232,233,240,.5); font-weight:700; }
  .hero .mo { color:#9F8FEF; font-weight:700; margin-top:6px; font-size:15px; }
  .hero .narr { margin-top:16px; font-size:13.5px; line-height:1.6; color:rgba(232,233,240,.85); }
  .grid { display:flex; gap:14px; margin:18px 0 8px; }
  .stat { flex:1; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:16px; }
  .stat .k { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:rgba(232,233,240,.5); }
  .stat .v { font-size:22px; font-weight:800; margin-top:4px; }
  .health .v { color:#00FF88; }
  .section-title { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:#9F8FEF; margin:34px 0 14px; font-weight:700; }
  .ops { display:flex; gap:14px; }
  .op-card { flex:1; border:1px solid rgba(159,143,239,.3); border-radius:12px; padding:16px; background:rgba(159,143,239,.05); }
  .op-rank { font-family:'Courier New',monospace; color:#9F8FEF; font-size:12px; font-weight:700; }
  .op-label { font-weight:800; font-size:14px; margin:6px 0; }
  .op-amt { color:#F472B6; font-weight:900; font-size:20px; }
  .op-amt .per { font-size:11px; color:rgba(232,233,240,.5); font-weight:700; }
  .op-rec { font-size:11.5px; line-height:1.5; color:rgba(232,233,240,.75); margin-top:8px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:14px 8px; border-bottom:1px solid rgba(255,255,255,.07); vertical-align:top; font-size:13px; }
  .cat-label { font-weight:700; }
  .cat-desc { color:rgba(232,233,240,.5); font-size:11.5px; margin-top:3px; }
  .amt { text-align:right; font-weight:800; font-size:15px; white-space:nowrap; }
  .amt .per { font-size:11px; color:rgba(232,233,240,.45); font-weight:600; }
  .nowrap { white-space:nowrap; width:120px; }
  .dots { display:flex; gap:4px; }
  .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .sev { font-size:11px; margin-top:5px; font-weight:700; }
  .rec-row td { border-bottom:1px solid rgba(255,255,255,.07); padding-top:0; color:rgba(232,233,240,.7); font-size:11.5px; }
  .rec-arrow { color:#00FF88; font-weight:800; }
  .bench { margin-top:16px; font-size:12px; color:rgba(232,233,240,.6); }
  .bench strong { color:#E8E9F0; font-size:15px; margin:0 8px; }
  .bench .vs { color:rgba(232,233,240,.4); }
  .badges { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; }
  .badge { font-family:'Courier New',monospace; font-size:10px; padding:3px 8px; border:1px solid; border-radius:20px; }
  .foot { margin-top:34px; padding-top:18px; border-top:1px solid rgba(255,255,255,.08); font-size:10.5px; color:rgba(232,233,240,.45); line-height:1.6; }
</style></head>
<body>
  <div class="page">
    <div class="wm">ProfitOS Engine · Profit Leak Audit</div>
    <h1>${esc(business.name || 'Profit Leak Report')}</h1>
    <div class="sub">${esc(business.industry || 'Business')}${business.domain ? ' · ' + esc(business.domain) : ''} · Prepared for ${esc(contact.email)} · ${esc(meta.generated_at.slice(0, 10))}</div>

    <div class="hero">
      <div class="wm" style="color:rgba(232,233,240,.5)">Estimated annual profit leak</div>
      <div class="big">${money(headline.total_annual_leak)}<span class="per"> /year</span></div>
      <div class="mo">≈ ${money(headline.total_monthly_leak)} every month · ${esc(headline.leak_as_pct_of_revenue)}% of revenue</div>
      <div class="narr">${esc(headline.narrative)}</div>
    </div>

    <div class="grid">
      <div class="stat health"><div class="k">Profit Health Score</div><div class="v">${esc(headline.health_score)}/100</div></div>
      <div class="stat"><div class="k">Revenue basis</div><div class="v">${money(headline.revenue_basis)}${headline.revenue_basis_known ? '' : '*'}</div></div>
      <div class="stat"><div class="k">Monthly leak</div><div class="v">${money(headline.total_monthly_leak)}</div></div>
    </div>
    ${benchRow}
    <div class="badges">${sourceBadges}</div>

    <div class="section-title">Top 3 Recoverable Opportunities</div>
    <div class="ops">${topCards}</div>

    <div class="section-title">Full Profit-Leak Breakdown</div>
    <table>${categoryRows}</table>

    <div class="foot">
      ${esc(disclaimer)}<br/>
      Report ${esc(meta.run_id)} · Generated by ${esc(meta.engine)} · ${esc(meta.generated_at)}${headline.revenue_basis_known ? '' : '<br/>* Revenue basis estimated from your reported range; connect accounting for exact figures.'}
    </div>
  </div>
</body></html>`;
}
