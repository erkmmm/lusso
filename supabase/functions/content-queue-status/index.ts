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

  const token = Deno.env.get("SEO_REPO_TOKEN")
  if (!token) {
    // Say so plainly rather than 500ing: an unconfigured integration and a
    // broken one look identical from the CRM otherwise.
    return json({ ok: false, configured: false, error: "SEO_REPO_TOKEN not set" })
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
      return json({ ok: false, configured: true, error: `github ${r.status}` }, 200)
    }
    const data = await r.json()

    // Only commits that actually add a page count as posts — the branch also
    // carries tooling commits, and the drip skips those. Matching that rule
    // here is what stops the CRM reporting a queue deeper than it really is.
    const posts = (data.commits ?? [])
      .map((c: { sha: string; commit: { message: string; author: { date: string } } }) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0],
        date: c.commit.author.date,
      }))
      .filter((c: { message: string }) => /^Add /i.test(c.message))

    return json({
      ok: true,
      configured: true,
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
