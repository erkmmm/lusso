import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const XERO_CLIENT_ID     = Deno.env.get("XERO_CLIENT_ID")     ?? ""
const XERO_CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET") ?? ""
const XERO_REDIRECT_URI  = Deno.env.get("XERO_REDIRECT_URI")  ?? ""
const LUSSO_APP_URL      = Deno.env.get("LUSSO_APP_URL")       ?? "https://lusso-7tj.pages.dev"

// UTF-8 safe base64 — btoa() breaks on characters outside Latin1
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

Deno.serve(async (req: Request) => {
  const url   = new URL(req.url)
  const code  = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const err   = url.searchParams.get("error")

  const fail = (msg: string) =>
    Response.redirect(`${LUSSO_APP_URL}/settings?xero_error=${encodeURIComponent(msg)}`, 302)

  if (err)           return fail(err)
  if (!code||!state) return fail("Missing code or state")

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Validate and consume state
    const { data: stateRow } = await admin
      .from("xero_oauth_states").select("user_id,created_at").eq("state", state).single()
    if (!stateRow) return fail("Invalid or expired state")

    const ageMs = Date.now() - new Date(stateRow.created_at).getTime()
    await admin.from("xero_oauth_states").delete().eq("state", state)
    if (ageMs > 10 * 60 * 1000) return fail("OAuth state expired — please try again")

    // Exchange code for tokens
    const creds = toBase64(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)
    const tokenRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:   "authorization_code",
        code,
        redirect_uri: XERO_REDIRECT_URI,
      }),
    })
    if (!tokenRes.ok) return fail(`Token exchange failed: ${await tokenRes.text()}`)
    const tokens = await tokenRes.json()
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Get connected tenants
    const tenantsRes = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!tenantsRes.ok) return fail("Failed to fetch Xero organisations")
    const tenants = await tenantsRes.json()
    if (!tenants?.length) return fail("No Xero organisations found")

    // /connections returns EVERY organisation this app has ever been authorised
    // for, not just the one picked on the consent screen — so the old
    // `tenants[0]` silently ignored the user's choice. Store them all (one token
    // set covers every tenant; the org is selected per-request via the
    // Xero-tenant-id header) and let the user pick in Settings.
    const now = new Date().toISOString()

    // Which org stays live: keep the current one if it's still authorised,
    // otherwise fall back to the first. Never assume — the picker is the only
    // thing that changes this deliberately.
    const { data: current } = await admin
      .from("xero_integrations").select("tenant_id").eq("status", "active").maybeSingle()
    const activeTenantId = tenants.some((t: any) => t.tenantId === current?.tenant_id)
      ? current!.tenant_id
      : tenants[0].tenantId

    // Clear active first — a partial unique index allows only one active row, so
    // writing the new one before releasing the old would fail.
    await admin.from("xero_integrations")
      .update({ status: "available", updated_at: now })
      .eq("status", "active")

    for (const t of tenants) {
      const { error: upsertErr } = await admin.from("xero_integrations").upsert({
        tenant_id:         t.tenantId,
        organisation_name: t.tenantName,
        access_token:      tokens.access_token,
        refresh_token:     tokens.refresh_token,
        token_expires_at:  expiresAt,
        connected_by:      stateRow.user_id,
        connected_at:      now,
        status:            t.tenantId === activeTenantId ? "active" : "available",
        updated_at:        now,
      }, { onConflict: "tenant_id" })
      if (upsertErr) return fail(`DB error: ${upsertErr.message}`)
    }

    const activeName = tenants.find((t: any) => t.tenantId === activeTenantId)?.tenantName ?? "Xero"
    await admin.from("xero_sync_logs").insert({
      action: "xero_connected", entity_type: "integration",
      entity_id: activeTenantId, status: "success",
      request_summary: `Connected: ${activeName}${tenants.length > 1 ? ` (+${tenants.length - 1} other org${tenants.length > 2 ? "s" : ""} available)` : ""}`,
      created_by: stateRow.user_id,
    })

    return Response.redirect(`${LUSSO_APP_URL}/settings?xero=connected`, 302)
  } catch (e) {
    return fail(String(e))
  }
})
