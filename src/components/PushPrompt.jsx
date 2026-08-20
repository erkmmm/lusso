/**
 * One-tap notification opt-in, shown once per device on first launch.
 *
 * Browsers won't let the app ask for permission unprompted (Safari requires a
 * user gesture, and a dismissed prompt is a permanent block), so this is the
 * closest thing to asking automatically: the app makes the offer, the tap makes
 * the request. Dismissing snoozes it for a month; Settings → General always has
 * the switch.
 */

import { useEffect, useState } from 'react';
import { Bell, X, Share } from 'lucide-react';
import { pushPromptMode, snoozePushPrompt, enablePush, isIOS } from '../lib/push';
import { toast } from './ToastContainer';

export default function PushPrompt() {
  const [mode, setMode] = useState(null);   // 'enable' | 'install' | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Deliberately late: the first screen belongs to the user's work, not to us.
    const t = setTimeout(async () => {
      const m = await pushPromptMode();
      if (!cancelled) setMode(m);
    }, 2500);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (!mode) return null;

  const dismiss = () => { snoozePushPrompt(); setMode(null); };

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      toast('Notifications on — you’ll hear about quotes, replies and installs.');
      setMode(null);
    } catch (e) {
      toast(e.message || 'Could not turn on notifications.', 'error', { duration: 8000 });
      snoozePushPrompt(7);
      setMode(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-16 z-[60] p-3 lg:inset-x-auto lg:right-5 lg:bottom-5 lg:w-96 lg:p-0">
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl p-4 pr-10">
        <button onClick={dismiss} aria-label="Dismiss"
          className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-600">
          <X size={15} />
        </button>

        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Bell size={17} className="text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Get alerted the moment it matters</p>

            {mode === 'enable' ? (<>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Quotes opened and accepted, installer responses, customer replies and tasks falling
                due — on this device, even when Lusso is closed.
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={turnOn} disabled={busy}
                  className="text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                  {busy ? 'Turning on…' : 'Turn on notifications'}
                </button>
                <button onClick={dismiss} disabled={busy}
                  className="text-xs font-medium px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
                  Not now
                </button>
              </div>
            </>) : (<>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {isIOS()
                  ? <>iPhone only allows alerts from an installed app. Tap <Share size={11} className="inline -mt-0.5" /> then
                      <span className="font-medium text-slate-600"> Add to Home Screen</span>, and open Lusso from there.</>
                  : <>Install Lusso to your home screen to receive alerts when it’s closed.</>}
              </p>
              <button onClick={dismiss}
                className="text-xs font-medium px-3 py-2 -ml-1 mt-2 rounded-lg text-slate-500 hover:bg-slate-100">
                Got it
              </button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
