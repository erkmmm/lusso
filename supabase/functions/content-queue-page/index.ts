import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// One queued page, fetched for preview.
//
// The page exists only as HTML on the private `queue` branch — it has not been
// published, so there is no URL to point an iframe at. This reads the file the
// commit added and hands back the markup for the CRM to render.
//
// Kept out of content-queue-status because that is called on every page load
// and this is called only when someone asks to read something. Different
// cadence, different blast radius if it breaks.

const REPO = "erkmmm/LussoWebite"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

// Enough to know what you are looking at before the render arrives — and the
// two fields most worth checking before a page goes live.
const tag = (html: string, re: RegExp) => html.match(re)?.[1]?.trim() ?? null;

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

  const fr = await gh(`/contents/${page.filename}?ref=queue`)
  if (!fr.ok) {
    const d = await fr.json().catch(() => ({}))
    return json({ ok: false, error: `github ${fr.status}${d?.message ? `: ${d.message}` : ""}` })
  }
  const file = await fr.json()
  // atob mangles anything non-ASCII; these pages carry em dashes and curly
  // quotes, so decode the bytes as UTF-8 rather than trusting atob alone.
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))
  const html = new TextDecoder("utf-8").decode(bytes)

  return json({
    ok: true,
    filename: page.filename,
    title: tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: tag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    words: html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
    html,
  })
})
