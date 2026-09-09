import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderPage } from "../_shared/render.ts"

// Publish one page, in any order.
//
// The drip could only ever publish oldest-first, because it fast-forwards `main`
// along `queue` and git history is linear -- to publish the 24th page you must
// publish the 23 in front of it. Cherry-picking is not a way out either: the
// queued commits all touch blog.html, sitemap.xml, CREDITS.md and the image
// manifest, so replaying them out of order conflicts immediately.
//
// So this does not move history at all. It copies the FILES that make up one
// page -- its .html and its own images -- from `queue` onto `main` as a single
// new commit. File-level, order-free, conflict-free.
//
// The shared aggregates are deliberately NOT copied. queue's blog.html lists
// cards for pages that are not live yet, and its sitemap.xml names URLs that
// would 404; taking either wholesale would publish broken links. They are
// patched from main's own copy instead.
//
// Consequence worth being explicit about: once main carries a commit of its own,
// `git merge-base --is-ancestor origin/main origin/queue` is false, and
// drip-publish.yml aborts with "queue has diverged". That is expected -- this
// replaces the drip rather than running beside it.

const REPO = "erkmmm/LussoWebite"
// drip-publish.yml refuses any other author: "Vercel blocks the deploy with
// 'Deployment was blocked' and no build log". Same rule applies to us.
const AUTHOR = { name: "Jett Hopkins", email: "hopkinsjett@gmail.com" }

// Files every page commit touches, which must never be copied wholesale.
const SHARED = new Set([
  "blog.html", "sitemap.xml", "image-manifest.csv", "image-contact-sheet.html",
  "assets/img/CREDITS.md", "assets/img/GENERATED.md",
  "Keywords.csv", "Service_keywords.csv", ".gitignore",
  "AGENTS.md", "CLAUDE.md", "README.md",
])
const isShared = (p: string) =>
  SHARED.has(p) || p.startsWith("references/") || p.startsWith("scripts/") ||
  p.startsWith("seo-reports/") || p.startsWith("templates/") ||
  p.startsWith("keyword-cluster-") || p.startsWith(".claude/")


/** Read a text file from a branch. */
async function readText(gh: (p: string, i?: RequestInit) => Promise<Record<string, unknown>>,
                        path: string, ref: string): Promise<string | null> {
  try {
    const meta = await gh(`/contents/${encodeURI(path)}?ref=${ref}`) as { content?: string }
    if (!meta.content) return null
    return new TextDecoder().decode(
      Uint8Array.from(atob(String(meta.content).replace(/\n/g, "")), c => c.charCodeAt(0)))
  } catch { return null }
}

const pick = (html: string, re: RegExp) => (html.match(re) ?? [])[1] ?? ""

/**
 * The card for blog.html, built from the page's own markup.
 *
 * Reading the rendered page rather than the database row is what lets this work
 * for the backlog too: those pages were written on the Mac and have no row worth
 * trusting, but every one of them carries its title, description, hero and read
 * time in its own head.
 */
function buildCard(pageHtml: string, slug: string, category: string, isService = false) {
  const title = pick(pageHtml, /<title>([^<]*)<\/title>/).replace(/\s*\|\s*Lusso\s*$/, "")
  const desc  = pick(pageHtml, /<meta name="description" content="([^"]*)"/)
  const alt   = pick(pageHtml, /<meta property="og:image:alt" content="([^"]*)"/) || title
  const when  = pick(pageHtml, /<time[^>]*>([^<]*)<\/time>/)
    || pick(pageHtml, /"datePublished":\s*"([^"]*)"/)
  const read  = pick(pageHtml, /(\d+)\s*min read/) || "6"

  // The hero, stepped down to the width the card grid actually renders.
  const hero  = pick(pageHtml, /<img src="(assets\/img\/[^"]+)"[^>]*fetchpriority="high"/)
  const stem  = hero.replace(/-\d+\.webp$/, "")
  const media = stem
    ? `<img src="${stem}-1200.webp" alt="${alt}" loading="lazy" width="1200" height="800" `
      + `srcset="${stem}-400.webp 400w, ${stem}-800.webp 800w, ${stem}-1200.webp 1200w" `
      + `sizes="(max-width: 720px) 100vw, (max-width: 1024px) 50vw, 33vw">`
    : ""

  // A service page is not dated content -- "6 min read" on a page selling a
  // measure and quote is the wrong promise, so it carries the lead time the
  // rest of services.html carries.
  const meta = isService
    ? `Made to measure <span class="dot"></span> 2&ndash;4 weeks`
    : `${when} <span class="dot"></span> ${read} min read`
  const more = isService ? "See the range" : "Read more"

  return `      <a class="card reveal"${isService ? ` id="${slug}"` : ""} data-cat="${category.toLowerCase()}" href="${slug}.html">
        <div class="card__media">
          ${media}
          <span class="card__tag">${category}</span>
        </div>
        <div class="card__body">
          <p class="card__meta">${meta}</p>
          <h3 class="card__title">${title}</h3>
          <p class="card__excerpt">${desc}</p>
          <span class="card__more">${more} <svg class="arw" width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true"><path d="M1 5h11M8.5 1.5L12 5l-3.5 3.5" stroke="currentColor" stroke-width="1.4"/></svg></span>
        </div>
      </a>
`
}


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "Unauthorized" }, 401)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: "Unauthorized" }, 401)

  const token = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
  if (!token) return json({ error: "SEO_REPO_TOKEN is not set" })

  const gh = async (path: string, init?: RequestInit) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "User-Agent": "lusso-crm",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      throw new Error(`github ${r.status}${d?.message ? `: ${d.message}` : ""}`)
    }
    return r.json()
  }

  const body = await req.json().catch(() => ({}))
  const action = ["sync-queue", "preview", "delete"].includes(body?.action) ? body.action : "post"

  // ── Delete ────────────────────────────────────────────────────────────────
  // A queued page is a FILE on the `queue` branch, not just a row. Removing the
  // row alone would take it out of the app while leaving the page sitting in
  // the site's queue, still publishable by anything that walks the branch --
  // a delete that does not delete. So the file goes too.
  //
  // A published page is deliberately NOT removed from the site: taking a live
  // URL down is a different decision with SEO consequences, and it should be
  // made on purpose rather than as a side effect of tidying the list.
  if (action === "delete") {
   try {
    const { data: p } = await supabase.from("content_posts")
      .select("id, slug, status, title, meta").eq("id", String(body?.postId ?? "")).maybeSingle()
    if (!p) return json({ error: "no such page" }, 404)

    let removedFile: string | null = null
    const path = (p.meta?.committed_path as string) ?? (p.slug ? `${p.slug}.html` : null)

    if (p.status === "queued" && path) {
      // Needs the file's current sha; GitHub refuses a delete without it.
      const existing = await gh(`/contents/${encodeURI(path)}?ref=queue`).catch(() => null) as
        { sha?: string } | null
      if (existing?.sha) {
        await gh(`/contents/${encodeURI(path)}`, {
          method: "DELETE",
          body: JSON.stringify({
            message: `Remove the ${p.title ?? p.slug} page from the queue`,
            sha: existing.sha, branch: "queue",
            author: AUTHOR, committer: AUTHOR,
          }),
        })
        removedFile = path
      }
    }

    // Soft delete: every list already filters on deleted_at, and a row kept is
    // a row that can be looked at when someone asks what happened to a page.
    const { error } = await admin.from("content_posts")
      .update({ deleted_at: new Date().toISOString() }).eq("id", p.id)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, removedFile, wasStatus: p.status })
   } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 200)
   }
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  // The exact bytes that would be committed -- not an approximation of them.
  // A page already on the branch is returned as-is; one still a draft is put
  // through the same renderPage() the publisher uses, so what is reviewed and
  // what ships cannot drift apart.
  if (action === "preview") {
    try {
      const { data: p } = await supabase.from("content_posts")
        .select("id, slug, title, kind, status, body_html, meta, external_id")
        .eq("id", String(body?.postId ?? "")).maybeSingle()
      if (!p) return json({ error: "no such page" }, 404)

      const branch = p.status === "published" ? "main" : "queue"
      const onBranch = p.slug ? await readText(gh, `${p.slug}.html`, branch) : null
      if (onBranch) return json({ ok: true, html: onBranch, from: branch })

      // Not committed yet: render it the way the publisher will.
      const templatePath = p.kind === "service"
        ? "templates/service-page.html" : "templates/blog-post.html"
      const template = await readText(gh, templatePath, "main")
      if (!template) return json({ error: `could not read ${templatePath}` })

      const imgs = await gh(`/contents/assets/img?ref=main`) as { name: string }[]
      const heroes = (imgs ?? []).map(f => f.name)
        .filter(n => n.endsWith("-1900x1267-1900.webp"))

      const { html, unfilled } = renderPage({
        template,
        title: p.title ?? "Untitled",
        slug: p.slug ?? "preview",
        description: (p.meta?.description as string) ?? "",
        bodyHtml: p.body_html ?? "",
        keyword: (p.meta?.keyword as string) ?? "",
        heroes,
        publishedAt: new Date(),
      })
      return json({ ok: true, html, from: "rendered", unfilled })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Bring the branch's pages into the list ────────────────────────────────
  // Every page waiting on `queue` becomes a row, so the app can offer the same
  // actions on the backlog as on anything it wrote itself.
  if (action === "sync-queue") {
   try {
    const cmp = await gh(`/compare/main...queue`)
    const commits = (cmp.commits ?? []) as { sha: string; commit: { message: string } }[]

    // Concurrently: one round trip per commit, done in sequence, is roughly
    // forty of them and overruns the function's wall clock. The whole point of
    // asking per commit is to learn which page each one added.
    const details = await Promise.all(
      commits.map(c => gh(`/commits/${c.sha}`).then(d => ({ c, d })).catch(() => null)))

    const rows: Record<string, unknown>[] = []
    for (const entry of details) {
      if (!entry) continue
      const { c, d } = entry
      const added = (d.files ?? [])
        .filter((f: { status: string; filename: string }) =>
          f.status === "added" && /^[a-z0-9-]+\.html$/.test(f.filename))
        .map((f: { filename: string }) => f.filename)
      for (const file of added) {
        const slug = file.replace(/\.html$/, "")
        const subject = String(c.commit.message).split("\n")[0]
        rows.push({
          slug,
          title: subject.replace(/^Add (the )?/i, "").replace(/\s+(post|service page|page)$/i, ""),
          channel: "web",
          kind: /service page$/i.test(subject) ? "service" : "blog",
          status: "queued",
          external_id: c.sha,
          meta: { source: "repo", committed_path: file },
        })
      }
    }
    // Filter against what exists rather than upserting on conflict: the slug
    // index is PARTIAL (`where channel = 'web' and deleted_at is null`), and
    // Postgres cannot infer a partial index as an ON CONFLICT target -- it fails
    // with 42P10, "no unique or exclusion constraint matching the ON CONFLICT
    // specification". Reading first also makes the intent plainer: a page this
    // app already owns must keep its body, its keyword and its history.
    const { data: existing } = await admin
      .from("content_posts").select("slug").is("deleted_at", null)
    const have = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
    const fresh = rows.filter(r => !have.has(r.slug as string))

    if (fresh.length) {
      const { error } = await admin.from("content_posts").insert(fresh)
      if (error) return json({ error: error.message }, 500)
    }
    return json({ ok: true, found: rows.length, added: fresh.length })
   } catch (e) {
    // Without this the throw from gh() became a bare 500 with nothing in the
    // logs, which is the failure mode this whole project keeps trying to avoid.
    return json({ error: e instanceof Error ? e.message : String(e) }, 200)
   }
  }

  // ── Publish one page ──────────────────────────────────────────────────────
  const postId = String(body?.postId ?? "")
  if (!postId) return json({ error: "postId required" }, 400)

  const { data: post } = await supabase
    .from("content_posts").select("id, status, title, slug, external_id, channel, meta")
    .eq("id", postId).maybeSingle()
  if (!post) return json({ error: "no such page" }, 404)
  if (post.channel !== "web") return json({ error: "that is not a web page" }, 400)
  if (post.status === "published") return json({ ok: true, alreadyLive: true })

  const fail = async (msg: string) => {
    await admin.from("content_posts")
      .update({ status: "failed", publish_error: msg.slice(0, 500) }).eq("id", postId)
    return json({ ok: false, error: msg })
  }

  try {
    const slug = post.slug
    if (!slug) return await fail("this page has no slug")
    const pageFile = `${slug}.html`

    // Where the page's files live. A page written in this app is committed to
    // queue by content-publish; a page from the backlog was committed there by
    // the Mac. Either way `queue` is the source.
    const src = "queue"

    // Everything that commit added or changed, minus the shared aggregates.
    let files: string[] = [pageFile]
    if (post.external_id) {
      const detail = await gh(`/commits/${post.external_id}`)
      files = (detail.files ?? [])
        .filter((f: { status: string; filename: string }) => f.status !== "removed")
        .map((f: { filename: string }) => f.filename)
        .filter((f: string) => !isShared(f))
      if (!files.includes(pageFile)) files.push(pageFile)
    }

    // The cluster note rides along. It is committed separately from the page,
    // so it is never in the page commit's file list -- named explicitly here or
    // it stays on queue forever while its page goes live.
    const notePath = `keyword-cluster-${slug}.md`
    if (!files.includes(notePath)) files.push(notePath)

    // Build a tree on top of main carrying those files at their queue contents.
    const mainRef = await gh(`/git/ref/heads/main`)
    const baseSha = mainRef.object.sha
    const baseCommit = await gh(`/git/commits/${baseSha}`)

    const tree: Record<string, string>[] = []
    for (const path of files) {
      // Read the blob sha from the queue side rather than the content: images
      // are megabytes, and a sha reference costs nothing to move.
      const meta = await gh(`/contents/${encodeURI(path)}?ref=${src}`)
        .catch(() => null) as { sha?: string } | null
      if (!meta?.sha) continue
      tree.push({ path, mode: "100644", type: "blob", sha: meta.sha })
    }
    if (!tree.some(t => t.path === pageFile)) {
      return await fail(`${pageFile} is not on the ${src} branch`)
    }

    // ── Listings ────────────────────────────────────────────────────────────
    // A page nobody links to is a page Google finds slowly and readers never
    // find at all. blog.html and sitemap.xml are patched from MAIN's copies --
    // never taken from queue, whose versions already name pages that are not
    // live and would ship links straight to a 404.
    const pageHtml = await readText(gh, pageFile, src)
    const blobs: { path: string; content: string }[] = []

    if (pageHtml) {
      const category = post.kind === "service" ? "Services" : "Guides"

      const isService = post.kind === "service"

      // Services belong on services.html, posts on blog.html. Putting a service
      // page in the journal was the previous behaviour and it was wrong twice
      // over: readers would not find it, and the journal would date it.
      const listing = isService ? "services.html" : "blog.html"
      const page = await readText(gh, listing, "main")
      if (page && !page.includes(`href="${slug}.html"`)) {
        const card = buildCard(pageHtml, slug, category, isService)
        if (isService) {
          // Appended, not prepended: services.html is an ordered range, not a
          // feed, and the first card is the one the page leads with.
          const grid = page.indexOf('<div class="cards">')
          const end = grid === -1 ? -1 : page.indexOf("\n    </div>", grid)
          if (end !== -1) {
            blobs.push({ path: listing,
              content: page.slice(0, end + 1) + card + page.slice(end + 1) })
          }
        } else {
          // Newest first: in front of the first card in the grid.
          const at = page.indexOf('<a class="card')
          if (at !== -1) {
            const lineStart = page.lastIndexOf("\n", at) + 1
            blobs.push({ path: listing,
              content: page.slice(0, lineStart) + card + page.slice(lineStart) })
          }
        }
      }

      // The homepage "Popular pages" nav is how a service page gets a link from
      // the strongest page on the site. Blog posts reach the homepage through
      // blog.html instead, so they are not added here.
      if (isService) {
        const home = await readText(gh, "index.html", "main")
        const nav = home?.indexOf('<nav class="quicklinks reveal" aria-label="Popular pages">') ?? -1
        if (home && nav !== -1 && !home.includes(`href="${slug}.html"`)) {
          const close = home.indexOf("</nav>", nav)
          if (close !== -1) {
            const title = pick(pageHtml, /<title>([^<]*)<\/title>/).replace(/\s*\|\s*Lusso\s*$/, "")
            const link = `      <a href="${slug}.html">${title} <span aria-hidden="true">&rarr;</span></a>\n`
            blobs.push({ path: "index.html",
              content: home.slice(0, close) + link + "    " + home.slice(close) })
          }
        }
      }

      const sitemap = await readText(gh, "sitemap.xml", "main")
      const loc = `https://www.lusso.com.au/${slug}.html`
      if (sitemap && !sitemap.includes(loc)) {
        const entry = `  <url>\n    <loc>${loc}</loc>\n`
          + `    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n`
          + `    <changefreq>monthly</changefreq>\n`
          + `    <priority>${post.kind === "service" ? "0.8" : "0.5"}</priority>\n  </url>\n`
        blobs.push({ path: "sitemap.xml",
          content: sitemap.replace("</urlset>", entry + "</urlset>") })
      }
    }

    // Text files go in as content; the page and its images ride in as blob shas.
    for (const b of blobs) {
      tree.push({ path: b.path, mode: "100644", type: "blob", content: b.content } as unknown as Record<string, string>)
    }

    const newTree = await gh(`/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    })

    const commit = await gh(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Publish ${post.title ?? slug}`,
        tree: newTree.sha,
        parents: [baseSha],
        author: AUTHOR, committer: AUTHOR,
      }),
    })

    await gh(`/git/refs/heads/main`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })

    await admin.from("content_posts").update({
      status: "published",
      published_at: new Date().toISOString(),
      publish_error: null,
      meta: { ...(post.meta ?? {}), published_commit: commit.sha },
    }).eq("id", postId)

    return json({ ok: true, published: slug, commit: commit.sha, files: tree.length })
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e))
  }
})
