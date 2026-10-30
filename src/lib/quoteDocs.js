/**
 * Documents attached to a quote for the customer to read.
 *
 * Brochures, warranty terms, care instructions, a fabric range card — the
 * things that used to be emailed separately and then lost in a thread. They
 * hang off the quote itself, so they are on the page the customer opens, they
 * are still there when they come back to it a fortnight later, and anyone the
 * link is forwarded to gets them too.
 *
 * ── Why the bucket is public ────────────────────────────────────────────────
 * The customer's quote page runs under the anon key and the email links
 * straight to the file. A signed URL is no use to either: it expires in an
 * hour, and the email gets opened tomorrow. So `quote-docs` is public, exactly
 * like `quote-plans`, and the privacy comes from the path — a uuid per
 * document, which cannot be guessed from the quote number.
 *
 * Nothing confidential should go in here. It is customer-facing reading
 * material, not the job file.
 */
import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

const BUCKET = 'quote-docs';

/** 25MB — the bucket's own limit, checked here so the error is a sentence. */
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

export const ACCEPT_ATTR = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
].join(',');

const extOf = (file) => {
  const fromName = (file?.name || '').split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  return file?.type === 'application/pdf' ? 'pdf' : 'bin';
};

/** Strip the extension for the default label — the customer reads the name. */
export const titleFromFilename = (name = '') =>
  String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Document';

export const formatBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

/** A short, readable kind for the chip on the line: "PDF", "Word", "Image". */
export const docKind = (doc) => {
  const t = String(doc?.mimeType || '');
  const ext = String(doc?.path || '').split('.').pop()?.toLowerCase();
  if (t === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (t.startsWith('image/')) return 'Image';
  if (t.includes('word') || ext === 'doc' || ext === 'docx') return 'Word';
  if (t.includes('sheet') || t.includes('excel') || ext === 'xls' || ext === 'xlsx') return 'Spreadsheet';
  if (t === 'text/csv' || ext === 'csv') return 'CSV';
  if (t.startsWith('text/')) return 'Text';
  return 'File';
};

/**
 * The URL the customer's browser hits. Derived from the path rather than
 * stored on the quote: a stored URL would freeze today's project domain into
 * every quote ever sent, and the first time the bucket moved they would all
 * break at once with no way to tell which.
 */
export function quoteDocUrl(doc) {
  const path = typeof doc === 'string' ? doc : doc?.path;
  if (!path || !supabase) return '';
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload one file against a quote.
 *
 * @param {string} quoteId
 * @param {File}   file
 * @param {string} [name]  what the customer sees; defaults to the filename
 * @returns {Promise<object>} the document record to append to quote.documents
 */
export async function uploadQuoteDoc(quoteId, file, name) {
  if (!supabase) throw new Error('Not connected — documents need an internet connection to upload.');
  if (!file) throw new Error('No file chosen.');
  if (file.size > MAX_DOC_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_DOC_BYTES)}.`);
  }

  const id = uuidv4();
  // Foldered by quote so removing a quote's documents is one prefix, and a
  // stray file is traceable to the quote it came from.
  const path = `${quoteId}/${id}.${extOf(file)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message || `Could not upload ${file.name}.`);

  return {
    id,
    name: (name || '').trim() || titleFromFilename(file.name),
    path,
    mimeType: file.type || '',
    sizeBytes: file.size || 0,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Delete the stored bytes for a document.
 *
 * Returns rather than throws on failure: the caller has already taken the
 * document off the quote, and leaving an orphaned file in a bucket is a much
 * smaller problem than an error that makes someone think the removal failed.
 */
export async function removeQuoteDoc(doc) {
  const path = typeof doc === 'string' ? doc : doc?.path;
  if (!path || !supabase) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('[quoteDocs] could not remove', path, error.message);
  return !error;
}
