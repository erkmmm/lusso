import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Step one of connecting a Facebook Page (and through it, Instagram).
//
// The callback arrives from Meta with no session -- a browser redirect, not an
// app request -- so it cannot authenticate the caller. `state` is what carries
// the connection across: random, stored here, traded back on return, and single
// use. A state that is not in the table is refused.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

// Facebook Login for Business does not take a scope list at all: `config_id`
// has replaced it. The permissions live on the configuration in the app dashboard
// (instagram_content_publish, instagram_basic, pages_show_list,
// pages_read_engagement), and sending `scope=` instead is what produced
// "Invalid Scopes: pages_manage_posts, instagram_content_publish".
//
// Instagram only, deliberately. pages_manage_posts is not available to this app
// -- its use cases are Marketing-API shaped, and Meta's own dialog says not all
// use cases can be added to one app -- so Facebook Page posting would need a
// separate app. Instagram publishes through the Page it is linked to, which
// needs only the read permissions above.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const appId    = Deno.env.get("META_APP_ID")
  const redirect = Deno.env.get("META_REDIRECT_URI")
  const configId = Deno.env.get("META_CONFIG_ID")
  if (!appId || !redirect || !configId) {
    return json({
      error: "Instagram is not set up yet",
      hint: "META_APP_ID, META_REDIRECT_URI and META_CONFIG_ID need to be set on this project",
    }, 200)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "Unauthorized" }, 401)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: "Unauthorized" }, 401)

  const state = crypto.randomUUID()
  const { error } = await admin.from("meta_oauth_states")
    .insert({ state, user_id: user.id })
  if (error) return json({ error: error.message }, 500)

  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth")
  url.searchParams.set("client_id", appId)
  url.searchParams.set("redirect_uri", redirect)
  url.searchParams.set("state", state)
  url.searchParams.set("config_id", configId)
  url.searchParams.set("response_type", "code")

  return json({ ok: true, url: url.toString() })
})
