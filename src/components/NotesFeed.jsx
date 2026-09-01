/**
 * NotesFeed — capture anything, from anywhere.
 *
 * The measure sheet holds what a window needs. This holds everything else: the
 * table linen the client wants matched to the roman blind fabric, the gate code,
 * the "she'll decide on the sheer after the floors go down". One composer, one
 * feed, mounted on a job, on a customer, and globally at /notes.
 *
 * A note with no due date is a note. Give it a date and the SAME record becomes
 * a to-do that Today chases — no re-typing, no second concept to learn. That is
 * why both live in `tasks` and why the due-date control sits in the composer
 * rather than behind a "create task" screen.
 *
 * Saving never waits on the network: the note is written to localStorage (and
 * queued for Supabase) the instant you hit save, and photos upload afterwards
 * in the background. On one bar of signal in a driveway, the note is already
 * safe before the photo has left the phone.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, formatDistanceToNow, addDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import {
  StickyNote, Camera, CalendarClock, Check, Trash2, X, Loader,
  Briefcase, User, AlertTriangle, ImageOff, ChevronDown, Link2, Search,
} from 'lucide-react';
import Card from './Card';
import { toast } from './ToastContainer';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { useProfile } from '../contexts/UserProfileContext';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import {
  addNote, getNotes, setTaskDone, deleteTask, setNotePhotos, setNoteDueDate,
  isTaskOpen, getJobs, getCustomers, TASK_PRIORITY_COLORS,
} from '../store/data';
import { noteDraftKey, readNoteDraft, writeNoteDraft, clearNoteDraft } from '../lib/noteDraft';
import { uploadNotePhoto, signNotePhotos, deleteNotePhotos } from '../lib/photoStore';

const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const dayStr   = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');

const DUE_PRESETS = [
  { label: 'Today',    get: () => todayStr() },
  { label: 'Tomorrow', get: () => dayStr(1) },
  { label: 'Next week',get: () => dayStr(7) },
];

const when = (iso) => {
  if (!iso) return '';
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); } catch { return ''; }
};

const dueLabel = (d) => {
  if (!d) return '';
  const t = todayStr();
  if (d === t) return 'due today';
  if (d === dayStr(1)) return 'due tomorrow';
  if (d < t) return `overdue · ${format(parseISO(d), 'd MMM')}`;
  return `due ${format(parseISO(d), 'd MMM')}`;
};

export default function NotesFeed({
  jobId = null,
  customerId = null,
  quoteId = null,
  measureSheetId = null,
  scope = 'record',        // 'record' → this job/customer. 'all' → everything, with a link picker.
  autoFocus = false,
  onSaved = null,          // fires after a note is written — used by the measure
                           // sheet to persist the sheet the note is anchored to
  heading = 'Notes & to-dos',
  className = '',
}) {
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  // The feed reads the store in the render body, so a save anywhere (including
  // another tab hydrating) has to re-render it.
  useDataRefresh();
  const { salespeople } = useActiveSalespeople();
  const global = scope === 'all';

  // ── Composer ───────────────────────────────────────────────────────────────
  // Whatever was half-typed here last time is the composer's starting state, so
  // a locked screen or a mis-hit back gesture can't take the words with it.
  const draftKey = noteDraftKey({ measureSheetId, jobId, customerId, quoteId });
  const [draftSeed] = useState(() => readNoteDraft(draftKey) || {});

  const [text,     setText]     = useState(draftSeed.text || '');
  const [due,      setDue]      = useState(draftSeed.due || '');
  const [urgent,   setUrgent]   = useState(!!draftSeed.urgent);
  const [assignee, setAssignee] = useState('');
  const [files,    setFiles]    = useState([]);      // File[] awaiting upload
  const [link,     setLink]     = useState(null);    // { type, id, label } — global composer only
  const [linkQuery,setLinkQuery]= useState('');
  const [saving,   setSaving]   = useState(false);

  const textRef  = useRef(null);
  const fileRef  = useRef(null);

  // The router reuses this component when only the :id changes, so the context
  // can move under a half-typed note. Swap in that context's own draft rather
  // than filing one customer's words against another.
  const [seenKey, setSeenKey] = useState(draftKey);
  if (seenKey !== draftKey) {
    const d = readNoteDraft(draftKey) || {};
    setSeenKey(draftKey);
    setText(d.text || '');
    setDue(d.due || '');
    setUrgent(!!d.urgent);
  }

  // ── Feed ───────────────────────────────────────────────────────────────────
  const [showDone, setShowDone] = useState(false);
  const [urls,     setUrls]     = useState({});      // storage path → signed URL
  const [uploading,setUploading]= useState({});      // note id → count still uploading
  const [lightbox, setLightbox] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query,    setQuery]    = useState('');

  const all = getNotes(global ? {} : { jobId, customerId, quoteId, measureSheetId });
  // Search only exists on the global page: a job's own feed is short enough to
  // read, and a filter box on it would just be another empty control.
  const q = query.trim().toLowerCase();
  const notes = q
    ? all.filter(n => `${n.description || ''} ${n.title || ''} ${n.authorName || ''}`.toLowerCase().includes(q))
    : all;
  const open  = notes.filter(isTaskOpen);
  const done  = notes.filter(n => !isTaskOpen(n));

  // Sign every photo on screen in ONE request rather than one per thumbnail —
  // a job with a dozen photographed notes would otherwise fire a dozen calls on
  // every render. Keyed on the paths themselves so it re-signs only when the
  // set actually changes.
  const photoPaths = notes.flatMap(n => n.photoPaths || []);
  const photoKey   = photoPaths.join('|');

  useEffect(() => {
    const missing = photoKey.split('|').filter(p => p && !urls[p]);
    if (!missing.length) return;
    let cancelled = false;
    signNotePhotos(missing).then(map => { if (!cancelled) setUrls(u => ({ ...u, ...map })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  // Mirror every keystroke out to storage. Cheap, synchronous, and the only
  // copy of the words until the note is actually saved.
  useEffect(() => {
    writeNoteDraft(draftKey, { text, due, urgent });
  }, [draftKey, text, due, urgent]);

  const grow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  };

  // ── Link picker (global composer) ──────────────────────────────────────────
  const linkOptions = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const customers = getCustomers();
    const nameOf = (cid) => customers.find(c => c.id === cid)?.name || 'Customer';
    const jobs = getJobs()
      .filter(j => `${j.jobNumber || ''} ${nameOf(j.customerId)} ${j.siteAddress || ''}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(j => ({ type: 'job', id: j.id, customerId: j.customerId, label: `${j.jobNumber || 'Job'} · ${nameOf(j.customerId)}` }));
    const people = customers
      .filter(c => `${c.name || ''} ${c.email || ''} ${c.mobile || ''}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(c => ({ type: 'customer', id: c.id, label: c.name || 'Customer' }));
    return [...jobs, ...people];
  }, [linkQuery]);

  const resetComposer = () => {
    clearNoteDraft(draftKey);
    setText(''); setDue(''); setUrgent(false); setAssignee('');
    setFiles([]); setLink(null); setLinkQuery('');
    if (fileRef.current) fileRef.current.value = '';
    if (textRef.current) textRef.current.style.height = 'auto';
  };

  const handleSave = async () => {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);

    // The id is minted here so the photos can be filed under it while the note
    // itself is already saved and visible.
    const id = uuidv4();
    const target = global
      ? { jobId: link?.type === 'job' ? link.id : null,
          customerId: link?.type === 'customer' ? link.id : (link?.customerId ?? null) }
      : { jobId, customerId, measureSheetId };

    const saved = addNote({
      id,
      text: body,
      ...target,
      quoteId: global ? null : quoteId,
      dueDate: due || null,
      priority: urgent ? 'urgent' : 'normal',
      assignedTo: assignee || null,
      authorName: displayName || '',
      photoPaths: [],
    });

    const pending = files;
    resetComposer();
    setSaving(false);
    if (!saved) return;
    onSaved?.(saved);
    toast(due ? 'To-do saved.' : 'Note saved.');

    if (!pending.length) return;
    setUploading(u => ({ ...u, [id]: pending.length }));
    const paths = [];
    for (const f of pending) {
      try { paths.push(await uploadNotePhoto(id, f)); }
      catch { toast('A photo failed to upload — the note is saved.', 'warning'); }
      setUploading(u => ({ ...u, [id]: Math.max(0, (u[id] || 1) - 1) }));
    }
    if (paths.length) setNotePhotos(id, paths);
    setUploading(u => { const n = { ...u }; delete n[id]; return n; });
  };

  const handleDelete = async (note) => {
    deleteTask(note.id);
    setConfirmDelete(null);
    await deleteNotePhotos(note.photoPaths || []);
    toast('Deleted.');
  };

  const addFiles = (list) => {
    const picked = Array.from(list || []).filter(f => f.type.startsWith('image/'));
    if (picked.length) setFiles(f => [...f, ...picked].slice(0, 6));
  };

  const canSave = text.trim().length > 0 && !saving;

  return (
    <div className={`space-y-4 ${className}`}>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => {
              // ⌘/Ctrl+Enter saves — a laptop habit that costs nothing on a phone.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSave(); }
            }}
            rows={2}
            placeholder="Note anything — a measurement, what the client asked for, something to chase…"
            className="w-full text-sm text-slate-800 placeholder:text-slate-400 resize-none border-0 focus:ring-0 focus:outline-none bg-transparent"
          />

          {/* Photo tray */}
          {files.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {files.map((f, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                  <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setFiles(list => list.filter((_, j) => j !== i))}
                    aria-label="Remove photo"
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Link picker — only when composing away from a record */}
          {global && (
            <div className="mt-2">
              {link ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full pl-2.5 pr-1.5 py-1">
                  <Link2 size={11} /> {link.label}
                  <button onClick={() => setLink(null)} aria-label="Unlink" className="text-slate-400 hover:text-slate-700">
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <div className="relative">
                  <input
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    placeholder="Link to a project or customer (optional)"
                    className="w-full text-xs text-slate-600 placeholder:text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200 focus:border-slate-300 focus:outline-none"
                  />
                  {linkOptions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
                      {linkOptions.map(o => (
                        <button
                          key={`${o.type}-${o.id}`}
                          onClick={() => { setLink(o); setLinkQuery(''); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                        >
                          {o.type === 'job'
                            ? <Briefcase size={12} className="text-amber-500 flex-shrink-0" />
                            : <User size={12} className="text-blue-500 flex-shrink-0" />}
                          <span className="truncate text-slate-700">{o.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls — everything past the text is optional */}
        <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-100 rounded-b-xl flex items-center gap-1.5 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5"
          >
            <Camera size={13} /> Photo
          </button>

          <label className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border cursor-pointer ${
            due ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
          }`}>
            <CalendarClock size={13} />
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="bg-transparent border-0 p-0 text-xs focus:outline-none w-[112px]"
              aria-label="Due date"
            />
          </label>

          {!due && DUE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => setDue(p.get())}
              className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-white"
            >
              {p.label}
            </button>
          ))}
          {due && (
            <button onClick={() => setDue('')} className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-1.5">
              clear
            </button>
          )}

          <button
            onClick={() => setUrgent(v => !v)}
            title="Flag as urgent"
            className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border ${
              urgent ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle size={13} /> Urgent
          </button>

          {salespeople.length > 1 && (
            <div className="relative">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="appearance-none text-xs font-medium bg-white border border-slate-200 rounded-lg pl-2.5 pr-6 py-1.5 text-slate-600 focus:outline-none"
                aria-label="Assign to"
              >
                <option value="">Anyone</option>
                {salespeople.map(p => (
                  <option key={p.id} value={p.id}>{p.fullName || p.email}</option>
                ))}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3.5 py-1.5 transition-colors ${
              canSave ? 'bg-amber-500 hover:bg-amber-400 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saving ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {due ? 'Save to-do' : 'Save note'}
          </button>
        </div>
      </Card>

      {/* ── Feed ──────────────────────────────────────────────────────────── */}
      {all.length === 0 ? (
        <div className="text-center py-8">
          <StickyNote size={22} className="text-slate-300 mx-auto" />
          <p className="text-sm text-slate-500 mt-2">Nothing noted yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            Anything that doesn’t fit a measure sheet goes here — and anything with a date shows up on Today.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <StickyNote size={14} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800">
              {heading} <span className="text-slate-400 font-normal">· {open.length} open</span>
            </h3>
            {global && (
              <>
                <div className="flex-1" />
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search notes"
                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 w-36 sm:w-52 focus:outline-none focus:border-slate-300"
                  />
                </div>
              </>
            )}
          </div>

          {notes.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No notes match “{query}”.</p>
          )}

          <div className="divide-y divide-slate-50">
            {open.map(n => (
              <NoteRow
                key={n.id} note={n} urls={urls} uploading={uploading[n.id]}
                hereJobId={jobId} hereCustomerId={customerId} navigate={navigate}
                onToggle={() => setTaskDone(n.id, true)}
                onDelete={() => setConfirmDelete(n)}
                onDue={(d) => setNoteDueDate(n.id, d)}
                onPhoto={setLightbox}
              />
            ))}
          </div>

          {done.length > 0 && (
            <>
              <button
                onClick={() => setShowDone(v => !v)}
                className="w-full px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center gap-1.5 border-t border-slate-100"
              >
                <ChevronDown size={13} className={`transition-transform ${showDone ? 'rotate-180' : ''}`} />
                Done · {done.length}
              </button>
              {showDone && (
                <div className="divide-y divide-slate-50 bg-slate-50/50">
                  {done.map(n => (
                    <NoteRow
                      key={n.id} note={n} urls={urls} uploading={uploading[n.id]}
                      hereJobId={jobId} hereCustomerId={customerId} navigate={navigate}
                      onToggle={() => setTaskDone(n.id, false)}
                      onDelete={() => setConfirmDelete(n)}
                      onDue={(d) => setNoteDueDate(n.id, d)}
                      onPhoto={setLightbox}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg" />
          <button aria-label="Close" className="absolute top-4 right-4 text-white/80 hover:text-white">
            <X size={22} />
          </button>
        </div>
      )}

      {/* Delete confirm — notes are the only record of a conversation, so ask */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-800">Delete this note?</p>
            <p className="text-xs text-slate-500 mt-1.5 line-clamp-3">{confirmDelete.description || confirmDelete.title}</p>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setConfirmDelete(null)} className="text-xs font-medium text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="text-xs font-semibold text-white bg-red-500 hover:bg-red-400 px-3 py-2 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One entry ────────────────────────────────────────────────────────────────
function NoteRow({ note, urls, uploading, hereJobId, hereCustomerId, navigate, onToggle, onDelete, onDue, onPhoto }) {
  const doneState = !!note.completedAt || note.status === 'completed';
  const overdue   = !doneState && note.dueDate && note.dueDate < todayStr();
  const [dueOpen, setDueOpen] = useState(false);

  const meta = [
    note.authorName,
    when(note.createdAt),
  ].filter(Boolean).join(' · ');

  return (
    <div className="px-4 py-3 flex gap-3 group">
      {/* Tick — a note can be ticked off too; it just isn't chased until dated */}
      <button
        onClick={onToggle}
        aria-label={doneState ? 'Mark not done' : 'Mark done'}
        className={`mt-0.5 w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
          doneState ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-500 text-transparent hover:text-green-500'
        }`}
      >
        <Check size={11} />
      </button>

      <div className="min-w-0 flex-1">
        <p className={`text-sm whitespace-pre-wrap break-words ${doneState ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {note.description || note.title}
        </p>

        {/* Photos */}
        {(note.photoPaths?.length > 0 || uploading > 0) && (
          <div className="flex gap-2 flex-wrap mt-2">
            {(note.photoPaths || []).map(p => (
              urls[p] ? (
                <button key={p} onClick={() => onPhoto(urls[p])} className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                  <img src={urls[p]} alt="" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div key={p} className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center">
                  <ImageOff size={14} className="text-slate-300" />
                </div>
              )
            ))}
            {uploading > 0 && (
              <div className="w-16 h-16 rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
                <Loader size={14} className="text-slate-400 animate-spin" />
              </div>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <span className="text-[11px] text-slate-400">{meta}</span>

          {note.dueDate && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
              overdue ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
            }`}>
              {dueLabel(note.dueDate)}
            </span>
          )}

          {note.priority === 'urgent' && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${TASK_PRIORITY_COLORS.urgent}`}>Urgent</span>
          )}

          {note.jobId && note.jobId !== hereJobId && (
            <button onClick={() => navigate(`/jobs/${note.jobId}`)}
              className="text-[11px] font-medium text-amber-600 hover:text-amber-700 inline-flex items-center gap-1">
              <Briefcase size={10} /> Project
            </button>
          )}
          {note.customerId && note.customerId !== hereCustomerId && !note.jobId && (
            <button onClick={() => navigate(`/customers/${note.customerId}`)}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
              <User size={10} /> Customer
            </button>
          )}

          {/* Undated note → give it a date without opening anything */}
          {!note.dueDate && !doneState && (
            dueOpen ? (
              <input
                type="date"
                autoFocus
                onBlur={() => setDueOpen(false)}
                onChange={(e) => { onDue(e.target.value); setDueOpen(false); }}
                className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setDueOpen(true)}
                className="text-[11px] text-slate-400 hover:text-slate-700 inline-flex items-center gap-1 opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <CalendarClock size={10} /> Add date
              </button>
            )
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        aria-label="Delete"
        className="text-slate-300 hover:text-red-500 opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity self-start"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
