-- Website leads get an instant courtesy reply.
--
-- Until now a lead got the on-page modal ("we'll be in touch shortly") and then
-- silence until somebody saw the push notification. The acknowledgement email
-- is what holds the lead while that happens — see the web-enquiry-autoreply
-- function for the copy and the duplicate-send protection.

-- ── 1. The send is claimed on the row itself ────────────────────────────────
-- This column is the idempotency key, not just a record. The function claims a
-- send with UPDATE … WHERE auto_replied_at IS NULL, so two concurrent
-- invocations cannot both win and nobody gets the email twice.
alter table public.web_enquiries
  add column if not exists auto_replied_at timestamptz;

comment on column public.web_enquiries.auto_replied_at is
  'When the automatic acknowledgement email went out to this lead. Claimed with a conditional update by the web-enquiry-autoreply edge function, which is what prevents a duplicate send. Null means no auto-reply has been sent.';

-- ── 2. Kill switch, beside the other notify config ─────────────────────────
-- Defaults to FALSE: applying this migration must not start emailing customers
-- before someone has read a real test send. Flip it on with
--   update public.internal_notify_config set autoreply_web_enquiries = true where id = 1;
-- and off again just as fast if the copy ever needs pulling.
alter table public.internal_notify_config
  add column if not exists autoreply_web_enquiries boolean not null default false;

comment on column public.internal_notify_config.autoreply_web_enquiries is
  'Master switch for the instant auto-reply to website leads. False stops the trigger firing at all — no deploy needed to turn it off.';

-- ── 3. The trigger ─────────────────────────────────────────────────────────
create or replace function public.web_enquiries_autoreply_new()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text;
begin
  -- Cheap structural rejections first; the function repeats all of them, since
  -- it can also be called directly, but there is no sense in an HTTP round
  -- trip for a row that can never qualify.
  --
  -- The source check is the important one: the newsletter form on the site
  -- writes to this same table with source='newsletter', and those people must
  -- never be told a consultant is about to ring them about their windows.
  if coalesce(new.source, 'website') <> 'website' then return null; end if;
  if coalesce(new.email, '') = '' then return null; end if;
  if new.deleted_at is not null then return null; end if;

  select token into v_token
    from public.internal_notify_config
   where id = 1 and autoreply_web_enquiries;
  if v_token is null then return null; end if;      -- switched off, or no token

  -- Fire-and-forget. A lead is saved and the staff push has already gone out by
  -- the time we get here; an auto-reply that fails must not roll any of that
  -- back.
  begin
    perform net.http_post(
      url     := 'https://wwompnqglvdxcmjquuzr.supabase.co/functions/v1/web-enquiry-autoreply',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('token', v_token, 'enquiryId', new.id)
    );
  exception when others then null;
  end;

  return null;
end;
$$;

drop trigger if exists web_enquiries_autoreply on public.web_enquiries;
create trigger web_enquiries_autoreply
  after insert on public.web_enquiries
  for each row execute function public.web_enquiries_autoreply_new();
