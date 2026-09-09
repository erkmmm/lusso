import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Step two: Meta redirects the browser here with a code.
//
// Two exchanges: code -> short-lived user token -> long-lived user token, then
// the Page token from /me/accounts.
//
// A system-user configuration would have made this one call and a token that
// never expires, and that was the original plan. It is not possible here: Meta
// greys out the business portfolio that OWNS the app in the system-user asset
// picker -- "This Meta Business Account owns the app" -- and Lusso Blinds owns
// this one. Facebook Login for Business assumes an agency connecting a CLIENT's
// assets, which is not the shape of a business connecting its own.
//
// So the sixty-day clock is back, by Meta's constraint rather than by choice.
// That is exactly what content_channels.expires_at and the "expiring_soon" flag
// on the safe view exist for: the reconnect prompt appears a fortnight out
// instead of posts failing one morning with no explanation.

const html = (title: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <body style="font:16px/1.5 system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f8fafc">
       <div style="max-width:32rem;padding:2rem;text-align:center">
         <h1 style="font-size:1.25rem;color:${ok ? "#0f172a" : "#be123c"}">${title}</h1>
         <p style="color:#475569">${body}</p>
         <p style="color:#94a3b8;font-size:.875rem">You can close this window.</p>
       </div>
     </body>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )

const GRAPH = "https://graph.facebook.com/v21.0"

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code  = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  // Meta sends the user back here when they cancel, too.
  const denied = url.searchParams.get("error_description")
  if (denied) return html("Not connected", denied, false)
  if (!code || !state) return html("Not connected", "Facebook did not send a code back.", false)

  const appId     = Deno.env.get("META_APP_ID")
  const appSecret = Deno.env.get("META_APP_SECRET")
  const redirect  = Deno.env.get("META_REDIRECT_URI")
  const appUrl    = Deno.env.get("APP_URL") ?? ""
  if (!appId || !appSecret || !redirect) {
    return html("Not connected", "This project has no Meta app configured.", false)
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // The state is single-use: deleted as it is read, so a replayed callback
  // cannot attach a second connection to someone else's org.
  const { data: pending } = await admin
    .from("meta_oauth_states").delete().eq("state", state).select("state").maybeSingle()
  if (!pending) {
    return html("Not connected", "That sign-in link had already been used, or it expired.", false)
  }

  try {
    // 1. code -> short-lived user token
    const shortRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: redirect, code,
    }))
    const short = await shortRes.json()
    if (!short.access_token) throw new Error(short.error?.message ?? "no token returned")

    // 2. short-lived -> long-lived. Skipping this leaves a token that dies in an
    // hour, which would look like the connection working and then not.
    const longRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret,
      fb_exchange_token: short.access_token,
    }))
    const token = await longRes.json()
    if (!token.access_token) throw new Error(token.error?.message ?? "could not extend the token")

    // Meta returns expires_in only sometimes; 60 days is its documented life, and
    // a conservative stand-in beats storing null and then warning about nothing.
    const expiresAt = new Date(Date.now() + (Number(token.expires_in) || 60 * 24 * 3600) * 1000)

    // The Pages this login can reach, with any linked Instagram account.
    // Instagram is only reachable through a Page it is linked to -- there is no
    // way to publish to an Instagram account that stands alone.
    //
    // TWO sources, because /me/accounts alone is not enough. It lists Pages the
    // PERSON administers directly; a Page owned by a business portfolio is
    // administered through that business and comes back as {"data":[]} -- which
    // is exactly what happened here, with no error to explain it. So when the
    // direct list is empty, walk the businesses instead.
    const FIELDS = "id,name,access_token,instagram_business_account{id,username}"
    const get = async (path: string) => {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}`
        + `access_token=${encodeURIComponent(token.access_token)}`)
      return await r.json()
    }

    let pages = await get(`me/accounts?fields=${FIELDS}`)
    const tried: string[] = [`me/accounts -> ${(pages.data ?? []).length}`]

    if (!(pages.data ?? []).length) {
      const businesses = await get("me/businesses?fields=id,name")
      tried.push(`me/businesses -> ${(businesses.data ?? []).length}`)
      for (const b of businesses.data ?? []) {
        for (const edge of ["owned_pages", "client_pages"]) {
          const found = await get(`${b.id}/${edge}?fields=${FIELDS}`)
          tried.push(`${b.name}/${edge} -> ${(found.data ?? []).length}`)
          if ((found.data ?? []).length) { pages = found; break }
        }
        if ((pages.data ?? []).length) break
      }
    }
    const page = (pages.data ?? []).find(
      (p: { instagram_business_account?: { id: string } }) => p.instagram_business_account?.id)
      ?? pages.data?.[0]
    if (!page) {
      // Say what Graph actually returned. "No Page found" with nothing else is
      // the kind of dead end that costs an hour of guessing; the error body and
      // the shape of the response narrow it to one cause immediately.
      throw new Error(
        (pages.error?.message ? `Graph: ${pages.error.message}. ` : "")
        + `No Page found. Tried: ${tried.join("; ")}`)
    }

    const ig = page.instagram_business_account
    if (!ig?.id) {
      throw new Error(
        `the Page "${page.name}" has no Instagram Business account linked to it. `
        + `Link one in Meta Business Suite, then connect again.`)
    }

    // Instagram only. A Facebook row is deliberately not written: posting to a
    // Page needs pages_manage_posts, which this app cannot request, so a
    // facebook row here would be a connection that looks live and fails on the
    // first post.
    const { error } = await admin.from("content_channels").upsert({
      channel: "instagram",
      page_id: page.id,
      ig_user_id: ig.id,
      display_name: ig.username ?? page.name,
      // The PAGE token, not the user token: publishing to an Instagram account
      // goes through the Page it is linked to.
      access_token: page.access_token ?? token.access_token,
      expires_at: expiresAt.toISOString(),
      last_error: null,
    }, { onConflict: "channel" })
    if (error) throw new Error(error.message)

    return html(
      "Instagram connected",
      `Posting as @${ig.username ?? page.name}, through the Page "${page.name}". `
      + `${appUrl ? `Head back to ${appUrl}` : "Head back to the app"} — it is under Content → Social.`,
      true,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from("content_channels")
      .update({ last_error: msg.slice(0, 300) })
      .eq("channel", "instagram")
    return html("Not connected", msg, false)
  }
})
