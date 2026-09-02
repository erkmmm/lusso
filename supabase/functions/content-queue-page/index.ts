import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// One queued page, fetched for preview — with its images.
//
// The page exists only as HTML on the private `queue` branch — it has not been
// published, so there is no URL to point an iframe at. This reads the file the
// commit added and hands back the markup for the CRM to render.
//
// Its photos are in the same boat: committed to `queue`, absent from the live
// site, so a relative <img src> resolves to a 404 and the page previews as a
// column of gaps. Since the whole point of the preview is deciding whether a
// photo is the right one, the images have to come too — inlined as data URIs,
// because an iframe rendering srcDoc under `sandbox=""` cannot authenticate to
// a private repo and the CRM must not hand it a token that could.
//
// Kept out of content-queue-status because that is called on every page load
// and this is called only when someone asks to read something. Different
// cadence, different blast radius if it breaks.

const REPO = "erkmmm/LussoWebite"

// Budget for the inlined photos. Base64 costs a third on top of the bytes, and
// this whole thing comes back as one JSON body, so the cap is on the encoded
// size. Eight photos at the 400w variant is ~370KB in practice; 6MB is room for
// a page far heavier than anything written so far, and still a response that
// arrives rather than one that times out.
const IMAGE_BUDGET = 6 * 1024 * 1024
const FETCH_CONCURRENCY = 6

const MIME: Record<string, string> = {
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", gif: "image/gif",
}
const EXT = Object.keys(MIME).join("|")

// A relative asset path, and only a relative one: the preceding character has to
// be a quote, whitespace or `(`. That is what keeps the absolute og:image URL
// (…lusso.com.au/assets/img/og-….jpg) out of the set — its `assets` is preceded
// by a slash. Those already resolve on the live domain via <base>, and an
// og:image never renders in the frame anyway.
const REF_RE = new RegExp(`(?<=["'\\s(])((?:\\./)?assets/[A-Za-z0-9._/-]+\\.(?:${EXT}))`, "gi")

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

// Enough to know what you are looking at before the render arrives — and the
// two fields most worth checking before a page goes live.
const tag = (html: string, re: RegExp) => html.match(re)?.[1]?.trim() ?? null;

// Every size of one photo is one photo. The build writes `<name>-<width>.webp`
// per variant, so stripping the width suffix groups them — and the preview then
// needs to carry only the narrowest of each, not all five.
const variant = (path: string) => {
  const m = path.match(new RegExp(`^(.*)-(\\d+)\\.(${EXT})$`, "i"))
  return m
    ? { base: `${m[1]}.${m[3]}`.toLowerCase(), width: Number(m[2]) }
    : { base: path.toLowerCase(), width: Number.POSITIVE_INFINITY }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++
      out[n] = await fn(items[n])
    }
  }))
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const token = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
  if (!token) return json({ ok: false, error: "SEO_REPO_TOKEN not set" })

  const { sha } = await req.json().catch(() => ({}))
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha ?? ""))) {
    return json({ ok: false, error: "a commit sha is required" }, 400)
  }

  const gh = (path: string) =>
    fetch(`https://api.github.com/repos/${REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lusso-crm",
      },
    })

  // Which file did this commit add? The commit message names the page in prose,
  // not in a form you can turn into a filename, so ask git rather than guess.
  const cr = await gh(`/commits/${sha}`)
  if (!cr.ok) {
    const d = await cr.json().catch(() => ({}))
    return json({ ok: false, error: `github ${cr.status}${d?.message ? `: ${d.message}` : ""}` })
  }
  const commit = await cr.json()
  const page = (commit.files ?? []).find((f: { filename: string; status: string }) =>
    f.status === "added" && f.filename.endsWith(".html") && !f.filename.includes("/"))
  if (!page) return json({ ok: false, error: "that commit adds no top-level page" })

  const fr = await gh(`/contents/${encodeURI(page.filename)}?ref=queue`)
  if (!fr.ok) {
    const d = await fr.json().catch(() => ({}))
    return json({ ok: false, error: `github ${fr.status}${d?.message ? `: ${d.message}` : ""}` })
  }
  const file = await fr.json()
  // atob mangles anything non-ASCII; these pages carry em dashes and curly
  // quotes, so decode the bytes as UTF-8 rather than trusting atob alone.
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))
  let html = new TextDecoder("utf-8").decode(bytes)
  // Read the metadata off the untouched markup. Everything below rewrites the
  // document for display, and a word count taken after a few hundred kilobytes
  // of base64 have been spliced in is a count of the wrong thing.
  const source = html

  // ---- inline the photos ------------------------------------------------

  const refs = [...new Set((source.match(REF_RE) ?? []).map((p) => p.replace(/^\.\//, "")))]

  // One entry per photo, pointing at its narrowest variant. Narrowest because
  // this is a judgement call about subject and framing, not a proof; a 400w
  // webp answers "is that the right photo" for a twentieth of the bytes.
  const groups = new Map<string, { pick: string; width: number; paths: string[] }>()
  for (const path of refs) {
    const { base, width } = variant(path)
    const g = groups.get(base)
    if (!g) groups.set(base, { pick: path, width, paths: [path] })
    else {
      g.paths.push(path)
      if (width < g.width) { g.pick = path; g.width = width }
    }
  }

  let budget = IMAGE_BUDGET
  const fetched = await mapLimit([...groups.values()], FETCH_CONCURRENCY, async (g) => {
    const ext = g.pick.split(".").pop()!.toLowerCase()
    const r = await gh(`/contents/${encodeURI(g.pick)}?ref=queue`).catch(() => null)
    if (!r?.ok) return { g, uri: null as string | null, cost: 0 }
    const f = await r.json().catch(() => null)
    // Over 1MB the contents endpoint returns metadata with an empty body and
    // expects a blob fetch instead. A preview thumbnail that large is a sign the
    // page references only its full-size original, which is not worth a second
    // round trip — it stays a gap and the count below says so.
    if (!f || f.encoding !== "base64" || !f.content) return { g, uri: null as string | null, cost: 0 }
    const b64 = f.content.replace(/\n/g, "")
    return { g, uri: `data:${MIME[ext] ?? "application/octet-stream"};base64,${b64}`, cost: b64.length }
  })

  // Data URIs contain commas, and srcset is a comma-separated list — leaving the
  // attribute in place would hand the browser a syntactically broken candidate
  // list and it would render nothing at all. So the responsive machinery comes
  // out and the single inlined variant is what shows. Same reason for the
  // preload hints, which point at variants that are no longer referenced.
  html = html
    .replace(/<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']image["'][^>]*>/gi, "")
    .replace(/\s(?:srcset|imagesrcset|sizes)\s*=\s*"[^"]*"/gi, "")
    .replace(/\s(?:srcset|imagesrcset|sizes)\s*=\s*'[^']*'/gi, "")

  let inlined = 0, missing = 0, imageBytes = 0
  for (const { g, uri, cost } of fetched) {
    if (!uri || (cost ?? 0) > budget) { missing++; continue }
    budget -= cost ?? 0
    imageBytes += cost ?? 0
    inlined++
    // Every variant of this photo maps to the one we carried, so whichever
    // width survived in the `src` still resolves.
    //
    // `./foo` before `foo`, not after: the bare path is a substring of the
    // dot-slash form, so doing it the other way round rewrites the tail and
    // leaves `./data:image/webp;…` behind — a relative URL that resolves against
    // <base> and 404s, which is exactly the gap this function exists to close.
    for (const p of g.paths) {
      html = html.split(`./${p}`).join(uri)
      html = html.split(p).join(uri)
    }
  }

  return json({
    ok: true,
    filename: page.filename,
    title: tag(source, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: tag(source, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    words: source.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
    images: { inlined, missing, bytes: imageBytes },
    html,
  })
})
