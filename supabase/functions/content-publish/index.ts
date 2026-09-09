import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { renderPage } from "../_shared/render.ts"
import { auditContent } from "../_shared/audit.ts"
import { clusterFile } from "../_shared/cluster.ts"
import { approvedStems, indexImages, resolveImageSlots } from "../_shared/images.ts"

// Putting a social post live.
//
// Called only by publish_due() over pg_net, never by a browser -- so it
// authenticates with the shared notify token rather than a user session, the
// same way push-send does. Web pages never reach here: publishing one is an
// UPDATE the database does itself.
//
// Instagram is two calls, not one, and they are not interchangeable: you create
// a media CONTAINER, then publish that container. There is also no scheduling in
// the Graph API -- "post at 2pm" is our cron calling this at 2pm.
//
// Every exit writes the row. A social post that fails silently is worse than one
// that never sent, because the queue moves on and nobody looks again.

const GRAPH = "https://graph.facebook.com/v21.0"

// The site's repo. A page is a file on the `queue` branch; drip-publish.yml
// fast-forwards `main` over it on the timetable in drip-schedule.json.
const REPO = "erkmmm/LussoWebite"

// drip-publish.yml refuses any commit not authored by this address --
// "Vercel blocks the deploy with 'Deployment was blocked' and no build log".
// So the author is not cosmetic: get it wrong and the page silently never ships.
const COMMIT_AUTHOR = { name: "Jett Hopkins", email: "hopkinsjett@gmail.com" }

const b64encode = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const b64decode = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)))

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const body = await req.json().catch(() => ({}))
  const { token, postId } = body ?? {}

  // Same door push-send uses. Compared against the stored token rather than an
  // env var so rotating it is a database update, not a redeploy.
  const { data: cfg } = await admin
    .from("internal_notify_config").select("token").eq("id", 1).maybeSingle()
  if (!token || !cfg?.token || token !== cfg.token) return json({ error: "forbidden" }, 403)
  if (!postId) return json({ error: "postId required" }, 400)

  // Service role bypasses RLS. Lusso is single-tenant, so there is no org
  // predicate to add -- the post id is the whole of the scoping.
  const { data: post } = await admin
    .from("content_posts")
    .select("id, channel, kind, slug, title, body_html, caption, images, meta, external_id, status")
    .eq("id", postId).maybeSingle()
  if (!post) return json({ error: "no such post" }, 404)

  // Already live. A retry after a dispatch that died between publishing and
  // recording it must not post a second time. Web rows are excluded: their
  // external_id is a commit sha, and re-committing an identical file is a
  // no-op, not a duplicate post.
  if (post.external_id && post.channel !== "web") {
    await admin.from("content_posts").update({
      status: "published", published_at: new Date().toISOString(), publish_error: null,
    }).eq("id", post.id)
    return json({ ok: true, alreadyPublished: true })
  }

  const fail = async (msg: string) => {
    await admin.from("content_posts")
      .update({ status: "failed", publish_error: msg.slice(0, 500) })
      .eq("id", post.id)
    return json({ ok: false, error: msg })
  }

  // ── Web pages ───────────────────────────────────────────────────────────
  // A page becomes a file on the `queue` branch, exactly like one written on the
  // Mac. It is NOT pushed to main here: `queue` has to stay a fast-forward of
  // `main` or drip-publish.yml aborts with "queue has diverged", and that would
  // strand every page already waiting on that branch. Adding to the tip of the
  // queue is the only safe place to write, so the drip stays the single thing
  // that moves main.
  if (post.channel === "web") {
    const token = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
    if (!token) return await fail("SEO_REPO_TOKEN is not set — cannot reach the site's repo")
    if (!post.slug) return await fail("this page has no slug")

    const gh = (path: string, init?: RequestInit) =>
      fetch(`https://api.github.com/repos/${REPO}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "lusso-crm",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      })

    try {
      const kind = post.kind === "service" ? "service" : "blog"
      const templatePath = kind === "service"
        ? "templates/service-page.html" : "templates/blog-post.html"

      // The template and the image list come from `main`, not from the queue:
      // main is what is actually deployed, so a page is built against the shell
      // the site is really serving.
      // The image listing comes from the git tree, not the contents API: there
      // are 2240 files in assets/img and the contents API stops at 1000, so the
      // old call was choosing heroes from a silently truncated pool.
      const [tplRes, imgRes, genRes] = await Promise.all([
        gh(`/contents/${templatePath}?ref=main`),
        gh(`/git/trees/main:assets%2Fimg`),
        gh(`/contents/assets/img/GENERATED.md?ref=main`),
      ])
      if (!tplRes.ok) throw new Error(`could not read ${templatePath} (github ${tplRes.status})`)
      const template = b64decode((await tplRes.json()).content)

      // Only the largest rendition of each hero; srcsetFor() derives the rest.
      const imgNames: string[] = imgRes.ok
        ? ((await imgRes.json())?.tree ?? [] as { path: string }[])
            .map((f: { path: string }) => f.path)
        : []
      const heroCandidates = imgNames.filter(n => n.endsWith("-1900x1267-1900.webp"))

      // Only what GENERATED.md vouches for. assets/img also holds stock
      // photography, and a stock photo on one of these pages is the one image
      // outcome that has already been rejected out loud.
      const approved = genRes.ok
        ? approvedStems(b64decode((await genRes.json()).content))
        : new Set<string>()
      const imgIndex = indexImages(imgNames)

      // The hero goes through the SAME approved filter as the body slots. It did
      // not before, and the first page out of the pipeline took a Pexels stock
      // photo as its hero while every in-body image was a proper render -- the
      // pool was 42 heroes, only 33 of them approved.
      const heroes = heroCandidates.filter(n => {
        const stem = n.replace(/^assets\/img\//, "").replace(/-1900x1267-1900\.webp$/, "")
        return approved.has(stem)
      })

      const fillSlots = (frag: string) => {
        if (!frag || !approved.size) return { html: frag, filled: 0, unresolved: [] as string[] }
        return resolveImageSlots(frag, imgIndex, approved)
      }

      const sfRaw = (post.meta?.service ?? {}) as Record<string, string>
      const slotErrors: string[] = []
      const runSlots = (frag: string) => {
        const r = fillSlots(frag)
        slotErrors.push(...r.unresolved)
        return r.html
      }

      const bodyFilled = runSlots(post.body_html ?? "")
      const serviceFilled = kind === "service"
        ? Object.fromEntries(Object.entries(sfRaw).map(([k, v]) =>
            [k, typeof v === "string" && v.includes("<img") ? runSlots(v) : v]))
        : null

      const { html, unfilled } = renderPage({
        template,
        title: post.title ?? "Untitled",
        slug: post.slug,
        description: (post.meta?.description as string) ?? "",
        bodyHtml: bodyFilled,
        keyword: (post.meta?.keyword as string) ?? post.slug.replace(/-/g, " "),
        faq: post.meta?.faq as { q: string; a: string }[] | undefined,
        heroes,
        publishedAt: new Date(),
        // Per-page if the Mac script has made one, the brand default otherwise.
        ogImage: imgNames.includes(`og-${post.slug}.jpg`)
          ? `og-${post.slug}.jpg` : "og-default.jpg",
        service: serviceFilled as never,
      })

      // A stray {{TOKEN}} would be visible to a reader on a live page. Refusing
      // is recoverable; publishing is not.
      if (unfilled.length) {
        return await fail(`the template still wants ${unfilled.join(", ")} — not published`)
      }

      // THE GATE. The skill is explicit that a failing page never gets
      // committed. Checked here rather than only at write time because a page
      // can be edited by hand after it was written, and an edit is exactly when
      // a length or a link count quietly stops being right.
      const sf = (serviceFilled ?? {}) as Record<string, string>
      const gate = auditContent({
        title: post.title ?? "", slug: post.slug, description: (post.meta?.description as string) ?? "",
        // A service page's prose lives in its slots, not in a body column.
        bodyHtml: kind === "service"
          ? [sf.hero_copy, sf.why_us, sf.product_tiles, sf.local_conditions,
             sf.differentiator, sf.use_cases, sf.process, sf.service_area_links]
              .filter(Boolean).join("\n")
          : bodyFilled,
        faq: (post.meta?.faq as { q: string; a: string }[]) ?? [],
        kind,
      })
      // An unresolved slot means the approved library had nothing for that
      // query. The slot is dropped rather than shipped broken, but a page that
      // loses half its pictures should be looked at, not published quietly.
      if (slotErrors.length > 1) {
        return await fail(
          `${slotErrors.length} image slots had no match in the approved library: `
          + slotErrors.slice(0, 3).map(q => `"${q}"`).join(", ")
          + ` — reword them or generate the images first`)
      }

      // Nothing may reach a reader still pointing at a placeholder.
      if (/PLACEHOLDER|\{\{/.test(html)) {
        return await fail("the page still has unfilled image placeholders — not published")
      }

      if (gate.failed.length) {
        return await fail(
          `audit failed (${gate.passed} passed, ${gate.failed.length} failed): `
          + gate.failed.map(f => `${f.label}${f.detail ? ` — ${f.detail}` : ""}`).join("; "))
      }

      const path = `${post.slug}.html`

      // Write onto the tip of `queue`. If the file is already there (a retry
      // after a dispatch died mid-flight) its sha must be supplied or GitHub
      // refuses the update.
      const existing = await gh(`/contents/${path}?ref=queue`)
      const sha = existing.ok ? (await existing.json()).sha : undefined

      const put = await gh(`/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Add the ${post.title} ${kind === "service" ? "service page" : "post"}`,
          content: b64encode(html),
          branch: "queue",
          author: COMMIT_AUTHOR,
          committer: COMMIT_AUTHOR,
          ...(sha ? { sha } : {}),
        }),
      })
      if (!put.ok) {
        const d = await put.json().catch(() => ({}))
        throw new Error(`github ${put.status}${d?.message ? `: ${d.message}` : ""}`
          + (put.status === 403 || put.status === 404
             ? " — the repo token needs Contents: read and write" : ""))
      }
      const commit = (await put.json())?.commit?.sha ?? null

      // The cluster note, alongside the page the way the repo already does it.
      // Committed after the page and not allowed to fail the publish: a missing
      // note is a gap in the record, while a page that did not ship is a gap on
      // the site.
      try {
        const kw = (post.meta?.keyword as string) ?? null
        // Siblings share the seed the target came from -- that is what makes
        // them a cluster rather than a list.
        const { data: seedRow } = kw
          ? await admin.from("content_keywords").select("seed").eq("keyword", kw).maybeSingle()
          : { data: null }
        const { data: cluster } = await admin.from("content_keywords")
          .select("keyword, volume, difficulty, cpc, intent, created_at")
          .eq("seed", seedRow?.seed ?? "__none__")
          .order("volume", { ascending: false })
          .limit(12)

        const notePath = `keyword-cluster-${post.slug}.md`
        const prev = await gh(`/contents/${notePath}?ref=queue`)
        await gh(`/contents/${notePath}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `Add the keyword cluster note for ${post.slug}`,
            content: b64encode(clusterFile({
              slug: post.slug, title: post.title ?? post.slug,
              target: kw, cluster: cluster ?? [], writtenAt: new Date(),
            })),
            branch: "queue",
            author: COMMIT_AUTHOR, committer: COMMIT_AUTHOR,
            ...(prev.ok ? { sha: (await prev.json()).sha } : {}),
          }),
        })
      } catch { /* the page is committed; the note is not worth failing over */ }

      // `queued`, not `published`: the file is in the queue, and the drip is
      // what actually puts it on lusso.com.au. Calling it published here would
      // be the status page lying about what a reader can see.
      await admin.from("content_posts").update({
        status: "queued",
        publish_error: null,
        external_id: commit,
        meta: { ...(post.meta ?? {}), committed_path: path },
      }).eq("id", post.id)

      return json({ ok: true, committed: path, commit })
    } catch (e) {
      return await fail(e instanceof Error ? e.message : String(e))
    }
  }

  const { data: channel } = await admin
    .from("content_channels")
    .select("page_id, ig_user_id, access_token, expires_at")
    .eq("channel", post.channel).maybeSingle()

  if (!channel?.access_token) {
    return await fail(`${post.channel} is not connected — connect it in Settings → Content`)
  }
  if (channel.expires_at && new Date(channel.expires_at) < new Date()) {
    return await fail(`the ${post.channel} connection expired on ${new Date(channel.expires_at).toDateString()} — reconnect it in Settings → Content`)
  }

  const caption = [post.caption ?? "", ...((post.meta?.hashtags ?? []) as string[]).map(h => `#${h}`)]
    .join(" ").trim()
  try {
    let externalId: string

    if (post.channel === "instagram") {
      const images = (post.images ?? []) as { url?: string }[]
      const urls = images.map(i => i.url).filter(Boolean) as string[]

      // Instagram will not accept a text-only post. Saying so here beats Meta's
      // own error, which talks about a missing media parameter.
      if (!urls.length) return await fail("Instagram needs at least one image — add one before this can go out")
      if (!channel.ig_user_id) return await fail("this Page has no Instagram Business account linked to it")
      if (urls.length > 10) return await fail(`Instagram allows 10 images in a carousel; this post has ${urls.length}`)

      const ig = channel.ig_user_id
      const post_ = (path: string, body: Record<string, unknown>) =>
        fetch(`${GRAPH}/${path}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, access_token: channel.access_token }),
        }).then(r => r.json())

      let creationId: string

      if (urls.length === 1) {
        // Single image: one container, then publish it.
        const c = await post_(`${ig}/media`, { image_url: urls[0], caption })
        if (!c.id) throw new Error(c.error?.message ?? "Instagram would not accept the image")
        creationId = c.id
      } else {
        // Carousel: every slide gets its own container with is_carousel_item,
        // then ONE parent container holds them in order, and only the parent is
        // published. Slides carry no caption -- the caption belongs to the
        // parent, and putting it on a child silently does nothing.
        const children: string[] = []
        for (const [i, url] of urls.entries()) {
          const child = await post_(`${ig}/media`, { image_url: url, is_carousel_item: true })
          if (!child.id) {
            throw new Error(
              `slide ${i + 1} of ${urls.length} was rejected: ${child.error?.message ?? "no id returned"}`)
          }
          children.push(child.id)
        }
        const parent = await post_(`${ig}/media`, {
          media_type: "CAROUSEL", children: children.join(","), caption,
        })
        if (!parent.id) throw new Error(parent.error?.message ?? "Instagram would not build the carousel")
        creationId = parent.id
      }

      const published = await post_(`${ig}/media_publish`, { creation_id: creationId })
      if (!published.id) throw new Error(published.error?.message ?? "Instagram would not publish it")
      externalId = published.id
    } else {
      // Facebook takes text on its own, or a photo with the text as the caption.
      const image = ((post.images ?? []) as { url?: string }[])[0]?.url ?? null
      const endpoint = image ? "photos" : "feed"
      const payload: Record<string, string> = image
        ? { url: image, caption, access_token: channel.access_token }
        : { message: caption, access_token: channel.access_token }

      const res = await fetch(`${GRAPH}/${channel.page_id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const out = await res.json()
      const id = out.post_id ?? out.id
      if (!id) throw new Error(out.error?.message ?? "Facebook would not accept the post")
      externalId = id
    }

    await admin.from("content_posts").update({
      status: "published",
      published_at: new Date().toISOString(),
      external_id: externalId,
      publish_error: null,
    }).eq("id", post.id)

    await admin.from("content_channels")
      .update({ last_error: null }).eq("channel", post.channel)

    return json({ ok: true, externalId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // On the channel too, so Settings shows a connection that has started
    // failing rather than only the individual post that noticed.
    await admin.from("content_channels")
      .update({ last_error: msg.slice(0, 300) }).eq("channel", post.channel)
    return await fail(msg)
  }
})
