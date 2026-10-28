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
