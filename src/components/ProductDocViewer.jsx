/**
 * Full-screen viewer for one product document.
 *
 * Deliberately its own component with a tiny prop surface (`doc`, `onClose`), so
 * the same viewer can later be opened straight from a measure-sheet line without
 * anything being rebuilt — the point of the whole exercise is that a spec sheet
 * is one tap from wherever the question came up, not a separate errand.
 *
 * Portalled to <body>: it opens from inside a table with its own overflow
 * scrolling, which would otherwise clip it.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ExternalLink, FileText, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { signProductDoc, signProductDocDownload, docTypeLabel } from '../lib/productDocs';

const Meta = ({ label, value }) => (
  value ? (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  ) : null
);

export default function ProductDocViewer({ doc, onClose, onEdit, onDelete }) {
  const [url, setUrl]         = useState(null);
  const [dlUrl, setDlUrl]     = useState(null);
  const [error, setError]     = useState(null);
  const [confirmDel, setDel]  = useState(false);

  // Mounted with key={doc.id} by the caller, so a different document arrives as
  // a fresh component — no need to reset this state synchronously here.
  useEffect(() => {
    let live = true;
    (async () => {
      const signed = await signProductDoc(doc.filePath);
      if (!live) return;
      if (!signed) { setError('Could not open this file — you may be offline.'); return; }
      setUrl(signed);
      setDlUrl(await signProductDocDownload(doc.filePath, doc.fileName));
    })();
    return () => { live = false; };
  }, [doc.filePath, doc.fileName]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPdf   = (doc.fileName || doc.filePath || '').toLowerCase().endsWith('.pdf');
  const isImage = /\.(jpe?g|png|webp)$/i.test(doc.fileName || doc.filePath || '');

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800 text-sm truncate">{doc.title}</h2>
          <p className="text-xs text-slate-400 truncate">
            {[docTypeLabel(doc.docType), doc.supplier, doc.productCode,
              doc.version && `v${doc.version}`, doc.issued,
              doc.pageCount ? `${doc.pageCount} page${doc.pageCount !== 1 ? 's' : ''}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dlUrl && (
            <a href={dlUrl} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <Download size={14} /> <span className="hidden sm:inline">Download</span>
            </a>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <ExternalLink size={14} /> <span className="hidden sm:inline">New tab</span>
            </a>
          )}
          {onEdit && (
            <button type="button" onClick={() => onEdit(doc)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <Pencil size={14} /> <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {onDelete && (
            confirmDel ? (
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => { onDelete(doc); onClose(); }}
                  className="text-xs font-semibold px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-400">Remove</button>
                <button type="button" onClick={() => setDel(false)}
                  className="text-xs text-slate-400 px-1">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setDel(true)} title="Remove document"
                className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            )
          )}
          <button type="button" onClick={onClose} title="Close"
            className="p-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 bg-slate-100">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-6">
            <AlertTriangle size={28} className="text-amber-500" />
            <p className="text-sm text-slate-600">{error}</p>
          </div>
        ) : !url ? (
          <div className="h-full flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
          </div>
        ) : isImage ? (
          <div className="h-full overflow-auto p-4 flex items-start justify-center">
            <img src={url} alt={doc.title} className="max-w-full rounded-lg shadow-sm" />
          </div>
        ) : isPdf ? (
          /* iOS Safari renders only the first page of an embedded PDF, so the
             "New tab" button above is the real escape hatch, not a nicety. */
          <iframe title={doc.title} src={url} className="w-full h-full border-0" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
            <FileText size={32} className="text-slate-300" />
            <p className="text-sm text-slate-500">This file type can't be previewed here.</p>
            {dlUrl && <a href={dlUrl} className="text-sm font-medium text-amber-600 hover:underline">Download it instead</a>}
          </div>
        )}
      </div>

      {/* Notes strip */}
      {doc.notes && (
        <div className="flex-shrink-0 border-t border-slate-200 px-4 py-2.5 bg-amber-50/50">
          <div className="flex gap-4 items-start">
            <Meta label="Notes" value={doc.notes} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
