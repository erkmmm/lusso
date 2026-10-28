# Marketing email — setup before the first wave

Campaign mail must **not** go out on `lusso.com.au`. That domain is
authenticated in Resend (`resend._domainkey`, see `ops/dns/lusso.com.au.zone`)
and is what delivers quotes, invoices and installer requests. A re-engagement
campaign to addresses collected as far back as 2015 will draw spam complaints
and hard bounces — that is normal and survivable, but only if the reputation it
burns is not the reputation quotes depend on. A customer's quote landing in
junk because a marketing blast soured the domain is a far worse outcome than
any campaign is worth.

So marketing sends from its own subdomain, with its own DKIM key and its own
reputation.

## 1. Add the subdomain in Resend

Resend → Domains → Add Domain → `mail.lusso.com.au`.

Resend issues three records. Add them in Cloudflare DNS, all **DNS-only**
(grey cloud):

| Type | Name                             | Value                  |
|------|----------------------------------|------------------------|
| TXT  | `resend._domainkey.mail`         | (the p=… key Resend shows) |
| MX   | `send.mail`                      | `feedback-smtp.<region>.amazonses.com`, priority 10 |
| TXT  | `send.mail`                      | `v=spf1 include:amazonses.com ~all` |

Wait for Resend to show the domain Verified before sending anything.

DMARC on the root is `p=none`, which covers the subdomain by inheritance. Leave
it at `p=none` until the subdomain has a few clean sends behind it.

## 2. Set the sender

```
supabase secrets set MARKETING_EMAIL_FROM="Jett at Lusso <jett@mail.lusso.com.au>" --project-ref wwompnqglvdxcmjquuzr
```

`marketing-send` refuses to send at all while this is unset — deliberately. It
has no fallback to `EMAIL_FROM`, because silently shipping a campaign from the
quote sender is the exact mistake this split exists to prevent.

A personal-looking from-address outperforms `noreply@` or `marketing@` on both
opens and replies, and replies are the point: `Reply-To` carries the customer's
own reply token, so an answer threads straight onto their record in the CRM.

## 3. Warm up in the right order

Send the newest segment first and the oldest last:

```
A (0–2 yrs) → B (2–5) → C (5–8) → D (8+)
```

A's addresses are current, so they deliver cleanly and build the subdomain's
reputation. D's are up to eleven years old and will bounce hardest. Sending D
first on a cold subdomain is how a domain gets itself blocked.

Hard bounces belong in `marketing_suppressions` with `reason = 'bounced'` so
they are never retried. (Resend's bounce webhook is not wired to this table
yet — until it is, add them from the Resend dashboard by hand after each wave.)

## 4. Pace to the diary, not to the sender

Wave sizes in `marketing_campaigns.wave_size` are capacity numbers: how many
measure appointments the diary can absorb in a week. 50 a week for C and D, not
190 in an afternoon.

## 5. These campaigns do not solicit service work

Deliberately. Service has run $25–34k a year against $900k–1.8m total, at a few
hundred dollars a visit — it does not pay for the trip. So no campaign names a
fault, lists a symptom, or offers an inspection: C leads on motorisation and
fabric, D goes straight to replacement, and both ask for a quote.

A still promises to put right anything we supplied, because those installs are
under two years old and the Australian Consumer Law guarantees apply whatever
an email says. It just no longer reads out a checklist of faults.

Repair requests will still arrive — they always do from any contact with a
customer base. The point is not to manufacture them.

## 6. Marketing SMS — what has to be true before the first text

Added 2026-10-28. Texts go out on the **same registered AU mobile customers
already reply to** (`+61485075111`, `TWILIO_PHONE_NUMBER`), deliberately not an
alphanumeric sender ID: those are one-way, which would break reply threading,
and unregistered IDs now carry an "Unverified" label under ACMA's Sender ID
Register. No new Twilio setup is needed — but two things are:

- **Top up Twilio.** Each segment costs roughly 5c, so one pass over all 1,197
  textable customers is about $62 and a wave of 25 about $2.57. The balance was
  ~$20 in August. Unlike email, an empty balance fails mid-wave.
- **Check the preview's segment count before sending.** A text is 160
  characters only while every character is GSM-7. One curly apostrophe or em
  dash — which a word processor inserts without asking — flips the whole
  message to UCS-2 at 70 characters a segment and can triple the cost of a
  wave. The preview names the offending characters; keep campaign copy plain
  ASCII.

**SMS is not extra reach.** Of 1,197 customers with a usable mobile, only three
have no email address. A text campaign is therefore never a substitute for an
email campaign and never a duplicate of one — it is the follow-up to silence.
Set `audience.after_campaign` to the email campaign it follows and
`only_if_contacted: true`, and the audience will contain only people that email
actually reached, minus anyone who already replied.

**Opt-out is not optional.** Every text has "Reply STOP to opt out" appended by
the sender, and `comms-inbound` honours the keyword into
`marketing_sms_suppressions`. Stopping the texts does **not** unsubscribe the
email — the customer did not ask for that. A free-text request ("please stop
sending me these") does not auto-suppress; it lands in the Inbox for someone to
action, and it still has to be honoured.
