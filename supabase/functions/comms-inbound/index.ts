import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { parseInboundEmail } from "./email.ts"
import { requireTwilioSignature, timingSafeEqual } from "./twilio.ts"
import { verifyResendSignature, resendWebhookToInbound } from "./resend.ts"
import {
  isTwilioStatusCallback, applyTwilioStatus,
  isResendDeliveryEvent, applyResendStatus,
} from "./delivery.ts"

// Inbound customer messages.
//
//   SMS   — Twilio POSTs form-urlencoded. Answered with empty TwiML.
//   Email — Resend receives mail for reply.lusso.com.au and POSTs a
//           Svix-signed webhook. Answered with JSON.
//   Test  — a hand-rolled JSON shape for either channel, behind a shared
//           secret, so the threading logic can be exercised without waiting
//           on a real message.
//
// Delivery receipts for messages *we* sent arrive here too, on the same two
// authenticated paths: Twilio's StatusCallback is form-urlencoded with a
// MessageStatus and no Body, and Resend's email.delivered / email.bounced
// events are the same Svix-signed webhook with a different type. Both are
// matched to the original row by provider id — see delivery.ts.
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

      // A delivery receipt for a message we sent, not a message from a
      // customer. Same signature check, different destination.
      if (isTwilioStatusCallback(params)) {
        return json(await applyTwilioStatus(admin, params))
      }

      from = params.get("From") ?? ""
      body = params.get("Body") ?? ""
      to   = params.get("To")   ?? ""
    } else {
      const data = JSON.parse(rawBody || "{}")

      // Delivery receipt from Resend for an email we sent.
      if (isResendDeliveryEvent(data?.type)) {
        const denied = await verifyResendSignature(req, rawBody)
        if (denied) return denied
        return json(await applyResendStatus(admin, data))
      }

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

    // Who sent this? Postgres does the matching (see phone_matching.sql), so
    // both sides reduce to the same key — the last nine digits. The old
    // approach compared the raw string against a hand-written list of formats,
    // which missed roughly one customer record in eight and never looked at
    // customers.mobile at all. It also falls back to whoever we last exchanged
    // SMS with on that number, for a customer texting from a second handset.
    const { data: matched, error: matchErr } = await admin
      .rpc("match_customer_by_phone", { p_phone: from })
    if (matchErr) console.error("match_customer_by_phone:", matchErr.message)
    const customerId = (matched as string | null) ?? null

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
