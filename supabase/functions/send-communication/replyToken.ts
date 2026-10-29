import type { SupabaseClient } from "jsr:@supabase/supabase-js@2"

// Lowercase only, and no l/1/o/0 — the token travels as an email local part,
// which some mail servers case-fold in transit, and which humans occasionally
// retype off a screen. Ambiguous glyphs cost nothing to drop.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

// 16 chars over a 32-char alphabet is 80 bits. The token is a bearer key to a
// customer's job thread, so it has to be unguessable, not merely unique.
// 256 % 32 === 0, so the modulo below is unbiased.
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let out = ""
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/**
 * The stable reply token for one conversation, creating it on first use.
 *
 * A conversation is a job, a customer, or a web enquiry — enquiries included
 * because a lead who replies is exactly the conversation worth capturing, and
 * they have no customer record yet.
 *
 * Returns null when there is nothing to thread back to, so the caller keeps
 * whatever generic Reply-To it already had.
 */
export async function ensureReplyToken(
  admin: SupabaseClient,
  jobId: string | null,
  customerId: string | null,
  enquiryId: string | null = null,
): Promise<string | null> {
  if (!jobId && !customerId && !enquiryId) return null

  const existing = await findToken(admin, jobId, customerId, enquiryId)
  if (existing) return existing

  const token = mintToken()
  const { error } = await admin
    .from("reply_tokens")
    .insert({ token, job_id: jobId, customer_id: customerId, enquiry_id: enquiryId })

  if (!error) return token

  // 23505 is the conversation unique index: a concurrent send beat us to it,
  // so re-read and use theirs rather than failing the send.
  if (error.code === "23505") {
    const theirs = await findToken(admin, jobId, customerId, enquiryId)
    if (theirs) return theirs
    // A conflict with no row to show for it means the index is keyed on
    // something other than this conversation — which is how every web enquiry
    // after the first silently went out with no Reply-To for weeks, because
    // the old (job_id, customer_id) index treated all of them as one
    // conversation. Loud, because the message still sends and the only visible
    // symptom is a customer reply that never arrives.
    console.error(
      `reply token conflict with no matching row — job=${jobId} customer=${customerId} enquiry=${enquiryId}: ` +
      `${error.message}. This send has no Reply-To token, so a reply will not thread back into the CRM.`
    )
    return null
  }

  // Any other DB problem must not cost the customer their email. Fall through
  // to no token — the message still sends, it just isn't reply-threaded.
  console.error("reply token insert failed:", error.message)
  return null
}

async function findToken(
  admin: SupabaseClient,
  jobId: string | null,
  customerId: string | null,
  enquiryId: string | null = null,
): Promise<string | null> {
  // Filters must be applied before limit(): limit() returns a transform
  // builder, which has no .eq()/.is() on it.
  let q = admin.from("reply_tokens").select("token")

  // An enquiry token is keyed on the enquiry alone. Matching on the job and
  // customer nulls as well would still work, but stating it this way makes the
  // partial unique index the thing that guarantees one token per enquiry.
  if (enquiryId) {
    q = q.eq("enquiry_id", enquiryId)
    const { data } = await q.limit(1).maybeSingle()
    return data?.token ?? null
  }

  q = q.is("enquiry_id", null)
  q = jobId ? q.eq("job_id", jobId) : q.is("job_id", null)
  q = customerId ? q.eq("customer_id", customerId) : q.is("customer_id", null)
  const { data } = await q.limit(1).maybeSingle()
  return data?.token ?? null
}
