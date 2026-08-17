import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderEmail, renderText } from "./emailLayout.ts"

// Emails the active account managers when a customer opens / accepts / declines a
// quote. Called (fire-and-forget) from track_quote_event via pg_net. Requires a
// shared token only the DB knows, so this public endpoint can't be used to spam
// staff or read their emails. Recipients + details come from SECURITY DEFINER
// RPCs that exclude suspended/deactivated/banned/deleted/unconfirmed accounts.

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

    if (dryRun) return json({ ok: true, dryRun: true, recipients: to.length, resendConfigured: !!RESEND_KEY, from: EMAIL_FROM, subject })
    if (!to.length) return json({ ok: true, note: "no recipients" })
    if (!RESEND_KEY) return json({ ok: false, note: "Resend API key not configured" })

    const appUrl = Deno.env.get("APP_URL") || "https://app.lusso.com.au"
    const link = p.jobId ? `${appUrl}/jobs/${p.jobId}` : `${appUrl}/quotes/${quoteId}`

    const content = {
      preheader: `${custName} · ${p.quoteNumber}${p.salesperson ? ` · ${p.salesperson}` : ""}`,
      eyebrow,
      heading,
      body,
      cta: { label: "Open in Lusso", url: link },
      signOff: "",                       // internal mail needs no sign-off
      footerNote: `Salesperson: ${p.salesperson || "—"}`,
    }

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
    if (!res.ok) return json({ ok: false, note: data?.message || "send failed" })
    return json({ ok: true, id: data?.id, recipients: to.length })
  } catch (e) {
    return json({ ok: false, error: String(e) })
  }
})
