import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// How deep the SEO drip queue is, for the CRM to display.
//
// The queue is a git branch in a PRIVATE repo (erkmmm/LussoWebite): posts are
// committed to `queue`, and a GitHub Action fast-forwards `main` over four of
// them a day. The branch is the single source of truth — a status table would
// only ever be a copy that drifts every time the drip fires.
//
// It lives here rather than in the browser because reading a private repo needs
// a token, and a token in a browser app is a published token. The CRM calls
// this with the user's own session; the token never leaves the server.

const REPO = "erkmmm/LussoWebite"
const PER_DAY = 4 // two scheduled runs at COUNT=2 — see drip-publish.yml

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
  const action = ["publish", "request-run"].includes(body?.action) ? body.action : "status"
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
    const requests = await gh("/issues?state=open&labels=run-request")
      .then((x) => x.json()).catch(() => [])
    const pendingRun = Array.isArray(requests) && requests.length > 0
      ? { number: requests[0].number, since: requests[0].created_at,
          running: (requests[0].labels ?? []).some((l: { name: string }) => l.name === "run-running") }
      : null

    return json({
      ok: true,
      configured: true,
      pendingRun,
      posts: posts.length,
      commits: data.total_commits ?? 0,
      daysOfDrip: Math.floor(posts.length / PER_DAY),
      perDay: PER_DAY,
      next: posts.slice(0, 5),
      checkedAt: new Date().toISOString(),
    })
  } catch (e) {
    return json({ ok: false, configured: true, error: String(e).slice(0, 200) }, 200)
  }
})
