-- Per-conversation reply tokens.
--
-- Outbound customer email carries Reply-To: q-<token>@reply.lusso.com.au, so a
-- plain "Reply" in the customer's mail client lands back on the exact job. The
-- token is the routing key: reply.lusso.com.au is a subdomain that has never
-- carried mail, so Microsoft 365 is untouched by any of this.
--
-- One token per conversation, not per message. Reusing the token keeps the
-- reply address stable, which means the customer's mail client threads our
-- messages together instead of splitting them, and it holds writes to one row
-- per conversation rather than one per send.

create table if not exists public.reply_tokens (
  token        text primary key,
  job_id       text,
  customer_id  text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- A conversation is (job_id, customer_id). NULLS NOT DISTINCT so that the
-- customer-only conversation (job_id null) collapses to a single row instead
-- of minting a fresh token on every send.
create unique index if not exists reply_tokens_conversation_idx
  on public.reply_tokens (job_id, customer_id) nulls not distinct;

-- RLS on with no policies: service_role only. The edge functions use the
-- service key; nothing client-side has any business reading these, since a
-- leaked token lets anyone post into a customer's job thread.
alter table public.reply_tokens enable row level security;

comment on table public.reply_tokens is
  'Maps q-<token>@reply.lusso.com.au addresses back to a job/customer conversation. Service role only.';
