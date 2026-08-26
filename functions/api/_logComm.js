/**
 * Record an outbound email in the communications log.
 *
 * The Comms tab and the Inbox are built on this table, but the three emails
 * that go out through these Pages Functions — quotes, installer requests,
 * purchase orders — never wrote to it. Two consequences, both bad:
 *
 *   · a customer's thread didn't show that we'd emailed them their quote, and
 *   · a bounce had nothing to attach itself to. Resend's delivery webhook
 *     matches on external_id, so an unlogged send can never be marked bounced,
 *     which is how a quote that never arrived kept reading as "Sent".
 *
 * Written with the caller's own JWT, so RLS applies exactly as it does in the
 * app. Best-effort by design: the email has already gone by the time we get
 * here, and failing the request now would tell the user their quote didn't
 * send when it did. Problems are logged and swallowed.
 *
 * Files prefixed with "_" are not routed by Pages, so this is import-only.
 */

/**
 * @param {object} context   - the Pages Function context (for env)
 * @param {string} token     - the caller's Supabase access token
 * @param {object} entry
 * @param {string} entry.externalId - the Resend message id (the join key)
 * @param {string} entry.to         - recipient address
 * @param {string} entry.subject    - subject as sent
 * @param {string} entry.body       - one-line summary for the thread
 * @param {string} [entry.customerId]
 * @param {string} [entry.jobId]
 */
export async function logOutboundEmail(context, token, entry) {
  const URL = context.env.SUPABASE_URL || context.env.VITE_SUPABASE_URL;
  const KEY = context.env.SUPABASE_ANON_KEY || context.env.VITE_SUPABASE_ANON_KEY;
  if (!URL || !KEY || !token) return;

  try {
    const res = await fetch(`${URL}/rest/v1/communications`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        channel: 'email',
        direction: 'outbound',
        customer_id: entry.customerId ?? null,
        job_id: entry.jobId ?? null,
        subject: entry.subject ?? null,
        body: entry.body,
        to_address: entry.to,
        from_address: context.env.EMAIL_FROM || null,
        // 'sent' means the mail service accepted it. The delivery webhook
        // advances this to delivered or bounced.
        status: 'sent',
        external_id: entry.externalId ?? null,
      }),
    });
    if (!res.ok) {
      console.error('[logOutboundEmail] insert failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[logOutboundEmail] error:', err.message);
  }
}

/** The caller's bearer token, or '' when there isn't one. */
export function bearerToken(context) {
  const authz = context.request.headers.get('Authorization') || '';
  return authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
}
