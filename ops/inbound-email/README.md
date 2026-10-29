# Inbound customer email → CRM

Customer replies land on `reply.lusso.com.au` and thread onto the right job.

```
outbound send-communication
  └─ Reply-To: q-<token>@reply.lusso.com.au
       └─ customer replies
            └─ Resend receives mail for reply.lusso.com.au  (MX on the subdomain)
                 └─ Svix-signed webhook  →  comms-inbound
                      └─ GET /emails/receiving/{id}  (webhook carries no body)
                           └─ reply_tokens lookup → communications row
```

Microsoft 365 is not involved at any point, and neither is the apex.

## Why not Cloudflare Email Routing

The original plan was Email Routing plus a Worker. **Do not retry this.**

Email Routing onboards a **zone**, not a domain — the dashboard's onboarding
picker asks for "Zone" and offers no subdomain option. Onboarding
`lusso.com.au` writes to the apex:

- an **MX** to `route1/2/3.mx.cloudflare.net`, displacing
  `lusso-com-au.mail.protection.outlook.com`, and
- a **TXT SPF** `v=spf1 include:_spf.mx.cloudflare.net ~all`, leaving two SPF
  records on the apex.

The first breaks inbound Microsoft 365. The second is worse: two SPF records on
one name is a permerror by spec, so outbound M365 mail starts failing SPF too.
Cloudflare then locks both records.

Email Routing *does* support subdomains, but only as an extension of an
already-onboarded apex ("select the apex domain, then open Settings →
Subdomains"). There is no apex-free route in.

Resend puts the MX on whichever domain you enable receiving for, so pointing it
at `reply.lusso.com.au` leaves the apex untouched. That is the whole reason for
the switch.

## Activation order

Inbound is proven working **before** outbound stamping is switched on, so no
customer is ever handed a reply address that bounces. Steps 1–5 are invisible
to customers.

1. **Resend Pro.** The free plan allows one domain and `lusso.com.au` is it.
   (Pro also lifts the free tier's ~100 emails/day send cap, which now applies
   to live customer mail.)

2. **Add the domain.** Resend → Domains → Add domain → `reply.lusso.com.au`,
   region Tokyo `ap-northeast-1` to match the existing domain.

3. **Enable Receiving** on that domain and add the MX it gives you to
   Cloudflare DNS, on the `reply` name, DNS only.

4. **Create the webhook.** Resend → Webhooks → endpoint
   `https://wwompnqglvdxcmjquuzr.supabase.co/functions/v1/comms-inbound`,
   event `email.received`. Copy the signing secret (`whsec_…`).

5. **Set the Supabase Edge Function secrets:**

   | Secret | Value |
   |---|---|
   | `RESEND_WEBHOOK_SECRET` | the `whsec_…` from step 4 |
   | `RESEND_INBOUND_API_KEY` | a Resend API key with **read** access |
   | `COMMS_INBOUND_SECRET` | `openssl rand -hex 32` — optional, only for the test path |

   The existing `RESEND_API_KEY` is **send-restricted** and returns 401 on
   `GET /emails/receiving/{id}`, which is why the read key is separate. Without
   it, replies are still recorded but with a placeholder body naming the Resend
   id, rather than being lost.

   Until `RESEND_WEBHOOK_SECRET` is set the email path returns 503 and refuses
   everything. It fails closed on purpose: `comms-inbound` is public, and an
   unauthenticated inbound-email route would let anyone write a convincing
   customer message into a job thread.

6. **Prove inbound works before any customer sees a reply address.** Mint a
   token against a real job:

   ```sql
   insert into reply_tokens (token, job_id, customer_id)
   values ('testtoken1234567', '<job-id>', '<customer-id>');
   ```

   Email `q-testtoken1234567@reply.lusso.com.au` from your own account. It
   should appear on that job's comms thread within seconds. Then delete the
   test token and the test communication row.

7. **Turn on stamping.** Set the Supabase secret `REPLY_DOMAIN` to
   `reply.lusso.com.au`, and the same value as a Cloudflare Pages secret
   (`wrangler pages secret put REPLY_DOMAIN --project-name=lusso`) so the quote
   email stamps one too. Pages reads secrets at deploy time, so redeploy after
   setting it. From that moment outbound customer email carries a
   per-conversation `Reply-To`.

   To switch the feature off, unset `REPLY_DOMAIN`. Existing tokens keep
   working for inbound; new mail simply stops carrying a reply address.

## Who stamps a reply address

| Sender | Runs on | Mints the token via |
|---|---|---|
| `send-communication` — inbox messages | Supabase edge | service key, `replyToken.ts` |
| `quote-notify` — order confirmation | Supabase edge | service key, `ensure_reply_token()` RPC |
| `functions/api/send-quote.js` — the quote | Cloudflare Pages | caller's JWT, `ensure_reply_token()` RPC |
| `marketing-send` | Supabase edge | service key, inline |

All four key the conversation on `(job_id, customer_id)`, so a customer sees
one stable reply address however the mail reached them.

The Pages Function has no Supabase service key and must not be given one: it
would hand a public HTTP route unrestricted read/write over the whole database
to solve a sixteen-character problem. `ensure_reply_token()` is SECURITY
DEFINER behind the same `is_active_user()` check as the rest of the app, so
staff get a token for a conversation they could already see and nobody gets the
table. The service role is let through the same function for `quote-notify`,
which the database itself calls and which therefore has no signed-in user.

Installer requests and purchase orders are deliberately left on the generic
`EMAIL_REPLY_TO`: they go to trades and suppliers, not to the customer whose
thread a token points at.

## Notes

- **One token per conversation, not per message** — the reply address stays
  stable, so the customer's mail client threads our messages together.
- **A conversation is a job/customer *or* a web enquiry**, and the two are
  keyed separately: `reply_tokens_conversation_idx` on
  `(job_id, customer_id)` applies only `where enquiry_id is null`, and
  enquiries get `reply_tokens_enquiry_uniq` on `enquiry_id`.
  Do not fold them back into one index. A web enquiry has no customer and no
  job, so under the original un-partitioned `(job_id, customer_id) NULLS NOT
  DISTINCT` index every enquiry was `(null, null)` — the first lead replied to
  claimed that key and every lead after it failed on 23505, which
  `ensureReplyToken` swallows by design. Those sends went out with the generic
  `EMAIL_REPLY_TO` instead, so the lead's reply landed in Microsoft 365 and
  never reached Resend. Nothing errored; the reply simply never appeared in the
  inbox. Fixed in `migrations/reply_tokens_enquiry_scope.sql`.
- **Unmatched mail is still recorded** with a null `customer_id` rather than
  dropped. A message in the wrong place is recoverable; a lost one is not.
- **Every route into `comms-inbound` authenticates**: SMS by Twilio request
  signature, Resend by Svix signature, the JSON test paths by shared secret. An
  unverified route would be a bypass around the other two, not merely a gap of
  its own.
- **Attachments are not stored.** Resend exposes them via its Attachments API;
  `resend.ts` is where that would hook in.
- The Svix check enforces a 5-minute timestamp tolerance so a captured webhook
  can't be replayed later.

## Inbound SMS signature validation

`comms-inbound` rejects any form-encoded POST whose `X-Twilio-Signature`
doesn't verify, using `TWILIO_AUTH_TOKEN` (already set). Twilio signs the exact
URL configured in its console; if the runtime reconstructs a different one,
every message is rejected. On mismatch the function logs the candidates it
tried:

```
supabase functions logs comms-inbound
```

If the console's URL isn't among them, set `TWILIO_WEBHOOK_URL` to that exact
value. Verify the signing logic itself with:

```
node scripts/test-twilio-signature.mjs
```
