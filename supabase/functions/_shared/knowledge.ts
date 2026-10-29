/**
 * Supplier-document retrieval, shared by the job assistant and the inbox
 * reply suggester.
 *
 * The price lists are far too large to sit in a prompt — the Simply Cell 2026
 * list alone is 230k characters, and the fabric codes sit 94% of the way
 * through it. So the model gets an index plus these two tools and fetches the
 * part it actually needs.
 */

export type KnowledgeDoc = { filename: string; description: string; text: string }

/**
 * Flatten the whitespace a PDF extractor leaves behind, without destroying
 * paragraph breaks. Offsets quoted by search_knowledge are offsets into this
 * normalised text, so every reader has to agree on it.
 */
export function normalise(raw: string) {
  return raw.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n")
}

/**
 * Build a matcher that tolerates the spacing a PDF extractor sprays through
 * short codes — the Simply Cell list writes "VS 2" and "F 1", and a fabric
 * code can arrive split across a line break.
 */
export function looseMatcher(query: string) {
  const q = query.trim().slice(0, 60)
  const pattern = [...q]
    .filter(c => !/\s/.test(c))
    .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*")
  if (!pattern) return null

  // Short alphanumeric queries are codes ("0100", "VS2", "F1"). Anchor them to
  // token boundaries, or "F1" matches the "f 1" inside "half 1" on every page.
  const isCode = /^[A-Za-z0-9]{1,8}$/.test(q.replace(/\s/g, ""))
  const body = isCode ? `(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])` : pattern
  return new RegExp(body, "gi")
}

export function runKnowledgeTool(name: string, input: any, library: KnowledgeDoc[]): string {
  try {
    if (name === "search_knowledge") return searchKnowledge(input, library)
    if (name === "read_knowledge")   return readKnowledge(input, library)
    return `Unknown tool "${name}".`
  } catch (e) {
    return `Tool error: ${String(e)}`
  }
}

export function searchKnowledge(input: any, library: KnowledgeDoc[]) {
  const re = looseMatcher(String(input.query ?? ""))
  if (!re) return "Empty query — give some text to search for."

  const wanted = input.filename ? String(input.filename).trim().toLowerCase() : null
  const docs = wanted
    ? library.filter(d => d.filename.toLowerCase() === wanted || d.filename.toLowerCase().includes(wanted))
    : library
  if (!docs.length) {
    return `No document matches "${input.filename}". Available: ${library.map(d => d.filename).join(", ")}`
  }

  // SHOW is deliberately small: every result is replayed on every later turn,
  // so a generous search is paid for again and again as the conversation runs.
  const PAD = 700, SCAN_CAP = 400, SHOW = 8, BUCKETS = 6
  type Hit = { file: string; offset: number; window: string; score: number; zone: string }
  const hits: Hit[] = []

  for (const d of docs) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(d.text)) !== null && hits.length < SCAN_CAP) {
      const from = Math.max(0, m.index - PAD)
      const to   = Math.min(d.text.length, m.index + m[0].length + PAD)
      const window = d.text.slice(from, to)
      // A price list is mostly grids of numbers. A code that explains itself
      // sits in a sentence or a fabric row; a code that is really a price sits
      // in a digit run. Rank by how much prose surrounds the hit, so the
      // explanation surfaces instead of 400 lookalike numbers.
      const letters = (window.match(/[A-Za-z]/g) ?? []).length
      const zone = `${d.filename}#${Math.floor((m.index / Math.max(1, d.text.length)) * BUCKETS)}`
      hits.push({ file: d.filename, offset: m.index, window, score: letters / window.length, zone })
      re.lastIndex = Math.max(re.lastIndex, to - PAD)
    }
  }

  if (!hits.length) {
    return `No match for "${input.query}"${wanted ? ` in ${docs.map(d => d.filename).join(", ")}` : " in any document"}. `
      + `Searched: ${docs.map(d => `${d.filename} (${d.text.length} chars)`).join(", ")}. `
      + `Say that you could not find it rather than answering from memory.`
  }

  // Take the wordiest hit from each region of each document before filling the
  // remaining slots by score. Without this the table of contents — far and away
  // the most prose-dense page in a price list — takes every slot, and the
  // section that actually explains the product never gets shown.
  const byZone = new Map<string, Hit>()
  for (const h of hits) {
    const held = byZone.get(h.zone)
    if (!held || h.score > held.score) byZone.set(h.zone, h)
  }
  const spread = [...byZone.values()].sort((a, b) => b.score - a.score)
  const rest   = hits.filter(h => !spread.includes(h)).sort((a, b) => b.score - a.score)
  const shown  = [...spread, ...rest].slice(0, SHOW).sort((a, b) => a.offset - b.offset)
  const head = hits.length > shown.length
    ? `${hits.length} match(es) for "${input.query}" — showing the ${shown.length} with the most surrounding text (the rest sit inside price grids). Narrow the query or use read_knowledge if you need a different one.`
    : `${hits.length} match(es) for "${input.query}":`

  return head + "\n\n" + shown.map(h => `--- ${h.file} @ offset ${h.offset} ---\n...${h.window}...`).join("\n\n")
}

export function readKnowledge(input: any, library: KnowledgeDoc[]) {
  const wanted = String(input.filename ?? "").trim().toLowerCase()
  const doc = library.find(d => d.filename.toLowerCase() === wanted)
    || library.find(d => d.filename.toLowerCase().includes(wanted))
  if (!doc) return `No document named "${input.filename}". Available: ${library.map(d => d.filename).join(", ")}`

  const offset = Math.max(0, Math.min(Number(input.offset ?? 0) || 0, doc.text.length))
  const length = Math.max(1, Math.min(Number(input.length ?? 20000) || 20000, 60000))
  const slice  = doc.text.slice(offset, offset + length)
  const endsAt = offset + slice.length

  return `${doc.filename} — characters ${offset}–${endsAt} of ${doc.text.length}\n\n${slice}\n\n`
    + (endsAt < doc.text.length
        ? `[${doc.text.length - endsAt} characters remain. Read on with offset ${endsAt}.]`
        : "[End of document.]")
}

/**
 * Render knowledge documents into prompt lines, giving each up to `docCap`
 * characters and the set as a whole up to `totalCap`. Anything that doesn't fit
 * is named rather than silently dropped, so the assistant can say it hasn't
 * read it instead of guessing.
 */

/** Tool definitions, identical for every assistant that reads the library. */
export const KNOWLEDGE_TOOLS = [
  {
    name: "search_knowledge",
    description:
      "Search the FULL text of every supplier document. Use this whenever you need a fabric code, colour name, fabric range, price, price group, system code or size limit that you cannot already see. Matching ignores spacing, so \"VS2\" finds \"VS 2\". Returns excerpts with the character offset of each hit.",
    input_schema: {
      type: "object",
      properties: {
        query:    { type: "string", description: "Text to find — a fabric code such as \"2312\", a fabric name, a system code such as \"VS 3\", or a section heading." },
        filename: { type: "string", description: "Optional. Restrict to one document, named exactly as it appears in the index." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_knowledge",
    description:
      "Read a window of one document by character offset. Use it after search_knowledge to read a price table or fabric list around a hit.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Exactly as named in the index." },
        offset:   { type: "integer", description: "Character offset to start at. Defaults to 0." },
        length:   { type: "integer", description: "Characters to return, max 60000. Defaults to 20000." },
      },
      required: ["filename"],
    },
  },
]
