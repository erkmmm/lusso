import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { parseInboundEmail } from "./email.ts"
import { requireTwilioSignature, timingSafeEqual } from "./twilio.ts"
import { verifyResendSignature, resendWebhookToInbound } from "./resend.ts"

// Inbound customer messages.
//
//   SMS   — Twilio POSTs form-urlencoded. Answered with empty TwiML.
//   Email — Resend receives mail for reply.lusso.com.au and POSTs a
//           Svix-signed webhook. Answered with JSON.
//   Test  — a hand-rolled JSON shape for either channel, behind a shared
//           secret, so the threading logic can be exercised without waiting
//           on a real message.
//
// This endpoint is public (verify_jwt false) because no external sender can
// carry a Supabase JWT, so every path authenticates itself: SMS by Twilio
// request signature, Resend by Svix signature, the test paths by shared
// secret. An unauthenticated route here would be a bypass around the others,
// not merely a gap of its own.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return xml()

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Read the body exactly once, as text. Svix signs the raw bytes, so
    // parsing to JSON and re-serialising would invalidate the signature.
    const rawBody = await req.text()
    const contentType = req.headers.get("content-type") ?? ""

    let from = "", body = "", to = ""

    if (contentType.includes("application/x-www-form-urlencoded")) {
      // Twilio's own format.
      const params = new URLSearchParams(rawBody)
      const denied = await requireTwilioSignature(req, params)
      if (denied) return denied

      from = params.get("From") ?? ""
      body = params.get("Body") ?? ""
      to   = params.get("To")   ?? ""
    } else {
      const data = JSON.parse(rawBody || "{}")

      // Real inbound email, from Resend.
      if (data?.type === "email.received") {
        const denied = await verifyResendSignature(req, rawBody)
        if (denied) return denied
        const msg = await resendWebhookToInbound(data)
        return await parseInboundEmail(admin, msg)
      }

      // Hand-rolled test email.
      if (data?.kind === "email") {
        const denied = requireInboundSecret(req)
        if (denied) return denied
        return await parseInboundEmail(admin, data)
      }

      // Hand-rolled test SMS. Twilio never sends JSON, so this path carries
      // no signature and takes the shared secret instead. Leaving it open
      // would make the signature check above pointless: an attacker would
      // simply POST JSON and skip verification entirely.
      const denied = requireInboundSecret(req)
      if (denied) return denied

      from = data.From ?? ""
      body = data.Body ?? ""
      to   = data.To   ?? ""
    }

    if (!from || !body) return xml()

    // Try every plausible format for the sender's number
    const variants = phoneVariants(from)
    const orFilter = variants.map(v => `phone.eq.${v}`).join(",")

    const { data: customers } = await admin
      .from("customers")
      .select("id, name")
      .or(orFilter)
      .is("deleted_at", null)
      .limit(1)

    const customerId = customers?.[0]?.id ?? null

    // Find the most recent active job for this customer
    let jobId: string | null = null
    if (customerId) {
      const { data: jobs } = await admin
        .from("jobs")
        .select("id")
        .eq("customer_id", customerId)
        .not("status", "eq", "Completed")
        .not("status", "eq", "Cancelled")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
      jobId = jobs?.[0]?.id ?? null
    }

    await admin.from("communications").insert({
      job_id: jobId,
      customer_id: customerId,
      channel: "sms",
      direction: "inbound",
      body,
      to_address: to,
      from_address: from,
      status: "received",
    })

    return xml()
  } catch {
    return xml()
  }
})

// Fails closed: with COMMS_INBOUND_SECRET unset the test paths are refused
// outright rather than left open.
function requireInboundSecret(req: Request): Response | null {
  const expected = Deno.env.get("COMMS_INBOUND_SECRET") ?? ""
  if (!expected) {
    return json({ error: "COMMS_INBOUND_SECRET not configured" }, 503)
  }
  const got = req.headers.get("x-inbound-secret") ?? ""
  if (!timingSafeEqual(got, expected)) {
    return json({ error: "unauthorized" }, 401)
  }
  return null
}

// Generate all plausible formats for a phone number so we can match
// whatever format the customer record was saved in.
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, "") // strip everything non-digit
  const variants = new Set<string>()
  variants.add(raw)               // original e.g. +61428501838
  variants.add(digits)            // 61428501838

  if (digits.startsWith("61") && digits.length >= 11) {
    const local = "0" + digits.slice(2)  // 0428501838
    variants.add(local)
    variants.add(local.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3"))  // 0428 501 838
    variants.add("+" + digits)            // +61428501838
    variants.add("+61 " + local.slice(1)) // +61 428501838
  }

  if (digits.startsWith("0") && digits.length === 10) {
    const intl = "61" + digits.slice(1)  // 61428501838
    variants.add("+" + intl)             // +61428501838
    variants.add(intl)
    variants.add(digits.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3")) // 0428 501 838
  }

  return Array.from(variants)
}

function xml() {
  return new Response("<?xml version='1.0'?><Response/>", {
    headers: { "Content-Type": "text/xml" }
  })
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" }
  })
}
