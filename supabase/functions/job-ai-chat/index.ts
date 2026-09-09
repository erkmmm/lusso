import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""

// How much of each knowledge document reaches the model.
//
// Per-document caps stop one huge catalogue crowding out the rest; the total
// caps stop the whole library overflowing the model's context as it grows.
// The company knowledge base sits in a cached prompt block (see below), so the
// larger budget is only paid in full on the first message of a burst.
const GLOBAL_DOC_CAP   = 120000
const GLOBAL_TOTAL_CAP = 120000
const JOB_DOC_CAP      = 60000
const JOB_TOTAL_CAP    = 120000

// How many chat turns are replayed. Always the MOST RECENT ones — reading the
// oldest turns instead makes the assistant deaf to everything just said.
const HISTORY_TURNS = 80

// Every spec column the measure sheet UI can populate. The assistant prices
// jobs off these, so a line rendered without its fixing type or its notes is a
// line it will quote wrong — render them all, drop only the empty ones.
const SPEC_FIELDS: [string, (li: any) => unknown][] = [
  ["Fabric/colour",      li => li.fabricColour],
  ["Control",            li => li.control],
  ["Return",             li => li.returnSide || li.controlSide],
  ["Motor side",         li => li.motorSide],
  ["Fixing",             li => li.fixing || li.mountType],
  ["Heading",            li => li.heading],
  ["Hem",                li => li.hem],
  ["Track colour",       li => li.trackColour || li.trackBaseBarColour],
  ["Bottom rail colour", li => li.baseBarColour],
  ["Operation type",     li => li.trackType],
  ["Bottom rail type",   li => li.baseBarType],
  ["Chain colour",       li => li.chainColour],
  ["Lining",             li => li.attachedLining ? (li.liningFabricColour ? `Yes — ${li.liningFabricColour}` : "Yes") : null],
  ["Notes",              li => [li.notes || li.installationNotes, li.additionalNotes].filter(Boolean).join(" · ")],
]


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

    const { jobId, message, clearHistory } = await req.json()
    if (!jobId) return json({ error: "jobId required" }, 400)

    if (clearHistory) {
      await admin.from("job_ai_messages").delete().eq("job_id", jobId)
      return json({ cleared: true })
    }

    if (!message?.trim()) return json({ error: "message required" }, 400)

    const { data: job } = await admin.from("jobs").select("*").eq("id", jobId).single()
    if (!job) return json({ error: "Job not found" }, 404)

    const [
      { data: customer },
      { data: quotes },
      { data: measures },
      { data: history },
      { data: comms },
      { data: jobKnowledge },
      { data: globalKnowledge },
      { data: transcripts },
      { data: speaker },
    ] = await Promise.all([
      admin.from("customers").select("name,email,phone,address,billing_address,notes,preferred_contact").eq("id", job.customer_id).single(),
      admin.from("quotes").select("quote_number,title,status,grand_total,created_at,sent_at,accepted_at").eq("job_id", jobId).is("deleted_at", null).order("created_at", { ascending: false }),
      admin.from("measure_sheets").select("status,measure_date,measurer,line_items").eq("job_id", jobId).is("deleted_at", null),
      admin.from("job_ai_messages").select("role,content,created_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(HISTORY_TURNS),
      admin.from("communications").select("channel,direction,subject,body,created_at").eq("job_id", jobId).order("created_at", { ascending: true }).limit(50),
      admin.from("job_ai_knowledge").select("filename,content,file_type,description,created_at").eq("job_id", jobId).order("created_at", { ascending: true }),
      admin.from("ai_global_knowledge").select("filename,content,file_type,description,created_at").order("created_at", { ascending: true }),
      admin.from("job_transcripts").select("summary,transcript,recorded_at,duration_seconds").eq("job_id", jobId).order("recorded_at", { ascending: true }),
      admin.from("profiles").select("display_name,role,employee_role").eq("id", user.id).single(),
    ])

    // Who is using the assistant right now (based on the logged-in session).
    const speakerName = speaker?.display_name || user.email || "a Lusso team member"
    const speakerRole = speaker?.employee_role
      || (speaker?.role === "account_manager" ? "account manager" : speaker?.role === "standard_user" ? "team member" : (speaker?.role ?? "team member"))

    // ── Block 1: static instructions + company knowledge base ────────────────
    // Byte-identical on every request from every user and every job, so it can
    // be cached by the API and re-read at ~10% of the input price.
    const base: string[] = [
      "You are the job assistant for Lusso, an Australian window coverings and furnishings business.",
      "You have full context about the job being discussed including the customer, quotes, measure sheets, consult recordings, all customer communications, job-specific documents, and the company knowledge base.",
      "Your job is to help the Lusso team — answering questions, drafting customer emails or SMS, writing internal notes, summarising the job, or suggesting next steps.",
      "",
      "Tone and style:",
      "- Write like a knowledgeable colleague, not a corporate bot. Friendly, clear, and to the point.",
      "- Use Australian English.",
      "- You can use the occasional emoji where it feels natural — one or two per response max.",
      "- Avoid heavy markdown like **bold** or bullet walls. Write in plain flowing sentences.",
      "- If drafting an email or SMS, write it out naturally without labelling every section.",
      "- Keep responses concise. If the answer is short, keep it short.",
      "- If something isn't in the context, say so honestly.",
      "- Supplier price lists are quoted as supplied — say whether a price excludes GST or freight when the document says so.",
      "",
      "Accuracy rules — these matter more than being helpful:",
      "- Never state a price, price group, system code (VS 2, VS 3, F 1, F 2 ...), fabric name, colour code, size limit or product specification from memory. State it only if you can see it in the document text loaded below, and name the document you read it from.",
      "- The suppliers below are separate businesses with separate ranges: Meyer Blinds (Simply Cell honeycomb), Verosol (VeroCell, VeroScreen), Silent Gliss, Oslo, Warwick, Kingtrack, Acmeda. Never carry a product name, fabric or price from one supplier's document into an answer about another. Once the team names a supplier, use only that supplier's documents for the rest of the conversation.",
      "- The inline copies of the documents below are cut short. When what you need isn't in the visible text — a fabric code, a colour name, a price group, a price table — call search_knowledge before you answer. It reads the FULL document, and its matching ignores spacing, so \"VS2\" finds \"VS 2\" and \"F1\" finds \"F 1\". Then read_knowledge to read around the hit.",
      "- Fabric ranges, colour codes and price tables almost always sit near the BACK of a supplier price list, which is exactly the part cut off inline. Assume you need to search for them rather than assuming they aren't there.",
      "- If search_knowledge finds nothing, say plainly that the document doesn't appear to contain it and name what you searched. Do not substitute a different supplier, and do not guess.",
      "- Hold on to what the team has already told you — the supplier, the product, the options they chose. Never re-ask for something they have already answered.",
      "- The measure sheet below is complete. If the team says they have updated it, re-read the lines below rather than asking them to paste it in.",
    ]

    if (globalKnowledge?.length) {
      const { lines: docLines, skipped } = renderDocs(globalKnowledge, GLOBAL_DOC_CAP, GLOBAL_TOTAL_CAP)
      base.push("")
      base.push(`## Company knowledge base (${globalKnowledge.length} documents)`)
      base.push("These documents apply to all jobs and contain company-wide information such as product catalogues, pricing, policies, and procedures. Spreadsheets appear sheet by sheet as comma-separated rows.")
      base.push("")
      base.push("Index — every document, with its full length. The copies below are budgeted and most are cut off partway; the FULL text of all of them is reachable with the search_knowledge and read_knowledge tools, using these exact filenames:")
      for (const d of globalKnowledge) {
        base.push(`- ${d.filename}${d.description ? ` — ${d.description}` : ""} (${normalise(d.content ?? "").length} characters)`)
      }
      base.push(...docLines)
      if (skipped.length) {
        base.push("")
        base.push(`[Not loaded this request (context limit): ${skipped.join(", ")}. Say so if asked about them rather than guessing.]`)
      }
    }

    base.push("")
    base.push("The specific job, the person you are talking to, and any job-specific documents follow below.")

    // ── Block 2: everything that varies per job / per user ───────────────────
    const lines: string[] = []
    lines.push(`You are currently chatting with ${speakerName} (${speakerRole}) — the Lusso team member using this tool right now, based on who is logged in. This person is NOT the customer. Address them by their first name when it feels natural, and read any "I", "me" or "we" in their messages as referring to them / the Lusso team.`)
    lines.push("")
    lines.push(`## Job ${job.job_number}`)
    lines.push(`Type: ${job.job_type ?? "—"} | Status: ${job.status} | Urgency: ${job.urgency ?? "Normal"}`)
    if (job.assigned_staff)       lines.push(`Assigned to: ${job.assigned_staff}`)
    if (job.measure_date)         lines.push(`Measure date: ${job.measure_date}`)
    if (job.quote_due_date)       lines.push(`Quote due: ${job.quote_due_date}`)
    if (job.install_date)         lines.push(`Install date: ${job.install_date}`)
    if (job.internal_notes)       lines.push(`Internal notes: ${job.internal_notes}`)
    if (job.access_instructions)  lines.push(`Access: ${job.access_instructions}`)
    if (job.parking_notes)        lines.push(`Parking: ${job.parking_notes}`)

    lines.push("")
    lines.push(`## Customer: ${customer?.name ?? "Unknown"}`)
    if (customer?.email)             lines.push(`Email: ${customer.email}`)
    if (customer?.phone)             lines.push(`Phone: ${customer.phone}`)
    if (customer?.address)           lines.push(`Site address: ${customer.address}`)
    if (customer?.billing_address)   lines.push(`Billing address: ${customer.billing_address}`)
    if (customer?.preferred_contact) lines.push(`Preferred contact: ${customer.preferred_contact}`)
    if (customer?.notes)             lines.push(`Customer notes: ${customer.notes}`)

    if (quotes?.length) {
      lines.push("")
      lines.push(`## Quotes (${quotes.length})`)
      for (const q of quotes) {
        const total = q.grand_total ? `$${Number(q.grand_total).toLocaleString("en-AU", { minimumFractionDigits: 2 })}` : "—"
        lines.push(`- ${q.quote_number}: ${q.title ?? "Untitled"} | Status: ${q.status} | Total: ${total}`)
        if (q.sent_at)     lines.push(`  Sent: ${q.sent_at.slice(0,10)}`)
        if (q.accepted_at) lines.push(`  Accepted: ${q.accepted_at.slice(0,10)}`)
      }
    }

    if (measures?.length) {
      lines.push("")
      lines.push(`## Measure sheets (${measures.length})`)
      lines.push("Every line is listed in full below. This IS the measure sheet, not a summary or a preview — never ask the team to paste it in.")
      for (const m of measures) {
        const items = Array.isArray(m.line_items) ? m.line_items : []
        lines.push("")
        lines.push(`Status: ${m.status} | Date: ${m.measure_date ?? "—"} | Measurer: ${m.measurer ?? "—"} | ${items.length} item(s)`)
        for (const [i, li] of items.entries()) {
          const size = (li.widthMm ?? li.width) || (li.dropMm ?? li.drop)
            ? `${li.widthMm ?? li.width ?? "?"}×${li.dropMm ?? li.drop ?? "?"}mm`
            : ""
          const qty  = Number(li.quantity ?? 1) > 1 ? ` ×${li.quantity}` : ""
          const head = [li.location, li.productNameSnapshot || li.productType, size].filter(Boolean).join(" — ")
          const specs = SPEC_FIELDS
            .map(([label, get]) => [label, get(li)] as [string, unknown])
            .filter(([, v]) => v != null && String(v).trim() !== "")
            .map(([label, v]) => `${label}: ${String(v).trim()}`)
          // A blank row on a half-started sheet is noise, not a window.
          if (!head && !specs.length) continue
          lines.push(`${i + 1}. ${head}${qty}${specs.length ? ` | ${specs.join(" | ")}` : ""}`)
        }
      }
    }

    if (transcripts?.length) {
      lines.push("")
      lines.push(`## Consult recordings (${transcripts.length})`)
      lines.push("Voice recordings of on-site consults, auto-transcribed. Use these to answer what was discussed with the customer during the consult.")
      for (const t of transcripts) {
        const date = t.recorded_at ? t.recorded_at.slice(0, 10) : ""
        const mins = t.duration_seconds ? `${Math.round(t.duration_seconds / 60)} min` : ""
        lines.push(`### Consult ${date}${mins ? ` (${mins})` : ""}`)
        if (t.summary && t.summary.trim()) {
          lines.push(t.summary.trim())
        } else if (t.transcript && t.transcript.trim()) {
          lines.push(t.transcript.trim().slice(0, 4000))
          if (t.transcript.length > 4000) lines.push("[... transcript truncated ...]")
        } else {
          lines.push("(transcription still processing)")
        }
      }
    }

    if (comms?.length) {
      lines.push("")
      lines.push(`## Customer communications (${comms.length} messages)`)
      for (const c of comms) {
        const date = c.created_at ? c.created_at.slice(0, 10) : ""
        const direction = c.direction === "outbound" ? "We sent" : "Customer replied"
        const ch = c.channel === "sms" ? "SMS" : "Email"
        if (c.subject) lines.push(`[${date}] ${direction} (${ch}) — Subject: ${c.subject}`)
        else           lines.push(`[${date}] ${direction} (${ch}):`)
        lines.push(`  \"${c.body.trim().slice(0, 500)}${c.body.length > 500 ? "..." : ""}\"`)
      }
    }

    if (jobKnowledge?.length) {
      const { lines: docLines, skipped } = renderDocs(jobKnowledge, JOB_DOC_CAP, JOB_TOTAL_CAP)
      lines.push("")
      lines.push(`## Job-specific documents (${jobKnowledge.length})`)
      lines.push(...docLines)
      if (skipped.length) lines.push(`[Not loaded this request (context limit): ${skipped.join(", ")}.]`)
    }

    // Fetched newest-first so the cap keeps the most recent turns; flipped back
    // to chronological order for the model.
    const messages = [
      ...[...(history ?? [])].reverse().map((m: any) => ({ role: m.role, content: m.content })),
      { role: "user", content: message.trim() },
    ]

    // Every document, at full length, addressable by the two tools below. The
    // inline copies above are budgeted and therefore truncated; this is what
    // the assistant reaches for when the answer is in a part it can't see.
    const library: KnowledgeDoc[] = [...(globalKnowledge ?? []), ...(jobKnowledge ?? [])]
      .filter((d: any) => (d.content ?? "").trim())
      .map((d: any) => ({ filename: d.filename, description: d.description ?? "", text: normalise(d.content) }))

    const tools = [
      {
        name: "search_knowledge",
        description:
          "Search the FULL text of every supplier document — including the parts that were truncated out of the inline copies above. Use this whenever you need a fabric code, colour name, fabric range, price, price group, system code or size limit that you cannot already see in full. Matching ignores spacing, so \"VS2\" finds \"VS 2\". Returns excerpts with the character offset of each hit; pass an offset to read_knowledge to read around it.",
        input_schema: {
          type: "object",
          properties: {
            query:    { type: "string", description: "Text to find — a fabric code such as \"2312\", a fabric name, a system code such as \"VS 3\", or a section heading such as \"Fabric overview\"." },
            filename: { type: "string", description: "Optional. Restrict to one document, named exactly as it appears in the index. Use this to stay inside one supplier's price list." },
          },
          required: ["query"],
        },
      },
      {
        name: "read_knowledge",
        description:
          "Read a window of one document by character offset. Use it after search_knowledge to read a price table or fabric list around a hit, and page through with successive offsets.",
        input_schema: {
          type: "object",
          properties: {
            filename: { type: "string", description: "Exactly as named in the index." },
            offset:   { type: "integer", description: "Character offset to start at. Defaults to 0." },
            length:   { type: "integer", description: "Characters to return, max 60000. Defaults to 20000. Price tables are large — read generously rather than paging in small steps." },
          },
          required: ["filename"],
        },
      },
    ]

    const convo: any[] = [
      ...[...(history ?? [])].reverse().map((m: any) => ({ role: m.role, content: m.content })),
      { role: "user", content: message.trim() },
    ]

    const usage = { input: 0, cache_write: 0, cache_read: 0, output: 0, tool_calls: 0 }
    let reply = ""
    let exhausted = false

    // Move the conversation cache breakpoint to the newest tool result before
    // each round. Without it, every search result accumulated so far is re-sent
    // at full input price on every subsequent round — which is what made one
    // long hunt cost more than reading the entire knowledge base.
    const moveCacheBreakpoint = () => {
      for (const m of convo) {
        if (Array.isArray(m.content)) for (const b of m.content) delete b.cache_control
      }
      const last = convo[convo.length - 1]
      if (last && Array.isArray(last.content) && last.content.length) {
        last.content[last.content.length - 1].cache_control = { type: "ephemeral" }
      }
    }

    const ask = (withTools: boolean) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        // A 1-hour cache TTL: the knowledge base is big, and a real
        // conversation has minutes-long gaps that blow the default 5-minute
        // window — re-writing the whole block at full price every message.
        "anthropic-beta": "extended-cache-ttl-2025-04-11",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        ...(withTools ? { tools } : {}),
        system: [
          // Cached: identical for every user and job, so after the first
          // message it is re-read at ~10% of the input price.
          { type: "text", text: base.join("\n"), cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: lines.join("\n") },
        ],
        messages: convo,
      }),
    })

    // Tool-use loop, bounded two ways. Rounds stop a model that keeps searching
    // from running the bill away; the wall-clock budget stops a slow hunt from
    // hitting the edge runtime's hard limit, which would kill the request
    // outright and return nothing at all. Both leave room to answer afterwards.
    const MAX_ROUNDS = 20
    const TOOL_DEADLINE = Date.now() + 200_000
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round === MAX_ROUNDS - 1 || Date.now() > TOOL_DEADLINE) { exhausted = true; break }
      const res = await ask(true)

      if (!res.ok) {
        // Log the body — a malformed request (bad block shape, oversized prompt)
        // is otherwise invisible behind a bare status code.
        console.error(`job-ai-chat anthropic ${res.status}: ${(await res.text()).slice(0, 800)}`)
        return json({ error: `AI error: ${res.status}` }, 502)
      }

      const data = await res.json()
      const u = data.usage ?? {}
      usage.input       += u.input_tokens ?? 0
      usage.cache_write += u.cache_creation_input_tokens ?? 0
      usage.cache_read  += u.cache_read_input_tokens ?? 0
      usage.output      += u.output_tokens ?? 0

      const blocks: any[] = data.content ?? []
      reply = blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || reply

      const calls = blocks.filter(b => b.type === "tool_use")
      if (data.stop_reason !== "tool_use" || !calls.length) break

      usage.tool_calls += calls.length
      convo.push({ role: "assistant", content: blocks })
      convo.push({
        role: "user",
        content: calls.map((c: any) => ({
          type: "tool_result",
          tool_use_id: c.id,
          content: runKnowledgeTool(c.name, c.input ?? {}, library),
        })),
      })
      moveCacheBreakpoint()
    }

    // The loop ran out of searches mid-hunt. `reply` at this point is only the
    // preamble the model wrote before its last tool call ("Let me check what
    // F1 vs F2 actually are...") — returning that looks like the assistant
    // simply stopped talking. Ask once more with the tools taken away so it
    // has to answer from what it already found, and say what it still lacks.
    if (exhausted) {
      console.warn(`job-ai-chat rounds exhausted job=${job.job_number} tools=${usage.tool_calls}`)
      convo.push({
        role: "user",
        content: "You have used all the searches available for this message. Answer now with what you have found so far. "
          + "Be explicit about which parts you confirmed in a document and which you could not find, and say what you would need to search next — do not fill any gap from memory.",
      })
      const res = await ask(false)
      if (res.ok) {
        const data = await res.json()
        const u = data.usage ?? {}
        usage.input += u.input_tokens ?? 0
        usage.cache_write += u.cache_creation_input_tokens ?? 0
        usage.cache_read += u.cache_read_input_tokens ?? 0
        usage.output += u.output_tokens ?? 0
        const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
        if (text) reply = text
      } else {
        console.error(`job-ai-chat final-answer ${res.status}: ${(await res.text()).slice(0, 400)}`)
        reply = (reply ? reply + "\n\n" : "")
          + "I ran out of searches on that one before I could finish. Ask me again and narrow it down a bit — naming the supplier and the exact code helps."
      }
    }

    if (!reply) reply = "Sorry, I couldn't generate a response."

    console.log(`job-ai-chat usage job=${job.job_number} in=${usage.input} cache_write=${usage.cache_write} cache_read=${usage.cache_read} out=${usage.output} tools=${usage.tool_calls}`)

    await admin.from("job_ai_messages").insert([
      { job_id: jobId, role: "user",      content: message.trim(), created_by: user.id },
      { job_id: jobId, role: "assistant", content: reply },
    ])

    return json({ reply })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

type KnowledgeDoc = { filename: string; description: string; text: string }

/**
 * Flatten the whitespace a PDF extractor leaves behind, without destroying
 * paragraph breaks. Offsets quoted by search_knowledge are offsets into this
 * normalised text, so every reader has to agree on it.
 */
function normalise(raw: string) {
  return raw.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n")
}

/**
 * Build a matcher that tolerates the spacing a PDF extractor sprays through
 * short codes — the Simply Cell list writes "VS 2" and "F 1", and a fabric
 * code can arrive split across a line break.
 */
function looseMatcher(query: string) {
  const q = query.trim().slice(0, 60)
  const pattern = [...q]
    .filter(c => !/\s/.test(c))
    .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*")
  if (!pattern) return null

  // Short alphanumeric queries are codes ("0100", "VS2", "F1"). Anchor them to
  // token boundaries, or "F1" matches the "f 1" inside "half 1" on every page.
  const isCode = /^[A-Za-z0-9]{1,8}$/.test(q.replace(/\s/g, ""))
  const body = isCode ? `(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])` : pattern
  return new RegExp(body, "gi")
}

function runKnowledgeTool(name: string, input: any, library: KnowledgeDoc[]): string {
  try {
    if (name === "search_knowledge") return searchKnowledge(input, library)
    if (name === "read_knowledge")   return readKnowledge(input, library)
    return `Unknown tool "${name}".`
  } catch (e) {
    return `Tool error: ${String(e)}`
  }
}

function searchKnowledge(input: any, library: KnowledgeDoc[]) {
  const re = looseMatcher(String(input.query ?? ""))
  if (!re) return "Empty query — give some text to search for."

  const wanted = input.filename ? String(input.filename).trim().toLowerCase() : null
  const docs = wanted
    ? library.filter(d => d.filename.toLowerCase() === wanted || d.filename.toLowerCase().includes(wanted))
    : library
  if (!docs.length) {
    return `No document matches "${input.filename}". Available: ${library.map(d => d.filename).join(", ")}`
  }

  // SHOW is deliberately small: every result is replayed on every later turn,
  // so a generous search is paid for again and again as the conversation runs.
  const PAD = 700, SCAN_CAP = 400, SHOW = 8, BUCKETS = 6
  type Hit = { file: string; offset: number; window: string; score: number; zone: string }
  const hits: Hit[] = []

  for (const d of docs) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(d.text)) !== null && hits.length < SCAN_CAP) {
      const from = Math.max(0, m.index - PAD)
      const to   = Math.min(d.text.length, m.index + m[0].length + PAD)
      const window = d.text.slice(from, to)
      // A price list is mostly grids of numbers. A code that explains itself
      // sits in a sentence or a fabric row; a code that is really a price sits
      // in a digit run. Rank by how much prose surrounds the hit, so the
      // explanation surfaces instead of 400 lookalike numbers.
      const letters = (window.match(/[A-Za-z]/g) ?? []).length
      const zone = `${d.filename}#${Math.floor((m.index / Math.max(1, d.text.length)) * BUCKETS)}`
      hits.push({ file: d.filename, offset: m.index, window, score: letters / window.length, zone })
      re.lastIndex = Math.max(re.lastIndex, to - PAD)
    }
  }

  if (!hits.length) {
    return `No match for "${input.query}"${wanted ? ` in ${docs.map(d => d.filename).join(", ")}` : " in any document"}. `
      + `Searched: ${docs.map(d => `${d.filename} (${d.text.length} chars)`).join(", ")}. `
      + `Say that you could not find it rather than answering from memory.`
  }

  // Take the wordiest hit from each region of each document before filling the
  // remaining slots by score. Without this the table of contents — far and away
  // the most prose-dense page in a price list — takes every slot, and the
  // section that actually explains the product never gets shown.
  const byZone = new Map<string, Hit>()
  for (const h of hits) {
    const held = byZone.get(h.zone)
    if (!held || h.score > held.score) byZone.set(h.zone, h)
  }
  const spread = [...byZone.values()].sort((a, b) => b.score - a.score)
  const rest   = hits.filter(h => !spread.includes(h)).sort((a, b) => b.score - a.score)
  const shown  = [...spread, ...rest].slice(0, SHOW).sort((a, b) => a.offset - b.offset)
  const head = hits.length > shown.length
    ? `${hits.length} match(es) for "${input.query}" — showing the ${shown.length} with the most surrounding text (the rest sit inside price grids). Narrow the query or use read_knowledge if you need a different one.`
    : `${hits.length} match(es) for "${input.query}":`

  return head + "\n\n" + shown.map(h => `--- ${h.file} @ offset ${h.offset} ---\n...${h.window}...`).join("\n\n")
}

function readKnowledge(input: any, library: KnowledgeDoc[]) {
  const wanted = String(input.filename ?? "").trim().toLowerCase()
  const doc = library.find(d => d.filename.toLowerCase() === wanted)
    || library.find(d => d.filename.toLowerCase().includes(wanted))
  if (!doc) return `No document named "${input.filename}". Available: ${library.map(d => d.filename).join(", ")}`

  const offset = Math.max(0, Math.min(Number(input.offset ?? 0) || 0, doc.text.length))
  const length = Math.max(1, Math.min(Number(input.length ?? 20000) || 20000, 60000))
  const slice  = doc.text.slice(offset, offset + length)
  const endsAt = offset + slice.length

  return `${doc.filename} — characters ${offset}–${endsAt} of ${doc.text.length}\n\n${slice}\n\n`
    + (endsAt < doc.text.length
        ? `[${doc.text.length - endsAt} characters remain. Read on with offset ${endsAt}.]`
        : "[End of document.]")
}

/**
 * Render knowledge documents into prompt lines, giving each up to `docCap`
 * characters and the set as a whole up to `totalCap`. Anything that doesn't fit
 * is named rather than silently dropped, so the assistant can say it hasn't
 * read it instead of guessing.
 */
function renderDocs(docs: any[], docCap: number, totalCap: number) {
  // Normalised here too, so a character offset means the same thing inline as
  // it does to search_knowledge and read_knowledge.
  const texts = docs.map(d => normalise(d.content ?? ""))
  const sizes = texts.map(t => Math.min(t.length, docCap))

  // Water-filling: every document gets an equal share of the budget, and
  // whatever a small document doesn't need is handed back to the larger ones.
  // The old first-come-first-served pass spent the whole budget on the oldest
  // uploads, so a price list added for today's job arrived truncated to its
  // cover page while a supplier nobody asked about was loaded in full.
  const alloc = new Array(docs.length).fill(0)
  let budget = totalCap
  let open = docs.map((_, i) => i).filter(i => sizes[i] > 0)

  while (open.length && budget > 0) {
    const share = Math.floor(budget / open.length)
    if (share <= 0) break
    const next: number[] = []
    for (const i of open) {
      const take = Math.min(share, sizes[i] - alloc[i])
      alloc[i] += take
      budget -= take
      if (alloc[i] < sizes[i]) next.push(i)
    }
    open = next
  }

  const lines: string[] = []
  const skipped: string[] = []

  for (const [i, d] of docs.entries()) {
    const content = texts[i]
    if (!content || alloc[i] <= 0) { skipped.push(d.filename); continue }

    const slice = content.slice(0, alloc[i])
    lines.push(`### ${d.filename}${d.description ? ` — ${d.description}` : ""}`)
    lines.push(slice)
    if (slice.length < content.length) {
      lines.push(`[... ${d.filename} TRUNCATED here — characters ${slice.length}–${content.length} are NOT shown above. The fabric ranges, colour codes and price tables usually sit near the BACK of a price list, so they are in this hidden part. Use search_knowledge or read_knowledge (from offset ${slice.length}) to read it. Never answer from memory or from another supplier's document instead. ...]`)
    }
  }

  return { lines, skipped }
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s, headers: { ...cors, "Content-Type": "application/json" },
  })
}
