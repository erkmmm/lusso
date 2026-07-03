// Shared RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
// Same implementation as ImportContacts' local parser — extracted for reuse.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ''); // strip BOM
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i += 2; }
      else if (c === '"') { inQ = false; i++; }
      else { field += c; i++; }
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ',') { row.push(field.trim()); field = ''; i++; }
      else if (c === '\r' && n === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i += 2; }
      else if (c === '\n' || c === '\r') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else { field += c; i++; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(f => f)) rows.push(row); }
  return rows;
}

// Rows (arrays) → objects keyed by the header row.
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}
