import { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { redeemBackupCode } from '../lib/mfaAdmin';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/ToastContainer';

// Shown after a correct password when the account has two-factor enrolled but
// the session is still at aal1. Verifies a TOTP code to reach aal2.
export default function MfaChallenge() {
  const { recheckMfa, signOut } = useAuth();
  const [code, setCode]       = useState('');
  const [factorId, setFactor] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [useBackup, setUseBackup] = useState(false); // backup-code recovery mode

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.find(f => f.status === 'verified') || data?.totp?.[0];
      if (totp) setFactor(totp.id);
      else setError('No authenticator found on this account.');
    });
  }, []);

  const verify = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (useBackup) {
        // Recovery: a valid backup code turns 2FA off so they can get in.
        await redeemBackupCode(code.trim());
        toast('Signed in with a backup code — two-factor is now off. Re-enable it in Settings.');
        await recheckMfa();
        return;
      }
      if (code.length < 6 || !factorId) return;
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
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {useBackup ? 'Enter one of your saved backup codes.' : 'Enter the 6-digit code from your authenticator app.'}
            </p>
          </div>
        </div>

        <form onSubmit={verify} className="space-y-3">
          {useBackup ? (
            <input
              autoFocus value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="w-full text-center text-xl tracking-[0.2em] font-mono border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white dark:bg-slate-800 dark:text-slate-100"
            />
          ) : (
            <input
              autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full text-center text-2xl tracking-[0.4em] font-mono border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white dark:bg-slate-800 dark:text-slate-100"
            />
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="submit" disabled={busy || (useBackup ? code.trim().length < 8 : code.length < 6)}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Verify
          </button>
        </form>

        <div className="flex flex-col items-center gap-1.5">
          <button onClick={() => { setUseBackup(v => !v); setCode(''); setError(''); }}
            className="text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1">
            <KeyRound size={12} /> {useBackup ? 'Use my authenticator app instead' : 'Lost your phone? Use a backup code'}
          </button>
          <button onClick={signOut} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            Sign in as a different user
          </button>
        </div>
      </div>
    </div>
  );
}
