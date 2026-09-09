/**
 * Keeps content_keywords current without anyone exporting a CSV by hand.
 *
 * Two sources, deliberately:
 *
 *   "repo" -- the Semrush exports already committed to the site repo
 *             (Keywords.csv, Service_keywords.csv). Real Semrush data, already
 *             paid for, and it works today.
 *   "api"  -- the live Semrush Analytics API. Better, because it refreshes.
 *
 * The API is the default and the repo is the fallback, because as of
 * 2026-09-01 the account's API units are exhausted -- every call returns
 * "does not have enough API units". That is reported, never swallowed: a sync
 * that silently imported stale CSVs while the caller believed it had pulled
 * live figures would be worse than one that failed.
 */
import { createClient } from "jsr:@supabase/supabase-js@2"

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json",
               "Access-Control-Allow-Origin": "*",
               "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" },
  })

const SEEDS_BLOG = ["blinds", "curtains"]
const SEEDS_SERVICE = ["window furnishing", "blinds installation"]

/**
 * Where the business actually drives. Used to pull QUESTIONS containing a place
 * name -- the gap in the current data is not that local keywords rank badly,
 * it is that the blog export contains two of them and both say "australia".
 */
const LOCAL_AREAS = ["gold coast", "brisbane", "tweed heads", "burleigh heads"]

/** Semrush answers 200 with a plain-text ERROR line; each needs its own advice. */
function semrushAdvice(err: string): string {
  // Checked 2026-09-04 against the account: API Units: 0, and Semrush sells
  // units to Business plans only. Keyword discovery (phrase_related,
  // phrase_questions) is v3-only, while the keys the account can now create are
  // v4, which v3 rejects -- Semrush retired the separate v3 key page. Both roads
  // are shut on a Pro plan, so this says so rather than sending someone back to
  // re-enter a key that cannot help.
  if (/ERROR 12[02]/.test(err) || /WRONG FORMAT OR EMPTY KEY/i.test(err)) {
    return "Semrush rejected the key. Keyword discovery is a v3 API and the account's keys "
         + "are v4, which v3 does not accept -- and the account has 0 API units, which only "
         + "Business plans can buy. Export from the Keyword Magic Tool instead and use "
         + "\"Import a Semrush CSV\"."
  }
  if (/API units|NOT ENOUGH/i.test(err)) {
    return "the Semrush account has no API units left, and only Business plans can buy them -- "
         + "export from the Keyword Magic Tool and use \"Import a Semrush CSV\" instead"
  }
  if (/NOTHING FOUND/i.test(err)) return "Semrush has no data for that phrase"
  return err
}

type Row = {
  keyword: string; volume: number | null; difficulty: number | null
  cpc: number | null; intent: string | null; seed: string | null
  tags: string | null; kind: string
}

/** Semrush CSVs quote any field containing a comma, and every row here has one. */
function parseCsv(text: string, kind: string): Row[] {
  const rows: string[][] = []
  let cur: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") { cur.push(field); field = "" }
    else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = "" }
    else if (c !== "\r") field += c
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  if (!rows.length) return []

  const head = rows[0].map(h => h.trim().toLowerCase())
  const at = (r: string[], name: string) => {
    const i = head.indexOf(name)
    return i === -1 ? "" : (r[i] ?? "").trim()
  }
  const num = (v: string) => {
    // Number("") is 0, not NaN -- so without this guard an empty cell became a
    // hard zero rather than "not stated", which is how every unrefreshed
    // Keyword Difficulty ended up looking like the easiest keyword in the table.
    const cleaned = (v ?? "").replace(/[^0-9.\-]/g, "").trim()
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  const out: Row[] = []
  for (const r of rows.slice(1)) {
    const keyword = at(r, "keyword").toLowerCase()
    if (!keyword) continue
    out.push({
      keyword,
      volume: num(at(r, "volume")),
      // NULL, not 0, when the column is blank. Semrush leaves it empty when the
      // metric has not been refreshed, and 0 is a legitimate value it also
      // reports -- collapsing the two made "we don't know how hard this is"
      // indistinguishable from "this is the easiest keyword in the table", and
      // scored it accordingly.
      difficulty: num(at(r, "keyword difficulty")),
      cpc: num(at(r, "cpc (usd)") || at(r, "cpc (aud)")),
      intent: at(r, "intent") || null,
      seed: at(r, "seed keyword") || null,
      tags: at(r, "tags") || null,
      kind,
    })
  }
  return out
}

/**
 * Semrush's Analytics API answers in its own semicolon-delimited format, not
 * JSON, and signals errors with a plain-text body and a 200.
 */
function parseSemrush(body: string): Record<string, string>[] {
  const lines = body.trim().split("\n")
  if (!lines.length) return []
  if (/^ERROR\b/i.test(lines[0])) throw new Error(lines[0].trim())
  const head = lines[0].split(";").map(h => h.trim())
  return lines.slice(1).map(l => {
    const cells = l.split(";")
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]))
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: { "Access-Control-Allow-Origin": "*",
               "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } })

  const url = Deno.env.get("SUPABASE_URL")!
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const body = await req.json().catch(() => ({}))

  // Two callers: pg_cron with the shared token, and a signed-in user pressing
  // the button. Same shape as content-publish.
  const { data: cfg } = await admin.from("internal_notify_config").select("token").eq("id", 1).maybeSingle()
  const viaToken = body?.token && cfg?.token && body.token === cfg.token
  if (!viaToken) {
    const auth = req.headers.get("Authorization")
    if (!auth) return json({ error: "not signed in" }, 401)
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await asUser.auth.getUser()
    if (!user) return json({ error: "not signed in" }, 401)
  }

  const wanted: string = body?.source ?? "auto"     // auto | api | repo
  const notes: string[] = []
  let rows: Row[] = []
  let used = ""

  // ── live API ────────────────────────────────────────────────────────────
  if (wanted === "api" || wanted === "auto") {
    const key = Deno.env.get("SEMRUSH_API_KEY")?.trim().replace(/^['"]|['"]$/g, "")
    if (!key) {
      notes.push("SEMRUSH_API_KEY is not set")
    } else {
      try {
        type Call = { type: string; phrase: string; kind: string; tags: string | null
                      columns: string; filter?: string }
        const calls: Call[] = []

        // Broad related terms, as before.
        for (const seed of SEEDS_BLOG)
          calls.push({ type: "phrase_related", phrase: seed, kind: "blog",
                       tags: null, columns: "Ph,Nq,Cp,Kd,In" })
        for (const seed of SEEDS_SERVICE)
          calls.push({ type: "phrase_related", phrase: seed, kind: "service",
                       tags: null, columns: "Ph,Nq,Cp,Kd,In" })

        // The point of this pass: questions that name a place we serve. These
        // are the local blog topics the CSV export has none of. Kd is not an
        // available column on phrase_questions, so it is not requested -- a
        // rejected column fails the whole call.
        for (const area of LOCAL_AREAS) {
          for (const product of ["blinds", "curtains"]) {
            calls.push({
              type: "phrase_questions", phrase: product, kind: "blog",
              tags: "local", columns: "Ph,Nq,Cp,Co,Nr",
              filter: `+|Ph|Co|${area}`,
            })
          }
        }

        for (const c of calls) {
          const q = new URLSearchParams({
            type: c.type, key, phrase: c.phrase, database: "au",
            export_columns: c.columns, display_limit: "200", display_sort: "nq_desc",
          })
          if (c.filter) q.set("display_filter", c.filter)

          const res = await fetch(`https://api.semrush.com/?${q}`)
          const text = await res.text()
          let parsed: Record<string, string>[]
          try {
            parsed = parseSemrush(text)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            // "nothing found" on one filtered question call is normal and must
            // not abandon the whole sync; a bad key or no units must.
            if (/NOTHING FOUND/i.test(msg)) { notes.push(`${c.type} ${c.phrase}: no data`); continue }
            throw new Error(msg)
          }
          for (const r of parsed) {
            const kw = (r["Keyword"] ?? "").toLowerCase()
            if (!kw) continue
            rows.push({
              keyword: kw,
              volume: Number(r["Search Volume"]) || null,
              // Absent on question rows. Left null rather than defaulted to 0,
              // which would read as "trivially easy" and outrank everything.
              difficulty: r["Keyword Difficulty Index"] !== undefined
                ? (Number(r["Keyword Difficulty Index"]) || 0) : null,
              cpc: Number(r["CPC"]) || null,
              // A question is informational by definition; Semrush does not
              // return an intent column on this report.
              intent: r["Intent"] ?? (c.type === "phrase_questions" ? "Informational" : null),
              seed: c.phrase, tags: c.tags, kind: c.kind,
            })
          }
        }
        used = "api"
      } catch (e) {
        // The units error is the expected one, and it must be visible.
        notes.push(`Semrush API: ${semrushAdvice(e instanceof Error ? e.message : String(e))}`)
        rows = []
      }
    }
  }

  // ── repo CSVs ───────────────────────────────────────────────────────────
  if (!rows.length && wanted !== "api") {
    const repoToken = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
    const repo = Deno.env.get("SEO_REPO") ?? "erkmmm/LussoWebite"
    // `queue`, not `main`. Keyword curation is editorial work in progress and
    // lives on the working branch -- the commit that tagged 72 export artefacts
    // do-not-target sat on queue unmerged, so reading main silently imported the
    // older, less-curated file and half the do-not-target tags vanished.
    const get = async (path: string) => {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=queue`, {
        headers: { Authorization: `Bearer ${repoToken}`, Accept: "application/vnd.github.raw",
                   "User-Agent": "lusso-crm" },
      })
      if (!r.ok) throw new Error(`could not read ${path} (github ${r.status})`)
      return await r.text()
    }
    try {
      // Local_questions.csv is the Keyword Magic Tool export of question
      // keywords naming a place we serve -- the gap the other two files have.
      // Read last so its curation wins on any keyword the blog file also holds.
      rows = [...parseCsv(await get("Keywords.csv"), "blog"),
              ...parseCsv(await get("Service_keywords.csv"), "service"),
              ...parseCsv(await get("Local_questions.csv"), "blog")]
      used = "repo"
      notes.push("used the Semrush exports committed to the site repo")
    } catch (e) {
      notes.push(`repo CSVs: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (!rows.length) return json({ ok: false, imported: 0, source: null, notes }, 502)

  // Last one wins on a duplicate keyword: the service file is more specific.
  const seen = new Map<string, Row>()
  for (const r of rows) seen.set(r.keyword, r)
  const unique = [...seen.values()]

  // upsert, not insert-ignore: a fresher pull should correct last quarter's
  // volume. used_at and excluded are absent on purpose -- those are decisions a
  // sync must never overwrite.
  let imported = 0
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500)
    const { error } = await admin.from("content_keywords")
      .upsert(chunk, { onConflict: "keyword" })
    if (error) return json({ ok: false, imported, source: used, notes: [...notes, error.message] }, 500)
    imported += chunk.length
  }

  // Anything a live page already targets is spent, so the writer stops
  // offering it. Matched on the keyword recorded when the page was written.
  const { data: usedKw } = await admin.from("content_posts")
    .select("id, meta").not("meta->>keyword", "is", null).is("deleted_at", null)
  for (const p of usedKw ?? []) {
    const k = (p.meta as { keyword?: string })?.keyword
    if (!k) continue
    await admin.from("content_keywords")
      .update({ used_at: new Date().toISOString(), used_by: p.id })
      .eq("keyword", k.toLowerCase()).is("used_at", null)
  }

  // Payload vs stored, so a mismatch like the branch mix-up above is visible
  // in the result instead of needing a five-step investigation to find.
  const taggedInPayload = unique.filter(r => r.tags).length
  const { count: taggedInDb } = await admin.from("content_keywords")
    .select("keyword", { count: "exact", head: true }).not("tags", "is", null)

  return json({ ok: true, imported, source: used, notes,
                diag: { taggedInPayload, taggedInDb } })
})
