import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Read every text page, preserving page references. Drawings remain evidence,
 * not permission to turn ceiling heights into finished manufacturing sizes. */
export async function extractPlanPages(bytes, { maxPages = 120, maxChars = 140000 } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const text = content.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      pages.push({ page: n, text });
    }
    let remaining = maxChars;
    const selected = pages.map(page => {
      const size = Math.min(page.text.length, 7000, remaining);
      remaining -= size;
      return { page: page.page, text: page.text.slice(0, size), truncated: size < page.text.length };
    });
    return { pageCount: pdf.numPages, pages: selected, omittedPages: Math.max(0, pdf.numPages - maxPages), needsVisualReview: !pages.some(p => p.text.length > 100) };
  } finally { await pdf.destroy(); }
}

export async function loadProjectPlans(rows, { jobId, download }) {
  const plans = [];
  for (const row of rows.filter(r => !r.deleted_at && r.file_path).slice(0, 3)) {
    const base = { fileName: row.file_name || 'Project plan', revision: row.revision || 1,
      updatedAt: row.revision_uploaded_at || row.updated_at || row.created_at,
      planViewerUrl: `https://app.lusso.com.au/jobs/${jobId}/takeoff` };
    // Never retrieve another project's private storage object.
    if (!String(row.file_path).startsWith(`${jobId}/`) || row.file_path.split('/').includes('..')) {
      plans.push({ ...base, error: 'This plan does not belong to the requested project.' }); continue;
    }
    try {
      const bytes = await download(row.file_path);
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Plan exceeds the 50MB text-reading limit; inspect it in the project plan viewer.');
      plans.push({ ...base, ...await extractPlanPages(bytes) });
    } catch (e) { plans.push({ ...base, error: e.message || 'Read the plan in the project plan viewer.' }); }
  }
  return plans;
}
