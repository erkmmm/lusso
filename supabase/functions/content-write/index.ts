import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import Anthropic from "npm:@anthropic-ai/sdk@0.123.0"
import { loadReferences, existingPages } from "../_shared/references.ts"
import { auditContent } from "../_shared/audit.ts"

// Writing a page, server-side.
//
// This is the function that removes the Mac from the loop. Lusso's equivalent
// is a GitHub issue labelled `run-request` that scripts/run-requests.py claims
// from launchd every couple of minutes -- so a page gets written only if that
// one machine happens to be awake, logged in, and holding a Claude session. The
// button in the CRM cannot report progress because it never started anything.
//
// Two things make the same work safe to do here:
//
//   * It runs in the BACKGROUND. A long-form page takes minutes, which is well
//     past the point where a browser or a proxy gives up on the request. So the
//     function books the work into content_jobs, returns the job id at once, and
//     does the writing under EdgeRuntime.waitUntil(). The page polls the job.
//
//   * It records FAILURE. Every path that can go wrong ends by writing to
//     content_jobs.error. A generation that dies silently is the failure mode
//     this codebase has already been bitten by twice -- push notifications were
//     dead on arrival behind `exception when others then null`, and the
//     Lusso-URL leak hid in the same swallow.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

// What the model must return. Enforced by the API rather than parsed hopefully
// out of prose: with output_config.format the response is already valid against
// this, so there is no repair loop and no half-written page to clean up.
// A service page is not a blog post with different words -- it is fifteen named
// slots in templates/service-page.html, each with its own required markup and
// its own count (exactly 8 tiles, exactly 4 checklist items, 3 capability
// columns). Asking for one body_html and hoping produced a page that could not
// render: the template kept 20 placeholders it was never given.
//
// Every fragment field below is documented block-for-block in
// service-blocks.md, which loadReferences() puts in the prompt. The
// descriptions here name the block and the count; the markup lives there, so
// the two cannot drift apart the way two copies would.
const SERVICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "slug", "description", "location", "hero_h", "hero_display",
             "hero_copy", "hero_query", "hero_alt", "why_us", "product_tiles",
             "local_conditions", "diff_display", "diff_lead", "differentiator",
             "use_cases_heading", "use_cases_display", "use_cases", "process",
             "tiles_heading", "testimonial_heading", "testimonial_lead",
             "area_heading", "area_display", "service_area_links", "faq"],
  properties: {
    title:       { type: "string", description: "Page title, 50-60 characters including any brand suffix." },
    slug:        { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    description: { type: "string", description: "Meta description, 150-160 characters." },
    location:    { type: "string", description: "The suburb, city or region this page serves, as written in prose: 'the Gold Coast', 'Brisbane'." },

    hero_h:       { type: "string", description: "The H1. The service and the place, no tagline." },
    hero_display: { type: "string", description: "The large display line under the H1. One sentence." },
    hero_copy:    { type: "string", description: "The hero paragraph. Two or three sentences that say what is actually on offer." },
    hero_query:   { type: "string", description: "An image search phrase for the hero." },
    hero_alt:     { type: "string", description: "Alt text for the hero image." },

    why_us:           { type: "string", description: "HTML for the {{WHY_US}} split block: the two sibling divs, with EXACTLY 4 .checklist items, each a fact then its consequence for the buyer." },
    product_tiles:    { type: "string", description: "HTML for {{PRODUCT_TILES}}: EXACTLY 8 <a class=\"tile\"> elements. Not 7, not 9 -- the grid is 4x2 and any other count leaves a hole." },
    local_conditions: { type: "string", description: "HTML for {{LOCAL_CONDITIONS}}: why this specific place is hard on window furnishings. Salt, sun, humidity, wind -- real local specifics, not generic weather." },
    diff_display:     { type: "string", description: "The display line above the three capability columns." },
    diff_lead:        { type: "string", description: "The lead paragraph above the three capability columns." },
    differentiator:   { type: "string", description: "HTML for {{DIFFERENTIATOR}}: EXACTLY 3 capability columns." },

    use_cases_heading: { type: "string" },
    use_cases_display: { type: "string" },
    use_cases:         { type: "string", description: "HTML for {{USE_CASES}}: room-by-room rows, one per room, each naming what actually gets specified there and why." },
    process:           { type: "string", description: "HTML for {{PROCESS}}: the real quote process, using the real numbers from Business-facts.md (24-48 hours, 30 days, no deposit)." },

    tiles_heading:       { type: "string" },
    testimonial_heading: { type: "string" },
    testimonial_lead:    { type: "string" },
    area_heading:        { type: "string" },
    area_display:        { type: "string" },
    service_area_links:  { type: "string", description: "HTML for {{SERVICE_AREA_LINKS}}: quicklink anchors to the suburbs and areas served. Link only to pages in the existing-pages list; anywhere without a page is plain text." },

    faq: { type: "array",
           description: "The FAQ, 4-8 entries. Rendered into {{FAQ_ITEMS}} and the FAQPage schema from this one source.",
           items: { type: "object", additionalProperties: false, required: ["q", "a"],
                    properties: { q: { type: "string" }, a: { type: "string" } } } },
  },
} as const

const WEB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "slug", "description", "body_html", "faq"],
  properties: {
    title:       { type: "string", description: "Page title, under 60 characters." },
    slug:        { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$",
                   description: "URL slug, lowercase and hyphenated." },
    description: { type: "string", description: "Meta description, 150-160 characters." },
    // Returned separately so the FAQPage schema is generated from the same
    // source as the visible FAQ. The skill is emphatic that writing them twice
    // is how a page ends up passing its own audit while its structured data
    // disagrees with the words on the page.
    faq: { type: "array",
           description: "The FAQ, 4-8 entries, matching the .faq block in body_html exactly.",
           items: { type: "object", additionalProperties: false,
                    required: ["q", "a"],
                    properties: { q: { type: "string" }, a: { type: "string" } } } },
    // Fragment, not a document: the site supplies the shell. A model that
    // returns <html> here would have its <head> silently swallowed by the
    // renderer, which looks like the page losing its styling for no reason.
    //
    // The old description restricted this to "h2, h3, p, ul, ol, li, strong, em,
    // a only", which actively FORBADE the site's own components -- .answer,
    // <figure>, .cmp-wrap, .post-cta, .faq/<details> are all in the stylesheet
    // and were all being suppressed by the schema. The block-markup reference is
    // now in the prompt, so the constraint has to allow what it mandates.
    body_html:   { type: "string",
                   description: "The body as an HTML fragment, using the exact component markup from the block reference in the prompt (.answer, figure, h2 with id, .cmp-wrap table, .post-cta, .faq with details/summary). No <html>, <head>, <body> or <h1> -- the shell and the title come from the template." },
  },
} as const

const SOCIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption"],
  properties: {
    caption:  { type: "string", description: "The post caption, ready to publish." },
    hashtags: { type: "array", items: { type: "string" },
                description: "Hashtags without the leading #." },
  },
} as const

const DEFAULT_BRIEF = `Write for a window furnishings business: made-to-measure curtains,
blinds, shutters and motorisation. The reader is a homeowner deciding what to put on
their windows, not a tradesperson.

Be specific and useful. Name fabrics, mechanisms and trade-offs. Say what something
costs to live with, not just what it looks like. Never pad -- a short page that answers
the question beats a long one that circles it.

Do not open with "In today's world" or any variant. Do not address the reader as
"homeowners". Do not promise things a quote has not been given for.`

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "Unauthorized" }, 401)
  if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500)

  // The caller's own client for anything RLS should govern; the service-role
  // client only for writes the user is not directly performing (job rows, and
  // the finished page). Lusso is single-tenant, so there is no org to scope by --
  // the role checks in the policies are the whole of the access control.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: "Unauthorized" }, 401)

  const body = await req.json().catch(() => ({}))
  const action = body?.action === "revise" ? "revise" : "write"

  // The KIND is what the caller asks for -- blog, service, instagram, facebook,
  // or whatever gets added next. The channel is derived from it, because where a
  // thing publishes is a property of the kind and not a second choice the caller
  // should be able to get wrong.
  const kind: string = String(body?.kind ?? "blog")

  // ── Book the job ───────────────────────────────────────────────────────────
  // Before any work, so a caller who double-clicks gets told rather than
  // charged twice. The partial unique indexes do the arbitration: one open
  // write per org, one open revision per post.
  const postId: string | null = body?.postId ?? null
  const instruction: string = String(body?.instruction ?? "").trim()

  const { data: kindRow } = await supabase
    .from("content_prompts")
    .select("kind, label, channel, prompt, max_kd")
    .eq("kind", kind).maybeSingle()
  if (!kindRow) {
    return json({ error: `there is no "${kind}" to write — check Settings → Content` }, 400)
  }
  const channel = kindRow.channel as string

  if (action === "revise") {
    if (!postId) return json({ error: "postId required" }, 400)
    if (instruction.length < 4) return json({ error: "say what should change" }, 400)
    if (instruction.length > 4000) return json({ error: "keep the instruction under 4000 characters" }, 400)
  }

  const { data: job, error: jobErr } = await admin
    .from("content_jobs")
    .insert({
      kind: action,
      post_id: postId,
      instruction: instruction || null,
      requested_by: user.id,
    })
    .select("id").single()

  if (jobErr) {
    // 23505 is one of the two partial unique indexes firing. That is not an
    // error the user caused twice -- it is the first request still running.
    if (jobErr.code === "23505") {
      return json({
        ok: true,
        alreadyRunning: true,
        why: action === "write"
          ? "A page is already being written for this business."
          : "This page already has a revision in progress.",
      })
    }
    return json({ error: jobErr.message }, 500)
  }

  // ── Do the writing, after the response has gone ────────────────────────────
  EdgeRuntime.waitUntil((async () => {
    // Progress, not completion: the Content page polls this row while a page is
    // being written, and a four-minute silence looks identical to a hang.
    const note = (step: string) =>
      admin.from("content_jobs").update({ step }).eq("id", job.id)

    const finish = (patch: Record<string, unknown>) =>
      admin.from("content_jobs")
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq("id", job.id)

    try {
      const { data: settings } = await admin
        .from("content_settings").select("brief").eq("id", 1).maybeSingle()
      const businessName = "Lusso"
      // Two layers, and the order matters. The house style is the business --
      // how it sounds, what it will not say -- and applies to everything. The
      // kind prompt is the craft of this particular artefact: a blog post
      // explains, a service page sells, a caption has one line to land. The
      // skills kept both in one SKILL.md per kind, which meant a change to the
      // voice had to be made in two files and usually was not.
      const brief      = settings?.brief?.trim() || DEFAULT_BRIEF
      const kindPrompt = (kindRow.prompt ?? "").trim()

      const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
      const isWeb = channel === "web"

      // Read the site's own repo. The /blog and /service skills open these
      // files before writing a word; without them "never invent a statistic"
      // is a rule with nothing behind it.
      const repoToken = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
      const ghHeaders = {
        Authorization: `Bearer ${repoToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lusso-crm",
      }
      const ghText = async (path: string) => {
        if (!repoToken) return null
        const r = await fetch(
          `https://api.github.com/repos/erkmmm/LussoWebite/contents/${encodeURI(path)}?ref=main`,
          { headers: ghHeaders })
        if (!r.ok) return null
        const f = await r.json()
        return new TextDecoder().decode(
          Uint8Array.from(atob(String(f.content).replace(/\n/g, "")), c => c.charCodeAt(0)))
      }
      const ghJson = async (path: string) => {
        if (!repoToken) return null
        const r = await fetch(`https://api.github.com/repos/erkmmm/LussoWebite${path}`, { headers: ghHeaders })
        return r.ok ? await r.json() : null
      }

      let system: string
      let prompt: string
      let keywordId: string | null = null
      // Declared out here because the INSERT below needs it and the write branch
      // is its own block -- the same reason keywordId lives at this level.
      let topicUsed: string | null = null

      if (action === "revise") {
        const { data: post } = await admin
          .from("content_posts")
          .select("title, slug, body_html, caption, meta, channel")
          .eq("id", postId).single()
        if (!post) throw new Error("that page no longer exists")

        system = `You are revising an existing ${kindRow.label.toLowerCase()} for ${businessName}.\n\n`
          + `${brief}\n\n${kindPrompt}\n\n`
          + `Apply the requested change and return the whole thing. Leave everything the `
          + `instruction did not ask about exactly as it was -- an unrequested rewrite is `
          + `a change nobody reviewed.`
        prompt = post.channel === "web"
          ? `Current title: ${post.title}\nCurrent slug: ${post.slug}\n\n`
            + `Current body:\n${post.body_html}\n\n---\n\nChange requested: ${instruction}`
          : `Current caption:\n${post.caption}\n\n---\n\nChange requested: ${instruction}`
      } else {
        // pick_keyword() applies this kind's own eligibility rules and
        // pick-keyword.py's scoring. Called on the CALLER's client so it runs
        // under their RLS and current_org() resolves -- as service role it would
        // see no org at all.
        const { data: picks } = await supabase.rpc("pick_keyword", { p_kind: kind })
        const kw = picks?.[0]

        const asked = String(body?.topic ?? "").trim()
        const topic = asked || kw?.keyword || null
        topicUsed = topic

        // A web page without a keyword is a page with no reason to exist -- it
        // is the search term that decides the whole shape of it. A social post
        // is not: people post about the work, not about a search. So the
        // keyword is required for web and merely useful for everything else.
        if (!topic && isWeb) {
          throw new Error(
            `no ${kindRow.label.toLowerCase()} keyword left — import a Semrush export under ` +
            `Settings → Content, or type a topic to write about`)
        }
        // A typed or clicked topic still spends the keyword when it matches a
        // row. Without this a local topic chip would stay on the page forever,
        // offering to write a post that already exists.
        if (asked) {
          const { data: exact } = await admin.from("content_keywords")
            .select("id").eq("keyword", asked.toLowerCase()).is("used_at", null).maybeSingle()
          keywordId = exact?.id ?? null
        } else {
          keywordId = kw?.id ?? null
        }

        // ── Research, then write. Two calls, not one. ────────────────────
        //
        // Steps 1-3 of the skill are SERP research: read the top three results,
        // record their length and headings, cover what they all cover, then add
        // something none of them did. That needs the live web, so it runs as its
        // own call with the web_search tool.
        //
        // It cannot be folded into the writing call: output_config.format and
        // citations are mutually exclusive, and web search returns citations. So
        // research produces notes, and the notes go into the writing prompt.
        if (isWeb) {
          await note("researching the top results")
          const [refs, pages] = await Promise.all([
            loadReferences(ghText, kind, topic),
            existingPages(ghJson),
          ])

          const research = await anthropic.messages.create({
            model: "claude-opus-5",
            max_tokens: 8000,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
            messages: [{
              role: "user",
              content:
                `Research the search term "${topic}" for a page on an Australian window `
                + `furnishings site. Search it, then read the top three ORGANIC results `
                + `(skip ads, Reddit, YouTube, directories).\n\n`
                + `Report, tersely:\n`
                + `1. For each competitor: approximate word count, format `
                + `(comparison / listicle / how-to / guide), and every H2.\n`
                + `2. The topics ALL THREE cover — these are mandatory.\n`
                + `3. Two substantial topics NONE of them cover that a working `
                + `installer could write. Installation detail, Australian regulation `
                + `and real numbers are the reliable gaps.\n`
                + `4. The People Also Ask questions, for the FAQ.\n`
                + `5. The average word count, and the target: the top of a ±20% band `
                + `around it.\n\n`
                + `Notes only. Do not write the page.`,
            }],
          })
          const notes = research.content
            .filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n")

          system = `You write for ${businessName}.\n\n${brief}\n\n${kindPrompt}\n\n`
            + `================ VERIFIED REFERENCE MATERIAL ================\n`
            + `Everything below is the business's own documented fact. Prefer a figure `
            + `from here over an industry-standard range every time — it is the difference `
            + `between matching competitors and beating them. A field marked [UNKNOWN] is `
            + `NOT a licence to guess: write around it.\n\n${refs.text}`

          const measured = kw && !asked
            ? ` It gets about ${kw.volume} searches a month at keyword difficulty ${kw.difficulty ?? "unknown"}.`
            : ""
          prompt = `Write a ${kindRow.label.toLowerCase()} targeting "${topic}".${measured}\n\n`
            + `=== SERP RESEARCH ===\n${notes}\n\n`
            + `Cover every topic all three competitors cover, hit the target length above, `
            + `and include the two gaps they missed.\n\n`
            + `=== THE GATE ===\n`
            + `The page is checked before it can publish. These are hard limits, not `
            + `preferences:\n`
            + `- title EXACTLY 50-60 characters, including any " | Lusso" you add\n`
            + `- meta description EXACTLY 150-160 characters\n`
            + `- at least 4 H2s, every one with an id\n`
            + `- 3 to 6 internal links, no more than 6\n`
            + `- at least 2 external links to .gov.au / .edu.au / an industry body, `
            + `each with rel="noopener"\n`
            + `- at least 3 <strong> phrases, a list, and the .answer block\n`
            + `- 4 to 8 FAQ questions\n`
            + `- no HTML entities (&amp; etc) in the faq array — write a literal &\n\n`
            + `=== INTERNAL LINKS ===\n`
            + `Link to 3-6 of these existing pages where genuinely relevant, with `
            + `descriptive anchor text, as relative links like <a href="slug.html">:\n`
            + pages.map(p => p.slug).join(", ")
            + `\n\nAlso include at least two authoritative EXTERNAL links `
            + `(.gov.au, .edu.au, or an industry body) with target="_blank" rel="noopener". `
            + `Only link to a URL you are confident exists.`

          // Recorded so a thin page can be explained later rather than guessed at.
          await admin.from("content_jobs")
            .update({ error: refs.missing.length
              ? `note: reference files not found: ${refs.missing.join(", ")}` : null })
            .eq("id", job.id)
        } else {
          system = `You write for ${businessName}.\n\n${brief}\n\n${kindPrompt}`
          const measured = kw && !asked
            ? ` It gets about ${kw.volume} searches a month at keyword difficulty ${kw.difficulty ?? "unknown"}`
              + `${kw.intent ? `, and the intent behind it is ${kw.intent.toLowerCase()}` : ""}.`
            : ""
          const label = kindRow.label.toLowerCase()
          prompt = topic
            ? `Write a ${label} about "${topic}".${measured}`
            : `Write a ${label} about the business's work. Pick one specific thing worth `
              + `saying and say it -- not a summary of everything they do.`
        }
      }

      const schema = !isWeb ? SOCIAL_SCHEMA
        : kind === "service" ? SERVICE_SCHEMA : WEB_SCHEMA

      // Streamed because a long page at a high max_tokens is exactly the request
      // that hits an HTTP timeout otherwise.
      await note("writing the page")
      const stream = anthropic.messages.stream({
        model: "claude-opus-5",
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema },
        },
        system,
        messages: [{ role: "user", content: prompt }],
      })
      const message = await stream.finalMessage()

      if (message.stop_reason === "refusal") {
        throw new Error(`declined: ${message.stop_details?.explanation ?? "no reason given"}`)
      }
      const text = message.content.find((b) => b.type === "text")
      if (!text || text.type !== "text") throw new Error("the model returned no text")
      let out = JSON.parse(text.text)

      // ── Repair pass ───────────────────────────────────────────────────
      // The gate has checks no amount of prompting hits reliably -- "title
      // 50-60 characters" is a counting task, and the model is writing prose.
      // So rather than ask harder, measure and hand back the misses. One pass:
      // if a second attempt still cannot count to 60, a third will not either,
      // and the failures are recorded for a human instead.
      // A service page has no body_html -- its prose is spread across fifteen
      // slots. Concatenating them gives the audit the same thing a reader sees,
      // so link counts, image attributes and entity checks still mean something.
      const checkable = (o: Record<string, string>) =>
        kind === "service"
          ? [o.hero_copy, o.why_us, o.product_tiles, o.local_conditions,
             o.differentiator, o.use_cases, o.process, o.service_area_links]
              .filter(Boolean).join("\n")
          : o.body_html

      let audit = isWeb
        ? auditContent({ title: out.title, slug: out.slug, description: out.description,
                         bodyHtml: checkable(out), faq: out.faq ?? [], kind })
        : null

      if (audit?.failed.length) {
        await note(`repairing ${audit.failed.length} audit failure(s)`)
        const repair = await anthropic.messages.create({
          model: "claude-opus-5",
          max_tokens: 32000,
          thinking: { type: "adaptive" },
          output_config: { effort: "high", format: { type: "json_schema", schema } },
          system,
          messages: [
            { role: "user", content: prompt },
            { role: "assistant", content: text.text },
            { role: "user", content:
                `The page failed these checks:\n\n`
                + audit.failed.map(f => `- ${f.label}${f.detail ? ` (currently: ${f.detail})` : ""}`).join("\n")
                + `\n\nReturn the whole page again with exactly these fixed and `
                + `nothing else changed. Do not rewrite passing prose. For any `
                + `length check, count the characters -- do not estimate. To cut `
                + `internal links, drop the least relevant ones, keeping the link `
                + `text as plain prose.` },
          ],
        })
        const rt = repair.content.find((b) => b.type === "text")
        if (rt && rt.type === "text") {
          const fixed = JSON.parse(rt.text)
          const after = auditContent({ title: fixed.title, slug: fixed.slug,
            description: fixed.description, bodyHtml: checkable(fixed),
            faq: fixed.faq ?? [], kind })
          // Keep the repair only if it actually helped. A repair that trades one
          // failure for another is a regression wearing a fix's clothes.
          if (after.failed.length < audit.failed.length) { out = fixed; audit = after }
        }
        await note(audit.failed.length
          ? `audit: ${audit.failed.length} still failing`
          : `audit: all ${audit.passed} checks passed`)
      }

      if (action === "revise") {
        await admin.from("content_posts").update({
          ...(isWeb
            ? { title: out.title, body_html: out.body_html,
                meta: { description: out.description } }
            : { caption: out.caption, meta: { hashtags: out.hashtags ?? [] } }),
          updated_at: new Date().toISOString(),
        }).eq("id", postId)

        await finish({ status: "done" })
        return
      }

      const { data: created, error: insErr } = await admin.from("content_posts").insert({
        channel,
        kind,
        status: "draft",
        created_by: user.id,
        ...(isWeb
          ? { title: out.title, slug: out.slug, body_html: out.body_html ?? null,
              meta: { description: out.description, keyword: topicUsed, faq: out.faq ?? [],
                      audit: audit ? { passed: audit.passed, failed: audit.failed } : null,
                      // Everything the service template needs that a blog post
                      // does not. Kept whole rather than flattened into columns:
                      // these are template slots, not queryable facts.
                      ...(kind === "service" ? { service: {
                        location: out.location,
                        hero_h: out.hero_h, hero_display: out.hero_display,
                        hero_copy: out.hero_copy, hero_query: out.hero_query,
                        hero_alt: out.hero_alt,
                        why_us: out.why_us, product_tiles: out.product_tiles,
                        local_conditions: out.local_conditions,
                        diff_display: out.diff_display, diff_lead: out.diff_lead,
                        differentiator: out.differentiator,
                        use_cases_heading: out.use_cases_heading,
                        use_cases_display: out.use_cases_display,
                        use_cases: out.use_cases, process: out.process,
                        tiles_heading: out.tiles_heading,
                        testimonial_heading: out.testimonial_heading,
                        testimonial_lead: out.testimonial_lead,
                        area_heading: out.area_heading, area_display: out.area_display,
                        service_area_links: out.service_area_links,
                      } } : {}) } }
          : { caption: out.caption, meta: { hashtags: out.hashtags ?? [] } }),
      }).select("id").single()

      // A slug collision means the model picked a slug a page already owns.
      // Retrying the whole generation to get a different one costs minutes;
      // suffixing costs nothing and leaves both pages reachable.
      if (insErr?.code === "23505" && isWeb) {
        const { data: retry } = await admin.from("content_posts").insert({
          channel, kind, status: "draft", created_by: user.id,
          title: out.title, slug: `${out.slug}-2`, body_html: out.body_html,
          meta: { description: out.description, keyword: topicUsed, faq: out.faq ?? [] },
        }).select("id").single()
        if (retry && keywordId) {
          await admin.from("content_keywords")
            .update({ used_at: new Date().toISOString(), used_by: retry.id })
            .eq("id", keywordId)
        }
        await finish({ status: "done", post_id: retry?.id ?? null })
        return
      }
      if (insErr) throw new Error(insErr.message)

      if (keywordId) {
        await admin.from("content_keywords")
          .update({ used_at: new Date().toISOString(), used_by: created.id })
          .eq("id", keywordId)
      }
      await finish({ status: "done", post_id: created.id })
    } catch (e) {
      await finish({ status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 500) })
    }
  })())

  return json({ ok: true, jobId: job.id })
})
