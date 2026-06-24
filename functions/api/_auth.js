/**
 * Shared caller-authorization guard for the email Pages Functions.
 *
 * These functions hold the Resend key and can send mail from the business
 * domain, so every request must come from a signed-in, active staff member.
 * We verify the caller's Supabase JWT (passed as `Authorization: Bearer …`)
 * and re-check that their profile is active — both server-side.
 *
 * Returns the Supabase user object when authorized, or null otherwise.
 * Files prefixed with "_" are not routed by Pages, so this is import-only.
 */
export async function requireActiveUser(context) {
  const URL = context.env.SUPABASE_URL || context.env.VITE_SUPABASE_URL;
  const KEY = context.env.SUPABASE_ANON_KEY || context.env.VITE_SUPABASE_ANON_KEY;

  const authz = context.request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!token || !URL || !KEY) return null;

  // 1) Verify the token is a valid Supabase session.
  let user;
  try {
    const ur = await fetch(`${URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: KEY },
    });
    if (!ur.ok) return null;
    user = await ur.json();
  } catch {
    return null;
  }
  if (!user?.id) return null;

  // 2) Re-check the caller is an active profile (RLS lets a user read own row).
  try {
    const pr = await fetch(
      `${URL}/rest/v1/profiles?id=eq.${user.id}&select=status`,
      { headers: { Authorization: `Bearer ${token}`, apikey: KEY } }
    );
    if (!pr.ok) return null;
    const rows = await pr.json();
    if (!Array.isArray(rows) || rows[0]?.status !== 'active') return null;
  } catch {
    return null;
  }

  return user;
}
