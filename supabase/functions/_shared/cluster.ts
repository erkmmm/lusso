/**
 * The keyword-cluster-<slug>.md that ships alongside a page.
 *
 * The hand-written ones carry analysis a generator cannot honestly produce, so
 * this does not try to imitate that. It writes down exactly what the app knows:
 * which keywords were pulled from Semrush, their figures, when they were
 * fetched, and which one the page targets. Everything a person would need to
 * pick the argument up later, and nothing invented to fill the shape.
 */

export type ClusterKeyword = {
  keyword: string
  volume: number | null
  difficulty: number | null
  cpc: number | string | null
  intent: string | null
  created_at?: string | null
}

const n = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-AU")

const money = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—"
  const x = typeof v === "string" ? Number(v) : v
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : "—"
}

export function clusterFile(opts: {
  slug: string
  title: string
  target: string | null
  cluster: ClusterKeyword[]
  writtenAt: Date
}): string {
  const { slug, title, target, cluster, writtenAt } = opts
  const vols = cluster.map(k => k.volume ?? 0)
  const total = vols.reduce((a, b) => a + b, 0)
  const kds = cluster.map(k => k.difficulty).filter((d): d is number => d !== null)
                     .sort((a, b) => a - b)
  const medianKd = kds.length
    ? (kds.length % 2 ? kds[(kds.length - 1) / 2]
                      : Math.round((kds[kds.length / 2 - 1] + kds[kds.length / 2]) / 2))
    : null

  // The oldest row in the cluster, because a cluster is only as fresh as its
  // stalest number.
  const pulled = cluster
    .map(k => k.created_at).filter(Boolean).sort()[0]?.slice(0, 10) ?? null

  const rows = cluster.map(k => {
    const isTarget = target && k.keyword.toLowerCase() === target.toLowerCase()
    const kw = isTarget ? `**${k.keyword}**` : k.keyword
    return `| ${kw} | ${n(k.volume)} | ${n(k.difficulty)} | ${money(k.cpc)} | ${k.intent ?? "—"} |`
  }).join("\n")

  return `# Keyword cluster — ${title}

**Source:** Semrush, \`au\` database, via the CRM's keyword sync
**Target page:** [${slug}.html](${slug}.html)
**Target keyword:** ${target ?? "_not recorded_"}
**Cluster size:** ${cluster.length} keyword${cluster.length === 1 ? "" : "s"}${
    total ? ` · **combined volume:** ${n(total)}/mo` : ""
  }${medianKd !== null ? ` · **median KD:** ${medianKd}` : ""}

> Written by the CRM on ${writtenAt.toISOString().slice(0, 10)}.${
    pulled ? ` Keyword figures pulled from Semrush on ${pulled}.` : ""
  }
> These are the numbers the page was chosen on. They are not re-checked when the
> page is published, so treat anything older than a quarter as indicative.

---

## The cluster

| Keyword | Volume | KD | CPC | Intent |
| --- | ---: | ---: | ---: | --- |
${rows || "| _no cluster keywords recorded_ | — | — | — | — |"}

---

## What this file is not

The hand-written cluster notes in this repo carry a judgement call — which term
to lead on, which competitor owns the SERP, why a hard keyword is worth taking
anyway. This file does not, because the app has no honest way to produce one.
If this page matters, that analysis is still worth writing here by hand.
`
}
