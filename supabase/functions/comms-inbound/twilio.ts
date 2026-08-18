// Twilio request signature validation.
//
// Twilio signs each webhook with HMAC-SHA1 over the exact URL it POSTed to,
// followed by every POST parameter appended in sorted key order, keyed by the
// account's auth token. Without this check the endpoint is public and anyone
// who learns the URL can write messages into a customer's job thread.
//
// https://www.twilio.com/docs/usage/security#validating-requests

/**
 * Returns null when the request is genuinely from Twilio, or a Response to
 * return to the caller when it is not.
 */
export async function requireTwilioSignature(
  req: Request,
  params: URLSearchParams,
): Promise<Response | null> {
  const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
  if (!token) {
    // Fail closed. The send path already requires this token, so an unset
    // value means misconfiguration, not a deliberate opt-out.
    console.error("TWILIO_AUTH_TOKEN unset — refusing unverifiable inbound SMS")
    return text("twilio auth token not configured", 503)
  }

  const provided = req.headers.get("x-twilio-signature") ?? ""
  if (!provided) return text("missing signature", 403)

  const payload = signablePayload(params)
  const candidates = candidateUrls(req)

  for (const url of candidates) {
    const expected = await sign(url + payload, token)
    if (timingSafeEqual(provided, expected)) return null
  }

  // Log the candidates: the overwhelmingly likely cause of a mismatch is that
  // the public URL Twilio signed differs from what the runtime reconstructs,
  // and this line says exactly what to set TWILIO_WEBHOOK_URL to.
  console.error(
    `Twilio signature mismatch. Tried: ${candidates.join(" | ")}. ` +
    `If the URL configured in the Twilio console is not among these, set ` +
    `TWILIO_WEBHOOK_URL to that exact value.`
  )
  return text("invalid signature", 403)
}

// Sorted key order, each key immediately followed by its value. Repeated keys
// contribute each of their values, in the order they arrived.
function signablePayload(params: URLSearchParams): string {
  const keys = Array.from(new Set(params.keys())).sort()
  let out = ""
  for (const k of keys) for (const v of params.getAll(k)) out += k + v
  return out
}

/**
 * The URLs this request might have been signed against.
 *
 * Twilio signs the public URL. Behind Supabase's proxy the runtime may see a
 * different scheme or host, so reconstruct from the forwarding headers as well
 * as trusting req.url, and allow an explicit override. Offering several
 * candidates costs nothing security-wise — every one still has to produce a
 * matching HMAC under the auth token.
 */
function candidateUrls(req: Request): string[] {
  const urls = new Set<string>()

  const override = Deno.env.get("TWILIO_WEBHOOK_URL") ?? ""
  if (override) urls.add(override)

  urls.add(req.url)
  urls.add(req.url.replace(/^http:\/\//, "https://"))

  try {
    const u = new URL(req.url)
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
    const proto = req.headers.get("x-forwarded-proto") || "https"
    if (host) urls.add(`${proto}://${host}${u.pathname}${u.search}`)
  } catch { /* req.url always parses; nothing to recover if it somehow doesn't */ }

  return Array.from(urls)
}

async function sign(data: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain" } })
}
