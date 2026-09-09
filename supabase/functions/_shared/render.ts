/**
 * A content_posts row -> the HTML file the site serves.
 *
 * This is the half of scripts/new-post.py that a server can do. The script fills
 * the head, schema, breadcrumbs and dates and leaves {{BODY}}, {{TOC_LINKS}},
 * {{JSONLD_FAQ}} and the hero for a human; nobody is here to finish those, so
 * this fills all of them.
 *
 * Two things it deliberately does NOT do, because doing them badly is worse than
 * not doing them:
 *
 *   * Generate imagery. The skill's image pass is Pexels then Higgsfield, and
 *     neither belongs in a publish step. Instead the hero is chosen from the 42
 *     renditions already on the site, by word overlap with the keyword -- a real
 *     photo of a real window covering, rather than a broken <img>.
 *   * Invent related posts. When there is nothing good to link, the whole
 *     "Related from the journal" section is removed rather than rendered empty.
 */

const SITE = "https://www.lusso.com.au"
const AUTHOR = { name: "Jett Hopkins", jobTitle: "Third-generation window furnishings specialist" }

// Copied from the Organization block the live service pages already carry, so a
// generated page and a hand-built one describe the same business. The legal
// name and ABN are the registered ones -- "Lusso" is a business name only.
const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Lusso Fashion for Windows",
  legalName: "The Trustee for HOPKINS FAMILY TRUST",
  vatID: "72 388 582 539",
  url: `${SITE}/`,
  logo: `${SITE}/assets/img/apple-touch-icon.png`,
  foundingDate: "1978",
  email: "info@lusso.com.au",
  telephone: "+61755284006",
  sameAs: ["https://www.instagram.com/lusso.blinds/"],
}
const VARIANTS = [400, 800, 1200, 1600, 1900]

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const slugify = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-")
   .replace(/^-|-$/g, "").slice(0, 40)

/** Strip tags for anything that has to be plain text (TOC labels, FAQ schema). */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()

/**
 * Give every h2 a stable id and collect them for the table of contents.
 * The site's own pages use short slugs (`#how`, `#faq`), so these match.
 */
export function addHeadingIds(body: string) {
  const toc: { id: string; label: string }[] = []
  const out = body.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (_m, attrs = "", inner) => {
    const label = text(inner)
    const id = slugify(label) || `s${toc.length + 1}`
    toc.push({ id, label })
    // Keep any attributes the writer produced, but never a second id.
    const kept = String(attrs || "").replace(/\sid="[^"]*"/i, "")
    return `<h2 id="${id}"${kept}>${inner}</h2>`
  })
  return { body: out, toc }
}

/**
 * FAQ schema, built from the FAQ section the prompt asks for.
 *
 * Only emitted when the shape is really there -- an h2 whose text mentions FAQ
 * or questions, followed by h3/question pairs. Marking up something that is not
 * a FAQ is a structured-data penalty, not a win, so silence is the safe default.
 */
export function faqSchema(body: string): string {
  const idx = body.search(/<h2[^>]*>[^<]*(faq|frequently asked|common questions)[^<]*<\/h2>/i)
  if (idx === -1) return ""
  const tail = body.slice(idx)
  const qa: { q: string; a: string }[] = []
  const re = /<h3(?:\s[^>]*)?>([\s\S]*?)<\/h3>\s*((?:<p>[\s\S]*?<\/p>\s*)+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(tail)) !== null) {
    const q = text(m[1]), a = text(m[2])
    if (q && a) qa.push({ q, a })
  }
  if (qa.length < 2) return ""
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(({ q, a }) => ({
      "@type": "Question", name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  })
}

const jsonLd = (obj: unknown) =>
  `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`

/**
 * Pick a hero from what the site already has.
 *
 * `heroes` is the list of `<name>-1900x1267-1900.webp` files in assets/img.
 * Scored on how many words of the keyword appear in the filename, which is
 * enough because the filenames are descriptive by convention
 * ("quiet-living-room-heavy-curtains-drawn"). Ties break toward the shorter
 * name, which is usually the more general photo.
 */
export function pickHero(heroes: string[], keyword: string, fallback: string) {
  const words = keyword.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3)
  let best = fallback, bestScore = -1
  for (const file of heroes) {
    const score = words.reduce((n, w) => n + (file.includes(w) ? 1 : 0), 0)
    if (score > bestScore || (score === bestScore && score > 0 && file.length < best.length)) {
      best = file; bestScore = score
    }
  }
  return best
}

/** "quiet-room-1900x1267-1900.webp" -> the full srcset across every rendition. */
export function srcsetFor(hero: string) {
  const stem = hero.replace(/-\d+\.webp$/, "")
  return VARIANTS.map(w => `assets/img/${stem}-${w}.webp ${w}w`).join(", ")
}

const human = (d: Date) =>
  `${d.getUTCDate()} ${d.toLocaleString("en-AU", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`

/** The fifteen template slots a service page has and a blog post does not. */
export type ServiceFields = {
  location: string
  hero_h: string; hero_display: string; hero_copy: string
  hero_query: string; hero_alt: string
  why_us: string; product_tiles: string; local_conditions: string
  diff_display: string; diff_lead: string; differentiator: string
  use_cases_heading: string; use_cases_display: string; use_cases: string
  process: string; tiles_heading: string
  testimonial_heading: string; testimonial_lead: string
  area_heading: string; area_display: string; service_area_links: string
}

export type RenderInput = {
  /** Present for kind === "service"; renderPage switches on it. */
  service?: ServiceFields | null
  /**
   * The Open Graph image filename. The templates hardcode og-<slug>.jpg, which
   * scripts/make-og-image.py produces on the Mac -- an edge function cannot,
   * since the source is WebP and the output must be JPEG. Rather than reference
   * a file that does not exist (a 404 share card, and a real audit failure on
   * every page this pipeline writes), the publisher passes og-default.jpg when
   * the per-page one is absent.
   */
  ogImage?: string | null
  template: string
  /** The FAQ as the writer returned it, so the schema and the visible questions
   *  come from ONE source. Parsing them back out of the HTML is how a page ends
   *  up passing its own audit while its structured data disagrees with itself. */
  faq?: { q: string; a: string }[]
  title: string
  slug: string
  description: string
  bodyHtml: string
  keyword: string
  category?: string
  heroes: string[]
  publishedAt: Date
}


/** Points the share-card tags at an image that actually exists. */
function applyOgImage(html: string, slug: string, ogImage?: string | null): string {
  if (!ogImage || ogImage === `og-${slug}.jpg`) return html
  return html.split(`assets/img/og-${slug}.jpg`).join(`assets/img/${ogImage}`)
}

export function renderPage(inp: RenderInput): { html: string; unfilled: string[] } {
  if (inp.service) return renderService(inp, inp.service)
  const { body, toc } = addHeadingIds(inp.bodyHtml)
  const h1 = inp.title
  // The site's own titles carry the brand suffix; adding it twice is the kind of
  // thing nobody notices until it is on 40 pages.
  const fullTitle = /\|\s*Lusso\s*$/i.test(inp.title) ? inp.title : `${inp.title} | Lusso`

  const hero = pickHero(inp.heroes, `${inp.keyword} ${inp.slug}`,
    inp.heroes[0] ?? "assets/img/placeholder-1900x1267-1900.webp")
  const heroAlt = `${h1} — Lusso window furnishings`

  // Read time at 220 words a minute, the figure the existing cards use.
  const words = text(body).split(/\s+/).length
  const readTime = Math.max(2, Math.round(words / 220))

  const iso = inp.publishedAt.toISOString().slice(0, 10)

  const breadcrumb = jsonLd({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Journal", item: `${SITE}/blog.html` },
      { "@type": "ListItem", position: 3, name: h1, item: `${SITE}/${inp.slug}.html` },
    ],
  })

  const blogposting = jsonLd({
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: h1,
    description: inp.description,
    image: `${SITE}/assets/img/og-${inp.slug}.jpg`,
    datePublished: iso, dateModified: iso,
    inLanguage: "en-AU", wordCount: words, articleSection: inp.category ?? "Guides",
    keywords: inp.keyword,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}/${inp.slug}.html` },
    author: {
      "@type": "Person", name: AUTHOR.name, jobTitle: AUTHOR.jobTitle,
      url: `${SITE}/about.html#author`,
      worksFor: { "@id": `${SITE}/#organization` },
      knowsAbout: ["Curtains", "Blinds", "Window furnishings", "Soft furnishings"],
    },
    publisher: { "@id": `${SITE}/#organization` },
  })

  const values: Record<string, string> = {
    TITLE: esc(fullTitle),
    OG_TITLE: esc(h1),
    META_DESCRIPTION: esc(inp.description),
    SLUG: inp.slug,
    H1: esc(h1),
    DEK: esc(inp.description),
    CATEGORY: inp.category ?? "Guides",
    READ_TIME: String(readTime),
    BREADCRUMB_LABEL: esc(h1),
    PUBLISHED: iso,
    MODIFIED: iso,
    PUBLISHED_HUMAN: human(inp.publishedAt),
    MODIFIED_HUMAN: human(inp.publishedAt),
    JSONLD_BREADCRUMB: breadcrumb,
    JSONLD_BLOGPOSTING: blogposting,
    JSONLD_FAQ: inp.faq?.length
      ? jsonLd({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: inp.faq.map(({ q, a }) => ({
            "@type": "Question", name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        })
      // Falls back to reading the rendered HTML for pages written before the
      // writer returned a faq array -- the backlog, mostly.
      : faqSchema(body),
    HERO_SRC: `assets/img/${hero}`,
    HERO_SRCSET: srcsetFor(hero),
    HERO_ALT: esc(heroAlt),
    HERO_QUERY: esc(inp.keyword),
    HERO_W: "1900",
    HERO_H: "1267",
    TOC_LINKS: toc.map(t => `      <a href="#${t.id}">${esc(t.label)}</a>`).join("\n"),
    BODY: body,
    RELATED_CARDS: "",
  }

  let html = inp.template
  for (const [k, v] of Object.entries(values)) {
    html = html.split(`{{${k}}}`).join(v)
  }

  html = applyOgImage(html, inp.slug, inp.ogImage)

  // Nothing good to put in it, so take the whole section out rather than ship a
  // "Keep reading" heading above an empty row.
  html = html.replace(
    /<!-- =+\s*\n\s*RELATED\s*\n\s*=+ -->\s*<section[\s\S]*?<\/section>\s*/m, "")

  // Anything the template asked for and we did not supply. Returned rather than
  // thrown: the caller decides whether a stray token is worth refusing to
  // publish over, and it is far better to know than to ship "{{FOO}}" to a
  // reader.
  const unfilled = [...new Set(
    [...html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(m => m[1]))]

  return { html, unfilled }
}


/**
 * Service pages share the shell but almost none of the slots: no body, no table
 * of contents, no BlogPosting, a Service + LocalBusiness graph instead, and
 * fifteen named sections the writer returns individually.
 */
function renderService(inp: RenderInput, f: ServiceFields): { html: string; unfilled: string[] } {
  const h1 = f.hero_h || inp.title
  const fullTitle = /\|\s*Lusso\s*$/i.test(inp.title) ? inp.title : `${inp.title} | Lusso`
  const hero = pickHero(inp.heroes, `${inp.keyword} ${inp.slug}`,
    inp.heroes[0] ?? "assets/img/placeholder-1900x1267-1900.webp")

  const values: Record<string, string> = {
    TITLE: esc(fullTitle),
    H1: esc(h1),
    SLUG: inp.slug,
    META_DESCRIPTION: esc(inp.description),
    BREADCRUMB_LABEL: esc(h1),
    LOCATION: esc(f.location),

    HERO_SRC: `assets/img/${hero}`,
    HERO_SRCSET: srcsetFor(hero),
    HERO_QUERY: esc(f.hero_query || inp.keyword),
    HERO_ALT: esc(f.hero_alt || h1),
    HERO_W: "1900",
    HERO_H: "1267",
    HERO_DISPLAY: esc(f.hero_display),
    HERO_COPY: f.hero_copy,

    WHY_US: f.why_us,
    TILES_HEADING: esc(f.tiles_heading),
    PRODUCT_TILES: f.product_tiles,
    LOCAL_CONDITIONS: f.local_conditions,
    DIFF_DISPLAY: esc(f.diff_display),
    DIFF_LEAD: esc(f.diff_lead),
    DIFFERENTIATOR: f.differentiator,
    TESTIMONIAL_HEADING: esc(f.testimonial_heading),
    TESTIMONIAL_LEAD: esc(f.testimonial_lead),
    USE_CASES_HEADING: esc(f.use_cases_heading),
    USE_CASES_DISPLAY: esc(f.use_cases_display),
    USE_CASES: f.use_cases,
    PROCESS: f.process,
    AREA_HEADING: esc(f.area_heading),
    AREA_DISPLAY: esc(f.area_display),
    // The nav's accessible name, so it is not just "navigation" to a screen
    // reader on a page that has several.
    AREA_ARIA: esc(`Areas we service near ${f.location}`),
    SERVICE_AREA_LINKS: f.service_area_links,

    FAQ_HEADING: "Frequently asked questions",
    FAQ_ITEMS: (inp.faq ?? []).map(({ q, a }) =>
      `        <details>\n`
      + `          <summary>${esc(q)}</summary>\n`
      + `          <div class="faq__a"><p>${esc(a)}</p></div>\n`
      + `        </details>`).join("\n"),

    JSONLD_BREADCRUMB: jsonLd({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Services", item: `${SITE}/services.html` },
        { "@type": "ListItem", position: 3, name: h1, item: `${SITE}/${inp.slug}.html` },
      ],
    }),
    JSONLD_ORGANIZATION: jsonLd(ORGANIZATION),
    JSONLD_SERVICE: jsonLd({
      "@context": "https://schema.org", "@type": "Service",
      name: h1,
      description: inp.description,
      serviceType: "Window furnishings supply and installation",
      areaServed: { "@type": "Place", name: f.location },
      provider: { "@id": `${SITE}/#organization` },
      url: `${SITE}/${inp.slug}.html`,
    }),
    JSONLD_FAQ: inp.faq?.length
      ? jsonLd({
          "@context": "https://schema.org", "@type": "FAQPage",
          mainEntity: inp.faq.map(({ q, a }) => ({
            "@type": "Question", name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        })
      : "",
  }

  let html = inp.template
  for (const [k, v] of Object.entries(values)) html = html.split(`{{${k}}}`).join(v)
  html = applyOgImage(html, inp.slug, inp.ogImage)

  const unfilled = [...new Set(
    [...html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(m => m[1]))]
  return { html, unfilled }
}
