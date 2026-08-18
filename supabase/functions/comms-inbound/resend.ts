import type { InboundEmail } from "./email.ts"
import { timingSafeEqual } from "./twilio.ts"

// Inbound email from Resend, which receives mail for reply.lusso.com.au and
// POSTs a webhook here.
//
// Why Resend and not Cloudflare Email Routing: Email Routing onboards a whole
// zone and writes its own MX and SPF to the apex, which would displace the
// Microsoft 365 MX and leave two SPF records on lusso.com.au (a permerror).
// Resend puts the MX on whichever domain you enable receiving for, so all of
// this stays on the reply subdomain and the apex is never touched.
//
// https://resend.com/docs/dashboard/receiving/introduction

export interface ResendWebhook {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    from?: string
    to?: string[]
    subject?: string
  }
}

/**
 * Verify a Svix-signed webhook. Returns null when genuine, or the Response to
 * send back when not.
 *
 * Must be given the raw body exactly as received — parsing and re-serialising
 * the JSON changes the bytes and the signature will never match.
 */
export async function verifyResendSignature(
  req: Request,
  rawBody: string,
): Promise<Response | null> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? ""
  if (!secret) {
    // Fail closed, like the other paths into this function.
    console.error("RESEND_WEBHOOK_SECRET unset — refusing unverifiable inbound email")
    return json({ error: "RESEND_WEBHOOK_SECRET not configured" }, 503)
  }

  const id   = req.headers.get("svix-id") ?? ""
  const ts   = req.headers.get("svix-timestamp") ?? ""
  const sigs = req.headers.get("svix-signature") ?? ""
  if (!id || !ts || !sigs) return json({ error: "missing svix headers" }, 401)

  // Reject stale timestamps so a captured request can't be replayed later.
  const then = Number.parseInt(ts, 10)
  const now  = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(then) || Math.abs(now - then) > 300) {
    return json({ error: "timestamp outside tolerance" }, 401)
  }

  // whsec_<base64>. The bytes after the prefix are the HMAC key.
  const b64key = secret.startsWith("whsec_") ? secret.slice(6) : secret
  let key: Uint8Array
  try {
    key = Uint8Array.from(atob(b64key), c => c.charCodeAt(0))
  } catch {
    console.error("RESEND_WEBHOOK_SECRET is not valid base64 after the whsec_ prefix")
    return json({ error: "misconfigured secret" }, 503)
  }

  const expected = await hmacSha256Base64(key, `${id}.${ts}.${rawBody}`)

  // Header is space-delimited "v1,<sig>" entries; more than one may appear
  // during a secret rotation, and any of them matching is good enough.
  const provided = sigs.split(" ")
    .filter(p => p.startsWith("v1,"))
    .map(p => p.slice(3))

  if (!provided.some(p => timingSafeEqual(p, expected))) {
    return json({ error: "invalid signature" }, 401)
  }
  return null
}

/**
 * Turn a verified webhook into the shape parseInboundEmail already expects.
 *
 * Resend's webhook carries metadata only — no body — so the message content
 * needs a second call to their API.
 */
export async function resendWebhookToInbound(
  payload: ResendWebhook,
): Promise<InboundEmail> {
  const d = payload.data ?? {}
  const to = pickRecipient(d.to ?? [])

  const base: InboundEmail = {
    kind: "email",
    to,
    from: extractAddress(d.from ?? ""),
    fromName: extractName(d.from ?? ""),
    subject: d.subject ?? "",
  }

  const apiKey = Deno.env.get("RESEND_INBOUND_API_KEY") || Deno.env.get("RESEND_API_KEY") || ""
  const id = d.email_id ?? ""
  if (!apiKey || !id) {
    return { ...base, text: bodyUnavailable(id, "no API key or email id") }
  }

  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      // The send-only key returns 401/403 here. Record the message anyway
      // rather than drop a customer reply on the floor.
      const detail = await res.text().catch(() => "")
      console.error(`resend receiving fetch ${res.status}: ${detail.slice(0, 300)}`)
      return { ...base, text: bodyUnavailable(id, `HTTP ${res.status}`) }
    }
    const full = await res.json()
    return {
      ...base,
      subject: full.subject ?? base.subject,
      text: full.text ?? "",
      html: full.html ?? "",
      messageId: full.message_id ?? id,
    }
  } catch (e) {
    console.error("resend receiving fetch threw:", String(e))
    return { ...base, text: bodyUnavailable(id, String(e)) }
  }
}

// Losing the body is bad, but losing the fact that a customer replied at all
// is worse. Leave something a human can act on and trace.
function bodyUnavailable(id: string, why: string): string {
  return `(Lusso could not retrieve this message's body — Resend id ${id || "unknown"}: ${why}. The customer did reply; open it in Resend.)`
}

// Every address at the reply domain reaches us, so prefer the one that
// actually carries a token over whatever happens to be first.
function pickRecipient(list: string[]): string {
  const addrs = list.map(extractAddress).filter(Boolean)
  return addrs.find(a => /^q-[a-z0-9]{8,64}@/i.test(a)) ?? addrs[0] ?? ""
}

function extractAddress(v: string): string {
  const m = v.match(/<([^>]+)>/)
  return (m ? m[1] : v).trim().toLowerCase()
}

function extractName(v: string): string {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*</)
  return m ? m[1].trim() : ""
}

async function hmacSha256Base64(key: Uint8Array, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" }
  })
}
