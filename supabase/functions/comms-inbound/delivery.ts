import type { SupabaseClient } from "jsr:@supabase/supabase-js@2"

// Delivery receipts for messages we sent.
//
// Both providers accept a message and answer 200 long before they know whether
// it arrived, so the row send-communication writes says "sent" and means only
// "accepted". Twilio then posts to its StatusCallback and Resend to its
// delivery webhook, and this is where those land. Rows are matched on
// external_id — the Twilio SID or the Resend email id stored at send time.
//
// Rules that keep the badge honest:
//   · never move a row backwards (a late "sent" must not undo "delivered"),
//   · never invent a row — an event for something we didn't send is ignored,
//   · never fail the webhook on a miss, or the provider will retry forever.

/**
 * How final a state is. A provider can deliver events out of order — Twilio
 * regularly posts "sent" after "delivered" — so an update only applies when it
 * ranks at least as high as what's already stored.
 */
const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  complained: 4,   // delivered, and then some: the recipient marked it spam
  bounced: 5,      // terminal, and the one staff must see
  failed: 5,
}

// Twilio MessageStatus → our vocabulary.
// https://www.twilio.com/docs/messaging/api/message-resource#message-status-values
const TWILIO_STATUS: Record<string, string> = {
  queued: "queued",
  accepted: "queued",
  scheduled: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  undelivered: "bounced",   // the carrier rejected it — same meaning to staff
  failed: "failed",
  canceled: "failed",
}

// Resend event type → our vocabulary. email.opened / email.clicked are
// deliberately absent: whether a customer opened an email is a different
// question from whether it arrived, and tracking it isn't what this is for.
const RESEND_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  // Resend refused to send at all, because the address is already on its
  // suppression list from an earlier bounce or complaint. The send call still
  // returns 200 and an id, so without this event the message looks sent and
  // simply never arrives — the exact failure this file exists to catch.
  "email.suppressed": "failed",
}

export function isResendDeliveryEvent(type: unknown): boolean {
  return typeof type === "string" && type in RESEND_STATUS
}

/**
 * Apply one status update to the row with this provider id.
 * Returns a short result for the response body; never throws.
 */
async function applyStatus(
  admin: SupabaseClient,
  externalId: string,
  status: string,
  detail: string | null,
): Promise<{ ok: true; updated: boolean; note?: string }> {
  if (!externalId || !status) return { ok: true, updated: false, note: "nothing to match on" }

  const { data: row, error } = await admin
    .from("communications")
    .select("id, status")
    .eq("external_id", externalId)
    .maybeSingle()

  if (error) {
    console.error("delivery lookup failed:", error.message)
    return { ok: true, updated: false, note: "lookup failed" }
  }
  // Not ours — a message sent from the Twilio console, or an event for another
  // environment sharing the account. Silently fine.
  if (!row) return { ok: true, updated: false, note: "no matching message" }

  const current = RANK[row.status] ?? -1
  const incoming = RANK[status] ?? -1
  if (incoming < current) {
    return { ok: true, updated: false, note: `ignored ${status} behind ${row.status}` }
  }

  const { error: updErr } = await admin
    .from("communications")
    .update({ status, status_detail: detail, status_at: new Date().toISOString() })
    .eq("id", row.id)

  if (updErr) {
    console.error("delivery update failed:", updErr.message)
    return { ok: true, updated: false, note: "update failed" }
  }
  return { ok: true, updated: true }
}

/**
 * Twilio StatusCallback. Twilio posts the same form-urlencoded shape as an
 * inbound SMS, distinguished by carrying MessageStatus and no Body.
 */
export function isTwilioStatusCallback(params: URLSearchParams): boolean {
  return !!params.get("MessageStatus") && !params.get("Body")
}

export async function applyTwilioStatus(admin: SupabaseClient, params: URLSearchParams) {
  const sid = params.get("MessageSid") ?? params.get("SmsSid") ?? ""
  const raw = params.get("MessageStatus") ?? ""
  const status = TWILIO_STATUS[raw]
  if (!status) return { ok: true, updated: false, note: `unmapped status ${raw}` }

  // Twilio sends a numeric error code on failure; the human message is only in
  // their docs, so keep the code — it's what you search on.
  const code = params.get("ErrorCode")
  const detail = code ? `Twilio error ${code}` : null

  return await applyStatus(admin, sid, status, detail)
}

/** Resend delivery webhook (email.delivered, email.bounced, and friends). */
export async function applyResendStatus(admin: SupabaseClient, data: {
  type?: string
  data?: { email_id?: string; bounce?: { message?: string; type?: string; subType?: string } }
}) {
  const status = RESEND_STATUS[data?.type ?? ""]
  if (!status) return { ok: true, updated: false, note: `unmapped event ${data?.type}` }

  const bounce = data?.data?.bounce
  let detail = bounce?.message || bounce?.subType || bounce?.type || null
  if (data?.type === "email.suppressed" && !detail) {
    detail = "Suppressed by Resend — this address bounced or complained before"
  }

  return await applyStatus(admin, data?.data?.email_id ?? "", status, detail)
}
