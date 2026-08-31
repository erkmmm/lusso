import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderEmail, renderText } from "./emailLayout.ts"

// Emails the active account managers when a customer opens / accepts / declines a
// quote. Called (fire-and-forget) from track_quote_event via pg_net. Requires a
// shared token only the DB knows, so this public endpoint can't be used to spam
// staff or read their emails. Recipients + details come from SECURITY DEFINER
// RPCs that exclude suspended/deactivated/banned/deleted/unconfirmed accounts.
//
// On acceptance it also sends the CUSTOMER a confirmation. The accepted-quote
// page has always told them "a copy has been emailed to you" — and until this
// existed, nothing was: the only mail leaving the building went to staff.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  try {
    const { quoteId, eventType, meta, dryRun, token } = await req.json().catch(() => ({}))
    if (!quoteId || !eventType) return json({ error: "quoteId and eventType required" }, 400)
    if (!["quote_first_opened", "quote_accepted", "quote_declined"].includes(eventType))
      return json({ ok: true, skipped: eventType })

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: authorized } = await admin.rpc("notify_token_ok", { p_token: token ?? "" })
    if (!authorized) return json({ error: "unauthorized" }, 401)

    const { data: p, error: rpcErr } = await admin.rpc("quote_notify_payload", { p_quote_id: quoteId })
    if (rpcErr) return json({ ok: false, error: rpcErr.message })
    if (!p) return json({ error: "quote not found" }, 404)

    const custName = p.customerName || meta?.name || "A customer"
    const to: string[] = Array.isArray(p.recipients) ? p.recipients.filter(Boolean) : []

    // Subjects keep their emoji — in a crowded staff inbox the glyph is how you
    // spot an acceptance at a glance. The email body itself stays on-brand.
    let subject = "", eyebrow = "", heading = "", body = ""
    if (eventType === "quote_first_opened") {
      subject = `\u{1F441}️ ${custName} opened quote ${p.quoteNumber}`
      eyebrow = "Quote opened"
      heading = `${custName} opened ${p.quoteNumber}`
      body    = `${custName} just opened quote ${p.quoteNumber} for the first time.`
    } else if (eventType === "quote_accepted") {
      subject = `✅ ${custName} ACCEPTED quote ${p.quoteNumber}`
      eyebrow = "Quote accepted"
      heading = `${custName} accepted ${p.quoteNumber}`
      body    = `${custName} accepted quote ${p.quoteNumber}. Time to raise the invoice and book it in.`
    } else {
      subject = `❌ ${custName} declined quote ${p.quoteNumber}`
      eyebrow = "Quote declined"
      heading = `${custName} declined ${p.quoteNumber}`
      body    = `${custName} declined quote ${p.quoteNumber}.${meta?.reason ? `\n\nReason given: ${meta.reason}` : ""}`
    }

    const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
    const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Lusso <onboarding@resend.dev>"

    const appUrl = Deno.env.get("APP_URL") || "https://app.lusso.com.au"
    const link = p.jobId ? `${appUrl}/jobs/${p.jobId}` : `${appUrl}/quotes/${quoteId}`

    if (dryRun) return json({ ok: true, dryRun: true, recipients: to.length, resendConfigured: !!RESEND_KEY, from: EMAIL_FROM, subject, customerEmail: !!p.customerEmail })
    if (!RESEND_KEY) return json({ ok: false, note: "Resend API key not configured" })
    // No account managers configured is not a reason to withhold the customer's
    // own confirmation, so this check no longer short-circuits the whole run.
    if (!to.length && !(eventType === "quote_accepted" && p.customerEmail)) {
      return json({ ok: true, note: "no recipients" })
    }

    const content = {
      preheader: `${custName} · ${p.quoteNumber}${p.salesperson ? ` · ${p.salesperson}` : ""}`,
      eyebrow,
      heading,
      body,
      cta: { label: "Open in Lusso", url: link },
      signOff: "",                       // internal mail needs no sign-off
      footerNote: `Salesperson: ${p.salesperson || "—"}`,
    }

    // Guarded because `to` may legitimately be empty now: an acceptance with no
    // account managers configured still owes the customer their confirmation,
    // and Resend rejects an empty recipient list.
    let staffSend: Record<string, unknown> = { sent: false, note: "no recipients" }
    if (to.length) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          subject,
          html: renderEmail(content),
          text: renderText(content),
        }),
      })
      const data = await res.json().catch(() => ({}))
      staffSend = res.ok ? { sent: true, id: data?.id } : { sent: false, note: data?.message || "send failed" }
    }

    // ── Customer confirmation ────────────────────────────────────────────────
    // Their receipt: what they chose, what it came to, and what happens next.
    // Failing to send it must never fail the staff notification, so it's
    // wrapped and reported rather than thrown.
    let customerSend: Record<string, unknown> = { sent: false }
    if (eventType === "quote_accepted" && p.customerEmail) {
      try {
        const money = (n: unknown) =>
          "$" + Number(n ?? 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const items: Array<{ name: string; location?: string; quantity?: number; total?: number }> =
          Array.isArray(p.items) ? p.items : []
        const lines = items
          .map(i => `• ${i.name}${i.location ? ` (${i.location})` : ""}${Number(i.quantity) > 1 ? ` × ${i.quantity}` : ""} — ${money(i.total)}`)
          .join("\n")
        const deposit = p.depositAmount != null
          ? `\n\nYour ${p.depositLabel ?? ""} deposit of ${money(p.depositAmount)} confirms the order — we'll sort that out with you on the call.`
          : ""
        const quoteLink = p.publicToken
          ? `${appUrl}/quotes/${quoteId}/preview?t=${encodeURIComponent(String(p.publicToken))}`
          : ""

        const custContent = {
          preheader: `Your order is confirmed · ${p.quoteNumber} · ${money(p.grandTotal)}`,
          eyebrow: "Order confirmed",
          heading: `Thank you — we have your acceptance`,
          greeting: `Hi ${String(custName).split(" ")[0] || "there"},`,
          body:
            `Thanks for accepting quote ${p.quoteNumber}${p.siteAddress ? ` for ${p.siteAddress}` : ""}. `
            + `Here's what you've confirmed:\n\n${lines}\n\nTotal: ${money(p.grandTotal)} (incl. GST where it applies).${deposit}`,
          cta: quoteLink ? { label: "View your quote", url: quoteLink } : null,
          outro: "We'll call within one business day to arrange the deposit and book your installation. "
               + "If anything here doesn't look right, just reply to this email — it comes straight to us.",
          signOff: "The Lusso Team",
        }

        const custRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [p.customerEmail],
            subject: `Your Lusso order is confirmed — ${p.quoteNumber}`,
            html: renderEmail(custContent),
            text: renderText(custContent),
          }),
        })
        const custData = await custRes.json().catch(() => ({}))
        customerSend = custRes.ok
          ? { sent: true, id: custData?.id }
          : { sent: false, note: custData?.message || "customer send failed" }
      } catch (e) {
        customerSend = { sent: false, note: String(e) }
      }
    }

    return json({ ok: true, staff: staffSend, recipients: to.length, customer: customerSend })
  } catch (e) {
    return json({ ok: false, error: String(e) })
  }
})
