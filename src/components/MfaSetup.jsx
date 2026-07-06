import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from './ToastContainer';
import Card from './Card';

// Two-factor (TOTP) enrolment for the signed-in user, used in Settings.
// Optional — enabling it just adds a code step at that user's next login.
export default function MfaSetup() {
  const { recheckMfa } = useAuth();
  const [factors, setFactors] = useState(null);      // null = loading
  const [enrolling, setEnrolling] = useState(null);   // { factorId, qr, secret }
  const [code, setCode]  = useState('');
  const [busy, setBusy]  = useState(false);
  const [error, setError] = useState('');

  const load = () => supabase.auth.mfa.listFactors().then(({ data }) => {
    setFactors((data?.totp || []).filter(f => f.status === 'verified'));
  }).catch(() => setFactors([]));
  useEffect(() => { load(); }, []);

  const startEnroll = async () => {
    setBusy(true); setError('');
    try {
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (err) throw err;
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) {
      setError(e.message || 'Could not start setup.');
    } finally { setBusy(false); }
  };

  const confirmEnroll = async (e) => {
    e?.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true); setError('');
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: ch.id, code });
      if (vErr) throw vErr;
      toast('Two-factor authentication enabled.');
      setEnrolling(null); setCode('');
      await recheckMfa();
      load();
    } catch (err) {
      setError(err.message || 'That code didn’t match — try again.');
      setCode('');
    } finally { setBusy(false); }
  };

  const cancelEnroll = async () => {
    if (enrolling?.factorId) { try { await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }); } catch { /* ignore */ } }
    setEnrolling(null); setCode(''); setError('');
  };

  const remove = async (factorId) => {
    if (!window.confirm('Turn off two-factor authentication for your account?')) return;
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
      if (err) throw err;
      toast('Two-factor authentication turned off.');
      await recheckMfa(); load();
    } catch (e) {
      toast(`Could not remove: ${e.message}`);
    } finally { setBusy(false); }
  };

  const enabled = factors && factors.length > 0;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <ShieldCheck size={14} className="text-amber-500" /> Two-factor authentication
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Add a 6-digit code from your phone to your login for extra security.</p>
      </div>

      <div className="p-5">
        {factors === null ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Checking…</div>
        ) : enrolling ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">1. Scan this with your authenticator app (Google Authenticator, Authy, or your phone’s password manager).</p>
            <div className="flex justify-center">
              <img src={enrolling.qr} alt="Two-factor QR code" className="w-44 h-44 border border-slate-200 rounded-lg bg-white" />
            </div>
            <p className="text-xs text-slate-400 text-center">
              Can’t scan? Enter this key manually:
              <span className="block font-mono text-slate-600 mt-1 break-all select-all">{enrolling.secret}</span>
            </p>
            <form onSubmit={confirmEnroll} className="space-y-2">
              <p className="text-sm text-slate-600">2. Enter the 6-digit code it shows:</p>
              <input
                autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full text-center text-xl tracking-[0.3em] font-mono border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={cancelEnroll}
                  className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={busy || code.length < 6}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Turn on
                </button>
              </div>
            </form>
          </div>
        ) : enabled ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">Two-factor is on</p>
              <p className="text-xs text-slate-400">You’ll enter a code from your app at each login.</p>
            </div>
            <button onClick={() => remove(factors[0].id)} disabled={busy}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 flex-shrink-0">
              <ShieldOff size={13} /> Turn off
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-600">Not enabled.</p>
            </div>
            <button onClick={startEnroll} disabled={busy}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50 flex-shrink-0">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Enable
            </button>
          </div>
        )}
        {error && !enrolling && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </Card>
  );
}
