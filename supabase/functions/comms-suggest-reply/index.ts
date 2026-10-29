import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { normalise, runKnowledgeTool, KNOWLEDGE_TOOLS, type KnowledgeDoc } from "../_shared/knowledge.ts"

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""

// How far back the thread is read. A customer conversation is short compared
// to a job chat, and the useful context is almost always the last few turns.
const THREAD_LIMIT = 40

// An SMS over 160 GSM-7 characters bills as multiple segments, and a single
// curly quote or emoji drops the whole message to UCS-2 at 70 per segment.
// The draft is held well inside one segment rather than trusting the model to
// count.
const SMS_TARGET = 300

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    if (!ANTHROPIC_KEY) return json({ error: "NO_API_KEY" }, 400)

    const { customerId, jobId, enquiryId, channel, guidance } = await req.json()
    if (!customerId && !jobId && !enquiryId) return json({ error: "customerId, jobId or enquiryId required" }, 400)
    // The web form offers "text"; everything downstream calls it sms.
    const ch = (channel === "sms" || channel === "text") ? "sms" : "email"

    if (enquiryId) {
      return await suggestForEnquiry({ admin, user, enquiryId, ch, guidance })
    }

    // The thread is read from the database rather than taken from the client:
    // a suggested reply must be grounded in what was actually sent, not in
    // whatever a page happened to have in state.
    const threadQuery = admin
      .from("communications")
      .select("channel,direction,subject,body,created_at")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT)
    if (customerId) threadQuery.eq("customer_id", customerId)
    else            threadQuery.eq("job_id", jobId)

    const [
      { data: customer },
      { data: thread },
      { data: jobs },
      { data: globalKnowledge },
      { data: speaker },
    ] = await Promise.all([
      customerId
        ? admin.from("customers").select("name,email,phone,address,notes,preferred_contact").eq("id", customerId).single()
        : Promise.resolve({ data: null }),
      threadQuery,
      admin.from("jobs").select("id,job_number,job_type,status,measure_date,install_date,quote_due_date")
        .eq(customerId ? "customer_id" : "id", customerId ?? jobId)
        .order("created_at", { ascending: false }).limit(10),
      admin.from("ai_global_knowledge").select("filename,content,description"),
      admin.from("profiles").select("display_name").eq("id", user.id).single(),
    ])

    const messages = [...(thread ?? [])].reverse()
    const lastInbound = [...messages].reverse().find((m: any) => m.direction === "inbound")
    if (!lastInbound) return json({ error: "NO_INBOUND", message: "Nothing from the customer to reply to yet." }, 400)

    const jobIds = (jobs ?? []).map((j: any) => j.id)
    const { data: quotes } = jobIds.length
      ? await admin.from("quotes").select("quote_number,title,status,grand_total,job_id,sent_at,accepted_at")
          .in("job_id", jobIds).is("deleted_at", null).order("created_at", { ascending: false }).limit(20)
      : { data: [] }

    const senderName = (speaker?.display_name ?? "").trim().split(/\s+/)[0] || "the Lusso team"

    // ── Block 1: instructions. Byte-identical every request, so it caches. ──
    const base: string[] = [
      "You draft replies to customer messages for Lusso, an Australian window coverings and furnishings business.",
      "You are writing a DRAFT for a Lusso staff member to read, edit and send. You never send anything yourself.",
      "",
      "Write the reply and nothing else — no preamble, no sign-off block, no 'Here is a draft'. Just the message body.",
      "",
      "Voice:",
      "- Write as the Lusso staff member, to the customer. Warm, direct, like a person who knows the job.",
      "- Australian English. Plain sentences. No corporate filler, no 'we value your enquiry'.",
      "- Match the customer's level of formality. If they wrote two lines, do not write six.",
      "- Use the customer's first name once, naturally, if you know it.",
      "",
      "Accuracy — this matters more than sounding helpful:",
      "- Never state a price, lead time, install date, fabric name, colour code or product specification unless you can see it in the context below or find it with the tools. A wrong number in a customer's inbox is a commitment.",
      "- If the honest answer needs something you do not have, write the reply so it still moves things forward — acknowledge, say what happens next, and leave the specific to be filled in. Then note what is missing on a final line beginning 'NEEDS:'.",
      "- Never invent a date. If the customer asks when something will happen and no date is in the context, say you will confirm it rather than guessing.",
      "- Suppliers are separate businesses: Meyer Blinds (Simply Cell), Verosol, Silent Gliss, Oslo, Warwick, Kingtrack, Acmeda. Never carry a product or price between them.",
      "- If the customer asks a product question you can answer from the supplier documents, use search_knowledge first and answer from what you read.",
      "",
      "Never promise a discount, waive a charge, accept a cancellation, or commit to a date that is not already in the context. If the customer asks for any of those, draft a reply that acknowledges the request and says a person will come back to them.",
    ]

    if (globalKnowledge?.length) {
      base.push("")
      base.push(`## Supplier documents available (${globalKnowledge.length})`)
      base.push("Not loaded here — reach them with search_knowledge and read_knowledge using these exact filenames:")
      for (const d of globalKnowledge) {
        base.push(`- ${d.filename}${d.description ? ` — ${d.description}` : ""} (${normalise(d.content ?? "").length} characters)`)
      }
    }

    // ── Block 2: this customer, this thread ────────────────────────────────
    const lines: string[] = []
    lines.push(`You are drafting on behalf of ${senderName}.`)
    lines.push(`Channel: ${ch === "sms" ? `SMS — keep it under ${SMS_TARGET} characters, plain ASCII only (no emoji, no curly quotes or dashes), as a single message` : "Email — a short paragraph or two"}.`)
    lines.push("")
    lines.push(`## Customer: ${customer?.name ?? "Unknown"}`)
    if (customer?.email)             lines.push(`Email: ${customer.email}`)
    if (customer?.phone)             lines.push(`Phone: ${customer.phone}`)
    if (customer?.address)           lines.push(`Address: ${customer.address}`)
    if (customer?.preferred_contact) lines.push(`Prefers: ${customer.preferred_contact}`)
    if (customer?.notes)             lines.push(`Internal notes (never quote these back): ${customer.notes}`)

    if (jobs?.length) {
      lines.push("")
      lines.push(`## Their jobs (${jobs.length})`)
      for (const j of jobs) {
        const bits = [
          `${j.job_number}`,
          j.job_type ?? null,
          `Status: ${j.status}`,
          j.measure_date   ? `Measured ${j.measure_date}` : null,
          j.quote_due_date ? `Quote due ${j.quote_due_date}` : null,
          j.install_date   ? `Install ${j.install_date}` : null,
        ].filter(Boolean)
        lines.push(`- ${bits.join(" | ")}`)
      }
    }

    if (quotes?.length) {
      const byJob = new Map((jobs ?? []).map((j: any) => [j.id, j.job_number]))
      lines.push("")
      lines.push(`## Their quotes (${quotes.length})`)
      for (const q of quotes) {
        const total = q.grand_total
          ? `$${Number(q.grand_total).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`
          : "—"
        const when = q.accepted_at ? `accepted ${q.accepted_at.slice(0, 10)}`
                   : q.sent_at    ? `sent ${q.sent_at.slice(0, 10)}`
                   : "not sent"
        lines.push(`- ${q.quote_number} (${byJob.get(q.job_id) ?? "—"}): ${q.title ?? "Untitled"} | ${q.status} | ${total} | ${when}`)
      }
    }

    lines.push("")
    lines.push(`## The conversation (${messages.length} messages, oldest first)`)
    for (const m of messages) {
      const date = m.created_at ? m.created_at.slice(0, 16).replace("T", " ") : ""
      const who  = m.direction === "outbound" ? "LUSSO" : "CUSTOMER"
      const kind = m.channel === "sms" ? "SMS" : "Email"
      lines.push(`[${date}] ${who} (${kind})${m.subject ? ` — ${m.subject}` : ""}:`)
      lines.push(m.body.trim().slice(0, 1500))
      lines.push("")
    }
    lines.push("Draft a reply to the LAST message from the customer.")
    if (guidance && String(guidance).trim()) {
      lines.push("")
      lines.push(`The staff member wants the reply to cover this: ${String(guidance).trim().slice(0, 500)}`)
    }

    const out = await runDraft({ base, lines, globalKnowledge, ch })
    console.log(`comms-suggest-reply customer=${customerId ?? "-"} job=${jobId ?? "-"} ch=${ch} tools=${out.toolCalls}`)

    return json({ draft: out.draft, needs: out.needs, channel: ch, basedOn: lastInbound.created_at })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

/**
 * A website enquiry is a different animal from a customer thread: usually a
 * first contact, no history, no measurements, and no price that could honestly
 * be quoted. What it needs is a fast, specific reply that gets a measure
 * booked — so it gets its own context and its own brief.
 */
async function suggestForEnquiry(
  { admin, user, enquiryId, ch, guidance }:
  { admin: any; user: any; enquiryId: string; ch: string; guidance?: string }
) {
  const { data: enquiry } = await admin
    .from("web_enquiries")
    .select("id,created_at,name,email,phone,suburb,interest,message,source,page_url,preferred_contact,status")
    .eq("id", enquiryId).is("deleted_at", null).single()
  if (!enquiry) return json({ error: "Enquiry not found" }, 404)

  // Someone who fills the form twice is one lead, not two. Match the way the
  // inbox groups them — on email, then on phone digits.
  // Match the way the inbox groups repeat submissions — on email, then phone.
  // A value with a comma or a bracket would break PostgREST's or() grammar, and
  // an enquiry with neither would build an empty filter, so both are skipped
  // rather than risking a query that throws.
  const safe = (v: string | null) => v && !/[,()]/.test(v) ? v.trim() : null
  const byEmail = safe(enquiry.email)
  const byPhone = safe(enquiry.phone)
  const filters = [
    byEmail ? `email.eq.${byEmail}` : null,
    byPhone ? `phone.eq.${byPhone}` : null,
  ].filter(Boolean)

  const siblings = filters.length
    ? (await admin
        .from("web_enquiries")
        .select("id,created_at,name,email,phone,suburb,interest,message,source,page_url")
        .is("deleted_at", null)
        .or(filters.join(","))
        .order("created_at", { ascending: true })
        .limit(10)).data
    : null

  const all = (siblings?.length ? siblings : [enquiry])
  const ids = all.map((x: any) => x.id)

  const [{ data: replies }, { data: globalKnowledge }, { data: speaker }] = await Promise.all([
    admin.from("communications").select("channel,direction,subject,body,created_at")
      .in("enquiry_id", ids).order("created_at", { ascending: true }).limit(THREAD_LIMIT),
    admin.from("ai_global_knowledge").select("filename,content,description"),
    admin.from("profiles").select("display_name").eq("id", user.id).single(),
  ])

  const senderName = (speaker?.display_name ?? "").trim().split(/\s+/)[0] || "the Lusso team"
  const firstName  = (enquiry.name ?? "").trim().split(/\s+/)[0]

  const base: string[] = [
    "You draft first replies to website enquiries for Lusso, an Australian window coverings and furnishings business on the Gold Coast.",
    "You are writing a DRAFT for a Lusso staff member to read, edit and send. You never send anything yourself.",
    "",
    "Write the reply and nothing else — no preamble, no sign-off block. Just the message body.",
    "",
    "What this reply is for:",
    "- Someone has filled in the form on the website. The job of the reply is to answer what they actually asked, and move towards booking a free measure and quote at their place.",
    "- Be quick and specific. Reference what they said — the product they named, the room, the suburb. A reply that could have been sent to anyone is worse than no reply.",
    "- One clear next step. Offer to book a measure, or ask the one question you genuinely need before you can.",
    "",
    "Voice:",
    "- Warm, direct, human. Australian English. Short sentences.",
    "- Use their first name once, early.",
    "- No corporate filler. Never 'thank you for your enquiry, we value your business'.",
    "",
    "Hard limits — a first reply is a commitment in a stranger's inbox:",
    "- NEVER quote a price, a price range, a 'from' price, or a lead time. Nothing has been measured. If they asked what it costs, say the measure is free and the quote comes from it.",
    "- Never invent a date or a time slot. Offer to book, or ask when suits — do not say 'we can come Tuesday' unless the staff member told you to.",
    "- Never promise a discount or a deal.",
    "- Product facts are fine if you can see them in the supplier documents — use search_knowledge first. Never state a specification from memory.",
    "- If something is missing that you would need, add a final line beginning 'NEEDS:' and it will be shown to the staff member instead of sent.",
  ]

  if (globalKnowledge?.length) {
    base.push("")
    base.push(`## Supplier documents available (${globalKnowledge.length})`)
    base.push("Not loaded here — reach them with search_knowledge and read_knowledge using these exact filenames:")
    for (const d of globalKnowledge) {
      base.push(`- ${d.filename}${d.description ? ` — ${d.description}` : ""} (${normalise(d.content ?? "").length} characters)`)
    }
  }

  const lines: string[] = []
  lines.push(`You are drafting on behalf of ${senderName}.`)
  lines.push(`Channel: ${ch === "sms" ? `SMS — under ${SMS_TARGET} characters, plain ASCII only (no emoji, no curly quotes or dashes), one message` : "Email — two short paragraphs at most"}.`)
  lines.push("")
  lines.push(`## The lead`)
  if (enquiry.name)              lines.push(`Name: ${enquiry.name}`)
  if (enquiry.suburb)            lines.push(`Suburb: ${enquiry.suburb}`)
  if (enquiry.interest)          lines.push(`Interested in: ${enquiry.interest}`)
  if (enquiry.preferred_contact) lines.push(`Asked to be contacted by: ${enquiry.preferred_contact}`)
  if (enquiry.source)            lines.push(`Came from: ${enquiry.source}`)
  if (enquiry.page_url)          lines.push(`Page they enquired from: ${enquiry.page_url}`)
  lines.push(`Submitted: ${String(enquiry.created_at).slice(0, 16).replace("T", " ")}`)

  lines.push("")
  lines.push("## What they wrote")
  lines.push(enquiry.message?.trim() || "(they left the message box empty — the form was submitted with contact details only)")

  if (all.length > 1) {
    lines.push("")
    lines.push(`## They have filled the form ${all.length} times`)
    for (const x of all) {
      lines.push(`- ${String(x.created_at).slice(0, 10)}${x.interest ? ` | ${x.interest}` : ""}: ${(x.message ?? "").trim().slice(0, 300) || "(no message)"}`)
    }
    lines.push("A repeat enquiry usually means the first one was missed. Do not make them repeat themselves.")
  }

  if (replies?.length) {
    lines.push("")
    lines.push(`## Already sent to them (${replies.length})`)
    for (const r of replies) {
      const who = r.direction === "outbound" ? "LUSSO" : "THEM"
      lines.push(`[${String(r.created_at).slice(0, 16).replace("T", " ")}] ${who} (${r.channel}):`)
      lines.push((r.body ?? "").trim().slice(0, 1000))
      lines.push("")
    }
    lines.push("This is a follow-up, not a first reply. Do not reintroduce yourself or repeat what has already been said.")
  }

  lines.push("")
  lines.push(firstName ? `Draft the reply to ${firstName}.` : "Draft the reply.")
  if (guidance && String(guidance).trim()) {
    lines.push("")
    lines.push(`The staff member wants the reply to cover this: ${String(guidance).trim().slice(0, 500)}`)
  }

  const out = await runDraft({ base, lines, globalKnowledge, ch })
  console.log(`comms-suggest-reply enquiry=${enquiryId} ch=${ch} tools=${out.toolCalls}`)
  return json({ draft: out.draft, needs: out.needs, channel: ch, basedOn: enquiry.created_at })
}

/**
 * One model call per assistant turn, with the knowledge tools attached and a
 * bounded loop. Shared by both paths so a change to the retry, the cache
 * breakpoint or the SMS sanitising applies to customer threads and web leads
 * alike.
 */
async function runDraft(
  { base, lines, globalKnowledge, ch }:
  { base: string[]; lines: string[]; globalKnowledge: any[] | null; ch: string }
) {
  const convo: any[] = [{ role: "user", content: "Draft the reply." }]
  let draft = ""
  let toolCalls = 0
  let exhausted = false

  const ask = (withTools: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "extended-cache-ttl-2025-04-11",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1200,
      ...(withTools ? { tools: KNOWLEDGE_TOOLS } : {}),
      system: [
        { type: "text", text: base.join("\n"), cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: lines.join("\n") },
      ],
      messages: convo,
    }),
  })

  // Most replies need no lookup; the few that do are product questions, and
  // those resolve in a search plus a read.
  const MAX_ROUNDS = 6
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round === MAX_ROUNDS - 1) { exhausted = true; break }
    const res = await ask(true)
    if (!res.ok) {
      console.error(`comms-suggest-reply anthropic ${res.status}: ${(await res.text()).slice(0, 600)}`)
      throw new Error(`AI error: ${res.status}`)
    }
    const data = await res.json()
    const blocks: any[] = data.content ?? []
    draft = blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || draft

    const calls = blocks.filter(b => b.type === "tool_use")
    if (data.stop_reason !== "tool_use" || !calls.length) break

    // Built lazily: a reply needing no lookup never pays to normalise a
    // megabyte of price lists.
    const library: KnowledgeDoc[] = (globalKnowledge ?? [])
      .filter((d: any) => (d.content ?? "").trim())
      .map((d: any) => ({ filename: d.filename, description: d.description ?? "", text: normalise(d.content) }))

    toolCalls += calls.length
    convo.push({ role: "assistant", content: blocks })
    convo.push({
      role: "user",
      content: calls.map((c: any) => ({
        type: "tool_result",
        tool_use_id: c.id,
        content: runKnowledgeTool(c.name, c.input ?? {}, library),
      })),
    })
  }

  if (exhausted) {
    const res = await ask(false)
    if (res.ok) {
      const data = await res.json()
      const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
      if (text) draft = text
    }
  }

  // Split the NEEDS: line off so the composer gets clean text and the gap is
  // shown as a warning rather than pasted into someone's inbox.
  let needs = ""
  const needsAt = draft.search(/^NEEDS:/m)
  if (needsAt >= 0) {
    needs = draft.slice(needsAt).replace(/^NEEDS:\s*/, "").trim()
    draft = draft.slice(0, needsAt).trim()
  }

  // Belt and braces on the GSM-7 trap: strip the characters that silently
  // halve an SMS segment, whatever the model produced.
  if (ch === "sms") {
    draft = draft
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
      .replace(/[^\x20-\x7E\n]/g, "")
      .trim()
  }

  return { draft, needs, toolCalls }
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s, headers: { ...cors, "Content-Type": "application/json" },
  })
}
