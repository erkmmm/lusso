/**
 * Photos on a measure-sheet line.
 *
 * A window is easier to photograph than to describe. The bracket that won't
 * clear the architrave, the fabric already in the room, the reveal that isn't
 * square — a picture against THAT line settles an argument in the workroom
 * months later, which is exactly the kind of thing that otherwise ruins a job.
 *
 * Photos are stored as paths on the line item (which lives in the sheet's jsonb
 * `line_items`), uploaded straight from the camera and downscaled on the way.
 * The write-back is deliberately immediate — see `onChange` at the call site in
 * NewMeasureSheet, which persists the whole sheet the moment a photo lands
 * rather than waiting for the 60-second autosave.
 *
 * Two shapes, same component:
 *   inline  — thumbnails and an Add button, for the card layout and the sheet view
 *   compact — one camera button with a count, for a table cell that has no room
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, X, Loader, ImageOff, Images } from 'lucide-react';
import { uploadPhoto, signPhotos, deletePhotos, linePhotoPrefix } from '../lib/photoStore';
import { toast } from './ToastContainer';

const MAX_PER_LINE = 8;

/** Shared upload/sign/remove behaviour for both shapes. */
function usePhotos({ sheetId, item, onChange }) {
  const paths = item?.photoPaths || [];
  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(0);
  const key = paths.join('|');

  useEffect(() => {
    const missing = key.split('|').filter(p => p && !urls[p]);
    if (!missing.length) return;
    let cancelled = false;
    signPhotos(missing).then(map => { if (!cancelled) setUrls(u => ({ ...u, ...map })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const add = async (fileList) => {
    const picked = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!picked.length) return;
    const room = MAX_PER_LINE - paths.length;
    if (room <= 0) { toast(`Up to ${MAX_PER_LINE} photos per line.`, 'warning'); return; }

    const files = picked.slice(0, room);
    setUploading(n => n + files.length);

    // Accumulate locally rather than reading `item` again on each completion:
    // this closure holds the paths as they were when the picker opened, so
    // appending to the stale list would drop every photo but the last.
    let current = [...paths];
    for (const f of files) {
      try {
        const path = await uploadPhoto(linePhotoPrefix(sheetId, item.id), f);
        current = [...current, path];
        onChange(current);
      } catch {
        toast('A photo failed to upload — try again when you have signal.', 'warning');
      }
      setUploading(n => Math.max(0, n - 1));
    }
  };

  const remove = async (path) => {
    onChange(paths.filter(p => p !== path));
    await deletePhotos([path]);
  };

  return { paths, urls, uploading, add, remove };
}

function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg" />
      <button aria-label="Close" className="absolute top-4 right-4 text-white/80 hover:text-white">
        <X size={22} />
      </button>
    </div>
  );
}

export default function LinePhotos({
  sheetId,
  item,
  onChange = null,        // (paths) => void. Omit for read-only.
  compact = false,
  label = 'Photos',
}) {
  const readOnly = !onChange;
  const { paths, urls, uploading, add, remove } = usePhotos({ sheetId, item, onChange: onChange || (() => {}) });
  const [lightbox, setLightbox] = useState(null);
  const [openSheet, setOpenSheet] = useState(false);
  const fileRef = useRef(null);

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      className="hidden"
      onChange={(e) => { add(e.target.files); e.target.value = ''; }}
    />
  );

  const thumbs = (
    <div className="flex gap-2 flex-wrap">
      {paths.map(p => (
        <div key={p} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 group">
          {urls[p] ? (
            <button type="button" onClick={() => setLightbox(urls[p])} className="w-full h-full">
              <img src={urls[p]} alt="" className="w-full h-full object-cover" />
            </button>
          ) : (
            <div className="w-full h-full bg-slate-100 flex items-center justify-center">
              <ImageOff size={14} className="text-slate-300" />
            </div>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => remove(p)}
              aria-label="Remove photo"
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}

      {Array.from({ length: uploading }).map((_, i) => (
        <div key={`up-${i}`} className="w-16 h-16 rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
          <Loader size={14} className="text-slate-400 animate-spin" />
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-16 h-16 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-amber-400 hover:text-amber-600 flex flex-col items-center justify-center gap-1 transition-colors"
        >
          <Camera size={16} />
          <span className="text-[10px] font-medium">Add</span>
        </button>
      )}
    </div>
  );

  // ── Compact: one button for a table cell ─────────────────────────────────
  if (compact) {
    const count = paths.length + uploading;
    return (
      <>
        {picker}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => (count ? setOpenSheet(true) : fileRef.current?.click())}
          title={count ? `${count} photo${count === 1 ? '' : 's'}` : 'Add photo'}
          className={`relative p-1.5 transition-colors ${count ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-amber-500'}`}
        >
          {count ? <Images size={14} /> : <Camera size={14} />}
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 rounded-full px-1 leading-tight">
              {count}
            </span>
          )}
        </button>

        {openSheet && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center" >
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpenSheet(false)} aria-hidden="true" />
            <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800">Photos</h3>
                  <p className="text-xs text-slate-400 truncate">
                    {item.location || `Line ${item.sortOrder != null ? item.sortOrder + 1 : ''}`}
                    {item.productNameSnapshot ? ` · ${item.productNameSnapshot}` : ''}
                  </p>
                </div>
                <button onClick={() => setOpenSheet(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700">
                  <X size={18} />
                </button>
              </div>
              {thumbs}
            </div>
          </div>
        )}

        <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      </>
    );
  }

  // ── Inline: the card layout and the read-only sheet view ────────────────
  if (readOnly && !paths.length) return null;

  return (
    <div>
      {picker}
      {label && (
        <label className="block text-xs font-medium text-slate-500 mb-1">
          {label}{paths.length > 0 && <span className="text-slate-400 font-normal"> · {paths.length}</span>}
        </label>
      )}
      {thumbs}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
