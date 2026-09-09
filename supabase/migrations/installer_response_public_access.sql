-- Blocker 5: the installer accept link could not work on an installer's phone.
--
-- The two tokens the public page matches on (secure_accept_token /
-- secure_decline_token) were on the write layer's strip list, so they never
-- reached the database and installations.accept_token stayed null everywhere.
-- Everything the page renders — suburb, pickup details, site notes — was
-- stripped for the same reason. And even with the data present, RLS on
-- installations requires is_active_user(), so an anonymous read returns
-- nothing. The link only ever "worked" in a signed-in staff browser that
-- already held the record in localStorage.
--
-- Three parts: give the columns somewhere to land, index the tokens, and add a
-- pair of SECURITY DEFINER RPCs so the installer can read their own request and
-- answer it without an account. See src/store/db.js (FIELD_TO_DB) for the
-- secureAcceptToken -> accept_token rename that makes the columns reachable.

-- ── 1. The columns an install request actually carries ──────────────────────
alter table public.installations
  add column if not exists decline_token       text,
  add column if not exists token_expires_at    timestamptz,
  add column if not exists response_comment    text,
  add column if not exists sent_at             timestamptz,
  add column if not exists service_required    text,
  add column if not exists suburb              text,
  add column if not exists arrival_time        text,
  add column if not exists expected_duration   text,
  add column if not exists product_summary     text,
  add column if not exists installation_notes  text,
  add column if not exists access_notes        text,
  add column if not exists parking_notes       text,
  add column if not exists site_notes          text,
  add column if not exists pickup_type         text,
  add column if not exists pickup_locations    jsonb,
  add column if not exists reveal_full_details boolean not null default false,
  add column if not exists assigned_salesperson text,
  add column if not exists created_by          text,
  add column if not exists deleted_by          text;

-- A token is the only credential on this route, so it has to be unique and
-- findable. Partial, because most historical rows have neither.
create unique index if not exists installations_accept_token_uidx
  on public.installations (accept_token)  where accept_token  is not null;
create unique index if not exists installations_decline_token_uidx
  on public.installations (decline_token) where decline_token is not null;

-- ── 2. Read one request, by token, with no account ──────────────────────────
-- Returns only what the installer is owed before they commit: the area, the
-- date, the work, the pickup. NOT the site address or the customer's contact
-- details — the page promises those come after acceptance, and this is what
-- makes that promise true rather than cosmetic.
create or replace function public.get_install_request_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id',                 i.id,
    'status',             coalesce(i.status, 'Sent'),
    -- Which link was followed decides the action. The caller never gets to say.
    'action',             case when i.accept_token = p_token then 'accept' else 'decline' end,
    'expired',            (i.token_expires_at is not null and now() > i.token_expires_at),
    'installerFirstName', split_part(coalesce(n.name, ''), ' ', 1),
    'suburb',             i.suburb,
    'proposedDate',       i.scheduled_date,
    'arrivalTime',        i.arrival_time,
    'expectedDuration',   i.expected_duration,
    'serviceRequired',    i.service_required,
    'productSummary',     i.product_summary,
    'installationNotes',  i.installation_notes,
    'pickupType',         i.pickup_type,
    'pickupLocations',    coalesce(i.pickup_locations, '[]'::jsonb),
    'accessNotes',        i.access_notes,
    'parkingNotes',       i.parking_notes,
    'siteNotes',          i.site_notes,
    'responseComment',    i.response_comment,
    'respondedAt',        i.responded_at
  )
  from public.installations i
  left join public.installers n on n.id = i.installer_id
  where i.deleted_at is null
    and p_token is not null
    and (i.accept_token = p_token or i.decline_token = p_token);
$function$;

-- ── 3. Answer it ────────────────────────────────────────────────────────────
create or replace function public.respond_to_install_request(p_token text, p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row    public.installations%rowtype;
  v_accept boolean;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- FOR UPDATE so a double-tap on a phone can't produce two responses.
  select * into v_row from public.installations
   where deleted_at is null and (accept_token = p_token or decline_token = p_token)
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Answering twice is a re-tap, not an error. Report what already stands.
  if v_row.status in ('Accepted', 'Declined') then
    return jsonb_build_object('ok', true, 'alreadyResponded', true,
                              'status', v_row.status, 'responseComment', v_row.response_comment);
  end if;

  if v_row.token_expires_at is not null and now() > v_row.token_expires_at then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  v_accept := (v_row.accept_token = p_token);

  update public.installations set
    status           = case when v_accept then 'Accepted' else 'Declined' end,
    responded_at     = now(),
    response_comment = coalesce(nullif(p_comment, ''), response_comment),
    updated_at       = now()
  where id = v_row.id;

  -- Forward-only, so an installer answering an old link can't drag a job that
  -- has already been installed back to "Installation Booked".
  if v_accept then
    perform public.job_advance_status(v_row.job_id, 'Installation Booked');
  end if;

  -- The staff notification is raised by installations_notify_response on the
  -- status change above, so it fires exactly once and gets pushed to phones.
  return jsonb_build_object('ok', true, 'alreadyResponded', false,
                            'status', case when v_accept then 'Accepted' else 'Declined' end,
                            'action', case when v_accept then 'accept' else 'decline' end);
end;
$function$;

-- The installer has no account. That is the entire point of the link.
grant execute on function public.get_install_request_by_token(text) to anon, authenticated;
grant execute on function public.respond_to_install_request(text, text) to anon, authenticated;

-- These two are the only doors into installations for an anonymous caller;
-- direct table access stays closed.
revoke execute on function public.get_install_request_by_token(text) from public;
revoke execute on function public.respond_to_install_request(text, text) from public;
