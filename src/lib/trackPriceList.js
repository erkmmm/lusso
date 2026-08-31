/**
 * Read made-to-measure track pricing out of a supplier price book.
 *
 * Track pricing isn't a product list — it's a set of small banded tables, one
 * per track series, each shaped:
 *
 *     Track Size M | Number Of Brackets | Standard | Clear Wave
 *     2.00           4                    $143.00    $165.00
 *     3.00           5                    $188.00    $235.00
 *
 * They live in the curtain rate card rather than the price library, because the
 * calculator looks a track price up by band rather than multiplying a rate.
 *
 * Three things vary between series and all of them matter:
 *   • the bands themselves — Series 84 runs 2–12m in whole metres, Series 70
 *     runs 1–6m in half metres, so a single shared set of widths won't do
 *   • the second column is sometimes a bracket count and sometimes a price
 *   • the wide-heading column is "Clear Wave" on some pages and "S-Wave" on
 *     others, and both mean the same thing to the calculator
 *
 * A series that stops early says so ("NOT AVAILABLE OVER 8m") and that's kept:
 * the calculator refuses to price past the last band rather than guessing, which
 * is the correct behaviour for a track you can't actually buy that long.
 */

/** "$1,059.00" → 1059. Returns null for anything that isn't a price. */
function money(s) {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Series title, from the page's own heading.
 *
 * Every page repeats the same address block, then a code and a date, then the
 * title — so the title is what follows the date, trimmed at the boilerplate
 * that comes after it.
 */
function seriesTitle(text) {
  const m = text.match(/ABN[^]{0,40}?[\d.]+\s+\w+\s+\d{4}\s+(.{4,80}?)\s*(?:Made to Measure|Tracking System Components|Components Code|Track Size)/i);
  if (m) return m[1].replace(/\s{2,}/g, ' ').trim();
  const alt = text.match(/((?:The\s+\w+\s+System\s+)?Series\s+\d+[^$]{0,50}?System)/i);
  return alt ? alt[1].replace(/\s{2,}/g, ' ').trim() : '';
}

/**
 * Pull the banded rows out of one page's text.
 *
 * Rows are found by shape rather than by position: a track length in metres,
 * optionally a bracket count, then two prices. Reading the shape is what lets
 * the same code handle a page with a bracket column and one without.
 */
function parseBands(text) {
  const start = text.search(/Track Size/i);
  if (start < 0) return null;

  // Stop before the footnotes — "Over 6.00m $27.50 / 1.00m" is a rate, not a band.
  const body = text.slice(start);
  const overM = body.match(/Over\s+([\d.]+)\s*m[^$]{0,20}\$\s*([\d,.]+)\s*\/\s*([\d.]+)\s*\.?0?0?\s*m/i);
  const cutAt = body.search(/Over\s+[\d.]+\s*m|NOT AVAILABLE|Please note|When [Oo]rdering|Split track/);
  const rows  = cutAt > 0 ? body.slice(0, cutAt) : body;

  // <metres> [<brackets>] $<standard> $<wave>
  const re = /(\d+\.\d{2})\s+(?:(\d{1,2})\s+)?\$\s*([\d,]+(?:\.\d{2})?)\s+\$\s*([\d,]+(?:\.\d{2})?)/g;
  const bands = [];
  let m;
  while ((m = re.exec(rows)) !== null) {
    const metres   = parseFloat(m[1]);
    const standard = money(m[3]);
    const wave     = money(m[4]);
    if (!Number.isFinite(metres) || standard === null || wave === null) continue;
    bands.push({ widthMm: Math.round(metres * 1000), standard, clearWave: wave });
  }
  if (bands.length < 3) return null;

  // Bands must climb; a stray match from a different table would break that.
  bands.sort((a, b) => a.widthMm - b.widthMm);

  const maxNote = body.match(/NOT AVAILABLE OVER\s*([\d.]+)\s*m/i);

  return {
    bands,
    // A per-metre rate beyond the last band, when the page states one. Kept as
    // information rather than applied: the calculator prices from bands, and
    // inventing bands from a rate would put numbers in the rate card that the
    // supplier never printed.
    overRate: overM ? { fromMm: Math.round(parseFloat(overM[1]) * 1000), perMetre: money(overM[2]) } : null,
    notAvailableOverMm: maxNote ? Math.round(parseFloat(maxNote[1]) * 1000) : null,
    waveLabel: /Clear\s*Wave/i.test(body) ? 'Clear Wave' : /S[-–]\s*Wave/i.test(body) ? 'S-Wave' : 'Wave',
  };
}

/**
 * Every banded track table in the document, one entry per series page.
 *
 * @param {Array} pages  [{ page, text }]
 */
export function findTrackTables(pages) {
  const out = [];
  for (const { page, text } of pages) {
    const parsed = parseBands(text);
    if (!parsed) continue;
    const title = seriesTitle(text) || `Page ${page}`;
    out.push({
      page,
      title,
      ...parsed,
      widthsMm:  parsed.bands.map(b => b.widthMm),
      standard:  parsed.bands.map(b => b.standard),
      clearWave: parsed.bands.map(b => b.clearWave),
    });
  }
  return out;
}

/** Read a PDF File into per-page text, for findTrackTables. */
export async function extractPdfPages(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    pages.push({ page: p, text: content.items.map(i => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ') });
  }
  return pages;
}

/**
 * Suggest which rate-card track a detected series belongs to.
 *
 * Matching is on the series number plus how it's driven, because that's what
 * actually distinguishes them: Series 84 appears twice in the book, once hand
 * drawn and once motorised, and they're different tracks at very different
 * prices. Nothing is guessed on the strength of the number alone.
 */
export function suggestTrackType(title, trackTypes) {
  const t = String(title || '').toLowerCase();
  const series = t.match(/series\s*(\d+)/)?.[1];
  if (!series) return null;

  const motorised = /motoris|somfy|acmeda|turbo|powered/.test(t);
  const handDrawn = /hand\s*drawn/.test(t);

  const score = (name) => {
    const n = name.toLowerCase();
    if (!n.includes(series)) return -1;
    let s = 1;
    // "(240v)" and "(Battery)" are both motorised; "(Manual)" is hand drawn.
    const nameMotorised = /240v|battery|motor/.test(n);
    const nameManual    = /manual|hand/.test(n);
    if (motorised && nameMotorised) s += 2;
    if (handDrawn && nameManual)    s += 2;
    if (motorised && nameManual)    s -= 2;
    if (handDrawn && nameMotorised) s -= 2;
    return s;
  };

  let best = null, bestScore = 0;
  for (const name of trackTypes) {
    const s = score(name);
    if (s > bestScore) { bestScore = s; best = name; }
  }
  return best;
}

/**
 * Compare a detected table against what the rate card holds today.
 *
 * Returned per band so the change can be shown before it's applied — a price
 * list import that silently overwrites a rate card is not something anyone
 * should have to trust.
 */
export function diffAgainstRates(detected, current) {
  const curWidths = current?.widthsMm || [];
  const rows = detected.widthsMm.map((w, i) => {
    const ci = curWidths.indexOf(w);
    const oldStd  = ci >= 0 ? current?.standard?.[ci]  ?? null : null;
    const oldWave = ci >= 0 ? current?.clearWave?.[ci] ?? null : null;
    const newStd  = detected.standard[i];
    const newWave = detected.clearWave[i];
    const pct = (a, b) => (a === null || !a) ? null : Math.round(((b - a) / a) * 1000) / 10;
    return {
      widthMm: w,
      oldStandard: oldStd, newStandard: newStd, stdPct: pct(oldStd, newStd),
      oldClearWave: oldWave, newClearWave: newWave, wavePct: pct(oldWave, newWave),
      isNew: ci < 0,
    };
  });
  const dropped = curWidths.filter(w => !detected.widthsMm.includes(w));
  const changed = rows.filter(r => r.oldStandard !== r.newStandard || r.oldClearWave !== r.newClearWave).length;
  return { rows, dropped, changed };
}
