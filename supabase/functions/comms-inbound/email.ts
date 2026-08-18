import type { SupabaseClient } from "jsr:@supabase/supabase-js@2"

// Inbound email from the Cloudflare Email Routing worker on reply.lusso.com.au.
//
// The whole design rests on the recipient address: outbound mail stamps
// Reply-To: q-<token>@reply.lusso.com.au, so the address a reply arrives at
// identifies the conversation exactly, with no guessing from sender or subject.

export interface InboundEmail {
  kind: "email"
  to?: string          // envelope recipient — carries the token
  from?: string
  fromName?: string
  subject?: string
  text?: string
  html?: string
  messageId?: string
}

export async function parseInboundEmail(
  admin: SupabaseClient,
  msg: InboundEmail,
): Promise<Response> {
  const from = (msg.from ?? "").trim().toLowerCase()
  const to   = (msg.to ?? "").trim().toLowerCase()
  if (!from) return json({ error: "from required" }, 400)

  let jobId: string | null = null
  let customerId: string | null = null
  let matchedBy = "none"

  // 1. The token in the recipient address. Authoritative when present.
  const token = extractToken(to)
  if (token) {
    const { data } = await admin
      .from("reply_tokens")
      .select("job_id, customer_id")
      .eq("token", token)
      .maybeSingle()

    if (data) {
      jobId = data.job_id
      customerId = data.customer_id
      matchedBy = "token"
      await admin
        .from("reply_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("token", token)
    }
  }

  // 2. Fall back to the sender's address — covers mail sent to a token that
  // has been purged, and customers who compose fresh rather than replying.
  if (!customerId) {
    // ilike gives case-insensitive matching, but _ and % are wildcards to it
    // and both are legal in an address — jane_smith@ would otherwise also
    // match jane-smith@. Escape them so this stays an exact comparison.
    const pattern = from.replace(/[\\%_]/g, m => `\\${m}`)
    const { data: customers } = await admin
      .from("customers")
      .select("id")
      .ilike("email", pattern)
      .is("deleted_at", null)
      .limit(1)

    customerId = customers?.[0]?.id ?? null
    if (customerId) matchedBy = "sender_email"
  }

  // 3. With a customer but no job, attach to their most recent active job —
  // the same rule the SMS path already uses, so both channels behave alike.
  if (customerId && !jobId) {
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

  const raw = msg.text?.trim() || htmlToText(msg.html ?? "")
  // An unmatched or empty message is still recorded. A reply landing in the
  // wrong place is recoverable; a reply that vanishes is not.
  const body = stripQuotedReply(raw) || raw || "(empty message)"

  const { error } = await admin.from("communications").insert({
    job_id: jobId,
    customer_id: customerId,
    channel: "email",
    direction: "inbound",
    subject: msg.subject ?? null,
    body,
    to_address: to || null,
    from_address: msg.fromName ? `${msg.fromName} <${from}>` : from,
    status: "received",
    external_id: msg.messageId ?? null,
  })

  if (error) return json({ error: `DB error: ${error.message}` }, 500)
  return json({ ok: true, matchedBy, jobId, customerId })
}

// q-<token>@reply.lusso.com.au -> token. Lowercased, because mail servers are
// free to case-fold a local part in transit and some do.
function extractToken(address: string): string | null {
  const m = address.match(/^q-([a-z0-9]{8,64})@/i)
  return m ? m[1].toLowerCase() : null
}

/**
 * Trim the quoted history off a reply.
 *
 * Without this, every reply stores the entire prior thread and the comms
 * timeline becomes unreadable by the third message. The heuristics below are
 * deliberately conservative: on no match the full text is kept, because
 * over-trimming would silently destroy what the customer actually wrote.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return ""
  const lines = text.replace(/\r\n/g, "\n").split("\n")

  const singleLineMarkers = [
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*_{10,}\s*$/,
    /^\s*-{10,}\s*$/,
    /^\s*Sent from my \S+/i,
    /^\s*Get Outlook for \S+/i,
  ]

  // A message that opens with a quote marker is quoted top to bottom — usually
  // a forward. There is no new text to separate out, so the quote rule below
  // is disabled entirely; applying it would cut at line 1 and throw the rest
  // of the message away.
  const startsQuoted = /^\s*>/.test(lines[0] ?? "")

  let cut = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (singleLineMarkers.some(re => re.test(line))) { cut = i; break }

    // "On Mon, 4 Aug 2026 at 09:12, Jett Hopkins <jobs@lusso.com.au> wrote:"
    // — routinely wrapped across two or three lines by the sending client.
    if (/^\s*On\b/.test(line)) {
      const joined = lines.slice(i, i + 3).join(" ")
      if (/\bwrote:\s*$/.test(joined) || /\bwrote:\s/.test(joined)) { cut = i; break }
    }

    // An Outlook header block: From: followed closely by Sent:/To:/Subject:.
    // Requiring the second header avoids cutting on a line that merely starts
    // with the word "From:" in ordinary prose.
    if (/^\s*From:\s*\S/i.test(line)) {
      const near = lines.slice(i + 1, i + 5)
      if (near.some(l => /^\s*(Sent|To|Subject|Date):\s*\S/i.test(l))) { cut = i; break }
    }

    // A quoted block below the customer's own text.
    if (!startsQuoted && /^\s*>/.test(line) && i > 0) { cut = i; break }
  }

  const kept = (cut === -1 ? lines : lines.slice(0, cut))
    .join("\n")
    .replace(/\s+$/, "")
    .trim()

  return kept
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" }
  })
}
