/**
 * Filling the image slots a written page leaves behind.
 *
 * The writer emits <img> tags with a query and no src. Something has to turn
 * those into real files or the page ships broken images -- which is exactly what
 * happened to the first page this pipeline wrote.
 *
 * The pool is assets/img/GENERATED.md and nothing else. That file lists the
 * Higgsfield renders made to the brand's locked style block; the rest of
 * assets/img includes stock photography that does not belong on these pages.
 * Matching on filename alone is how a stock photo got picked before, so the
 * approved list is the gate, not a preference.
 */

/** The file stems GENERATED.md vouches for, read from its slot tables. */
export function approvedStems(generatedMd: string): Set<string> {
  return new Set(
    [...generatedMd.matchAll(/\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/g)].map(m => m[1]))
}

export type Rendition = { geom: string; widths: number[] }

/**
 * assets/img holds 2240 files, and the contents API stops at 1000 -- so this
 * takes a git tree listing. Names are `<stem>-<W>x<H>-<width>.webp`.
 */
export function indexImages(paths: string[]): Map<string, Rendition> {
  const out = new Map<string, Rendition>()
  for (const p of paths) {
    const m = /^(?:assets\/img\/)?([a-z0-9][a-z0-9-]*?)-(\d+x\d+)-(\d+)\.webp$/.exec(p)
    if (!m) continue
    const [, stem, geom, w] = m
    const cur = out.get(stem)
    if (cur && cur.geom === geom) cur.widths.push(Number(w))
    else if (!cur) out.set(stem, { geom, widths: [Number(w)] })
  }
  for (const r of out.values()) r.widths.sort((a, b) => a - b)
  return out
}

/**
 * Product families. A stem from the wrong family is disqualified outright, not
 * merely scored lower -- GENERATED.md records that the first generated pass
 * "shipped three cards showing the wrong product", and word overlap will
 * happily match a roman blind to a roller query on "blind", "window" and
 * "living room". A missing photo is recoverable; a photo of the competitor's
 * product on a page selling yours is not.
 */
const FAMILIES: Record<string, RegExp> = {
  roller:    /\broller\b/,
  roman:     /\broman\b/,
  venetian:  /\bvenetian\b/,
  vertical:  /\bvertical\b/,
  panel:     /\bpanel-glide|\bpanel\b/,
  curtain:   /\bcurtain|\bdrape|\bsheer\b|\bpleat\b/,
  shutter:   /\bshutter/,
  awning:    /\bawning/,
  outdoor:   /\boutdoor\b|\balfresco\b|\bzip.?track\b/,
}

const familyOf = (s: string): string | null => {
  for (const [name, re] of Object.entries(FAMILIES)) if (re.test(s)) return name
  return null
}

const STOP = new Set(["a","an","the","and","or","of","in","on","at","to","for",
  "with","from","by","into","over","under","up","down","its","it","is","are",
  "photo","photograph","image","close","view","shot"])

const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
   .filter(w => w.length > 2 && !STOP.has(w))

/**
 * How well a stem answers a query. Overlap, weighted so that a rare word
 * matching counts for more than a common one -- "roller" appearing in both is
 * worth less than "reveal" appearing in both, because half the library says
 * roller.
 */
function score(queryWords: string[], stem: string, df: Map<string, number>, n: number) {
  const sw = new Set(tokens(stem))
  let s = 0
  for (const w of queryWords) {
    if (!sw.has(w)) continue
    s += Math.log(1 + n / (1 + (df.get(w) ?? 0)))
  }
  return s
}

export type SlotResult = {
  html: string
  filled: number
  /** Queries nothing in the approved pool could answer. */
  unresolved: string[]
}

/**
 * Replaces every image slot in `html` with a real approved render.
 *
 * A slot nothing matches is REMOVED along with its <figure>, not left pointing
 * at a placeholder. A missing photo is a page that reads slightly thinner; a
 * broken one is a page that looks abandoned.
 */
export function resolveImageSlots(
  html: string,
  index: Map<string, Rendition>,
  approved: Set<string>,
  sizes = "(max-width: 720px) 100vw, (max-width: 1024px) 800px, 1200px",
): SlotResult {
  const pool = [...index.keys()].filter(s => approved.has(s))

  // Document frequency across the pool, for the weighting above.
  const df = new Map<string, number>()
  for (const stem of pool) for (const w of new Set(tokens(stem))) df.set(w, (df.get(w) ?? 0) + 1)

  const used = new Set<string>()
  const unresolved: string[] = []
  let filled = 0

  const out = html.replace(/<img\b[^>]*>/g, (tag) => {
    const q = /\bdata-(?:pexels-query|hf-prompt)="([^"]*)"/.exec(tag)?.[1]
    if (!q) return tag                       // already a real image
    const qw = tokens(q)

    const wantFamily = familyOf(q.toLowerCase())

    let best: string | null = null, bestScore = 0
    for (const stem of pool) {
      if (used.has(stem)) continue           // no page repeats an image
      // Only a conflict disqualifies. A stem naming no product at all -- a bare
      // window, a room -- is still fair game for any query.
      if (wantFamily) {
        const has = familyOf(stem)
        if (has && has !== wantFamily) continue
      }
      const s = score(qw, stem, df, pool.length)
      if (s > bestScore) { bestScore = s; best = stem }
    }
    // Two tokens' worth of agreement. Below that the match is a coincidence,
    // and a wrong photo of the wrong product is worse than no photo.
    if (!best || bestScore < 2) { unresolved.push(q); return "" }

    used.add(best)
    const r = index.get(best)!
    const [w, h] = r.geom.split("x")
    const largest = r.widths[r.widths.length - 1]
    const srcset = r.widths.map(x => `assets/img/${best}-${r.geom}-${x}.webp ${x}w`).join(", ")
    filled++

    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? q
    const eager = /fetchpriority="high"/.test(tag)
    // data-hf-prompt, not data-pexels-query: GENERATED.md is explicit that the
    // attribute swap is what stops fetch-pexels.py overwriting these on its
    // next run.
    return `<img src="assets/img/${best}-${r.geom}-${largest}.webp" `
      + `srcset="${srcset}" sizes="${sizes}" `
      + `data-hf-prompt="${best}" alt="${alt}" `
      + `${eager ? 'fetchpriority="high"' : 'loading="lazy"'} `
      + `width="${w}" height="${h}">`
  })

  // A <figure> whose image did not resolve is an empty box with a caption.
  const cleaned = out.replace(/<figure>\s*<\/figure>\s*/g, "")
                     .replace(/<figure>\s*(<figcaption[\s\S]*?<\/figcaption>)?\s*<\/figure>\s*/g, "")

  return { html: cleaned, filled, unresolved }
}
