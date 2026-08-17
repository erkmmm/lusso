// GET    → return connection status + settings (no tokens)
// PATCH  → update settings
// POST   → switch active org ({ activateTenantId }) or dismiss sync-log
//          errors ({ ids: [...] } or { all: true })
// DELETE → disconnect
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Allow-Methods is required, not optional, for the methods this function uses.
// GET/HEAD/POST are CORS-safelisted and pass preflight without it, but PATCH
// and DELETE are not — omitting it made the browser reject the preflight, so
// Disconnect and Save Settings both died with a bare "Failed to fetch" before
// the request was ever sent.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Unauthorized" }, 401)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "Unauthorized" }, 401)

    const { data: profile } = await supabase
      .from("profiles").select("role,status").eq("id", user.id).single()
    if (profile?.role !== "account_manager" || profile?.status !== "active")
      return json({ error: "Account Manager access required" }, 403)

    if (req.method === "GET") {
      const { data: intg } = await admin
        .from("xero_integrations")
        .select("id,tenant_id,organisation_name,connected_at,last_synced_at,status,settings")
        .eq("status", "active")
        .maybeSingle()

      // `id` is returned so the panel can dismiss a specific entry; dismissed
      // rows stay in the table but drop out of this list.
      const { data: errors } = await admin
        .from("xero_sync_logs")
        .select("id,action,status,error_message,created_at")
        .eq("status", "error")
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(5)

      // Every organisation this Xero consent covers, so Settings can offer a
      // switcher instead of making the user re-run OAuth and hope.
      const { data: orgs } = await admin
        .from("xero_integrations")
        .select("tenant_id,organisation_name,status")
        .in("status", ["active", "available"])
        .order("organisation_name")

      return json({
        connected: !!intg,
        integration: intg ? {
          organisationName: intg.organisation_name,
          tenantId:         intg.tenant_id,
          connectedAt:      intg.connected_at,
          lastSyncedAt:     intg.last_synced_at,
          status:           intg.status,
          settings:         intg.settings ?? {},
        } : null,
        organisations: (orgs ?? []).map(o => ({
          tenantId: o.tenant_id,
          name:     o.organisation_name,
          active:   o.status === "active",
        })),
        recentErrors: errors ?? [],
      })
    }

    if (req.method === "PATCH") {
      const body = await req.json()
      const { data: updated } = await admin
        .from("xero_integrations")
        .update({ settings: body.settings, updated_at: new Date().toISOString() })
        .eq("status", "active")
        .select("settings")
        .single()
      return json({ settings: updated?.settings })
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}))
      const now = new Date().toISOString()

      // Switch which authorised organisation invoices are created in.
      if (body.activateTenantId) {
        const { data: target } = await admin
          .from("xero_integrations")
          .select("tenant_id,organisation_name,access_token,status")
          .eq("tenant_id", body.activateTenantId)
          .maybeSingle()
        if (!target) return json({ error: "That organisation is not authorised" }, 404)
        if (!target.access_token)
          return json({ error: "That organisation has no valid token — reconnect to Xero first" }, 400)

        // Release the current active row before claiming the new one: a partial
        // unique index permits only one active row at a time.
        await admin.from("xero_integrations")
          .update({ status: "available", updated_at: now })
          .eq("status", "active")
        const { error: actErr } = await admin.from("xero_integrations")
          .update({ status: "active", updated_at: now })
          .eq("tenant_id", body.activateTenantId)
        if (actErr) return json({ error: actErr.message }, 500)

        await admin.from("xero_sync_logs").insert({
          action: "xero_org_switched", entity_type: "integration",
          entity_id: target.tenant_id, status: "success",
          request_summary: `Active organisation set to ${target.organisation_name}`,
          created_by: user.id,
        })
        return json({ success: true, organisationName: target.organisation_name })
      }

      let q = admin.from("xero_sync_logs")
        .update({ dismissed_at: now })
        .eq("status", "error")
        .is("dismissed_at", null)

      if (body.all === true) {
        // Dismiss every outstanding error.
      } else if (Array.isArray(body.ids) && body.ids.length > 0) {
        q = q.in("id", body.ids)
      } else {
        return json({ error: "Provide ids: [...] or all: true" }, 400)
      }

      const { data: dismissed, error } = await q.select("id")
      if (error) return json({ error: error.message }, 500)
      return json({ success: true, dismissed: dismissed?.length ?? 0 })
    }

    if (req.method === "DELETE") {
      // Every authorised org shares the one token set, so disconnecting has to
      // clear them all — leaving a sibling row holding live tokens would mean
      // "Disconnected" in the UI while the credentials still worked.
      await admin.from("xero_integrations")
        .update({ status: "disconnected", access_token: null, refresh_token: null, updated_at: new Date().toISOString() })
        .in("status", ["active", "available", "error"])
      await admin.from("xero_sync_logs").insert({
        action: "xero_disconnected", entity_type: "integration",
        status: "success", created_by: user.id,
      })
      return json({ success: true })
    }

    return json({ error: "Method not allowed" }, 405)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}
