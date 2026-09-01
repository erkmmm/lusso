/**
 * Unsent note drafts.
 *
 * Half a typed note is still information that only exists in one place: the
 * phone in your hand, in a house you are about to leave. A tapped-away drawer,
 * a locked screen that discards the tab, a mis-hit back gesture — any of those
 * used to take the words with them.
 *
 * So every keystroke in a composer is mirrored to localStorage under a key
 * scoped to what you were looking at, and restored when you come back. The
 * draft is cleared only once the note itself is saved.
 *
 * Deliberately plain localStorage rather than the compressed store: this must
 * survive being written on literally every keystroke, and it must never be the
 * thing that throws.
 */

const PREFIX = 'lusso_note_draft:';

/** One key per capture context, so a job draft can't overwrite a sheet draft. */
export const noteDraftKey = ({ measureSheetId, jobId, customerId, quoteId } = {}) =>
  `${PREFIX}${measureSheetId || jobId || customerId || quoteId || 'global'}`;

export function readNoteDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && typeof d.text === 'string' ? d : null;
  } catch {
    return null;
  }
}

export function writeNoteDraft(key, draft) {
  try {
    // An empty draft is not worth a row — and leaving one behind would restore
    // a stale due date onto the next note typed here.
    if (!draft || !String(draft.text || '').trim()) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch { /* quota or private mode — the in-memory draft still works */ }
}

export function clearNoteDraft(key) {
  try { localStorage.removeItem(key); } catch { /* nothing to do */ }
}
