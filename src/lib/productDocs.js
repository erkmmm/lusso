/**
 * Product reference documents — supplier spec sheets, install guides, warranty
 * and care instructions.
 *
 * Binaries live in the private `product-docs` bucket; the record stores only the
 * path, and viewing mints a short-lived signed URL. Paths are IMMUTABLE per
 * document (`{documentId}.{ext}`), so a given path always holds the same bytes —
 * which is what will let these be cached for offline reading later, the same way
 * takeoff plans are.
 *
 * ── On parsing, and why it can't make the library unreliable ────────────────
 * Spec sheets come from a dozen suppliers and no two are laid out alike. So
 * nothing here is allowed to be authoritative: the parsers below only ever
 * produce SUGGESTIONS that pre-fill the upload form for a human to confirm.
 * What the user types is what gets stored.
 *
 * The one thing extraction genuinely affects is whether a document can be found
 * by its contents. When a PDF has no text layer (a scan, or a flattened export)
 * we record `hasText: false` rather than pretend — the document is still filed,
 * still viewable, still findable by title/supplier/code, and the UI says plainly
 * that its contents aren't searchable.
 */
import { supabase } from './supabase';

const BUCKET = 'product-docs';
const SIGNED_TTL = 3600; // seconds

export const DOC_TYPES = [
  { key: 'spec',     label: 'Spec sheet' },
  { key: 'install',  label: 'Install guide' },
  { key: 'fabric',   label: 'Fabric / range' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'care',     label: 'Care & cleaning' },
  { key: 'other',    label: 'Other' },
];

export const docTypeLabel = (key) =>
  DOC_TYPES.find(t => t.key === key)?.label || 'Document';

const extOf = (file) => {
  const fromName = (file?.name || '').split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  return file?.type === 'application/pdf' ? 'pdf' : 'bin';
};

export const productDocPath = (docId, file) => `${docId}.${extOf(file)}`;

/** Upload one document. Returns the storage path. */
export async function uploadProductDoc(docId, file) {
  if (!supabase) throw new Error('Supabase not configured');
  const path = productDocPath(docId, file);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true, // re-uploading a replacement for the same document is fine
  });
  if (error) throw error;
  return path;
}

// Signed URLs cached for the life of the tab — opening the same spec sheet
// three times in a conversation shouldn't re-sign it three times.
const urlCache = new Map(); // path → { url, expires }

export async function signProductDoc(path) {
  if (!path || !supabase) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + (SIGNED_TTL - 300) * 1000 });
  return data.signedUrl;
}

/** A signed URL that downloads with the document's real filename attached. */
export async function signProductDocDownload(path, fileName) {
  if (!path || !supabase) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL, { download: fileName || true });
  return error ? null : (data?.signedUrl || null);
}

export async function removeProductDoc(path) {
  if (!path || !supabase) return;
  try { await supabase.storage.from(BUCKET).remove([path]); }
  catch { /* an orphaned blob is harmless; the record is what matters */ }
}

// ── Metadata suggestions ─────────────────────────────────────────────────────

const NOISE = new Set([
  'hr', 'lr', 'web', 'print', 'final', 'copy', 'v', 'ver', 'version',
  'au', 'aus', 'australia', 'nz', 'datasheet', 'pdf',
]);

const TYPE_HINTS = [
  [/instal|fitting|assembly/i,            'install'],
  [/warrant|guarantee/i,                  'warranty'],
  [/care|clean|maintenance/i,             'care'],
  [/fabric|range|colou?r\s*card|swatch/i, 'fabric'],
  [/spec|technical|data\s*sheet/i,        'spec'],
];

/**
 * Read what we can out of a filename. Every field is optional and every field
 * is a suggestion — see the note at the top of this file.
 *
 * e.g. "P201.0-Duo-Pleated-Blind-Specification-2020-05-HR-v1.0.pdf"
 *      → { productCode: 'P201.0', title: 'Duo Pleated Blind',
 *          docType: 'spec', version: '1.0', issued: '2020-05' }
 */
export function parseDocFileName(fileName = '') {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const out = {};

  const code = base.match(/^([A-Z]{1,4}\d{2,5}(?:\.\d+)?)\b/i);
  if (code) out.productCode = code[1].toUpperCase();

  const version = base.match(/\bv[.\s-]?(\d+(?:\.\d+)*)\b/i);
  if (version) out.version = version[1];

  const issued = base.match(/\b(20\d{2})[-_.](\d{1,2})\b/) || base.match(/\b(20\d{2})\b/);
  if (issued) out.issued = issued[2] ? `${issued[1]}-${String(issued[2]).padStart(2, '0')}` : issued[1];

  for (const [re, type] of TYPE_HINTS) if (re.test(base)) { out.docType = type; break; }

  // Whatever's left, once the structured bits and the noise are removed, is the
  // human-readable name.
  const words = base
    .split(/[-_\s.]+/)
    .filter(w => w && w !== out.productCode
      && !/^v?\d+(\.\d+)*$/i.test(w)
      && !/^20\d{2}$/.test(w)
      && !NOISE.has(w.toLowerCase())
      && !TYPE_HINTS.some(([re]) => re.test(w)));
  if (words.length) out.title = words.join(' ').replace(/\s+/g, ' ').trim();

  return out;
}

/**
 * Read what we can out of the document's own text. Better than the filename
 * where it works, because it's what the supplier actually stated — but it only
 * works on the "Label  Value" layout a lot of spec sheets happen to use, so it
 * is just as optional as everything else here.
 */
export function parseDocText(text = '') {
  if (!text) return {};
  const t = text.replace(/\s+/g, ' ');
  const out = {};
  const grab = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };

  const code    = grab(/Product\s*Code\s+([A-Z0-9][A-Z0-9.\-/]{1,20})/i);
  const name    = grab(/Product\s*Name\s+(.{2,60}?)\s+(?:Operation|Dimensions|Width|Product|Technical|Colours)\b/i);
  const version = grab(/\bVersion\s*([\d.]+)/i);
  const issued  = grab(/\bIssued\s+([A-Z][a-z]+\s+20\d{2}|\d{1,2}[-/]20\d{2}|20\d{2}[-/]\d{1,2})/i);

  if (code)    out.productCode = code.replace(/[.,;]$/, '');
  if (name)    out.title       = name.replace(/[.,;]$/, '');
  if (version) out.version     = version.replace(/\.$/, '');
  if (issued)  out.issued      = issued;

  return out;
}

/** Match the document text against suppliers we already know about. */
export function guessSupplier(text = '', fileName = '', knownSuppliers = []) {
  const hay = `${fileName} ${text.slice(0, 4000)}`.toLowerCase();
  const hit = knownSuppliers
    .filter(s => s && s.length > 2 && hay.includes(s.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  return hit || null;
}

/**
 * Merge filename-derived and text-derived suggestions into one set of proposed
 * values, and report every field where the two sources DISAGREE.
 *
 * The conflicts are the point. The example that prompted this: a Verosol spec
 * sheet named "...2020-05...v1.0.pdf" whose own footer reads "Version 1.1 |
 * Issued October 2017". Silently picking one would be how you end up quoting off
 * a superseded spec. The upload form shows both and makes someone choose.
 */
export function mergeDocSuggestions({ fromName = {}, fromText = {} }) {
  const fields = ['productCode', 'title', 'version', 'issued', 'docType'];
  const values = {};
  const conflicts = [];

  for (const f of fields) {
    const a = fromText[f];
    const b = fromName[f];
    // The document's own statement wins the default; the filename fills gaps.
    values[f] = a ?? b ?? '';
    if (a && b && String(a).toLowerCase() !== String(b).toLowerCase()) {
      conflicts.push({ field: f, fromDocument: a, fromFileName: b });
    }
  }
  return { values, conflicts };
}
