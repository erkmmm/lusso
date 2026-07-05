/**
 * Dashboard PDF report — a printable business summary of the currently
 * selected period. Built programmatically with jsPDF (same stack as the PO
 * PDF) so text stays crisp and tables paginate cleanly.
 *
 * Receives a plain snapshot object from the Dashboard (already filtered by
 * range/salesperson and passed through presentation-mode transforms), so this
 * module has no store dependencies and is testable in Node.
 */

import { getLogoDataUrl, LOGO_ASPECT } from './brandLogo';

const fmt$ = (v) => `$${Math.round(v || 0).toLocaleString('en-AU')}`;
const pct  = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(0)}%`);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function buildDashboardReport(s) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40; // margin

  // ── Header ──
  const logo = await getLogoDataUrl();
  if (logo) {
    doc.addImage(logo, 'PNG', M, 28, 24 * LOGO_ASPECT, 24);
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20);
    doc.text('LUSSO', M, 48);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(90);
  doc.text('Business Report', M, 66);
  doc.setFontSize(10); doc.setTextColor(120);
  const meta = [
    `Period: ${s.periodLabel}`,
    s.salesperson ? `Salesperson: ${s.salesperson}` : 'All salespeople',
    `Generated: ${s.generatedAt}`,
  ];
  meta.forEach((line, i) => doc.text(line, pageW - M, 40 + i * 13, { align: 'right' }));

  let y = 88;
  const section = (title) => {
    if (y > pageH - 120) { doc.addPage(); y = 48; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30);
    doc.text(title, M, y);
    y += 8;
  };
  const table = (head, body, opts = {}) => {
    autoTable(doc, {
      head: [head], body,
      startY: y,
      margin: { left: M, right: M },
      styles: { fontSize: 9.5, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [241, 241, 241], textColor: [40, 40, 40], fontStyle: 'bold', fontSize: 9 },
      ...opts,
    });
    y = doc.lastAutoTable.finalY + 24;
  };

  // ── Key numbers ──
  section('Key numbers');
  table(['Metric', 'Value', 'Notes'], [
    ['Total revenue',   fmt$(s.revenue),        s.revenueDeltaPct != null ? `${s.revenueDeltaPct >= 0 ? '+' : ''}${s.revenueDeltaPct.toFixed(1)}% vs same time last year` : ''],
    ['Pipeline value',  fmt$(s.pipelineValue),  `${s.pipelineCount} open quotes (last 12 months)`],
    ['Quotes won',      String(s.quotesWon),    `average ${fmt$(s.avgQuote)}`],
    ['Win rate',        pct(s.winRate),         `of ${s.decisions} resolved quotes`],
    ['Gross margin',    s.marginValue != null ? `${fmt$(s.marginValue)} (${pct(s.marginPct)})` : '—', s.marginPct != null ? `ex GST · costs known for ${pct(s.knownShare)} of revenue` : ''],
    ['Days to win',     s.medianDays != null ? `${s.medianDays} days` : '—', s.instantPct != null ? `median wait · ${pct(s.instantPct)} say yes on the spot` : ''],
    ['Repeat revenue',  pct(s.repeatPct),       s.repeatCount ? `from ${s.repeatCount} returning customers` : ''],
  ]);

  // ── Sales by category ──
  if (s.categories?.length) {
    const total = s.categories.reduce((t, c) => t + c.revenue, 0) || 1;
    section('Sales by category');
    table(['Category', 'Units', 'Revenue', 'Share'],
      s.categories.map(c => [c.name, String(c.units), fmt$(c.revenue), `${((c.revenue / total) * 100).toFixed(0)}%`]));
  }

  // ── Decision time ──
  if (s.buckets?.some(([, n]) => n > 0)) {
    section('How long wins took (sent to yes)');
    table(['Timeframe', 'Wins'], s.buckets.map(([label, n]) => [label, String(n)]));
  }

  // ── Top customers ──
  if (s.topCustomers?.length) {
    section('Top customers (lifetime accepted value)');
    table(['#', 'Customer', 'Accepted quotes', 'Lifetime value'],
      s.topCustomers.map((c, i) => [String(i + 1), c.name, String(c.count), fmt$(c.total)]));
  }

  // ── Salespeople ──
  if (s.reps?.length > 1) {
    section('Salespeople (won revenue in period)');
    table(['#', 'Salesperson', 'Won', 'Win rate', 'Revenue'],
      s.reps.map((r, i) => [String(i + 1), r.name, String(r.won), r.winRate != null ? pct(r.winRate) : '—', fmt$(r.revenue)]));
  }

  // ── Seasonality ──
  if (s.seasonality?.avg?.some(v => v > 0)) {
    section(`Seasonality — average accepted revenue by month (across ${s.seasonality.years} years)`);
    table(['Month', 'Avg revenue'], s.seasonality.avg.map((v, i) => [MONTH_NAMES[i], fmt$(v)]));
  }

  // ── Follow-ups ──
  if (s.followUps?.length) {
    section('Follow-ups needed (open quotes)');
    table(['Customer', 'Quote', 'Value', 'Sent', 'Why'],
      s.followUps.map(f => [
        f.customer, f.quoteNumber, fmt$(f.value), `${f.sentDays}d ago`,
        [f.unopened && 'never opened', f.expiring && (f.expDays === 0 ? 'expires today' : `expires in ${f.expDays}d`)].filter(Boolean).join(', '),
      ]));
  }

  // ── Footer on every page ──
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150);
    doc.text(`Lusso Business Report · ${s.periodLabel} · page ${i} of ${pages}`, M, pageH - 20);
  }

  return doc;
}

export async function downloadDashboardReport(snapshot) {
  const doc = await buildDashboardReport(snapshot);
  const slug = snapshot.periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`lusso-report-${slug}.pdf`);
}
