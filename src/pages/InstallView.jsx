import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Check, ChevronRight, ChevronDown, Camera, AlertTriangle,
  CheckCircle2, Filter,
} from 'lucide-react';
import {
  getJob, getCustomer, getMeasureSheetByJob, getTakeoffByJob,
  isInstalled, setLineInstalled, setRoomInstalled, installProgress,
  isPlanEstimate, MS_SPEC_FIELDS,
} from '../store/data';
import { groupByRoom } from '../lib/roomNaming';
import { signedPhotoUrl } from '../lib/takeoffStorage';
import { useProfile } from '../contexts/UserProfileContext';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { useSidebar } from '../contexts/SidebarContext';
import { toast } from '../components/ToastContainer';

/**
 * Install day.
 *
 * Everything here already existed — room, product, sizes, the specs, the site
 * photos, the check-measure state. What was missing was a way to READ it while
 * standing on a ladder: one room at a time, the specs that decide how a blind
 * goes up, and a tick per window so nobody has to remember which of the four in
 * the master bedroom is already done.
 *
 * Built for a phone held in one hand. Nothing on this page can change a size —
 * the numbers are what was ordered, and letting them be edited here would let a
 * mis-tap rewrite the record of what the workroom actually made.
 */
export default function InstallView() {
  const { id: jobId } = useParams();
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  const { requestRail } = useSidebar();
  useEffect(() => requestRail(), [requestRail]);

  const [, force] = useState(0);
  useDataRefresh(() => force(n => n + 1));

  const job = getJob(jobId);
  const customer = job ? getCustomer(job.customerId) : null;
  const sheet = getMeasureSheetByJob(jobId);
  const takeoff = getTakeoffByJob(jobId);

  const [openRoom, setOpenRoom] = useState(null);
  const [hideDone, setHideDone] = useState(false);

  const lineItems = useMemo(() => sheet?.lineItems || [], [sheet]);
  const progress = installProgress(lineItems);

  // The same grouping the quote and the plan takeoff use, so the room headings
  // and the A / B references match what the customer signed and what is printed
  // on the purchase order.
  const rooms = useMemo(() => groupByRoom(lineItems, {
    entryKeyOf: (li) => li.takeoffItemId || null,
  }), [lineItems]);

  // Photos live on the takeoff item, reached through the line's takeoffItemId.
  const photosFor = useMemo(() => {
    const byItem = new Map((takeoff?.items || []).map(i => [i.id, i.photos || []]));
    return (li) => (li.takeoffItemId ? byItem.get(li.takeoffItemId) || [] : []);
  }, [takeoff]);

  if (!job) {
    return (
      <div className="p-6 text-slate-500">
        Job not found. <button className="text-amber-600 underline" onClick={() => navigate('/jobs')}>Back to jobs</button>
      </div>
    );
  }
  if (!sheet || !lineItems.length) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500 text-sm">Nothing to install yet — this job has no measure sheet lines.</p>
        <button className="mt-2 text-amber-600 underline text-sm" onClick={() => navigate(`/jobs/${jobId}`)}>Back to the job</button>
      </div>
    );
  }

  const visibleRooms = hideDone
    ? rooms.map(r => ({ ...r, entries: r.entries.filter(e => e.items.some(li => !isInstalled(li))) }))
          .filter(r => r.entries.length)
    : rooms;

  const toggleLine = (li) => {
    setLineInstalled(sheet.id, li.id, !isInstalled(li), displayName);
    force(n => n + 1);
  };

  const toggleRoom = (room) => {
    const ids = room.entries.flatMap(e => e.items.map(li => li.id));
    const allDone = ids.every(id => isInstalled(lineItems.find(li => li.id === id)));
    setRoomInstalled(sheet.id, ids, !allDone, displayName);
    force(n => n + 1);
    toast(allDone ? `${room.room} reopened.` : `${room.room} done.`);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 pb-24">
      {/* Where you are and how far through */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600">Install</p>
        <h1 className="text-lg font-semibold text-slate-900 leading-tight">{customer?.name || 'This job'}</h1>
        <p className="text-xs text-slate-500">{job.siteAddress || customer?.address || job.jobNumber}</p>
      </div>

      <div className={`rounded-xl border px-4 py-3 mb-4 ${
        progress.complete ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-slate-800">
            {progress.complete ? 'All up' : `${progress.done} of ${progress.total} up`}
          </span>
          {!progress.complete && (
            <span className="text-xs text-slate-500 tabular-nums">{progress.remaining} to go</span>
          )}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${progress.complete ? 'bg-green-500' : 'bg-amber-500'}`}
            style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {visibleRooms.length} room{visibleRooms.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={() => setHideDone(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            hideDone ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Filter size={12} /> Remaining only
        </button>
      </div>

      <div className="space-y-2">
        {visibleRooms.map(room => {
          const lines = room.entries.flatMap(e => e.items);
          const roomProgress = installProgress(lines);
          const open = openRoom === room.room;
          return (
            <div key={room.room} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
              <button
                onClick={() => setOpenRoom(open ? null : room.room)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  roomProgress.complete ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {roomProgress.complete ? <Check size={15} /> : <span className="text-xs font-bold">{roomProgress.total}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 truncate">{room.room}</span>
                  <span className="block text-xs text-slate-400">
                    {roomProgress.done} of {roomProgress.total} up
                  </span>
                </span>
                {open ? <ChevronDown size={17} className="text-slate-400" /> : <ChevronRight size={17} className="text-slate-400" />}
              </button>

              {open && (
                <div className="border-t border-slate-100">
                  {room.entries.map(entry => entry.items.map(li => (
                    <InstallLine
                      key={li.id}
                      li={li}
                      ref_={entry.ref}
                      photos={photosFor(li)}
                      onToggle={() => toggleLine(li)}
                    />
                  )))}
                  <button
                    onClick={() => toggleRoom(room)}
                    className="w-full px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50 border-t border-slate-100"
                  >
                    {roomProgress.complete ? 'Reopen this room' : `Mark all of ${room.room} up`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hideDone && !visibleRooms.length && (
        <div className="text-center py-10">
          <CheckCircle2 size={28} className="text-green-500 mx-auto" />
          <p className="text-sm text-slate-600 mt-2">Everything is up.</p>
        </div>
      )}
    </div>
  );
}

/** One window: the numbers it was made to, the specs, and the tick. */
function InstallLine({ li, ref_, photos, onToggle }) {
  const done = isInstalled(li);
  const planOnly = isPlanEstimate(li);

  // Only the specs that actually carry a value — an installer scanning a card
  // shouldn't have to read past six empty fields to find the control side.
  const specs = MS_SPEC_FIELDS
    .map(f => ({ label: f.label, value: li[f.itemField] }))
    .filter(s => s.value && typeof s.value === 'string');

  return (
    <div className={`flex gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${done ? 'bg-green-50/40' : ''}`}>
      <button
        onClick={onToggle}
        aria-label={done ? 'Mark as not installed' : 'Mark as installed'}
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-colors ${
          done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 text-transparent hover:border-amber-400'
        }`}
      >
        <Check size={17} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {ref_ && (
            <span className="text-[10px] font-bold text-white bg-slate-800 rounded px-1.5 py-0.5 flex-shrink-0">{ref_}</span>
          )}
          <span className={`text-sm font-medium truncate ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {li.productNameSnapshot || li.location || 'Item'}
          </span>
          {(li.quantity || 1) > 1 && (
            <span className="text-xs text-slate-500 flex-shrink-0">×{li.quantity}</span>
          )}
        </div>

        <div className="text-sm font-semibold text-slate-700 tabular-nums mt-0.5">
          {li.widthMm || '—'} × {li.dropMm || '—'} mm
        </div>

        {li.fabricColour && <div className="text-xs text-slate-500 mt-0.5">{li.fabricColour}</div>}

        {specs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {specs.map(s => (
              <span key={s.label} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                {s.label}: <span className="font-medium text-slate-800">{s.value}</span>
              </span>
            ))}
          </div>
        )}

        {li.notes && <p className="text-xs text-slate-500 mt-1.5 italic">{li.notes}</p>}

        <div className="flex items-center gap-3 mt-1.5">
          {planOnly && (
            <span className="text-[11px] text-amber-600 flex items-center gap-1">
              <AlertTriangle size={11} /> size never check-measured
            </span>
          )}
          {photos.length > 0 && <PhotoRow photos={photos} />}
          {done && li.installedBy && (
            <span className="text-[11px] text-green-700 flex items-center gap-1 ml-auto">
              <Check size={11} /> {li.installedBy}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Site photos taken at measure — what the opening actually looks like. */
function PhotoRow({ photos }) {
  const [urls, setUrls] = useState([]);
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all(photos.map(p => signedPhotoUrl(p.path)))
      .then(list => { if (alive) setUrls(list.filter(Boolean)); });
    return () => { alive = false; };
  }, [photos]);

  if (!urls.length) return <span className="text-[11px] text-slate-400 flex items-center gap-1"><Camera size={11} />{photos.length}</span>;
  return (
    <>
      <div className="flex gap-1">
        {urls.map((u, i) => (
          <button key={u} onClick={() => setZoom(u)} className="w-9 h-9 rounded overflow-hidden border border-slate-200">
            <img src={u} alt={`Site photo ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </>
  );
}
