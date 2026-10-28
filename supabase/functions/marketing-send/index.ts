/**
 * marketing-send — sends ONE wave of a campaign, by email or by SMS.
 *
 * Waves, not blasts. The last campaign went to the whole list in a week and
 * the repair requests it (correctly) produced arrived faster than the install
 * diary could absorb. Wave size is a capacity number: how many service calls
 * the business can take, not how fast Resend can go.
 *
 * Safety, in order of how badly each failure would hurt:
 *
 *   · The marketing_sends row is claimed BEFORE the email is sent. The unique
 *     index on (campaign_id, lower(email)) means a crash mid-wave, a retry or
 *     a nervous second click cannot mail the same person twice.
 *   · Suppressed addresses never appear in the audience; marketing_audience()
 *     is the single definition of who gets mail, shared with the UI preview.
 *   · A template token that fails to resolve fails that recipient rather than
 *     emailing them a raw "{{first_name}}".
 *   · Sent from MARKETING_EMAIL_FROM, which must be a different subdomain to
 *     the one that delivers quotes. Spam complaints on a ten-year-old list are
 *     a certainty, and that reputation must not be shared with jobs@.
 *   · Reply-To is the customer's reply token, so "can you fix my blinds" lands
 *     on their record in the CRM instead of in a shared inbox.
 *
 * SMS differs from email in three ways that matter here, and only three:
 *
 *   · Reachability is a different test. marketing_audience() returns people
 *     who are `textable` for an SMS campaign and `emailable` for an email one,
 *     and the two do not substitute — a mobile is not a fallback for a bounced
 *     address. Suppression is likewise separate: STOP stops the texts, it does
 *     not unsubscribe the email, because the customer did not ask for that.
 *   · Every message costs money per segment, so the length maths is done
 *     before sending (see sms.ts) and surfaced in the preview rather than
 *     discovered on the bill.
 *   · The opt-out is a keyword, not a link. It is appended to every message
 *     and honoured by comms-inbound. Those two halves must ship together.
 *
 * POST body:
 *   { campaignId, waveSize?, dryRun?, testTo? }
 *     dryRun  — render the first few and report counts, write nothing
 *     testTo  — send one rendered email to that address, write nothing
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"
import { renderEmail, renderText } from "../send-communication/emailLayout.ts"
import { merge, hasUnresolved } from "./merge.ts"
import { composeSms, smsMetrics, smsProblems } from "./sms.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Resend's default allowance is 2 requests/second. One wave is small by
// design, so pacing is cheaper than the complexity of the batch endpoint.
const SEND_GAP_MS = 550

// Twilio AU long-code throughput is ~1 message/second.
const SMS_GAP_MS = 1050

// Hard ceiling per invocation regardless of wave_size, so a mistyped number
// cannot run the function past its wall-clock limit halfway through a wave.
const MAX_PER_RUN = 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Recipient {
  customer_id: string
  name: string | null
  first_name: string | null
  email: string
  business_name: string | null
  suburb: string | null
  last_purchase_label: string | null
  last_purchase_year: number | null
  years_since_purchase: number | null
  purchase_count: number
  lifetime_value: number
  blind_count: number
  curtain_count: number
  has_motorised: boolean
  has_battery: boolean
  primary_product: string | null
  product_phrase: string | null
  product_families: string[]
  mobile_e164: string | null
  textable: boolean
}

type Channel = "email" | "sms"

/** The address a given channel actually delivers to. */
const addressOf = (channel: Channel, r: Recipient) =>
  channel === "sms" ? (r.mobile_e164 ?? "") : r.email

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  try {
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

    // Mailing the customer list is an account-manager action. Deliberately
    // stricter than sending one email to one customer.
    const { data: isManager } = await supabase.rpc("is_account_manager")
    if (!isManager) return json({ error: "Only an account manager can send a campaign" }, 403)

    const { campaignId, waveSize, dryRun, testTo } = await req.json()
    if (!campaignId) return json({ error: "campaignId required" }, 400)

    const { data: campaign, error: cErr } = await admin
      .from("marketing_campaigns").select("*").eq("id", campaignId).maybeSingle()
    if (cErr)      return json({ error: `Campaign lookup failed: ${cErr.message}` }, 500)
    if (!campaign) return json({ error: `No campaign "${campaignId}"` }, 404)
    if (campaign.status === "paused" && !dryRun && !testTo) {
      return json({ error: "Campaign is paused" }, 409)
    }

    // The campaign decides its own channel; the request never overrides it.
    // A caller that could pass channel could text a list written for email.
    const channel: Channel = campaign.channel === "sms" ? "sms" : "email"

    const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
    // No silent fallback to the transactional sender: shipping marketing from
    // the address that delivers quotes is the one mistake this file exists to
    // prevent, so an unset secret is an error, not a default.
    const FROM = Deno.env.get("MARKETING_EMAIL_FROM") ?? ""
    // Twilio's own credentials, shared with send-communication: campaign texts
    // come from the same registered AU mobile customers already reply to, so a
    // reply threads onto their record through the existing inbound webhook.
    const TW_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? ""
    const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
    const TW_FROM  = Deno.env.get("TWILIO_PHONE_NUMBER") ?? ""

    if (channel === "email") {
      if (!RESEND_KEY)      return json({ error: "RESEND_API_KEY is not configured" }, 500)
      if (!FROM && !dryRun) return json({ error: "MARKETING_EMAIL_FROM is not set. Marketing must send from a different subdomain to quotes — set it before sending." }, 500)
    } else if (!dryRun) {
      if (!TW_SID || !TW_TOKEN || !TW_FROM) {
        return json({ error: "Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER)" }, 500)
      }
    }

    const APP_URL      = Deno.env.get("APP_URL") ?? "https://app.lusso.com.au"
    const REPLY_DOMAIN = Deno.env.get("REPLY_DOMAIN") ?? ""

    const size = Math.min(
      Math.max(1, Number(waveSize) || campaign.wave_size || 50),
      MAX_PER_RUN,
    )

    // Segment membership is derived from a materialised view, so a customer who
    // accepted a quote since the last refresh is still sitting in their old
    // segment — and segment D invites people to replace blinds they may have
    // only just bought. Refresh before a real wave. A preview is advisory and
    // can read whatever is current; paying 1-2s on every preview click is not
    // worth it.
    if (!dryRun && !testTo) {
      const { error: rErr } = await admin.rpc("marketing_refresh_facts")
      // Not fatal: stale segments are a worse message, not a broken send, and
      // refusing the whole wave over a refresh hiccup helps nobody.
      if (rErr) console.error("marketing_refresh_facts failed:", rErr.message)
    }

    // One definition of the audience, shared with the UI preview, so the two
    // can never disagree about who is about to be mailed.
    const { data: audience, error: aErr } = await admin
      .rpc("marketing_audience", { p_campaign_id: campaignId, p_limit: testTo ? 1 : size })
    if (aErr) return json({ error: `Audience failed: ${aErr.message}` }, 500)

    const recipients = (audience ?? []) as Recipient[]
    const remaining = await audienceCount(admin, campaignId)

    if (!recipients.length) {
      return json({ ok: true, sent: 0, remaining: 0, note: "Audience is empty — everyone eligible has been sent." })
    }

    const wave = testTo ? 0 : await nextWave(admin, campaignId)

    // ── Dry run ────────────────────────────────────────────────────────────
    if (dryRun) {
      return json({
        ok: true,
        dryRun: true,
        campaign: campaign.id,
        wave,
        waveSize: size,
        inThisWave: recipients.length,
        remainingAfter: remaining === null ? null : Math.max(0, remaining - recipients.length),
        channel,
        from: channel === "sms"
          ? (TW_FROM || "(TWILIO_PHONE_NUMBER not set)")
          : (FROM || "(MARKETING_EMAIL_FROM not set)"),
        // Segments across the whole wave, not just the sampled three — the
        // number that decides what this costs. Estimated from the sample's
        // worst case, because rendering 100 bodies to count them is wasteful
        // and under-estimating is the failure that matters.
        ...(channel === "sms" ? { smsSegmentsPerMessage: worstSegments(campaign, recipients) } : {}),
        preview: recipients.slice(0, 3).map((r) => {
          if (channel === "sms") {
            const c = composeSmsFor(campaign, r)
            return {
              to: r.mobile_e164, name: r.name, text: c.text, problems: c.problems,
              encoding: c.metrics.encoding, chars: c.metrics.chars, segments: c.metrics.segments,
              offenders: c.metrics.offenders,
            }
          }
          const c = compose(campaign, r, "PREVIEW-TOKEN", APP_URL)
          return { to: r.email, name: r.name, subject: c.subject, text: c.text, problems: c.problems }
        }),
      })
    }

    // ── Send ───────────────────────────────────────────────────────────────
    let sent = 0, failed = 0, skipped = 0
    const errors: { email: string; error: string }[] = []

    for (const r of recipients) {
      // Claim first. If the unique index rejects it, this address already has
      // a row for this campaign and must not be mailed again.
      let sendRowId: number | null = null
      if (!testTo) {
        const { data: claimed, error: claimErr } = await admin
          .from("marketing_sends")
          .insert({
            campaign_id: campaignId,
            customer_id: r.customer_id,
            channel,
            // Only the address this channel actually uses is recorded. Writing
            // both would make the per-channel unique indexes collide across
            // channels and block the SMS follow-up to an emailed customer.
            email:  channel === "email" ? r.email : null,
            mobile: channel === "sms"   ? r.mobile_e164 : null,
            wave,
            status: "queued",
          })
          .select("id").maybeSingle()
        if (claimErr) {
          if (claimErr.code === "23505") { skipped++; continue }
          failed++; errors.push({ email: r.email, error: claimErr.message }); continue
        }
        sendRowId = claimed?.id ?? null
      }

      if (channel === "sms") {
        const composed = composeSmsFor(campaign, r)
        if (composed.problems.length) {
          failed++
          errors.push({ email: r.mobile_e164 ?? "(no mobile)", error: composed.problems.join("; ") })
          if (sendRowId) {
            await admin.from("marketing_sends")
              .update({ status: "failed", error: composed.problems.join("; ") }).eq("id", sendRowId)
          }
          continue
        }

        const dest = testTo || r.mobile_e164!
        try {
          // Twilio's REST API, form-encoded, same as send-communication. No
          // StatusCallback: a receipt for a campaign text has nothing in
          // `communications` to match against yet, so it would be noise. The
          // SID is kept in external_id so receipts can be reconciled later.
          const form = new URLSearchParams({ To: dest, From: TW_FROM, Body: composed.text })
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form,
            },
          )
          const data = await res.json()
          if (!res.ok) throw new Error(data?.message ?? res.statusText)

          sent++
          if (sendRowId) {
            await admin.from("marketing_sends")
              .update({ status: "sent", external_id: data.sid, sent_at: new Date().toISOString() })
              .eq("id", sendRowId)
          }

          // Mirror it onto the customer's record. Without this a staff member
          // opening a reply sees an answer to a question they cannot see.
          if (!testTo && r.customer_id) {
            await admin.from("communications").insert({
              customer_id: r.customer_id,
              channel: "sms",
              direction: "outbound",
              subject: `Campaign · ${campaign.name}`,
              body: composed.text,
              to_address: dest,
              from_address: TW_FROM,
              status: "sent",
              external_id: data.sid,
            })
          }
        } catch (e) {
          failed++
          errors.push({ email: dest, error: String(e) })
          if (sendRowId) {
            await admin.from("marketing_sends").update({ status: "failed", error: String(e) }).eq("id", sendRowId)
          }
        }
      } else {
        const { data: unsubToken } = await admin
          .rpc("marketing_ensure_unsub_token", { p_email: r.email })

        const composed = compose(campaign, r, unsubToken ?? "", APP_URL)
        if (composed.problems.length) {
          failed++
          errors.push({ email: r.email, error: composed.problems.join("; ") })
          if (sendRowId) {
            await admin.from("marketing_sends")
              .update({ status: "failed", error: composed.problems.join("; ") }).eq("id", sendRowId)
          }
          continue
        }

        // A reply threads back onto this customer's record in the CRM. This is
        // the difference between repair demand being a pipeline and being chaos.
        let replyTo: string | undefined
        if (REPLY_DOMAIN) {
          const token = await ensureReplyToken(admin, r.customer_id)
          if (token) replyTo = `q-${token}@${REPLY_DOMAIN}`
        }

        const unsubUrl = `${APP_URL}/api/unsubscribe?t=${unsubToken}`

        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: FROM,
              to: testTo || r.email,
              reply_to: replyTo,
              subject: composed.subject,
              html: composed.html,
              text: composed.text,
              headers: {
                // Gmail and Yahoo require both on bulk mail, and both must work
                // without the recipient signing in anywhere.
                "List-Unsubscribe": `<${unsubUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.message ?? res.statusText)

          sent++
          if (sendRowId) {
            await admin.from("marketing_sends")
              .update({ status: "sent", external_id: data.id, sent_at: new Date().toISOString() })
              .eq("id", sendRowId)
          }
        } catch (e) {
          failed++
          errors.push({ email: r.email, error: String(e) })
          if (sendRowId) {
            await admin.from("marketing_sends").update({ status: "failed", error: String(e) }).eq("id", sendRowId)
          }
        }
      }

      if (testTo) break
      // Resend allows 2/sec; a Twilio long code sends about 1/sec and queues
      // the rest, so pacing to the slower of the two keeps the wave inside the
      // function's wall clock instead of handing Twilio a backlog.
      await sleep(channel === "sms" ? SMS_GAP_MS : SEND_GAP_MS)
    }

    if (!testTo && sent > 0 && campaign.status === "draft") {
      await admin.from("marketing_campaigns")
        .update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", campaignId)
    }

    // Re-count rather than subtract. A head-count that came back null would
    // otherwise read as "nothing left" and retire a campaign with hundreds of
    // customers still unmailed.
    const left = testTo ? remaining : await audienceCount(admin, campaignId)
    if (!testTo && left === 0 && sent > 0) {
      await admin.from("marketing_campaigns")
        .update({ status: "done", updated_at: new Date().toISOString() }).eq("id", campaignId)
    }

    return json({ ok: true, campaign: campaignId, wave, sent, failed, skipped, remaining: left, errors: errors.slice(0, 20) })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

/**
 * How many eligible recipients a campaign still has, or null if the count
 * could not be established. Null is returned rather than 0 precisely because
 * the caller uses zero to decide a campaign is finished.
 */
async function audienceCount(admin: SupabaseClient, campaignId: string): Promise<number | null> {
  const { count, error } = await admin
    .rpc("marketing_audience", { p_campaign_id: campaignId }, { count: "exact", head: true })
  if (error) {
    console.error("audience count failed:", error.message)
    return null
  }
  return count ?? null
}

/** The next wave number for a campaign — waves are 1-based and sequential. */
async function nextWave(admin: SupabaseClient, campaignId: string): Promise<number> {
  const { data } = await admin
    .from("marketing_sends").select("wave")
    .eq("campaign_id", campaignId).order("wave", { ascending: false }).limit(1).maybeSingle()
  return (data?.wave ?? 0) + 1
}

/**
 * The stable reply token for a customer conversation, minted on first use.
 * A deliberate mirror of send-communication/replyToken.ts, kept small: this
 * only ever needs the customer-level conversation, never a job or an enquiry.
 */
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

async function ensureReplyToken(admin: SupabaseClient, customerId: string): Promise<string | null> {
  if (!customerId) return null

  const find = async () => {
    const { data } = await admin
      .from("reply_tokens").select("token")
      .is("enquiry_id", null).is("job_id", null).eq("customer_id", customerId)
      .limit(1).maybeSingle()
    return data?.token ?? null
  }

  const existing = await find()
  if (existing) return existing

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let token = ""
  for (const b of bytes) token += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]

  const { error } = await admin.from("reply_tokens").insert({ token, customer_id: customerId, job_id: null })
  if (!error) return token
  if (error.code === "23505") return await find()

  // Never cost the customer their email over a token failure — the message
  // still goes, it simply is not reply-threaded.
  console.error("reply token insert failed:", error.message)
  return null
}

/** Render one campaign for one recipient. */
function compose(
  campaign: Record<string, any>,
  r: Recipient,
  unsubToken: string,
  appUrl: string,
) {
  const values: Record<string, unknown> = {
    first_name:           r.first_name,
    name:                 r.name,
    business_name:        r.business_name,
    suburb:               r.suburb,
    last_purchase_label:  r.last_purchase_label,
    last_purchase_year:   r.last_purchase_year,
    years_since_purchase: r.years_since_purchase,
    purchase_count:       r.purchase_count,
    blind_count:          r.blind_count,
    curtain_count:        r.curtain_count,
    has_motorised:        r.has_motorised,
    has_battery:          r.has_battery,
    primary_product:      r.primary_product,
    product_phrase:       r.product_phrase,
  }

  const subject = merge(campaign.subject, values)
  const body    = merge(campaign.body, values)
  const heading = merge(campaign.heading, values)
  const eyebrow = merge(campaign.eyebrow, values)
  const outro   = merge(campaign.outro, values)
  const preheader = merge(campaign.preheader, values)

  const problems: string[] = []
  for (const [label, text] of Object.entries({ subject, body, heading, eyebrow, outro, preheader })) {
    if (hasUnresolved(text)) problems.push(`unresolved merge field in ${label}`)
  }
  if (!subject) problems.push("subject rendered empty")
  if (!body)    problems.push("body rendered empty")

  const content = {
    preheader,
    eyebrow,
    heading,
    greeting: r.first_name ? `Hi ${r.first_name},` : "Hi there,",
    body,
    cta: campaign.cta_url && campaign.cta_label
      ? { label: campaign.cta_label, url: merge(campaign.cta_url, values) }
      : null,
    outro,
    signOff: campaign.sign_off,
    footerNote: "You're receiving this because we've quoted or installed for you.",
    footerLink: { label: "Unsubscribe", url: `${appUrl}/api/unsubscribe?t=${unsubToken}` },
  }

  return { subject, problems, html: renderEmail(content), text: renderText(content) }
}

/**
 * Render one campaign's SMS for one recipient.
 *
 * Deliberately NOT a variant of compose(): a text has no subject, no heading,
 * no preheader, no CTA block and no unsubscribe link, and pretending otherwise
 * is how an email layout ends up inside a 160-character message. The only
 * thing the two share is the merge syntax, so the same {{first_name}} works in
 * both and a campaign author does not have to learn two dialects.
 */
function composeSmsFor(campaign: Record<string, any>, r: Recipient) {
  const values: Record<string, unknown> = {
    first_name:           r.first_name,
    name:                 r.name,
    business_name:        r.business_name,
    suburb:               r.suburb,
    last_purchase_label:  r.last_purchase_label,
    last_purchase_year:   r.last_purchase_year,
    years_since_purchase: r.years_since_purchase,
    purchase_count:       r.purchase_count,
    blind_count:          r.blind_count,
    curtain_count:        r.curtain_count,
    has_motorised:        r.has_motorised,
    has_battery:          r.has_battery,
    primary_product:      r.primary_product,
    product_phrase:       r.product_phrase,
  }

  const merged = merge(campaign.sms_body, values)
  const problems: string[] = []
  // An unresolved token in a text is worse than in an email: there is no
  // layout to hide it, so "{{first_name}}" is the first thing read.
  if (hasUnresolved(merged)) problems.push("unresolved merge field in sms_body")

  const text = composeSms(merged)
  problems.push(...smsProblems(text))

  return { text, problems, metrics: smsMetrics(text) }
}

/**
 * The highest segment count across the sampled recipients.
 *
 * Worst case rather than average on purpose: merge fields vary the length per
 * person, and the number is used to decide whether a wave is affordable. An
 * average rounds the expensive recipients away.
 */
function worstSegments(campaign: Record<string, any>, recipients: Recipient[]) {
  return recipients.slice(0, 25).reduce(
    (worst, r) => Math.max(worst, composeSmsFor(campaign, r).metrics.segments),
    0,
  )
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })
}
