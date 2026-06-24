/**
 * PDF.js rendering helpers for the takeoff tool.
 *
 * Reuses the same pdfjs-dist + bundled-worker setup as pdfExtract.js. We keep
 * all takeoff geometry in "base coordinates" — the page's CSS-pixel size at
 * scale 1.0 (72 DPI user units) — so stored measurement points are completely
 * independent of zoom. Rendering rasterizes that same page at whatever scale
 * the viewport currently needs, optionally boosted by devicePixelRatio for
 * crispness, but the coordinate space the overlay uses never changes.
 */
let _pdfjs = null;

async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).href;
  _pdfjs = pdfjs;
  return pdfjs;
}

/** Load a PDF document from an ArrayBuffer. Returns the pdf.js document proxy. */
export async function loadPdf(arrayBuffer) {
  const { getDocument } = await getPdfjs();
  // Copy into a fresh Uint8Array — pdf.js transfers/detaches the buffer it's
  // given, which would break any later re-use of the same ArrayBuffer.
  const data = new Uint8Array(arrayBuffer.slice(0));
  return await getDocument({ data }).promise;
}

/** Base (scale 1.0) dimensions of a page, in CSS px / user units. */
export async function getPageBaseSize(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/**
 * Render a page into a canvas at `scale` (base→render multiplier).
 * `dpr` adds device-pixel-ratio crispness without affecting the CSS box.
 * The returned canvas has CSS size base*scale and backing store base*scale*dpr.
 * Cancellable via the returned `cancel()` (pdf.js render tasks can be aborted).
 */
export async function renderPageToCanvas(pdf, pageNumber, scale, canvas, dpr = 1) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: scale * dpr });
  const cssVp = page.getViewport({ scale });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(cssVp.width)}px`;
  canvas.style.height = `${Math.ceil(cssVp.height)}px`;

  // Serialize renders per-canvas: pdf.js throws if two render() calls target the
  // same canvas concurrently, which can happen on rapid zoom/page changes.
  const prev = canvas.__renderTask;
  if (prev) { try { prev.cancel(); } catch { /* already done */ } }

  const ctx = canvas.getContext('2d', { alpha: false });
  const task = page.render({ canvasContext: ctx, viewport });
  canvas.__renderTask = task;
  try {
    await task.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return null;
    throw e;
  } finally {
    if (canvas.__renderTask === task) canvas.__renderTask = null;
  }
  return canvas;
}
