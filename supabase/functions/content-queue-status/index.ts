import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// How deep the SEO drip queue is, for the CRM to display.
//
// The queue is a git branch in a PRIVATE repo (erkmmm/LussoWebite): posts are
// committed to `queue`, and a GitHub Action fast-forwards `main` over a few of
// them a day, on the timetable in drip-schedule.json. The branch is the single
// source of truth — a status table would only ever be a copy that drifts every
// time the drip fires.
//
// It lives here rather than in the browser because reading a private repo needs
// a token, and a token in a browser app is a published token. The CRM calls
// this with the user's own session; the token never leaves the server.

const REPO = "erkmmm/LussoWebite"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  // Two things this can do: report the queue, or publish from it. Publishing is
  // never implicit — the CRM has to ask for it by name, because it puts a page
  // on the live site and there is no undo short of a revert.
  const body = await req.json().catch(() => ({}))
  const action = ["publish", "request-run", "request-edit", "get-schedule", "set-schedule"].includes(body?.action)
    ? body.action : "status"
  const count = Math.min(Math.max(Number(body?.count) || 1, 1), 4)

  // A secret is almost never wrong in an interesting way — it is wrapped in the
  // quotes a shell kept, or carries the newline a paste added. Both are
  // indistinguishable from a genuinely wrong token at GitHub's end: all three
  // come back 401 Bad credentials.
  const rawToken = Deno.env.get("SEO_REPO_TOKEN")
  const token = rawToken?.trim().replace(/^['"]|['"]$/g, "")
  if (!token) {
    // Say so plainly rather than 500ing: an unconfigured integration and a
    // broken one look identical from the CRM otherwise.
    return json({ ok: false, configured: false, error: "SEO_REPO_TOKEN not set" })
  }

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

  // The drip's timetable. It lives in the repo rather than here because the
  // GitHub Action is what reads it, and a schedule stored where the thing it
  // governs cannot see it is a schedule waiting to be wrong.
  const SCHEDULE_PATH = "drip-schedule.json"
  const DEFAULT_SLOTS = [{ hour: 9, count: 2 }, { hour: 14, count: 2 }]

  // How many posts a day the drip actually sends.
  //
  // This was a hardcoded 4, which was right on the day it was written and stayed
  // right only by luck: the workflow now wakes hourly and asks this file whether
  // the hour is a slot, so editing the timetable from the CRM changed reality
  // while the constant went on quoting the old figure — and every "in N days" on
  // the Content page is derived from it. Read what the workflow reads.
  //
  // From `main`, because the workflow that runs is main's. And falling back to
  // the same two slots drip-publish.yml falls back to: two copies of a default
  // that disagree is how a status page starts lying.
  const readSlots = async (): Promise<{ hour: number; count: number }[]> => {
    try {
      const r = await gh(`/contents/${SCHEDULE_PATH}?ref=main`)
      if (!r.ok) return DEFAULT_SLOTS
      const f = await r.json()
      const cfg = JSON.parse(atob(f.content.replace(/\n/g, "")))
      const slots = (Array.isArray(cfg?.slots) ? cfg.slots : [])
        .map((x: { hour: unknown; count: unknown }) => ({
          hour: Math.trunc(Number(x?.hour)),
          count: Math.trunc(Number(x?.count)),
        }))
        .filter((x: { hour: number; count: number }) =>
          Number.isFinite(x.hour) && Number.isFinite(x.count) && x.count > 0)
        .sort((a: { hour: number }, b: { hour: number }) => a.hour - b.hour)
      return slots.length ? slots : DEFAULT_SLOTS
    } catch {
      return DEFAULT_SLOTS
    }
  }

  if (action === "get-schedule") {
    const r = await gh(`/contents/${SCHEDULE_PATH}?ref=main`)
    if (r.status === 404) {
      // Not written yet: report what the workflow falls back to, so the editor
      // opens showing what is actually happening rather than an empty form.
      return json({ ok: true, slots: DEFAULT_SLOTS, usingDefault: true })
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return json({ ok: false, error: `github ${r.status}${d?.message ? `: ${d.message}` : ""}` })
    }
    const file = await r.json()
    try {
      const cfg = JSON.parse(atob(file.content.replace(/\n/g, "")))
      return json({ ok: true, slots: cfg.slots ?? DEFAULT_SLOTS, sha: file.sha })
    } catch {
      return json({ ok: false, error: "drip-schedule.json is not valid JSON" })
    }
  }

  if (action === "set-schedule") {
    // The workflow only wakes between 06:00 and 20:00 AEST, so a slot outside
    // that would be saved and then silently never fire — worse than refusing it.
    const raw = Array.isArray(body?.slots) ? body.slots : []
    const slots = raw
      .map((s: { hour: unknown; count: unknown }) => ({
        hour: Math.trunc(Number(s?.hour)),
        count: Math.trunc(Number(s?.count)),
      }))
      .filter((s: { hour: number; count: number }) =>
        Number.isFinite(s.hour) && s.hour >= 6 && s.hour <= 20 &&
        Number.isFinite(s.count) && s.count >= 1 && s.count <= 4)
      .sort((a: { hour: number }, b: { hour: number }) => a.hour - b.hour)
    // One slot per hour; two entries for 09:00 would make "how many at nine"
    // depend on array order.
    const unique = slots.filter((s: { hour: number }, i: number, arr: { hour: number }[]) =>
      arr.findIndex((x) => x.hour === s.hour) === i)

    if (unique.length === 0) {
      return json({ ok: false, error: "no valid slots — hours must be 06–20 AEST, counts 1–4" })
    }

    const current = await gh(`/contents/${SCHEDULE_PATH}?ref=main`)
    const sha = current.ok ? (await current.json()).sha : undefined
    const content = JSON.stringify(
      { timezone: "Australia/Brisbane", slots: unique }, null, 2) + "\n"

    const r = await gh(`/contents/${SCHEDULE_PATH}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "Set the drip publishing times from the CRM",
        content: btoa(content),
        branch: "main",
        ...(sha ? { sha } : {}),
      }),
    })
    if (r.ok) {
      const perDay = unique.reduce((n: number, s: { count: number }) => n + s.count, 0)
      return json({ ok: true, slots: unique, perDay })
    }
    const d = await r.json().catch(() => ({}))
    return json({
      ok: false,
      error: `github ${r.status}${d?.message ? `: ${d.message}` : ""}`,
      hint: r.status === 403 || r.status === 404
        ? "the repo token needs Contents: read and write"
        : undefined,
    })
  }

  if (action === "request-edit") {
    // Editing a queued page is the same shape of problem as writing one: it
    // needs Claude, which does not run in a browser. So this leaves a request
    // the Mac claims, exactly like a top-up — a different label, a different
    // script, the same relay.
    //
    // The page is identified by FILENAME, never by commit sha. Applying an edit
    // rewrites the commit that added the page, so the sha the CRM was looking at
    // stops existing the moment the first edit lands. A filename survives that;
    // a sha would send the second edit hunting for a commit that is gone.
    const filename = String(body?.filename ?? "")
    const instruction = String(body?.instruction ?? "").trim()
    if (!/^[a-z0-9][a-z0-9-]*\.html$/.test(filename)) {
      return json({ ok: false, error: "a top-level page filename is required" }, 400)
    }
    if (instruction.length < 4) {
      return json({ ok: false, error: "say what should change" }, 400)
    }
    if (instruction.length > 4000) {
      return json({ ok: false, error: "that is too long — keep it under 4000 characters" }, 400)
    }

    // One open edit per page. Two would race: the first rewrites the commit, and
    // the second would be working from a tree that no longer exists.
    const open = await gh("/issues?state=open&labels=edit-request&per_page=100")
      .then((x) => x.json()).catch(() => [])
    const existing = Array.isArray(open)
      ? open.find((i: { title: string }) => i.title === `Edit ${filename}`)
      : undefined
    if (existing) {
      return json({ ok: true, alreadyRequested: true, number: existing.number, filename })
    }

    const who = body?.requestedBy ? ` by ${String(body.requestedBy).slice(0, 80)}` : ""
    const r = await gh("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: `Edit ${filename}`,
        labels: ["edit-request"],
        // The fenced block is what scripts/edit-requests.py parses; the prose
        // above it is for whoever opens the issue on GitHub instead.
        body: `Requested from the CRM${who}, while the page was still in the queue.\n\n`
          + `\`\`\`json\n${JSON.stringify({ file: filename, instruction }, null, 2)}\n\`\`\`\n\n`
          + `The Mac amends the queued commit in place and force-pushes the queue, so the `
          + `page publishes edited rather than publishing twice.`,
      }),
    })
    if (r.status === 201) {
      const created = await r.json()
      return json({ ok: true, requested: true, number: created.number, filename })
    }
    const detail = await r.json().catch(() => ({}))
    return json({
      ok: false,
      error: `github ${r.status}${detail?.message ? `: ${detail.message}` : ""}`,
      hint: r.status === 403 || r.status === 404
        ? "the repo token needs Issues: read and write"
        : undefined,
    }, 200)
  }

  if (action === "request-run") {
    // The CRM cannot write a page — that needs Claude, which does not run in a
    // browser. So this leaves a request where the Mac is watching: an issue
    // labelled `run-request`, which scripts/run-requests.py claims within a
    // couple of minutes and reports back on in the same thread.
    const existing = await gh("/issues?state=open&labels=run-request")
      .then((x) => x.json()).catch(() => [])
    if (Array.isArray(existing) && existing.length > 0) {
      // Two requests would not run twice, they would queue — and the second
      // would look ignored. Say it is already asked for instead.
      return json({ ok: true, alreadyRequested: true, number: existing[0].number })
    }
    const who = body?.requestedBy ? ` by ${String(body.requestedBy).slice(0, 80)}` : ""
    const r = await gh("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: "Weekly top-up requested",
        labels: ["run-request"],
        body: `Requested from the CRM${who}.\n\nThe Mac picks this up within a couple of `
          + `minutes if it is awake and logged in, tops the queue back up to 28, and reports `
          + `here. A full top-up runs for hours.`,
      }),
    })
    if (r.status === 201) {
      const created = await r.json()
      return json({ ok: true, requested: true, number: created.number })
    }
    const detail = await r.json().catch(() => ({}))
    return json({
      ok: false,
      error: `github ${r.status}${detail?.message ? `: ${detail.message}` : ""}`,
      hint: r.status === 403 || r.status === 404
        ? "the repo token needs Issues: read and write"
        : undefined,
    }, 200)
  }

  if (action === "publish") {
    // workflow_dispatch is the same door the scheduled run comes through, so a
    // manual publish behaves identically to an automatic one — same fast-forward,
    // same author, same Vercel deploy.
    const r = await gh("/actions/workflows/drip-publish.yml/dispatches", {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs: { count: String(count) } }),
    })
    if (r.status === 204) return json({ ok: true, dispatched: count })
    const detail = await r.json().catch(() => ({}))
    // 403 here almost always means the token is Contents-only. Dispatching a
    // workflow additionally needs Actions: write, and saying so beats "403".
    return json({
      ok: false,
      error: `github ${r.status}${detail?.message ? `: ${detail.message}` : ""}`,
      hint: r.status === 403 || r.status === 404
        ? "the repo token needs Actions: read and write, not just Contents: read"
        : undefined,
    }, 200)
  }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/compare/main...queue`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lusso-crm",
      },
    })
    if (!r.ok) {
      // Pass GitHub's own words through. "Bad credentials" (a wrong or expired
      // token) and "Not Found" (a fine-grained token that was never granted
      // this repo) are the same status code but completely different fixes.
      const detail = await r.json().catch(() => ({}))
      // Describe the secret's SHAPE, never its value. A real GitHub token is
      // ~40 chars for a classic `ghp_` and 80-plus for a `github_pat_`; a
      // length far off that, or a missing prefix, says the paste was truncated
      // or the wrong string entirely — which no amount of re-reading the docs
      // would have told anyone.
      const shape = {
        length: token?.length ?? 0,
        prefix: token ? `${token.split("_").slice(0, -1).join("_")}_` : null,
        hadWhitespace: rawToken !== rawToken?.trim(),
        hadQuotes: /^['"]|['"]$/.test(rawToken?.trim() ?? ""),
      }
      return json({
        ok: false,
        configured: true,
        error: `github ${r.status}${detail?.message ? `: ${detail.message}` : ""}`,
        tokenShape: shape,
      }, 200)
    }
    const data = await r.json()

    // Only commits that actually add a page count as posts — the branch also
    // carries tooling commits, and the drip skips those. Matching that rule
    // here is what stops the CRM reporting a queue deeper than it really is.
    //
    // queue.py decides this by looking for an added top-level .html file, which
    // would be one API call per commit. The compare endpoint's own `files` list
    // is no substitute: it is capped at 300 and silently truncates. So we go by
    // the subject line instead — every post reads "... post" or "... service
    // page", while tooling commits like "Add the unattended batch runner" do
    // not. Checked against the real branch: 28 either way.
    const posts = (data.commits ?? [])
      .map((c: { sha: string; commit: { message: string; author: { date: string } } }) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0],
        date: c.commit.author.date,
      }))
      .filter((c: { message: string }) => /\b(post|page)$/i.test(c.message.trim()))

    // Cheap enough to fold into the status call, and it is what stops the CRM
    // offering a button that would only ever say "already requested".
    //
    // One read for both kinds of request rather than one per label: GitHub ANDs
    // the `labels` filter, so asking for either would be two round trips on the
    // hot path. The repo carries a handful of issues, so a page of 100 is the
    // lot. `pull_request` is how a PR is told apart — /issues returns both.
    type Issue = {
      number: number; title: string; created_at: string
      labels?: { name: string }[]; pull_request?: unknown
    }
    // Concurrently with the timetable: two independent reads, and making the
    // status page a round trip slower to report a number is a poor trade.
    const [raw, slots] = await Promise.all([
      gh("/issues?state=open&per_page=100").then((x) => x.json()).catch(() => []),
      readSlots(),
    ])
    const perDay = slots.reduce((n, x) => n + x.count, 0) || 1
    const issues: Issue[] = Array.isArray(raw) ? raw.filter((i: Issue) => !i.pull_request) : []
    const labelled = (i: Issue, name: string) => (i.labels ?? []).some((l) => l.name === name)

    const runs = issues.filter((i) => labelled(i, "run-request"))
    const pendingRun = runs.length > 0
      ? { number: runs[0].number, since: runs[0].created_at, running: labelled(runs[0], "run-running") }
      : null

    // Which queued pages have an edit waiting. Keyed by filename because that is
    // what survives the amend — see the request-edit branch above. The CRM uses
    // it to badge the queue list and to stop offering a second edit on a page
    // that already has one in flight.
    const editRequests = issues
      .filter((i) => labelled(i, "edit-request"))
      .map((i) => ({
        number: i.number,
        file: i.title.replace(/^Edit\s+/, ""),
        since: i.created_at,
        running: labelled(i, "edit-running"),
      }))

    return json({
      ok: true,
      configured: true,
      pendingRun,
      editRequests,
      posts: posts.length,
      commits: data.total_commits ?? 0,
      daysOfDrip: Math.floor(posts.length / perDay),
      perDay,
      slots,
      // `next` for the Today card, which only has room for a few; `all` for the
      // Content page, which shows the whole queue in publishing order. Capped
      // at 100 so a queue nobody has drained cannot bloat the response.
      next: posts.slice(0, 5),
      all: posts.slice(0, 100),
      checkedAt: new Date().toISOString(),
    })
  } catch (e) {
    return json({ ok: false, configured: true, error: String(e).slice(0, 200) }, 200)
  }
})
