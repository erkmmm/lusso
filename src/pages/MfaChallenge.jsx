import { useState, useEffect } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Shown after a correct password when the account has two-factor enrolled but
// the session is still at aal1. Verifies a TOTP code to reach aal2.
export default function MfaChallenge() {
  const { recheckMfa, signOut } = useAuth();
  const [code, setCode]       = useState('');
  const [factorId, setFactor] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.find(f => f.status === 'verified') || data?.totp?.[0];
      if (totp) setFactor(totp.id);
      else setError('No authenticator found on this account.');
    });
  }, []);

  const verify = async (e) => {
    e?.preventDefault();
    if (busy || code.length < 6 || !factorId) return;
    setBusy(true); setError('');
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
      if (vErr) throw vErr;
      await recheckMfa(); // clears mfaRequired → app renders
    } catch (err) {
      setError(err.message || 'That code didn’t match. Try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loading-screen min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 dark:text-slate-100">Two-factor verification</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Enter the 6-digit code from your authenticator app.</p>
          </div>
        </div>

        <form onSubmit={verify} className="space-y-3">
          <input
            autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="w-full text-center text-2xl tracking-[0.4em] font-mono border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white dark:bg-slate-800 dark:text-slate-100"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="submit" disabled={busy || code.length < 6}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Verify
          </button>
        </form>

        <button onClick={signOut} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          Sign in as a different user
        </button>
      </div>
    </div>
  );
}
