import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { encryptPayload, vapidHeader } from "./webpush.ts"

// Fans one notification out to every device that has opted in to Web Push.
//
// Two callers, two ways of proving they're allowed:
//   • the notifications AFTER INSERT trigger, which passes the shared token
//     only the DB knows (same pattern as quote-notify) — sends to everyone;
//   • the "send test" button in Settings, which passes the signed-in user's
//     access token — sends only to that user's own devices.
// Dead endpoints (404/410) are deleted as we go, so the table self-cleans.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  try {
    const { token, notification, test } = await req.json().catch(() => ({}))
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    // ── Who's asking ──────────────────────────────────────────────────────────
    let onlyUserId: string | null = null
    if (token) {
      const { data: ok } = await admin.rpc("notify_token_ok", { p_token: token })
      if (!ok) return json({ error: "unauthorized" }, 401)
    } else {
      const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? ""
      const { data: { user } } = await admin.auth.getUser(jwt)
      if (!user) return json({ error: "unauthorized" }, 401)
      onlyUserId = user.id
    }

    const { data: cfg } = await admin
      .from("internal_notify_config")
      .select("vapid_public, vapid_private, vapid_subject")
      .eq("id", 1).single()
    if (!cfg?.vapid_public || !cfg?.vapid_private) return json({ ok: false, error: "VAPID keys not configured" })

    let q = admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, user_id")
    if (onlyUserId) q = q.eq("user_id", onlyUserId)
    const { data: subs, error: subErr } = await q
    if (subErr) return json({ ok: false, error: subErr.message })
    if (!subs?.length) return json({ ok: true, sent: 0, note: "no subscriptions" })

    const n = test
      ? { id: "test", type: "test", title: "Lusso test 🔔", body: "Push notifications are working on this device.", link: "/" }
      : notification
    if (!n?.title) return json({ error: "notification required" }, 400)

    const payload = JSON.stringify({
      title: n.title,
      body: n.body ?? "",
      tag: n.id ?? n.type ?? "lusso",
      url: n.link || (n.jobId ? `/jobs/${n.jobId}` : "/"),
      type: n.type ?? "",
    })

    // ── Deliver ───────────────────────────────────────────────────────────────
    const results = await Promise.all((subs as Sub[]).map(async (s) => {
      try {
        const body = await encryptPayload(payload, s.p256dh, s.auth)
        const res = await fetch(s.endpoint, {
          method: "POST",
          headers: {
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": "86400",
            "Urgency": n.type === "quote_accepted" ? "high" : "normal",
            "Authorization": await vapidHeader(s.endpoint, cfg.vapid_public, cfg.vapid_private, cfg.vapid_subject || "mailto:jobs@lusso.com.au"),
          },
          body,
        })
        if (res.status === 404 || res.status === 410) {
          // The browser threw this subscription away; stop carrying it.
          await admin.from("push_subscriptions").delete().eq("id", s.id)
          return { id: s.id, status: res.status, pruned: true }
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "")
          await admin.rpc("push_mark_failure", { p_id: s.id })
          return { id: s.id, status: res.status, error: detail.slice(0, 200) }
        }
        await admin.from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id)
        return { id: s.id, status: res.status, ok: true }
      } catch (e) {
        return { id: s.id, error: String(e).slice(0, 200) }
      }
    }))

    return json({
      ok: true,
      sent: results.filter((r) => (r as { ok?: boolean }).ok).length,
      failed: results.filter((r) => !(r as { ok?: boolean }).ok).length,
      results,
    })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
