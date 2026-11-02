// ── Push notifications ────────────────────────────────────────────────────────
// One switch per device: this browser subscribes with its own push endpoint, and
// every row that lands in `notifications` (quote opened/accepted/declined,
// installer responses, customer replies, tasks) is pushed to it by the
// `push-send` edge function.
//
// Split into two cards because the two halves have genuinely different reach:
// the switch and the device list are per-browser, while the mute toggles are
// stored on your user account (`notification_prefs.muted_types`) and so follow
// you onto every device you sign in on. One badge on one card couldn't tell
// the truth about both.
import { useState, useEffect } from 'react';
import { Bell, BellOff, Smartphone, Filter } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  getPushStatus, enablePush, disablePush, sendTestPush, pushSupported,
  needsHomeScreenInstall, NOTIFICATION_GROUPS, getMutedTypes, setGroupMuted,
} from '../../lib/push';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

export default function Notifications() {
  const [status, setStatus]   = useState({ supported: true, permission: 'default', subscribed: false });
  const [devices, setDevices] = useState([]);
  const [muted, setMuted]     = useState(new Set());
  const [busy, setBusy]       = useState(false);

  const refresh = async () => {
    setStatus(await getPushStatus());
    setMuted(await getMutedTypes());
    if (supabase) {
      const { data } = await supabase
        .from('push_subscriptions')
        .select('id, label, user_agent, created_at, last_success_at')
        .order('created_at', { ascending: false });
      setDevices(data || []);
    }
  };

  useEffect(() => { refresh(); }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (status.subscribed) {
        await disablePush();
        toast('Notifications turned off on this device.');
      } else {
        await enablePush();
        toast('Notifications on — this device will now be alerted.');
      }
      await refresh();
    } catch (e) {
      toast(e.message || 'Could not change notification settings.', 'error', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await sendTestPush();
      toast(`Test sent to ${res.sent} device${res.sent === 1 ? '' : 's'} — check your lock screen.`);
    } catch (e) {
      toast(e.message || 'Test failed.', 'error', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = async (group) => {
    const isOn = !group.types.every(t => muted.has(t));
    const prev = muted;
    // Optimistic: the switch should move under your finger, not after a round trip.
    const optimistic = new Set(prev);
    group.types.forEach(t => (isOn ? optimistic.add(t) : optimistic.delete(t)));
    setMuted(optimistic);
    try {
      setMuted(await setGroupMuted(group, isOn, prev));
    } catch (e) {
      setMuted(prev);
      toast(e.message || 'Could not save that preference.', 'error');
    }
  };

  const forget = async (id) => {
    await supabase.from('push_subscriptions').delete().eq('id', id);
    await refresh();
    toast('Device removed.');
  };

  const blocked   = status.permission === 'denied';
  const needsHome = pushSupported() && needsHomeScreenInstall();

  if (!pushSupported()) {
    return (
      <SettingsCard
        id="push-device"
        icon={Bell}
        title="Push notifications"
        description="Get a push on your phone or desktop when a quote is opened or accepted, an installer responds, a customer replies, or a task falls due — even when Lusso is closed."
        scope="device"
      >
        <p className="text-xs text-slate-500">This browser doesn’t support push notifications.</p>
      </SettingsCard>
    );
  }

  return (<>
    <SettingsCard
      id="push-device"
      icon={Bell}
      title="Push on this device"
      description="Get a push on your phone or desktop when a quote is opened or accepted, an installer responds, a customer replies, or a task falls due — even when Lusso is closed."
      scope="device"
      save={{ kind: 'instant' }}
      bodyClass="p-4 space-y-3"
      actions={
        <button
          role="switch"
          aria-checked={status.subscribed}
          aria-label="Push notifications on this device"
          disabled={busy || blocked || (needsHome && !status.subscribed)}
          onClick={toggle}
          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-40 before:absolute before:content-[''] before:-inset-x-2 before:-inset-y-2.5 ${status.subscribed ? 'bg-amber-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${status.subscribed ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      }
    >
      <div>
        <p className="text-sm font-medium text-slate-700">
          {status.subscribed ? 'On for this device' : 'Off for this device'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {blocked
            ? 'Blocked in your browser settings — allow notifications for Lusso, then switch this on.'
            : needsHome
              ? 'On iPhone, add Lusso to your Home Screen first (Share → Add to Home Screen), then open it from there.'
              : 'Each device you use needs its own switch.'}
        </p>
      </div>

      {status.subscribed && (
        <button onClick={test} disabled={busy}
          className="text-xs font-medium px-3 min-h-[44px] rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40">
          Send a test notification
        </button>
      )}

      {devices.length > 0 && (
        <div className="pt-3 border-t border-slate-100 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Subscribed devices</p>
          {devices.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-xs text-slate-600 py-1">
              <Smartphone size={13} className="text-slate-400 flex-shrink-0" />
              <span className="truncate flex-1">{d.label || d.user_agent?.slice(0, 40) || 'Device'}</span>
              <span className="text-slate-400 flex-shrink-0">
                {d.last_success_at ? `last alert ${new Date(d.last_success_at).toLocaleDateString()}` : 'no alerts yet'}
              </span>
              <button onClick={() => forget(d.id)} className="p-2 text-slate-400 hover:text-red-500 flex-shrink-0 relative before:absolute before:content-[''] before:-inset-[7px]" title="Remove">
                <BellOff size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>

    <SettingsCard
      id="notification-types"
      icon={Filter}
      title="What you’re notified about"
      description="Switching one off silences the push on every one of your devices — it still appears in the bell."
      scope="account"
      save={{ kind: 'instant' }}
      bodyClass="p-4"
    >
      {NOTIFICATION_GROUPS.map((g) => {
        const on = !g.types.every(t => muted.has(t));
        return (
          <div key={g.key} className="flex items-center gap-3 py-2 min-h-[44px]">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700">{g.label}</p>
              <p className="text-[11px] text-slate-400 leading-tight">{g.desc}</p>
            </div>
            <button
              role="switch"
              aria-checked={on}
              aria-label={g.label}
              onClick={() => toggleGroup(g)}
              className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors before:absolute before:content-[''] before:-inset-x-2 before:-inset-y-3 ${on ? 'bg-amber-500' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        );
      })}
    </SettingsCard>
  </>);
}
