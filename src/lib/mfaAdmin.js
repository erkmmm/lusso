import { supabase } from './supabase';

// Calls the mfa-admin edge function (backup codes + admin/self recovery).
async function call(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mfa-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Generate a fresh set of one-time backup codes (returns plaintext once).
export const generateBackupCodes = () => call({ action: 'generate' });

// Use a backup code to recover a locked-out account (disables 2FA).
export const redeemBackupCode = (code) => call({ action: 'use-backup-code', code });

// Account manager: clear another user's 2FA so they can re-enrol.
export const resetUserMfa = (targetUserId) => call({ action: 'reset', targetUserId });
