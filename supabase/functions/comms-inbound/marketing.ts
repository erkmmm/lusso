/**
 * What an inbound message means for a marketing campaign.
 *
 * Two jobs, and the first one is a legal obligation rather than a feature:
 *
 *   1. STOP has to work. The Spam Act 2003 requires a functional unsubscribe
 *      facility on every commercial electronic message, and the campaign texts
 *      promise "Reply STOP to opt out". That promise is only true because this
 *      file honours the keyword — the sender appends the line, this records
 *      the consequence, and shipping one without the other is worse than
 *      shipping neither.
 *
 *   2. A reply is attributed back to the campaign that prompted it. Without
 *      this, marketing_sends.status never leaves 'sent': the dashboard reports
 *      zero replies forever, and — the part that actually bites — an SMS
 *      campaign chained behind an email campaign with `after_campaign` skips
 *      nobody, because "already replied" is a state nothing ever writes. The
 *      chain quietly degrades into a second blast at people mid-conversation.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2"

/**
 * Keywords that opt a number out, matched as the WHOLE message.
 *
 * Twilio's own standard set, minus "NO" — a customer answering "no" to
 * "would you like a quote?" has declined an offer, not withdrawn consent, and
 * silently unsubscribing them would lose the conversation.
 *
 * Free-text ("please stop sending me these") deliberately does NOT match: it
 * threads to a human like any other reply. Pattern-matching intent inside a
 * sentence would also catch "stop by on Tuesday". A clear written request
 * still has to be honoured, so those land in the Inbox for someone to action.
 */
const STOP_WORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt out",
])

/**
 * Keywords that undo an opt-out, so a customer can let us back in.
 *
 * "YES" is deliberately NOT here, though Twilio's standard list includes it.
 * A campaign that ends "reply YES and we'll quote it" will collect YES as an
 * answer to the offer hundreds of times and as an opt-in resume approximately
 * never — treating it as the latter would swallow the very replies the
 * campaign exists to produce.
 */
const START_WORDS = new Set(["start", "unstop"])

const normalise = (body: string) =>
  String(body ?? "").trim().toLowerCase().replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ")

export const isStopKeyword  = (body: string) => STOP_WORDS.has(normalise(body))
export const isStartKeyword = (body: string) => START_WORDS.has(normalise(body))

/**
 * Record an SMS opt-out. Returns the normalised number, or null if the sender
 * was not a recognisable AU mobile (in which case there is nothing to suppress
 * and nothing we could have sent them anyway).
 */
export async function suppressMobile(
  admin: SupabaseClient, from: string, source = "sms-stop",
): Promise<string | null> {
  const { data, error } = await admin.rpc("marketing_suppress_mobile", {
    p_mobile: from, p_reason: "stop", p_source: source,
  })
  if (error) {
    // Loud: a swallowed opt-out is a breach that keeps on texting.
    console.error("marketing_suppress_mobile failed:", error.message, "for", from)
    return null
  }
  return (data as string | null) ?? null
}

/** Undo an opt-out after START/UNSTOP. */
export async function unsuppressMobile(
  admin: SupabaseClient, from: string,
): Promise<string | null> {
  const { data: e164 } = await admin.rpc("marketing_mobile_e164", { p_raw: from })
  const mobile = (e164 as string | null) ?? null
  if (!mobile) return null
  const { error } = await admin.from("marketing_sms_suppressions").delete().eq("mobile", mobile)
  if (error) console.error("unsuppress failed:", error.message)
  return mobile
}

/**
 * Mark the most recent campaign send to this person as replied.
 *
 * Most recent only, not every campaign they have ever received: a reply
 * answers the message that prompted it. Rows already marked 'replied' are left
 * alone so a conversation of five texts does not inflate the reply count to
 * five.
 */
export async function noteMarketingReply(
  admin: SupabaseClient,
  addr: { mobile?: string | null; email?: string | null },
): Promise<string | null> {
  let query = admin.from("marketing_sends").select("id, campaign_id").eq("status", "sent")

  if (addr.mobile) {
    const { data: e164 } = await admin.rpc("marketing_mobile_e164", { p_raw: addr.mobile })
    if (!e164) return null
    query = query.eq("channel", "sms").eq("mobile", e164 as string)
  } else if (addr.email) {
    query = query.eq("channel", "email").eq("email", addr.email.trim().toLowerCase())
  } else {
    return null
  }

  const { data, error } = await query.order("sent_at", { ascending: false }).limit(1).maybeSingle()
  if (error || !data) return null

  await admin.from("marketing_sends")
    .update({ status: "replied", replied_at: new Date().toISOString() })
    .eq("id", data.id)

  return data.campaign_id as string
}
