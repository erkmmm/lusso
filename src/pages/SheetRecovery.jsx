/**
 * Recover a measure sheet from the local version journal.
 *
 * Every save of every sheet leaves a snapshot in IndexedDB on the device that
 * made it (see src/lib/sheetJournal.js). This is where you go and get one back.
 *
 * It exists because on 2026-09-07 a measured house came back empty and there was
 * nowhere to look. The answer to "where did my measurements go" should never
 * again be "nowhere".
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, RotateCcw, ChevronRight, AlertTriangle, HardDrive, Ruler, Camera,
} from 'lucide-react';
import { getSheetVersions, listJournalledSheets, journalStats } from '../lib/sheetJournal';
import { saveMeasureSheet, getMeasureSheet, sheetContentScore } from '../store/data';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

const when = (ms) => new Date(ms).toLocaleString(undefined,
  { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const REASON = {
  'saved':        'saved',
  'before-save':  'before a save',
  'refused-write':'a save that was blocked',
  'unmount':      'leaving the page',
};

function VersionRow({ v, current, onRestore }) {
  const lines  = v.lines;
  const photos = (v.sheet.lineItems || []).reduce((n, li) => n + (li.photoPaths || []).length, 0);
  const better = v.score > current;
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-t border-slate-50 ${better ? 'bg-green-50/40' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-800">{when(v.at)}</span>
          <span className="text-[10px] text-slate-400 border border-slate-200 rounded-full px-1.5 py-0.5">
            {REASON[v.reason] || v.reason}
          </span>
          {better && (
            <span className="text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded-full px-1.5 py-0.5">
              more than what&apos;s saved now
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
          <span className="flex items-center gap-1"><Ruler size={10} />{lines} line{lines !== 1 ? 's' : ''}</span>
          <span>{v.score} filled field{v.score !== 1 ? 's' : ''}</span>
          {photos > 0 && <span className="flex items-center gap-1"><Camera size={10} />{photos}</span>}
        </p>
      </div>
      <button onClick={() => onRestore(v)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white flex-shrink-0">
        <RotateCcw size={12} /> Restore
      </button>
    </div>
  );
}

export default function SheetRecovery() {
  const navigate = useNavigate();
  const [sheets, setSheets]   = useState(null);
  const [open, setOpen]       = useState(null);   // sheetId being inspected
  // Tagged with the sheet it answers, so a stale fetch can never render against
  // a different sheet and the effect below needn't clear state synchronously.
  const [loaded, setLoaded]   = useState(null);   // { sheetId, versions }
  const [stats, setStats]     = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [list, st] = await Promise.all([listJournalledSheets(), journalStats()]);
      if (!live) return;
      setSheets(list);
      setStats(st);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getSheetVersions(open).then(v => { if (live) setLoaded({ sheetId: open, versions: v }); });
    return () => { live = false; };
  }, [open]);

  const versions = loaded && loaded.sheetId === open ? loaded.versions : [];

  const restore = (v) => {
    // allowShrink, because restoring IS a deliberate replacement — and the
    // version being replaced was itself just journalled by saveMeasureSheet, so
    // this is reversible too.
    saveMeasureSheet({ ...v.sheet, updatedAt: new Date().toISOString() }, { allowShrink: true });
    toast(`Restored the version from ${when(v.at)}`);
    navigate(`/measure-sheets/${v.sheet.id}`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5 pb-28">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <History size={19} className="text-amber-500" /> Recover a measure sheet
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Every save on this device leaves a copy here. If a sheet looks wrong or empty, an earlier version is below.
        </p>
      </div>

      <Card className="px-4 py-3 flex items-start gap-2.5 bg-slate-50/60">
        <HardDrive size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500">
          {stats
            ? <>Holding <strong>{stats.versions}</strong> version{stats.versions !== 1 ? 's' : ''} of <strong>{stats.sheets}</strong> sheet{stats.sheets !== 1 ? 's' : ''} ({Math.round(stats.bytes / 1024)} KB).</>
            : 'Reading the local history…'}
          {' '}This history is stored only on this device and is never synced, so nothing on the server can erase it.
        </p>
      </Card>

      {sheets === null ? (
        <p className="text-sm text-slate-400 px-1">Loading…</p>
      ) : sheets.length === 0 ? (
        <Card className="px-5 py-12 text-center">
          <History size={26} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-medium">No history on this device yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            The journal starts recording from the next save. If you measured on a different phone or laptop,
            check there — the history lives on the device that did the work.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sheets.map(s => {
            const live = getMeasureSheet(s.sheetId);
            const currentScore = live ? sheetContentScore(live) : 0;
            const recoverable = s.bestScore > currentScore;
            return (
              <Card key={s.sheetId} className="overflow-hidden">
                <button onClick={() => setOpen(open === s.sheetId ? null : s.sheetId)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {s.customerName || 'Unnamed sheet'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.versions} version{s.versions !== 1 ? 's' : ''} · last {when(s.latestAt)}
                      {!live && ' · not on this device any more'}
                    </p>
                  </div>
                  {recoverable && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded-full px-2 py-0.5 flex-shrink-0">
                      <AlertTriangle size={9} /> older copy has more
                    </span>
                  )}
                  <ChevronRight size={15}
                    className={`text-slate-300 flex-shrink-0 transition-transform ${open === s.sheetId ? 'rotate-90' : ''}`} />
                </button>

                {open === s.sheetId && (
                  versions.length === 0
                    ? <p className="px-4 py-3 text-xs text-slate-400 border-t border-slate-50">Reading versions…</p>
                    : versions.map(v => (
                        <VersionRow key={v.key} v={v} current={currentScore} onRestore={restore} />
                      ))
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
