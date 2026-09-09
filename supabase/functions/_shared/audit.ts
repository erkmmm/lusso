/**
 * The content half of scripts/audit-seo.py, as a gate the app can actually run.
 *
 * The skill is unambiguous: "The audit is the gate: do not tell the user a post
 * is finished until it passes." An app that writes pages and cannot run the gate
 * is an app that ships pages nobody checked.
 *
 * This is a PORT, not a reimplementation -- the thresholds below are the
 * script's, copied exactly, including the ones that look arbitrary (3-6 internal
 * links, not 3+; title 50-60, not "under 60"). Where a number here disagrees
 * with audit-seo.py, this file is wrong.
 *
 * Scope: the checks that depend on what the WRITER produced. The template-level
 * checks -- canonical, og tags, skip links, landmarks, focus styles, click-to-
 * call -- are not repeated, because templates/blog-post.html ships them and the
 * renderer fills that template; a page cannot lose them without the template
 * losing them first. Anything that IS the writer's output is checked here.
 */

export type Check = { label: string; ok: boolean; detail?: string; warn?: boolean }

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const words = (h: string) => text(h).split(" ").filter(w => w.length > 1)
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length

// Entities decode to one character for a reader, so lengths are measured after
// unescaping -- the script does the same, and a title with an &amp; in it is
// otherwise four characters longer than it looks.
const unescape = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&hellip;/g, "…")
  .replace(/&nbsp;/g, " ")

export type AuditInput = {
  title: string
  slug: string
  description: string
  bodyHtml: string
  faq: { q: string; a: string }[]
  kind: string
  /** Competitor average from the research pass; length is enforced against it. */
  serpAvg?: number | null
}

export function auditContent(inp: AuditInput): { checks: Check[]; failed: Check[]; passed: number } {
  const c: Check[] = []
  const add = (label: string, ok: boolean, detail = "", warn = false) =>
    c.push({ label, ok, detail, warn })

  const b = inp.bodyHtml ?? ""
  const bw = words(b)

  // ── head & metadata ──────────────────────────────────────────────────────
  // audit-seo.py measures the RENDERED <title>, which carries the site's
  // " | Lusso" suffix -- so measuring the raw title here was wrong by eight
  // characters, and would have pushed every title eight characters over the
  // limit on the page a reader actually gets. Mirrors render.ts's rule.
  const raw = inp.title ?? ""
  const t = unescape(/\|\s*Lusso\s*$/i.test(raw) ? raw : `${raw} | Lusso`)
  const d = unescape(inp.description ?? "")
  add("title 50-60 chars", t.length >= 50 && t.length <= 60, `${t.length} chars`)
  add("meta description 150-160", d.length >= 150 && d.length <= 160, `${d.length} chars`)

  // ── slug ─────────────────────────────────────────────────────────────────
  add("slug under 60 chars", (inp.slug ?? "").length < 60, inp.slug)
  add("slug lowercase + hyphens", /^[a-z0-9-]+$/.test(inp.slug ?? ""), inp.slug)

  // ── headings ─────────────────────────────────────────────────────────────
  // No H1 in the body: the template renders it, and a second one is a fail.
  const isService = inp.kind === "service"
  add("no <h1> in body", count(b, /<h1\b/g) === 0, `${count(b, /<h1\b/g)} found`)
  add("no <h5>/<h6> skipping levels", !/<h[56]\b/.test(b))
  // A service page's H2s belong to the template's sections, not to the writer's
  // fragments, so counting them here would measure the wrong thing.
  if (!isService) {
    add("at least 4 H2s", count(b, /<h2\b/g) >= 4, `${count(b, /<h2\b/g)} found`)
    add("every H2 has an id", count(b, /<h2\b/g) === count(b, /<h2[^>]*\bid=/g),
        `${count(b, /<h2[^>]*\bid=/g)} of ${count(b, /<h2\b/g)}`)
  }

  // ── body ─────────────────────────────────────────────────────────────────
  add("body has content", bw.length > 200, `${bw.length} words`)
  if (isService) {
    add("length (service page)", true, `${bw.length} words`, true)
  } else if (inp.serpAvg) {
    const lo = Math.round(inp.serpAvg * 0.8), hi = Math.round(inp.serpAvg * 1.2)
    add(`length within 20% of SERP avg (${lo}-${hi})`,
        bw.length >= lo && bw.length <= hi, `${bw.length} words`)
  } else {
    add("length (no SERP average)", true, `${bw.length} words`, true)
  }
  if (isService) {
    // The conversion checks from audit-seo.py's service branch. A service page
    // that does not ask for the job is a brochure.
    add("3+ calls to action", count(b, /href="#contact"/g) >= 3, `${count(b, /href="#contact"/g)} found`)
    add("exactly 8 product tiles", count(b, /class="tile"/g) === 8, `${count(b, /class="tile"/g)} found`)
    add("4 checklist items", count(b, /<span class="num">/g) === 4, `${count(b, /<span class="num">/g)} found`)
  } else {
    add("direct answer block", b.includes("answer__label"))
  }
  add("bullets or numbered list", b.includes("<ul>") || b.includes("<ol>"))
  add("bold key phrases", count(b, /<strong>/g) >= 3, `${count(b, /<strong>/g)} found`)

  // ── FAQ ──────────────────────────────────────────────────────────────────
  const visible = count(b, /<summary>/g)
  add("4-8 FAQ questions", visible >= 4 && visible <= 8, `${visible} found`)
  add("FAQ data matches the page", (inp.faq?.length ?? 0) === visible,
      `${inp.faq?.length ?? 0} in data, ${visible} on page`)

  // ── images ───────────────────────────────────────────────────────────────
  const imgs = b.match(/<img\b[^>]*>/g) ?? []
  add("every image has alt", imgs.every(i => /\balt="/.test(i)), `${imgs.length} images`)
  add("every image width+height",
      imgs.every(i => /\bwidth="/.test(i) && /\bheight="/.test(i)))
  add("every image lazy-loaded", imgs.every(i => /loading="lazy"|fetchpriority=/.test(i)))
  add("no hotlinked stock images",
      !b.includes("images.unsplash.com") && !b.includes("images.pexels.com"))
  // Slots are filled by the image pass; before it runs they must at least be
  // tagged, or there is nothing for that pass to find.
  add("image slots tagged for the image pass",
      imgs.length === 0 || imgs.every(i => /data-(pexels-query|hf-prompt)=/.test(i)),
      `${imgs.filter(i => /data-(pexels-query|hf-prompt)=/.test(i)).length} of ${imgs.length}`)

  // ── links ────────────────────────────────────────────────────────────────
  const internal = [...new Set((b.match(/href="([a-z0-9-]+\.html)/g) ?? []))]
  // A service page links out through its area quicklinks and product tiles, so
  // the blog's 3-6 ceiling would be wrong: more is better there, not worse.
  if (isService) add("3+ internal links", internal.length >= 3, `${internal.length}`)
  else add("3-6 in-body internal links", internal.length >= 3 && internal.length <= 6, `${internal.length}`)
  const ext = b.match(/href="https?:\/\/[^"]+"/g) ?? []
  const auth = ext.filter(e => /\.gov(\.au)?\/|\.edu\/|\.org(\.au)?\//.test(e))
  add("2+ authoritative external links", isService || auth.length >= 2,
      `${auth.length} of ${ext.length}`, isService)
  add("external links use rel=noopener",
      ext.length === 0 || count(b, /rel="noopener/g) >= ext.length)
  add("no 'click here' anchors", !/click here|read more</i.test(b.toLowerCase()))

  // ── JSON-LD hygiene the writer can break ────────────────────────────────
  // Entities are NOT decoded inside a JSON-LD block, so an &amp; ships verbatim
  // into the structured data. body-blocks.md calls this out explicitly.
  const faqText = (inp.faq ?? []).map(f => `${f.q} ${f.a}`).join(" ")
  add("no HTML entities in FAQ data", !/&(amp|quot|#39|lt|gt);/.test(faqText))

  const failed = c.filter(x => !x.ok && !x.warn)
  return { checks: c, failed, passed: c.filter(x => x.ok).length }
}
