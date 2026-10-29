/**
 * The per-conversation reply address for mail sent from a Pages Function.
 *
 * Outbound customer email carries Reply-To: q-<token>@reply.lusso.com.au, so a
 * plain "Reply" in the customer's mail client lands back on their thread in the
 * CRM instead of in the shared mailbox. See ops/inbound-email/README.md.
 *
 * The Supabase edge functions mint these themselves with the service key.
 * These Pages Functions have no service key and should not be given one — so
 * the minting lives in the database behind ensure_reply_token(), called with
 * the caller's own JWT under the same active-staff check as everything else.
 * See migrations/ensure_reply_token_rpc.sql.
 *
 * Best-effort, always: a reply address is worth having, but never worth losing
 * the customer's quote over. Every failure path returns null and the caller
 * falls back to whatever generic Reply-To it already had.
 *
 * Files prefixed with "_" are not routed by Pages, so this is import-only.
 *
 * @param {object} context  - the Pages Function context (for env)
 * @param {string} token    - the caller's Supabase access token
 * @param {object} conv
 * @param {string} [conv.jobId]
 * @param {string} [conv.customerId]
 * @returns {Promise<string|null>} the full reply address, or null
 */
export async function replyAddressFor(context, token, { jobId, customerId } = {}) {
  const URL    = context.env.SUPABASE_URL || context.env.VITE_SUPABASE_URL;
  const KEY    = context.env.SUPABASE_ANON_KEY || context.env.VITE_SUPABASE_ANON_KEY;
  // Unset means the reply domain isn't live in this environment, so an address
  // there would bounce. Leaving it unset keeps the previous behaviour exactly.
  const DOMAIN = context.env.REPLY_DOMAIN || '';

  if (!DOMAIN || !URL || !KEY || !token) return null;
  if (!jobId && !customerId) return null;

  try {
    const res = await fetch(`${URL}/rest/v1/rpc/ensure_reply_token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_job_id:      jobId ?? null,
        p_customer_id: customerId ?? null,
      }),
    });
    if (!res.ok) {
      console.error('[replyAddressFor] rpc failed:', res.status, await res.text());
      return null;
    }
    // A scalar text RPC comes back as a bare JSON string.
    const minted = await res.json();
    if (typeof minted !== 'string' || !minted) return null;
    return `q-${minted}@${DOMAIN}`;
  } catch (err) {
    console.error('[replyAddressFor] error:', err.message);
    return null;
  }
}

/**
 * The line that tells the customer a reply will reach us.
 *
 * Only ever rendered when the message really is threaded — promising "your
 * reply comes back to us" when it would land in a mailbox nobody watches is
 * worse than saying nothing.
 */
export const REPLY_NOTE =
  'Your reply to this email comes straight back to our team.';
