-- Reply tokens for web enquiries: give the enquiry its own conversation key.
--
-- reply_tokens_conversation_idx was UNIQUE on (job_id, customer_id) NULLS NOT
-- DISTINCT. A web enquiry has neither — it is a lead, with no customer record
-- and no job — so every enquiry token is (null, null) and the *first* enquiry
-- ever replied to claimed that key for good. Every enquiry after it hit 23505,
-- which ensureReplyToken() swallows by design (a DB problem must not cost the
-- customer their email), so the send went out with no
-- Reply-To: q-<token>@reply.lusso.com.au at all.
--
-- The visible symptom: staff reply to a website lead from the inbox, the lead
-- replies, and the reply never appears. It went to jobs@lusso.com.au — the
-- generic EMAIL_REPLY_TO fallback — so it landed in Microsoft 365 and Resend
-- never saw it, which means comms-inbound never saw it either.
--
-- The conversation key is therefore scoped to the rows that actually have one:
-- (job_id, customer_id) applies only where enquiry_id is null, and enquiries
-- get their own unique index on enquiry_id. One token per enquiry, one token
-- per job/customer conversation, and the two no longer collide.

alter table public.reply_tokens
  add column if not exists enquiry_id uuid;

drop index if exists public.reply_tokens_conversation_idx;

create unique index if not exists reply_tokens_conversation_idx
  on public.reply_tokens (job_id, customer_id) nulls not distinct
  where enquiry_id is null;

create unique index if not exists reply_tokens_enquiry_uniq
  on public.reply_tokens (enquiry_id)
  where enquiry_id is not null;

comment on column public.reply_tokens.enquiry_id is
  'web_enquiries.id for a lead conversation. Mutually exclusive with (job_id, customer_id) — see the two partial unique indexes.';
