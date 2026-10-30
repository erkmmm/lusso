/**
 * The customer's quote as a document they can keep.
 *
 * A quote on screen is a thing you make decisions in — options toggle, the
 * total moves, nothing is settled. A quote on paper is the opposite: it is the
 * decision, frozen. So this does not try to photograph the page. It rebuilds
 * the quote from the SAME selections the customer is looking at, which means
 * the PDF says what their screen said at the moment they asked for it, and a
 * customer who tries two combinations and saves both gets two honest documents
 * rather than two pictures of a webpage.
 *
 * Built off a plain snapshot for the same reason the purchase order is: the
 * document is reproducible from data alone, with no DOM and no styling in the
 * way.
 */

import { getLogoDataUrl, LOGO_ASPECT } from './brandLogo';

const M = 40;              // page margin, points
const INK = [26, 24, 22];
const MUTED = [120, 115, 110];
const RULE = [214, 208, 200];

/** Strip anything that would make a filename awkward on a phone or a Mac. */
export const quoteFileBase = (snap) =>
  `${snap.quoteNumber || 'Quotation'}${snap.customerName ? ` — ${snap.customerName}` : ''}`
    .replace(/[\\/:*?"<>|]+/g, '-').trim();

export async function buildQuotePdf(snap) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Masthead ──────────────────────────────────────────────────────────────
  const logo = await getLogoDataUrl();
  if (logo) {
    // Alias + compression: without them jsPDF re-embeds the decoded bitmap, and
    // a 30KB logo turned a two-page quote into a 3MB file — which matters for a
    // document whose whole job is to be emailed on to a partner or a builder.
    doc.addImage(logo, 'PNG', M, M - 6, 26 * LOGO_ASPECT, 26, 'lussoLogo', 'FAST');
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...INK);
    doc.text('LUSSO', M, M + 14);
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`QUOTATION ${snap.quoteNumber || ''}`.trim(), pageW - M, M + 2, { align: 'right' });
  if (snap.issued)  doc.text(`Issued ${snap.issued}`, pageW - M, M + 16, { align: 'right' });
  if (snap.expiry)  doc.text(`Pricing held until ${snap.expiry}`, pageW - M, M + 30, { align: 'right' });

  let y = M + 58;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(16); doc.setTextColor(...INK);
  doc.splitTextToSize(snap.title || 'Quotation', pageW - M * 2 - 150).forEach((line) => {
    doc.text(line, M, y); y += 20;
  });

  if (snap.siteAddress) {
    doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(snap.siteAddress, M, y); y += 16;
  }
  y += 8;

  // ── A table per room, so the paper reads in the same order as the page ────
  const money = (n) => snap.formatMoney(n);
  snap.rooms.forEach((room) => {
    autoTable(doc, {
      head: [[room.room, 'Qty', 'Price']],
      body: room.lines.map(l => [
        l.location && l.location !== room.room ? `${l.name}\n${l.location}` : l.name,
        String(l.quantity || 1),
        money(l.total),
      ]),
      startY: y,
      margin: { left: M, right: M },
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: { top: 6, bottom: 6, left: 0, right: 0 }, textColor: INK, overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold', fontSize: 10, textColor: INK, lineWidth: { bottom: 0.7 }, lineColor: RULE },
      columnStyles: {
        0: { cellWidth: pageW - M * 2 - 140 },
        1: { cellWidth: 50, halign: 'right', textColor: MUTED },
        2: { cellWidth: 90, halign: 'right' },
      },
      // Repeating the room name on a page break stops a continued room from
      // reading as an untitled list of charges.
      showHead: 'everyPage',
    });
    y = (doc.lastAutoTable?.finalY || y) + 18;
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  if (y > pageH - 170) { doc.addPage(); y = M; }
  doc.setDrawColor(...RULE); doc.setLineWidth(0.7);
  doc.line(M, y, pageW - M, y); y += 18;

  snap.summaryRows.forEach((row) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(row.label, M, y);
    doc.setTextColor(...INK);
    doc.text(row.value, pageW - M, y, { align: 'right' });
    y += 16;
  });

  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
  doc.text(`Total${snap.gstSuffix || ''}`, M, y);
  doc.text(snap.total, pageW - M, y, { align: 'right' });
  y += 22;

  if (snap.depositNote) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.splitTextToSize(snap.depositNote, pageW - M * 2).forEach((line) => { doc.text(line, M, y); y += 13; });
    y += 6;
  }

  // ── Terms ─────────────────────────────────────────────────────────────────
  if ((snap.terms || '').trim()) {
    if (y > pageH - 120) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text('TERMS', M, y); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.splitTextToSize(snap.terms.trim(), pageW - M * 2).forEach((line) => {
      if (y > pageH - 50) { doc.addPage(); y = M; }
      doc.text(line, M, y); y += 12;
    });
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    if (snap.footer) doc.text(snap.footer, M, pageH - 26);
    doc.text(`${p} of ${pages}`, pageW - M, pageH - 26, { align: 'right' });
  }

  return doc;
}

export async function downloadQuotePdf(snap) {
  (await buildQuotePdf(snap)).save(`${quoteFileBase(snap)}.pdf`);
}
