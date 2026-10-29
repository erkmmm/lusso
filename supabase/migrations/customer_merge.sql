-- Finding and merging duplicate customer records.
--
-- Two customers can be the same person: `Jett Hopko` and `Jett Hopkins`, same
-- email, same phone, created a month apart. The split is not cosmetic — their
-- jobs, quotes and message history live on separate records, so neither one
-- tells the truth about the relationship.
--
-- Nothing here merges anything by itself, and that is deliberate. Fifteen
-- phone numbers in this database are shared across customer records and only
-- some of those are duplicates: `John Stewart` and `Judy Stewart` are a couple
-- on one line, and one mobile sits on three unrelated clients — a builder's.
-- Auto-merging on phone would fuse a husband and wife into one customer.
-- customer_duplicate_groups() therefore only *proposes*, labelling each group
-- with what matched, and a person decides.
--
-- Every merge is recorded in customer_merges with the exact rows it moved, so
-- undo_customer_merge() can put them back where they were rather than guessing.

create table if not exists public.customer_merges (
  id          uuid primary key default gen_random_uuid(),
  kept_id     text not null,
  merged_id   text not null,
  -- { "<table>": ["<key>", ...] } — exactly what moved, for an exact undo.
  moved       jsonb not null default '{}'::jsonb,
  -- Full rows that could not move and were removed instead (reply_tokens).
  dropped     jsonb not null default '[]'::jsonb,
  -- The surviving record before blank-filling, so undo restores it verbatim.
  kept_before jsonb,
  merged_by   uuid,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz
);

create index if not exists customer_merges_kept_idx on public.customer_merges (kept_id);

alter table public.customer_merges enable row level security;

drop policy if exists customer_merges_read on public.customer_merges;
create policy customer_merges_read on public.customer_merges
  for select using ((select public.is_active_user()));
-- No insert/update/delete policies: this table is written only by the
-- SECURITY DEFINER functions below, so a merge record cannot be forged or
-- quietly erased to hide what a merge did.

-- ── What might be a duplicate ────────────────────────────────────────────────
create or replace function public.customer_duplicate_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with active as (
    select c.id, c.name, c.email, c.phone, c.business_name, c.address, c.created_at,
           nullif(lower(btrim(c.email)), '') as email_key,
           nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9), '') as phone_key
      from customers c
     where c.deleted_at is null
  ),
  -- What each record owns. Staff need this to pick which one survives: the
  -- record with the history is almost always the one to keep.
  counted as (
    select a.*,
           (select count(*) from jobs j   where j.customer_id = a.id and j.deleted_at is null) as jobs,
           (select count(*) from quotes q where q.customer_id = a.id)                          as quotes,
           (select count(*) from communications m where m.customer_id = a.id)                  as messages
      from active a
  ),
  by_email as (
    select 'email' as basis,
           c.email_key as match_key,
           array_agg(c.id order by c.id) as member_ids,
           jsonb_agg(to_jsonb(c) - 'email_key' - 'phone_key' order by c.created_at) as members
      from counted c
     where c.email_key is not null
     group by c.email_key
    having count(*) > 1
  ),
  by_phone as (
    select 'phone' as basis,
           c.phone_key as match_key,
           array_agg(c.id order by c.id) as member_ids,
           jsonb_agg(to_jsonb(c) - 'email_key' - 'phone_key' order by c.created_at) as members
      from counted c
     where c.phone_key is not null and length(c.phone_key) = 9
     group by c.phone_key
    having count(*) > 1
  )
  select coalesce(jsonb_agg(g order by g->>'basis', g->>'matchKey'), '[]'::jsonb) into v
    from (
      select jsonb_build_object('basis', basis, 'matchKey', match_key, 'members', members) as g
        from by_email
      union all
      -- A phone group whose members are exactly an email group is the same
      -- group seen twice; the email reading is the confident one, so keep it.
      select jsonb_build_object('basis', p.basis, 'matchKey', p.match_key, 'members', p.members)
        from by_phone p
       where not exists (select 1 from by_email e where e.member_ids = p.member_ids)
    ) s;

  return v;
end;
$$;

revoke all on function public.customer_duplicate_groups() from public, anon;
grant execute on function public.customer_duplicate_groups() to authenticated;

-- ── Merge ────────────────────────────────────────────────────────────────────
create or replace function public.merge_customers(p_keep text, p_merge text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- table -> the column that identifies a row, for an exact undo. The
  -- suppression tables are keyed on the address itself, not on an id.
  k_tables  text[][] := array[
    ['calendar_events','id'], ['communications','id'], ['jobs','id'],
    ['marketing_sends','id'], ['marketing_sms_suppressions','mobile'],
    ['marketing_suppressions','email'], ['measure_sheets','id'],
    ['purchase_orders','id'], ['quote_activity_events','id'], ['quotes','id'],
    ['review_requests','id'], ['takeoffs','id'], ['tasks','id']
  ];
  v_tbl     text;
  v_key     text;
  v_ids     text[];
  v_moved   jsonb := '{}'::jsonb;
  v_dropped jsonb := '[]'::jsonb;
  v_keep    customers%rowtype;
  v_merge   customers%rowtype;
  v_id      uuid;
  i         int;
begin
  if not public.is_active_user() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'two different customers are required' using errcode = '22023';
  end if;

  select * into v_keep  from customers where id = p_keep  and deleted_at is null;
  if not found then raise exception 'the customer to keep was not found' using errcode = '23503'; end if;
  select * into v_merge from customers where id = p_merge and deleted_at is null;
  if not found then raise exception 'the customer to merge was not found' using errcode = '23503'; end if;

  for i in 1 .. array_length(k_tables, 1) loop
    v_tbl := k_tables[i][1];
    v_key := k_tables[i][2];
    execute format(
      'with moved as (update public.%I set customer_id = $1 where customer_id = $2 returning %I)
       select coalesce(array_agg(%I::text), array[]::text[]) from moved', v_tbl, v_key, v_key)
      into v_ids using p_keep, p_merge;
    if coalesce(array_length(v_ids, 1), 0) > 0 then
      v_moved := v_moved || jsonb_build_object(v_tbl, to_jsonb(v_ids));
    end if;
  end loop;

  -- reply_tokens is unique on (job_id, customer_id). Where the surviving
  -- customer already holds a token for that job the merged one cannot move, so
  -- it is recorded in full and deleted. Nothing is lost that matters: a reply
  -- to the retired address still finds the customer by sender address, it just
  -- no longer pins the job.
  with del as (
    delete from reply_tokens r
     where r.customer_id = p_merge
       and r.enquiry_id is null
       and exists (
         select 1 from reply_tokens k
          where k.customer_id = p_keep
            and k.enquiry_id is null
            and k.job_id is not distinct from r.job_id)
    returning r.*
  )
  select coalesce(jsonb_agg(to_jsonb(del)), '[]'::jsonb) into v_dropped from del;

  with moved as (
    update reply_tokens set customer_id = p_keep where customer_id = p_merge returning token
  )
  select coalesce(array_agg(token), array[]::text[]) into v_ids from moved;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    v_moved := v_moved || jsonb_build_object('reply_tokens', to_jsonb(v_ids));
  end if;

  -- Fill blanks on the survivor from the record being merged away, never
  -- overwrite: the kept record is the one a person chose.
  update customers c set
    email             = coalesce(nullif(btrim(c.email), ''),             nullif(btrim(v_merge.email), '')),
    phone             = coalesce(nullif(btrim(c.phone), ''),             nullif(btrim(v_merge.phone), '')),
    mobile            = coalesce(nullif(btrim(c.mobile), ''),            nullif(btrim(v_merge.mobile), '')),
    address           = coalesce(nullif(btrim(c.address), ''),           nullif(btrim(v_merge.address), '')),
    billing_address   = coalesce(nullif(btrim(c.billing_address), ''),   nullif(btrim(v_merge.billing_address), '')),
    business_name     = coalesce(nullif(btrim(c.business_name), ''),     nullif(btrim(v_merge.business_name), '')),
    preferred_contact = coalesce(nullif(btrim(c.preferred_contact), ''), nullif(btrim(v_merge.preferred_contact), '')),
    xero_contact_id   = coalesce(nullif(btrim(c.xero_contact_id), ''),   nullif(btrim(v_merge.xero_contact_id), '')),
    notes = case
      when coalesce(btrim(v_merge.notes), '') = '' then c.notes
      when coalesce(btrim(c.notes), '')       = '' then v_merge.notes
      else c.notes || E'\n\n— merged from ' || coalesce(v_merge.name, 'another record') || E'\n' || v_merge.notes
    end,
    updated_at = now()
  where c.id = p_keep;

  update customers set deleted_at = now(), updated_at = now() where id = p_merge;

  insert into customer_merges (kept_id, merged_id, moved, dropped, kept_before, merged_by)
  values (p_keep, p_merge, v_moved, v_dropped, to_jsonb(v_keep), auth.uid())
  returning id into v_id;

  return jsonb_build_object(
    'mergeId', v_id,
    'moved',   v_moved,
    'dropped', jsonb_array_length(v_dropped));
end;
$$;

revoke all on function public.merge_customers(text, text) from public, anon;
grant execute on function public.merge_customers(text, text) to authenticated;

-- ── Undo ─────────────────────────────────────────────────────────────────────
create or replace function public.undo_customer_merge(p_merge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m        customer_merges%rowtype;
  v_tbl    text;
  v_key    text;
  v_keys   text[];
  keycols  jsonb := jsonb_build_object(
    'marketing_sms_suppressions', 'mobile',
    'marketing_suppressions',     'email',
    'reply_tokens',               'token');
  b        jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into m from customer_merges where id = p_merge_id;
  if not found then raise exception 'merge not found' using errcode = '23503'; end if;
  if m.undone_at is not null then
    return jsonb_build_object('alreadyUndone', true);
  end if;

  for v_tbl in select jsonb_object_keys(m.moved) loop
    v_key  := coalesce(keycols ->> v_tbl, 'id');
    select array_agg(value::text) into v_keys
      from jsonb_array_elements_text(m.moved -> v_tbl) as t(value);
    execute format('update public.%I set customer_id = $1 where %I::text = any($2)', v_tbl, v_key)
      using m.merged_id, v_keys;
  end loop;

  -- Tokens that were removed because they collided come back as they were.
  insert into reply_tokens (token, job_id, customer_id, created_at, last_used_at, enquiry_id)
  select d->>'token', d->>'job_id', d->>'customer_id',
         (d->>'created_at')::timestamptz, (d->>'last_used_at')::timestamptz,
         (d->>'enquiry_id')::uuid
    from jsonb_array_elements(m.dropped) as d
  on conflict (token) do nothing;

  b := m.kept_before;
  if b is not null then
    update customers set
      email             = b->>'email',
      phone             = b->>'phone',
      mobile            = b->>'mobile',
      address           = b->>'address',
      billing_address   = b->>'billing_address',
      business_name     = b->>'business_name',
      preferred_contact = b->>'preferred_contact',
      xero_contact_id   = b->>'xero_contact_id',
      notes             = b->>'notes',
      updated_at        = now()
    where id = m.kept_id;
  end if;

  update customers set deleted_at = null, updated_at = now() where id = m.merged_id;
  update customer_merges set undone_at = now() where id = m.id;

  return jsonb_build_object('undone', true, 'restored', m.merged_id);
end;
$$;

revoke all on function public.undo_customer_merge(uuid) from public, anon;
grant execute on function public.undo_customer_merge(uuid) to authenticated;
