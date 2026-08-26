import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderEmail, renderText } from "./emailLayout.ts"
import { ensureReplyToken } from "./replyToken.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// Normalise a phone number to E.164 format.
// Handles Australian local format (04xx, 02xx etc.) and strips formatting.
function toE164(phone: string, defaultCountry = 'AU'): string {
  // Strip all non-digit and non-plus characters
  let digits = phone.replace(/[^\d+]/g, '')

  // Already in E.164
  if (digits.startsWith('+')) return digits

  // Australian local format: 0x -> +61x
  if (defaultCountry === 'AU' && digits.startsWith('0')) {
    return '+61' + digits.slice(1)
  }

  // Starts with country code without +
  if (digits.startsWith('61') && digits.length >= 11) {
    return '+' + digits
  }

  // Fallback: assume AU
  return '+61' + digits
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Unauthorized" }, 401)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "Unauthorized" }, 401)

    const { channel, jobId, customerId, enquiryId, to, subject, body } = await req.json()
    if (!channel || !body || !to) return json({ error: "channel, to, and body required" }, 400)

    let externalId: string | null = null
    let status = "sent"
    let normalizedTo = to
    // The subject the customer actually received, so the thread in the CRM
    // matches their inbox rather than showing a blank.
    let sentSubject: string | null = subject ?? null

    if (channel === "sms") {
      // Where Twilio should post delivery updates. Unset simply means no
      // receipts — the send still works exactly as before.
      const STATUS_CALLBACK = Deno.env.get("TWILIO_STATUS_CALLBACK_URL")
        ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/comms-inbound`

      const TWILIO_SID    = Deno.env.get("TWILIO_ACCOUNT_SID") ?? ""
      const TWILIO_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
      const TWILIO_FROM   = Deno.env.get("TWILIO_PHONE_NUMBER") ?? ""

      if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
        return json({ error: "Twilio not configured — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER to Supabase secrets" }, 400)
      }

      // Normalise to E.164 so Twilio accepts it
      normalizedTo = toE164(to)

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${toBase64(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: normalizedTo,
          From: TWILIO_FROM,
          Body: body,
          // Ask Twilio to report back what actually happened to the message.
          // Without this the row below stays "sent" forever, and a text to a
          // dead number is indistinguishable from one the customer read.
          // Handled by comms-inbound (see delivery.ts).
          ...(STATUS_CALLBACK ? { StatusCallback: STATUS_CALLBACK } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) return json({ error: `SMS failed: ${data.message ?? res.statusText}` }, 502)
      externalId = data.sid
      // Twilio's own word for it, mapped the same way the callback maps it —
      // "queued" until a carrier has actually taken it.
      status = data.status === "delivered" ? "delivered"
             : data.status === "sent" ? "sent"
             : "queued"
    } else if (channel === "email") {
      const RESEND_KEY  = Deno.env.get("RESEND_API_KEY") ?? ""
      const EMAIL_FROM  = Deno.env.get("EMAIL_FROM") ?? "Lusso <onboarding@resend.dev>"

      if (!RESEND_KEY) return json({ error: "Resend API key not configured" }, 400)

      // Sign off with the staff member who actually wrote the message — a
      // one-to-one email from a person reads very differently to one from a
      // faceless team alias, and the reply lands with the right person.
      const { data: profile } = await admin
        .from("profiles").select("display_name").eq("id", user.id).maybeSingle()
      const senderName = profile?.display_name
        ? `${profile.display_name} · Lusso`
        : "The Lusso Team"

      // Look up the recipient's first name so the greeting isn't generic.
      let firstName = ""
      if (customerId) {
        const { data: cust } = await admin
          .from("customers").select("name").eq("id", customerId).maybeSingle()
        firstName = cust?.name?.split(" ")[0] ?? ""
      }

      // Never send a blank or "(No subject)" subject line — it's the first
      // thing the customer sees in their inbox list and the first thing a spam
      // filter reads. Clients should send a real one; this is the floor.
      const subjectLine = String(subject ?? "").trim() || "Message from Lusso"

      // The message staff typed is the email — no invented heading or filler
      // copy on top of it, just the brand frame around their words.
      const content = {
        preheader: String(body).replace(/\s+/g, " ").slice(0, 140),
        eyebrow:   "Message from Lusso",
        heading:   subject || "",
        greeting:  firstName ? `Hi ${firstName},` : "",
        body,
        signOff:   senderName,
      }

      // Stamp a per-conversation Reply-To so a plain "Reply" threads back onto
      // this job. Gated on REPLY_DOMAIN: until reply.lusso.com.au actually
      // resolves and Email Routing is live, an address there would bounce, so
      // leaving the secret unset keeps the previous behaviour exactly.
      const REPLY_DOMAIN = Deno.env.get("REPLY_DOMAIN") ?? ""
      let replyTo = Deno.env.get("EMAIL_REPLY_TO") || undefined
      if (REPLY_DOMAIN) {
        const token = await ensureReplyToken(admin, jobId ?? null, customerId ?? null, enquiryId ?? null)
        if (token) replyTo = `q-${token}@${REPLY_DOMAIN}`
      }

      sentSubject = subjectLine

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          reply_to: replyTo,
          subject: subjectLine,
          html: renderEmail(content),
          text: renderText(content),
        }),
      })
      const data = await res.json()
      if (!res.ok) return json({ error: `Email failed: ${data.message ?? res.statusText}` }, 502)
      externalId = data.id
      status = "sent"
    } else {
      return json({ error: "channel must be sms or email" }, 400)
    }

    // Save to DB. `body` stays the plain text the staff member typed — the
    // comms thread shows the conversation, not the rendered HTML wrapper.
    const { data: comm, error: dbErr } = await admin.from("communications").insert({
      job_id: jobId ?? null,
      customer_id: customerId ?? null,
      enquiry_id: enquiryId ?? null,
      channel,
      direction: "outbound",
      subject: sentSubject,
      body,
      to_address: normalizedTo,
      from_address: channel === "sms" ? Deno.env.get("TWILIO_PHONE_NUMBER") : Deno.env.get("EMAIL_FROM"),
      status,
      external_id: externalId,
      created_by: user.id,
    }).select().single()

    if (dbErr) return json({ error: `DB error: ${dbErr.message}` }, 500)
    return json({ success: true, communication: comm })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })
}
