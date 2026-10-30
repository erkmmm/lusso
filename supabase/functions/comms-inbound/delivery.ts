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
 * The states that mean the message did not get there. Staff have to be told
 * about these: the badge on the Comms tab only helps someone who already
 * suspects a problem and goes looking, and the whole failure mode here is
 * believing a quote landed when it never did.
 */
const UNDELIVERED = new Set(["bounced", "failed", "complained"])

/** Shortened for a push notification, which gets about this much room. */
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

/**
 * Raise the "this never arrived" notification.
 *
 * Inserted into `notifications`, which has an AFTER INSERT trigger that fans
 * the push out to every subscribed device — so this one insert is the whole
 * delivery path. Deduped on the message and the state it reached: providers
 * retry webhooks, and Resend posts email.bounced more than once for the same
 * send, which would otherwise buzz a phone each time.
 *
 * Never throws and never blocks the status update. A notification that fails
 * to insert is a missed buzz; a webhook that 500s is a provider retrying
 * forever and a status that never lands at all.
 */
async function notifyUndelivered(
  admin: SupabaseClient,
  row: { id: string; channel?: string | null; to_address?: string | null; subject?: string | null; customer_id?: string | null; job_id?: string | null },
  status: string,
  detail: string | null,
) {
  try {
    // Who it was for, in the words staff think in. Falls back to the address
    // itself when the message isn't tied to a customer.
    let who = row.to_address || "the recipient"
    let named = false
    if (row.customer_id) {
      const { data: cust } = await admin
        .from("customers").select("name").eq("id", row.customer_id).maybeSingle()
      if (cust?.name) { who = cust.name; named = true }
    }

    const isEmail = (row.channel || "email") === "email"
    const noun = isEmail ? "Email" : "SMS"

    // Three different problems needing three different actions: a bounce is a
    // wrong or dead address, a complaint is a customer who does not want to
    // hear from us again, a failure is usually ours or the carrier's. "Bounce"
    // is email's word — a text that didn't arrive didn't bounce, it just
    // didn't get there.
    const title =
      status === "complained" ? `🚫 ${noun} marked as spam`
      : status === "bounced"  ? (isEmail ? "📪 Email bounced" : "📪 SMS didn’t get through")
      : `📪 ${noun} failed to send`

    // Reads as the start of a sentence in one case and mid-sentence in the
    // other, so it needs both forms.
    const subjectLine = row.subject ? `“${clip(row.subject, 60)}”` : null
    const leading  = subjectLine ?? "The message"
    const trailing = subjectLine ?? "the message"

    // The provider's reason is a fragment as often as a sentence, and two
    // sentences run together with no stop between them is unreadable on a
    // lock screen.
    const reason = detail ? clip(detail, 90).replace(/\s*$/, "").replace(/([^.!?])$/, "$1.") : ""
    const contact = row.to_address || (isEmail ? "that address" : "that number")
    const fix = isEmail
      ? "Check the address and send it again."
      : "Check the number and try again."

    const message =
      status === "complained"
        ? `${who} marked ${trailing} as spam. Don’t send to ${contact} again without asking.`
        : [`${leading} never reached ${who}${named && row.to_address ? ` (${row.to_address})` : ""}.`, reason, fix]
            .filter(Boolean).join(" ")

    const link = row.job_id ? `/jobs/${row.job_id}`
      : row.customer_id ? `/customers/${row.customer_id}`
      : "/inbox"

    const { error } = await admin.from("notifications").insert({
      type: "comms_undelivered",
      title,
      message,
      job_id: row.job_id ?? null,
      link,
      is_read: false,
      dedupe_key: `comms_undelivered:${row.id}:${status}`,
    })
    // 23505 is the dedupe unique index doing its job on a retried webhook.
    if (error && error.code !== "23505") {
      console.error("undelivered notification failed:", error.message)
    }
  } catch (err) {
    console.error("undelivered notification threw:", err)
  }
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
    .select("id, status, channel, direction, to_address, subject, customer_id, job_id")
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

  // Tell someone. Only on the way IN to a failed state — a quote that bounces
  // and is then re-sent to a corrected address would otherwise notify twice
  // for the one problem, and a complaint arriving after a bounce is the same
  // dead address reported twice over.
  if (UNDELIVERED.has(status) && !UNDELIVERED.has(row.status)) {
    await notifyUndelivered(admin, row, status, detail)
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
