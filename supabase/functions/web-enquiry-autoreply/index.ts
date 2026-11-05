import { requireStaff } from "../_shared/staffRequest.ts"
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderEmail, renderText } from "../send-communication/emailLayout.ts"
import { ensureReplyToken } from "../send-communication/replyToken.ts"
import { emailFrom, renderAutoReply, OFFICE_PHONE } from "./render.ts"

/**
 * Auto-reply to a website lead, seconds after they submit the form.
 *
 * Called by the web_enquiries AFTER INSERT trigger, which proves itself with
 * the shared token only the DB knows — the same arrangement as push-send and
 * quote-notify, and the reason verify_jwt is off. The website itself POSTs
 * straight to PostgREST and never calls this, so a visitor cannot trigger a
 * send to an address of their choosing.
 *
 * Three things matter more than the copy here:
 *
 *  1. IT MUST NOT SEND TWICE. `web_enquiries.auto_replied_at` is claimed with a
 *     conditional UPDATE … WHERE auto_replied_at IS NULL, so two concurrent
 *     invocations (a trigger retry, a manual replay) cannot both win. Anyone
 *     submitting the same form from three product pages in one session gets one
 *     email, not three — 42 rows in and the table already shows people doing
 *     exactly that.
 *  2. IT MUST NOT MAKE A PROMISE WE BREAK. The call window is worked out in
 *     Brisbane time and never claims a weekend. See render.ts.
 *  3. IT MUST NOT SEND NONSENSE. Every interpolated field is normalised and can
 *     be dropped. See the long note at the top of render.ts.
 *
 * A failure here must never be loud enough to matter: the lead is already saved
 * and the staff push has already fired, so the worst case is a customer who
 * does not get a courtesy email — not a lost lead.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Don't email the same person twice in a short window even across separate
// enquiry rows — the per-row claim above cannot see a second row.
const THROTTLE_HOURS = 6

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  try {
    const { token, enquiryId, force, preview, template: draft } = await req.json().catch(() => ({}))
    if (!enquiryId && !preview) return json({ error: "enquiryId required" }, 400)

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // ── Who's asking ─────────────────────────────────────────────────────────
    // The DB trigger carries the shared token; a staff member replaying a send
    // from the CRM carries their own JWT.
    if (token) {
      const { data: ok } = await admin.rpc("notify_token_ok", { p_token: token })
      if (!ok) return json({ error: "unauthorized" }, 401)
    } else {
      const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? ""
      const { data: { user } } = await admin.auth.getUser(jwt)
      if (!user) return json({ error: "unauthorized" }, 401)
      const denied = await requireStaff(req, cors)
      if (denied) return denied
    }

    // ── Preview ─────────────────────────────────────────────────────────────
    // Settings needs to show the actual words, not a description of them. The
    // body is not flat prose — it assembles itself per enquiry — so a preview
    // has to run the real renderer rather than echo the template box back.
    //
    // Nothing is claimed, sent or logged on this path, and it needs no
    // enquiry: it renders one fixed sample lead so two people reading the
    // screen see the same message. `now` is real, though, so the call promise
    // shown is the one a lead would actually get at this moment.
    //
    // Both versions come back. The built-in is what the boxes show as their
    // placeholder, which is the only way to read the shipped wording you are
    // about to override; the effective one reflects the unsaved draft when the
    // caller passes one, so the preview tracks typing instead of the last save.
    if (preview) {
      const officePhone = Deno.env.get("OFFICE_PHONE") ?? OFFICE_PHONE

      const { data: cfg } = await admin
        .from("internal_notify_config")
        .select("autoreply_subject, autoreply_body, autoreply_sms")
        .eq("id", 1)
        .maybeSingle()

      const saved = {
        subject: cfg?.autoreply_subject ?? null,
        body:    cfg?.autoreply_body    ?? null,
        sms:     cfg?.autoreply_sms     ?? null,
      }
      // An explicit draft wins, including a cleared box — which must preview as
      // the built-in, exactly as clearing and saving would behave.
      const effectiveTemplate = draft ?? saved

      const sample = {
        name:     "Sarah Chen",
        email:    "sarah@example.com",
        phone:    "0412345678",
        suburb:   "Mermaid Beach",
        interest: "Curtains",
      }

      const now = new Date()
      const builtIn   = renderAutoReply(sample, now, officePhone, {})
      const effective = renderAutoReply(sample, now, officePhone, effectiveTemplate)

      return json({
        preview: true,
        sample,
        builtIn: { subject: builtIn.subject, body: builtIn.body, sms: builtIn.sms },
        effective: {
          subject:  effective.subject,
          greeting: effective.greeting,
          body:     effective.body,
          outro:    effective.outro,
          sms:      effective.sms,
        },
        // What an editor may put in a box. Listed by the server so the help
        // text in Settings cannot drift from what fillTokens actually fills.
        tokens: [
          "first_name", "suburb", "interest", "phone",
          "call_window", "office_phone", "opening", "call_line",
        ],
      })
    }

    const { data: enquiry, error: readErr } = await admin
      .from("web_enquiries")
      .select("id, created_at, name, email, phone, suburb, interest, source, deleted_at, auto_replied_at")
      .eq("id", enquiryId)
      .maybeSingle()

    if (readErr) return json({ error: `DB error: ${readErr.message}` }, 500)
    if (!enquiry) return json({ error: "enquiry not found" }, 404)

    // ── Should this row get an auto-reply at all? ───────────────────────────
    if (enquiry.deleted_at) return skip("enquiry deleted")

    // The newsletter form writes to this same table with source='newsletter'
    // (see main.js). Those people asked for a mailing list, not a consultation,
    // and must never be told "a consultant will call you today".
    if ((enquiry.source ?? "website") !== "website") return skip(`source is '${enquiry.source}'`)

    const to = emailFrom(enquiry.email)
    if (!to) return skip("no usable email address")

    if (enquiry.auto_replied_at && !force) return skip("already auto-replied")

    // Same person, another form, minutes later.
    if (!force) {
      const since = new Date(Date.now() - THROTTLE_HOURS * 3600_000).toISOString()
      const { data: recent } = await admin
        .from("web_enquiries")
        .select("id")
        .eq("email", enquiry.email)
        .neq("id", enquiry.id)
        .gte("auto_replied_at", since)
        .limit(1)
      if (recent?.length) return skip(`already auto-replied to this address within ${THROTTLE_HOURS}h`)
    }

    // ── Claim the send ──────────────────────────────────────────────────────
    // Conditional on auto_replied_at still being null, so a concurrent
    // invocation gets zero rows back and bails instead of sending a duplicate.
    const claimedAt = new Date().toISOString()
    let claim = admin.from("web_enquiries").update({ auto_replied_at: claimedAt }).eq("id", enquiry.id)
    if (!force) claim = claim.is("auto_replied_at", null)
    const { data: claimed, error: claimErr } = await claim.select("id")

    if (claimErr) return json({ error: `claim failed: ${claimErr.message}` }, 500)
    if (!claimed?.length) return skip("another invocation claimed this send")

    // From here on a failure must put the claim back, or the customer silently
    // never gets an email and nothing will ever retry.
    const release = async () => {
      await admin.from("web_enquiries").update({ auto_replied_at: null }).eq("id", enquiry.id)
    }

    try {
      const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
      if (!RESEND_KEY) { await release(); return json({ error: "Resend API key not configured" }, 400) }

      const EMAIL_FROM = Deno.env.get("AUTOREPLY_EMAIL_FROM")
        ?? Deno.env.get("EMAIL_FROM")
        ?? "Lusso <jobs@lusso.com.au>"
      const officePhone = Deno.env.get("OFFICE_PHONE") ?? OFFICE_PHONE

      // Wording set in Settings, if anyone has set it. Read with the service
      // key because internal_notify_config is unreadable by clients by design
      // — the same table holds the notify token and the VAPID private key.
      //
      // A failure here is not a reason to drop the email: the built-in copy is
      // a perfectly good message, and a customer hearing nothing because a
      // settings read timed out is a far worse outcome than one hearing the
      // default wording.
      let template = {}
      {
        const { data: cfg, error: cfgErr } = await admin
          .from("internal_notify_config")
          .select("autoreply_subject, autoreply_body, autoreply_sms")
          .eq("id", 1)
          .maybeSingle()
        if (cfgErr) console.log(`autoreply ${enquiry.id} | template read failed, using built-in: ${cfgErr.message}`)
        else if (cfg) template = { subject: cfg.autoreply_subject, body: cfg.autoreply_body, sms: cfg.autoreply_sms }
      }

      // Rendered from `new Date()`, not created_at: "today" has to be true of
      // the moment the email lands, which on a retry is not when they typed it.
      const r = renderAutoReply(enquiry, new Date(), officePhone, template)

      // Which fields were dropped, in the logs, every time. A normaliser that
      // quietly rejects every real suburb would otherwise look like success.
      console.log(`autoreply ${enquiry.id} → ${to} | used ${JSON.stringify(r.used)}`)

      // An enquiry-scoped reply token means the "please reply" ask is true: the reply
      // lands on this lead's conversation in the Inbox, not in a shared
      // mailbox. Without REPLY_DOMAIN there is no such address, so the line
      // promising it is withheld rather than being a lie.
      const REPLY_DOMAIN = Deno.env.get("REPLY_DOMAIN") ?? ""
      let replyTo = Deno.env.get("EMAIL_REPLY_TO") || undefined
      let threaded = false
      if (REPLY_DOMAIN) {
        const rt = await ensureReplyToken(admin, null, null, enquiry.id)
        if (rt) { replyTo = `q-${rt}@${REPLY_DOMAIN}`; threaded = true }
      }

      const content = {
        preheader: r.preheader,
        eyebrow: "Enquiry received",
        heading: "Thank you for your enquiry",
        greeting: r.greeting,
        body: threaded
          ? r.body
          // "Please reply with" is the body's one call to action. With no
          // threading address it would send their answers somewhere nobody is
          // watching, so the ask becomes a phone call instead.
          : r.body.replace("please reply with:", "it would help to have the following to hand:"),
        cta: null,
        outro: r.outro,
        signOff: "The Lusso Team",
        replyNote: threaded
          ? "Simply reply to this email — your reply comes straight back to us."
          : "",
        footerNote: "You're receiving this because you sent an enquiry through lusso.com.au.",
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          reply_to: replyTo,
          subject: r.subject,
          html: renderEmail(content),
          text: renderText(content),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        await release()
        return json({ error: `Email failed: ${data.message ?? res.statusText}` }, 502)
      }

      // The thread in the CRM shows what the customer actually received, so
      // whoever makes the call knows what has already been promised. created_by
      // stays null — nobody wrote this.
      const { error: commErr } = await admin.from("communications").insert({
        enquiry_id: enquiry.id,
        channel: "email",
        direction: "outbound",
        subject: r.subject,
        body: `${r.greeting}\n\n${content.body}\n\n${r.outro}`,
        to_address: to,
        from_address: EMAIL_FROM,
        status: "sent",
        external_id: data.id,
        created_by: null,
      })
      // Deliberately not released: the email is gone, and releasing the claim
      // would send a second one. A missing thread row is the lesser fault.
      if (commErr) console.error(`autoreply ${enquiry.id} sent but not logged: ${commErr.message}`)

      return json({ sent: true, to, emailId: data.id, used: r.used, threaded, logged: !commErr })
    } catch (e) {
      await release()
      throw e
    }
  } catch (e) {
    console.error("autoreply failed:", String(e))
    return json({ error: String(e) }, 500)
  }
})

function skip(reason: string) {
  console.log(`autoreply skipped: ${reason}`)
  return json({ sent: false, skipped: reason })
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })
}
