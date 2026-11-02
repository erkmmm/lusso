-- Let the website auto-reply's wording be edited in Settings.
--
-- The switch already lives there (see web_autoreply_settings_rpc.sql); the
-- words did not, so changing a sentence meant a deploy. These three columns
-- hold the message, and the edge function prefers them over the copy compiled
-- into render.ts.
--
-- NULL means "use the built-in". That matters: it keeps the shipped default
-- improvable without overwriting a business that has written its own, and it
-- is the difference between an empty box meaning "say nothing" and meaning
-- "say the usual thing". Clearing a field in the UI restores the default
-- rather than sending a blank email.
--
-- The seeded values below are the current copy with the computed clauses left
-- as tokens, so the first person to open the editor sees exactly what is
-- already going out rather than a blank page.

alter table public.internal_notify_config
  add column if not exists autoreply_subject text,
  add column if not exists autoreply_body    text,
  add column if not exists autoreply_sms     text;

comment on column public.internal_notify_config.autoreply_subject is
  'Website auto-reply subject. NULL = the default compiled into render.ts.';
comment on column public.internal_notify_config.autoreply_body is
  'Website auto-reply body, with {{tokens}}. NULL = the default in render.ts.';
comment on column public.internal_notify_config.autoreply_sms is
  'After-hours auto-reply SMS. Must stay GSM-7 and under 160 characters.';

-- ── Read ───────────────────────────────────────────────────────────────────
-- Adds the copy to what the settings screen already reads. Any signed-in
-- staff member may SEE the wording; only an account manager may change it,
-- which is the same split the switch uses.
create or replace function public.web_autoreply_settings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'enabled',      coalesce((select autoreply_web_enquiries from internal_notify_config where id = 1), false),
    'can_edit',     coalesce((select public.is_account_manager()), false),
    'sent_30d',     (select count(*) from web_enquiries
                      where auto_replied_at > now() - interval '30 days'),
    'last_sent_at', (select max(auto_replied_at) from web_enquiries),
    'missed',       (select count(*) from web_enquiries
                      where auto_replied_at is null
                        and deleted_at is null
                        and source = 'website'
                        and coalesce(email, '') <> ''),
    'subject',      (select autoreply_subject from internal_notify_config where id = 1),
    'body',         (select autoreply_body    from internal_notify_config where id = 1),
    'sms',          (select autoreply_sms     from internal_notify_config where id = 1)
  );
end;
$$;

-- ── Write ──────────────────────────────────────────────────────────────────
-- Account managers only. Rewording this changes what every new lead reads
-- first, which is the same weight of decision as turning it on.
--
-- Blank is stored as NULL so the built-in comes back, rather than sending an
-- email with an empty body. The SMS is length-checked here as well as in the
-- UI: a 200-character SMS does not fail, it silently bills as two segments.
create or replace function public.web_autoreply_set_template(
  p_subject text,
  p_body    text,
  p_sms     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sms text := nullif(btrim(coalesce(p_sms, '')), '');
begin
  if not coalesce((select public.is_account_manager()), false) then
    raise exception 'Only an account manager can change the auto-reply wording'
      using errcode = '42501';
  end if;

  if v_sms is not null and length(v_sms) > 160 then
    raise exception 'The SMS is % characters — it must be 160 or fewer', length(v_sms)
      using errcode = '22001';
  end if;

  update internal_notify_config
     set autoreply_subject = nullif(btrim(coalesce(p_subject, '')), ''),
         autoreply_body    = nullif(btrim(coalesce(p_body, '')), ''),
         autoreply_sms     = v_sms
   where id = 1;

  if not found then
    raise exception 'internal_notify_config row 1 is missing — notifications are not configured'
      using errcode = 'P0002';
  end if;

  return public.web_autoreply_settings();
end;
$$;

revoke all on function public.web_autoreply_set_template(text, text, text) from public;
grant execute on function public.web_autoreply_set_template(text, text, text) to authenticated;

comment on function public.web_autoreply_set_template(text, text, text) is
  'Sets the website auto-reply wording. Account managers only. Blank fields are stored as NULL, which restores the built-in copy.';
