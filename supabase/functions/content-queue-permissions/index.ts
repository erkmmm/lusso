import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Which permissions the SEO repo token actually has.
//
// Separate from content-queue-status on purpose: that function is the working
// integration and this is a diagnostic, and a diagnostic should never be a
// reason to redeploy the thing it diagnoses.
//
// Only READ is probed. Every write here has a real consequence — publishing a
// page, or opening an issue that starts an hours-long run on the Mac — and a
// permission check that fires those is worse than not knowing. A fine-grained
// token grants read and write together per resource in GitHub's UI, so read is
// a reliable proxy for whether the resource was ticked at all.

const REPO = "erkmmm/LussoWebite"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const token = Deno.env.get("SEO_REPO_TOKEN")?.trim().replace(/^['"]|['"]$/g, "")
  if (!token) return json({ ok: false, configured: false, error: "SEO_REPO_TOKEN not set" })

  const probe = async (label: string, path: string, needed: string) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lusso-crm",
      },
    })
    return { label, needed, ok: r.ok, status: r.status }
  }

  const checks = await Promise.all([
    probe("Contents", "/contents/README.md?ref=main", "read the queue, save the schedule"),
    probe("Actions", "/actions/workflows", "publish now"),
    probe("Issues", "/issues?per_page=1", "request a top-up"),
  ])

  return json({
    ok: true,
    checks,
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
    allGranted: checks.every((c) => c.ok),
  })
})
