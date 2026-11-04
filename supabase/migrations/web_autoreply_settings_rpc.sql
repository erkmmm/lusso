-- Put the website auto-reply switch in Settings instead of in a SQL console.
--
-- internal_notify_config has RLS on and no policies at all, deliberately: it
-- holds the shared notify token and the VAPID private key, so no client may
-- ever select it. That is also why the toggle cannot simply be a table write
-- from the UI. These two security-definer functions expose exactly one boolean
-- out of that table and nothing else.

-- ── Read: any signed-in staff member ───────────────────────────────────────
-- The counts come with it because a bare on/off switch cannot be verified by
-- looking at it. "14 sent in the last 30 days, last one 20 minutes ago" is what
-- tells someone it is actually working.
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
    -- Leads that would have received one had the switch been on. Reads as 0
    -- once it is on and working, and as a growing number when it is not.
    'missed',       (select count(*) from web_enquiries
                      where auto_replied_at is null
                        and deleted_at is null
                        and source = 'website'
                        and coalesce(email, '') <> '')
  );
end;
$$;

-- ── Write: account managers only ───────────────────────────────────────────
-- Turning this on starts sending email to customers, which is not a change a
-- salesperson should be able to make from a settings screen.
create or replace function public.web_autoreply_set_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce((select public.is_account_manager()), false) then
    raise exception 'Only an account manager can change the auto-reply setting'
      using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'p_enabled is required' using errcode = '22004';
  end if;

  update internal_notify_config
     set autoreply_web_enquiries = p_enabled
   where id = 1;

  if not found then
    raise exception 'internal_notify_config row 1 is missing — notifications are not configured'
      using errcode = 'P0002';
  end if;

  return public.web_autoreply_settings();
end;
$$;

revoke all on function public.web_autoreply_settings()             from public;
revoke all on function public.web_autoreply_set_enabled(boolean)   from public;
grant execute on function public.web_autoreply_settings()           to authenticated;
grant execute on function public.web_autoreply_set_enabled(boolean) to authenticated;

comment on function public.web_autoreply_settings() is
  'Settings -> Messages reads the website auto-reply switch and its recent send counts through here, because internal_notify_config is unreadable by clients by design.';
comment on function public.web_autoreply_set_enabled(boolean) is
  'Turns the website lead auto-reply on or off. Account managers only — flipping it on starts sending email to customers.';
