/**
 * The reference files the /blog and /service skills read before writing a word.
 *
 * These are the difference between a page that sounds right and a page that is
 * right. The prompt can say "never invent a statistic" all it likes; without
 * Business-facts.md in front of it the model has nothing true to reach for, so
 * it writes around the gap or invents. Feeding the files in is what makes the
 * non-negotiable enforceable rather than aspirational.
 *
 * Fetched from `main` at write time rather than copied into the prompt rows:
 * the repo is where they are maintained, and a copy would rot the first time
 * someone corrects a fabric width.
 */

const REPO = "erkmmm/LussoWebite"

/** Which product file a keyword belongs to. */
export function productFileFor(topic: string): string | null {
  const t = topic.toLowerCase()
  if (/\b(curtain|sheer|drape|pleat|s-fold|voile)\b/.test(t)) return "curtains"
  if (/\b(roller|blockout|sunscreen|holland|dual)\b/.test(t))  return "roller-blinds"
  if (/\b(outdoor|awning|alfresco|patio|ziptrak|external)\b/.test(t)) return "outdoor-blinds"
  if (/\b(track|rod|hardware|bracket|motoris|cord)\b/.test(t)) return "tracks-and-hardware"
  if (/\bawning\b/.test(t)) return "awnings"
  return null
}

/**
 * Read the reference set for one page.
 *
 * Deliberately not everything: Semrush.md, Capabilities.md and On-page-SEO.md
 * describe the TOOLING, not the business, and spending context on them buys
 * nothing for a model that is not running the tooling. Reviews.md is service-only
 * because only a service page is allowed to quote reviews.
 */
export async function loadReferences(
  gh: (path: string) => Promise<string | null>,
  kind: string,
  topic: string,
): Promise<{ text: string; loaded: string[]; missing: string[] }> {
  const wanted = [
    "references/Business-facts.md",
    "references/Voice.md",
    "references/Humour.md",
    "references/Opinions.md",
    "references/Stories.md",
  ]
  if (kind === "service") wanted.push("references/Reviews.md")

  // The markup contract. Without it the writer emits generic <p>/<h2> and the
  // page renders as unstyled prose inside a styled shell -- every component the
  // stylesheet knows about (.answer, .cmp-wrap, .post-cta, .faq) simply absent.
  // These files ARE the difference between a page that matches the site and one
  // that merely sits on it.
  wanted.push(kind === "service"
    ? ".claude/skills/service/references/service-blocks.md"
    : ".claude/skills/blog/references/body-blocks.md")
  const product = productFileFor(topic)
  if (product) wanted.push(`references/products/${product}.md`)

  const loaded: string[] = []
  const missing: string[] = []
  const parts: string[] = []

  const files = await Promise.all(wanted.map(async p => ({ p, body: await gh(p) })))
  for (const { p, body } of files) {
    if (!body) { missing.push(p); continue }
    loaded.push(p)
    parts.push(`===== ${p} =====\n${body}`)
  }

  return { text: parts.join("\n\n"), loaded, missing }
}

/** Pages already on the site, for internal linking and to avoid duplicating one. */
export async function existingPages(
  ghJson: (path: string) => Promise<unknown>,
): Promise<{ slug: string; title: string }[]> {
  const tree = await ghJson("/git/trees/main?recursive=0") as
    { tree?: { path: string; type: string }[] } | null
  return (tree?.tree ?? [])
    .filter(f => f.type === "blob" && /^[a-z0-9-]+\.html$/.test(f.path))
    .map(f => ({ slug: f.path.replace(/\.html$/, ""), title: "" }))
}

export { REPO }
