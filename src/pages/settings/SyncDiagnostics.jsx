// ─── Sync & diagnostics ───────────────────────────────────────────────────────
// Cloud sync status, and the three repair tools that can move data in bulk.
//
// Those three used to sit one disclosure below the theme picker, in a section
// called "General", with nothing between a curious click and overwriting the
// cloud from one device. They are now a separate "Danger zone" block, each
// behind a confirm that states the direction of the overwrite — because
// "Force push" and "Force pull" differ only in which side loses, and the
// button text alone has never made that obvious.
import { useState } from 'react';
import {
  Wifi, WifiOff, CloudUpload, RefreshCw, CheckCircle2, AlertTriangle,
  ChevronUp, ChevronDown, ShieldAlert, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { pushAllToSupabase, hydrateFromSupabase, flushPending } from '../../store/db';
import { toast } from '../../components/ToastContainer';
import Card from '../../components/Card';
import SettingsCard from './SettingsCard';

// Each repair tool, in the words that matter: which way the data moves, and
// what is lost if you are wrong about needing it.
const DANGER_ACTIONS = {
  push: {
    label: 'Force push to cloud',
    blurb: "Overwrite cloud with this device's data.",
    icon: CloudUpload,
    iconClass: 'text-teal-500',
    direction: 'This device → the cloud',
    consequence: "The cloud copy is replaced by what is on this device. Anything a colleague changed and you haven't received yet is overwritten.",
    confirmLabel: 'Overwrite the cloud',
  },
  pull: {
    label: 'Force pull from cloud',
    blurb: "Replace this device's data with the cloud copy.",
    icon: RefreshCw,
    iconClass: 'text-blue-500',
    direction: 'The cloud → this device',
    consequence: "This device's copy is replaced by the cloud's. Anything you changed here that hasn't reached the cloud is lost.",
    confirmLabel: 'Overwrite this device',
  },
  reset: {
    label: 'Reset & resync from cloud',
    blurb: 'Pushes anything unsaved, then re-syncs and reconciles.',
    icon: RefreshCw,
    iconClass: 'text-blue-600',
    direction: 'Both ways — unsaved changes up, then everything down',
    consequence: 'The safest of the three: your local data is kept, not wiped. Unsynced changes are pushed first so they are not lost, then the cloud copy is merged back in.',
    confirmLabel: 'Reset & sync',
  },
};

export default function SyncDiagnostics() {
  const [syncStatus, setSyncStatus]   = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirming, setConfirming]   = useState(null); // key of DANGER_ACTIONS
  const isCloud = Boolean(supabase);
  const busy = syncStatus === 'pushing' || syncStatus === 'pulling';

  const handlePush = async () => {
    setSyncStatus('pushing');
    const { pushed, errors } = await pushAllToSupabase();
    if (errors.length > 0) {
      setSyncStatus({ err: true, msg: `${pushed} records pushed. ${errors.length} error(s): ${errors.join(' · ')}` });
    } else {
      setSyncStatus({ ok: true, msg: `${pushed} records pushed to cloud successfully.` });
    }
    setTimeout(() => setSyncStatus(null), 5000);
  };

  const handlePull = async () => {
    setSyncStatus('pulling');
    await hydrateFromSupabase();
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
    setSyncStatus({ ok: true, msg: 'Data synced from cloud.' });
    setTimeout(() => setSyncStatus(null), 4000);
  };

  const handleResetSync = async () => {
    setSyncStatus('pulling');
    // Safe reconcile: push anything unsynced FIRST so it isn't lost, then
    // re-pull. We no longer delete local keys up front — hydration reconciles
    // (and its empty-response guard means a transient empty pull can't wipe you).
    try { await flushPending(); } catch { /* best-effort */ }
    await hydrateFromSupabase();
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
    setSyncStatus({ ok: true, msg: 'Sync complete — reconciled with the cloud.' });
    setTimeout(() => setSyncStatus(null), 4000);
    toast('Sync complete — reconciled with the cloud.');
  };

  const RUN = { push: handlePush, pull: handlePull, reset: handleResetSync };

  const run = async (key) => {
    setConfirming(null);
    await RUN[key]();
  };

  const statusNote = syncStatus && typeof syncStatus === 'object' && (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${syncStatus.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
      {syncStatus.ok ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
      {syncStatus.msg}
    </div>
  );

  return (<>
    {/* Cloud sync status */}
    <Card id="sync-status" data-settings-card="sync-status" className="scroll-mt-24">
      <div className="px-5 py-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isCloud ? 'bg-green-50' : 'bg-slate-100'}`}>
          {isCloud ? <Wifi size={18} className="text-green-600" /> : <WifiOff size={18} className="text-slate-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-slate-800">{isCloud ? 'Live cloud sync active' : 'Offline mode'}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {isCloud ? 'Changes save instantly and appear on all devices automatically.' : 'No Supabase connection — data is stored locally on this device only.'}
          </p>
        </div>
        {isCloud && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
      </div>
      {isCloud && (
        <div className="border-t border-slate-100">
          <button onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 min-h-[44px] text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">
            <span>Diagnostics</span>
            {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showAdvanced && (
            <div className="border-t border-slate-50 px-5 py-3 space-y-1 text-xs text-slate-500">
              <p className="text-slate-400">
                Everything below is read-only. The tools that move data in bulk are in the danger zone at the
                bottom of this section.
              </p>
              <p>Connection: <span className="font-medium text-slate-700">Supabase, live</span></p>
              <p>Writes queue locally and flush on reconnect, so a dropped signal mid-measure is not a lost sheet.</p>
            </div>
          )}
        </div>
      )}
    </Card>

    {statusNote && <div>{statusNote}</div>}

    {/* ── Danger zone ───────────────────────────────────────────────────────── */}
    {isCloud && (
      <SettingsCard
        id="danger-zone"
        icon={ShieldAlert}
        iconClass="text-red-500"
        title="Danger zone"
        description="Repair tools that move data in bulk. Only reach for these if data looks wrong or out of sync — in normal use, sync needs no help."
        className="border-red-200"
        bodyClass=""
      >
        <div className="divide-y divide-slate-100">
          {Object.entries(DANGER_ACTIONS).map(([key, a]) => {
            const Icon = a.icon;
            const open = confirming === key;
            return (
              <div key={key} className={open ? 'bg-red-50/40' : ''}>
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <Icon size={15} className={`${a.iconClass} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">{a.label}</p>
                    <p className="text-xs text-slate-400">{a.blurb}</p>
                  </div>
                  <button
                    onClick={() => setConfirming(open ? null : key)}
                    disabled={busy}
                    className={`flex-shrink-0 text-xs font-semibold px-3 min-h-[36px] rounded-lg border transition-colors disabled:opacity-40 ${
                      open ? 'border-slate-200 text-slate-500' : 'border-red-200 text-red-600 hover:bg-red-50'
                    }`}>
                    {busy ? 'Working…' : open ? 'Cancel' : 'Run…'}
                  </button>
                </div>

                {/* The confirm names the direction, because "push" and "pull"
                    differ only in which side loses its copy. */}
                {open && (
                  <div className="px-5 pb-4 space-y-3">
                    <div className="rounded-xl border border-red-200 bg-white p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Direction</p>
                      <p className="text-sm font-medium text-slate-800">{a.direction}</p>
                      <p className="text-xs text-slate-500 leading-snug">{a.consequence}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => run(key)} disabled={busy}
                        className="flex items-center gap-1.5 text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white px-3 min-h-[44px] rounded-lg transition-colors">
                        <AlertTriangle size={13} /> {a.confirmLabel}
                      </button>
                      <button onClick={() => setConfirming(null)}
                        className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 px-3 min-h-[44px] rounded-lg transition-colors">
                        <X size={13} /> Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsCard>
    )}
  </>);
}
