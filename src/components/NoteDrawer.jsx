/**
 * NoteDrawer — the sheet's notes section, for the one place it can't be inline.
 *
 * Notes belong IN the measure sheet, as a section you scroll to (see SECTION 4
 * in NewMeasureSheet). The single exception is the fullscreen line-item table,
 * which replaces the whole sheet with a schedule: there is no section on screen
 * to scroll to, and dropping out of the table to write a note is exactly the
 * interruption this whole feature exists to remove. So the same feed comes to
 * you as a drawer instead.
 *
 * Closing it never discards anything: the composer mirrors every keystroke to
 * a stored draft, so a half-typed note survives the drawer, the tab and the
 * screen lock (see lib/noteDraft.js). It is the same draft the inline section
 * holds — the same sheet, so the same words either way.
 */
import { useEffect } from 'react';
import { X, StickyNote } from 'lucide-react';
import NotesFeed from './NotesFeed';

export default function NoteDrawer({
  open,
  onClose,
  measureSheetId = null,
  jobId = null,
  customerId = null,
  onSaved = null,
  title = 'Notes on this measure',
  subtitle = 'Anything the sheet has no box for. Add a date and it lands on Today.',
}) {
  // Escape closes; body scroll locks so the sheet underneath doesn't move.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full sm:max-w-2xl bg-slate-50 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] sm:max-h-[80vh] flex flex-col"
      >
        {/* Grab handle — this is a thumb-first surface */}
        <div className="sm:hidden pt-2 pb-1 flex justify-center flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="px-4 pb-3 pt-2 sm:pt-4 flex items-start gap-3 border-b border-slate-200 flex-shrink-0">
          <StickyNote size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close notes"
            className="text-slate-400 hover:text-slate-700 p-1 -m-1 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <NotesFeed
            measureSheetId={measureSheetId}
            jobId={jobId}
            customerId={customerId}
            autoFocus
            onSaved={onSaved}
            heading="On this sheet"
          />
        </div>
      </div>
    </div>
  );
}
