-- The four re-engagement campaigns, as sent.
--
-- Seeded as a migration because the copy is the asset here, not the schema.
--
-- C and D were originally built around a paid "Blind Health Check" that
-- converted repair enquiries into re-fits. That was the wrong read of the
-- business: service work has run $25–34k a year against $900k–1.8m total, a
-- few hundred dollars a visit, which does not pay for the van. So neither
-- campaign invites a fault report any more — no symptom list, no inspection
-- offer, no "tell me what is wrong". The same trip is pointed at a quote.
--
-- A keeps its warranty commitment, because Australian Consumer Law guarantees
-- it whatever an email says. What it no longer does is read out a checklist of
-- faults, which is the part that prompts people to go looking for one.
--
-- Wave sizes stay capacity numbers. Replacement quotes take a measure
-- appointment, so the diary is still the constraint.

insert into public.marketing_campaigns
  (id, name, segment, audience, wave_size, subject, preheader, eyebrow, heading, body, cta_label, cta_url, sign_off, notes)
values
(
  'a-check-in',
  'A · Recent customers — review & referral',
  'A', '{"is_trade": false}'::jsonb, 75,
  'How are the blinds holding up?',
  'Two minutes, and a favour to ask.',
  'A quick check-in',
  'How are they holding up?',
  $body$We fitted your {{product_phrase|window furnishings}}{{#if suburb}} in {{suburb}}{{/if}} back in {{last_purchase_label}}, and I would rather ask than assume everything is fine.

If it is — would you mind leaving us a Google review? We are a small family business on the Gold Coast, and a few honest words from someone who has actually lived with the product does more for us than any advertising we could buy.

And if anything is not right, just reply and tell me — anything we supplied is still ours to put right.$body$,
  'Leave a Google review',
  'https://search.google.com/local/writereview?placeid=ChIJscqHCScFkWsRDQvVRjxuzao',
  'Jett · Lusso Blinds & Curtains',
  'No selling. Recent buyers are worth more as reviewers and referrers than as prospects.'
),
(
  'b-room-you-skipped',
  'B · 2–5 years — the room they skipped',
  'B', '{"is_trade": false}'::jsonb, 75,
  'The room you did not get to',
  'Most jobs stop one room short.',
  'Still on file',
  'The room you did not get to',
  $body$Most of the jobs we do stop one room short. Budget, timing, or the room simply was not ready — and then a few years pass and it is still the one window with nothing on it.

We did your {{product_phrase|window furnishings}} in {{last_purchase_label}}{{#if suburb}}, at your place in {{suburb}}{{/if}}. If there is a room still waiting, we have the measurements, the fabrics and the hardware on file, so matching it is a short conversation rather than starting from scratch.
{{#if has_motorised}}
Worth knowing too: adding motors to blinds you already own is usually cheaper than people expect, and in most cases we can do it without replacing the blind itself.
{{/if}}
Reply with the room and I will tell you what it would cost.$body$,
  'Book a measure',
  'https://lusso.com.au/contact?utm_source=email&utm_medium=crm&utm_campaign=b-room-you-skipped',
  'Jett · Lusso Blinds & Curtains',
  'Low repair risk. The motorisation paragraph only renders for customers who already have motors.'
),
(
  'c-whats-changed',
  'C · 5–8 years — what has changed',
  'C', '{"is_trade": false}'::jsonb, 50,
  'What has changed since {{last_purchase_year}}',
  'Motors retrofit now, and the fabrics are better.',
  'Worth knowing',
  'A fair bit has changed since {{last_purchase_year}}',
  $body$We fitted your {{product_phrase|window furnishings}} in {{last_purchase_label}}{{#if suburb}}, at your place in {{suburb}}{{/if}}. The gear has moved on a long way since then, and two things are worth knowing about.

Motorisation is the big one. In most cases we can now add a motor to blinds you already own rather than replacing them, and it costs noticeably less than people expect — no rewiring and no mess.

The other is fabric. Screen and blockout fabrics made in the last few years hold their colour and their shape far better, which shows up most on anything facing west.

If either is of interest, reply and tell me which rooms. We still have your measurements on file, so current pricing is quick to put together.$body$,
  'Get current pricing',
  'https://lusso.com.au/contact?utm_source=email&utm_medium=crm&utm_campaign=c-whats-changed',
  'Jett · Lusso Blinds & Curtains',
  'Upgrade angle: motorisation retrofit and fabric. Deliberately invites no fault reports — service calls are not worth the van time.'
),
(
  'd-replacement-cycle',
  'D · 8+ years — replacement',
  'D', '{"is_trade": false}'::jsonb, 50,
  'Still the blinds we fitted in {{last_purchase_year}}?',
  'We still have your measurements on file.',
  'Worth knowing',
  '{{last_purchase_label}} was a while ago',
  $body$We fitted your {{product_phrase|window furnishings}} in {{last_purchase_label}} — {{years_since_purchase}} years ago now{{#if suburb}}, at your place in {{suburb}}{{/if}}.

Most window coverings on this coast are ready for replacing somewhere around that age, and the difference between then and now is bigger than people expect: quieter hardware, fabrics that hold their colour, and motors that retrofit without rewiring.

We still have your measurements and your original fabric choices on file, so pricing a replacement is a short job rather than starting from scratch.

If you would like a current price on the rooms that have worn worst, reply and tell me which ones. And if the answer is not yet, that is a perfectly good answer too.$body$,
  'Get current pricing',
  'https://lusso.com.au/contact?utm_source=email&utm_medium=crm&utm_campaign=d-replacement-cycle',
  'Jett · Lusso Blinds & Curtains',
  'Straight replacement. No fault language and no service offer — the van trip should buy a quote, not a call-out.'
)
on conflict (id) do update set
  name = excluded.name, segment = excluded.segment, audience = excluded.audience,
  wave_size = excluded.wave_size, subject = excluded.subject, preheader = excluded.preheader,
  eyebrow = excluded.eyebrow, heading = excluded.heading, body = excluded.body,
  cta_label = excluded.cta_label, cta_url = excluded.cta_url, sign_off = excluded.sign_off,
  notes = excluded.notes, updated_at = now();
