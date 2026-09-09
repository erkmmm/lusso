/**
 * Extract plain text from a spreadsheet File (.xlsx / .xls / .xlsm / .ods) so it
 * can be stored in the AI knowledge base.
 *
 * Every non-empty sheet becomes a CSV block under a "## Sheet: <name>" heading —
 * compact, and the row/column structure survives for the model to read.
 */
export async function extractSheetText(file, { maxChars = 76000 } = {}) {
  const XLSX = await import('xlsx');

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const blocks = [];
  let used = 0;
  const truncated = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;

    normaliseDates(ws);
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    // Excel files often carry formatting far past the real data — drop the
    // resulting all-comma rows and trailing empty cells.
    const rows = csv
      .split('\n')
      .map(line => line.replace(/,+\s*$/, ''))
      .filter(line => line.trim() !== '');
    if (!rows.length) continue;

    let body = rows.join('\n');
    const remaining = maxChars - used - name.length - 20;
    if (remaining <= 0) { truncated.push(name); continue; }
    if (body.length > remaining) {
      body = body.slice(0, remaining);
      truncated.push(name);
    }

    const block = `## Sheet: ${name}\n${body}`;
    blocks.push(block);
    used += block.length + 2;
  }

  if (!blocks.length) return '';

  let text = blocks.join('\n\n');
  if (truncated.length) {
    text += `\n\n[Truncated — this workbook is larger than the knowledge base limit. Shortened sheet(s): ${truncated.join(', ')}]`;
  }
  return text.trim();
}

/**
 * Rewrite date cells as ISO strings. Excel's own format would otherwise render
 * them US-style (1/2/26), which reads as the wrong day here.
 */
function normaliseDates(ws) {
  for (const ref of Object.keys(ws)) {
    if (ref[0] === '!') continue;
    const cell = ws[ref];
    if (cell?.t !== 'd' || !(cell.v instanceof Date)) continue;
    const d = cell.v;
    const pad = n => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = (d.getHours() || d.getMinutes() || d.getSeconds())
      ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
      : '';
    ws[ref] = { t: 's', v: date + time };
  }
}
