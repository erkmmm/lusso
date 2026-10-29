-- Rank duplicate candidates on the NAME, not on which contact detail matched.
--
-- customer_merge.sql proposed groups on a shared email or a shared phone and
-- treated email as the confident signal. The data says otherwise. Of 64 groups
-- sharing an email address, only 14 share a name:
--
--   deb@lusso.com.au        13 records, 13 different people — a staff address
--                           typed in where the customer had none
--   bayden@bgdarchitects.com 3 records — an architect's inbox on three clients
--   admin@build52.com.au     John Stewart and Judy Stewart
--
-- 23 customer records carry a @lusso.com.au address, and trades put one office
-- inbox on every client they refer. An email address is not a person.
--
-- What separates a duplicate from two people is the name — but only when both
-- halves of it are compared. Whole-string similarity puts "Jett Hopko" /
-- "Jett Hopkins" at 0.60 and "John Stewart" / "Judy Stewart" at 0.53, which is
-- no margin at all. Comparing given name and surname separately and taking the
-- worse of the two opens it up: every known duplicate scores 0.40 or more, the
-- Stewarts score 0.11.
--
-- Nothing here merges anything. It decides which groups are worth a person's
-- attention first.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.customer_name_match_score(a text, b text)
returns real
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  na text; nb text;
  fa text; fb text;
  la text; lb text;
begin
  na := btrim(regexp_replace(lower(coalesce(a, '')), '[^a-z ]', ' ', 'g'));
  nb := btrim(regexp_replace(lower(coalesce(b, '')), '[^a-z ]', ' ', 'g'));
  na := regexp_replace(na, ' +', ' ', 'g');
  nb := regexp_replace(nb, ' +', ' ', 'g');
  if na = '' or nb = '' then return 0; end if;
  if na = nb then return 1; end if;

  fa := split_part(na, ' ', 1);  fb := split_part(nb, ' ', 1);
  la := btrim(substr(na, length(fa) + 1));
  lb := btrim(substr(nb, length(fb) + 1));

  -- A single-word name ("Jamie") has no surname to compare, so fall back to
  -- the whole string rather than scoring it zero against "Jamie Arratoon".
  if la = '' or lb = '' then
    return extensions.similarity(na, nb);
  end if;

  return least(extensions.similarity(fa, fb), extensions.similarity(la, lb));
end;
$$;

grant execute on function public.customer_name_match_score(text, text) to authenticated, service_role;

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
           case when c.email ilike '%@lusso.com.au' then null
                else nullif(lower(btrim(c.email)), '') end as email_key,
           nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9), '') as phone_key
      from customers c
     where c.deleted_at is null
  ),
  counted as (
    select a.*,
           (select count(*) from jobs j   where j.customer_id = a.id and j.deleted_at is null) as jobs,
           (select count(*) from quotes q where q.customer_id = a.id)                          as quotes,
           (select count(*) from communications m where m.customer_id = a.id)                  as messages
      from active a
  ),
  -- Score every member against the first record in its group. The group is
  -- only as confident as its weakest member.
  e as (
    select c.*, first_value(c.name) over (partition by c.email_key order by c.created_at, c.id) as anchor
      from counted c where c.email_key is not null
  ),
  p as (
    select c.*, first_value(c.name) over (partition by c.phone_key order by c.created_at, c.id) as anchor
      from counted c where c.phone_key is not null and length(c.phone_key) = 9
  ),
  by_email as (
    select 'email' as basis, c.email_key as match_key,
           array_agg(c.id order by c.id) as member_ids,
           min(public.customer_name_match_score(c.name, c.anchor)) as name_agreement,
           jsonb_agg(to_jsonb(c) - 'email_key' - 'phone_key' - 'anchor' order by c.created_at) as members
      from e c group by c.email_key having count(*) > 1
  ),
  by_phone as (
    select 'phone' as basis, c.phone_key as match_key,
           array_agg(c.id order by c.id) as member_ids,
           min(public.customer_name_match_score(c.name, c.anchor)) as name_agreement,
           jsonb_agg(to_jsonb(c) - 'email_key' - 'phone_key' - 'anchor' order by c.created_at) as members
      from p c group by c.phone_key having count(*) > 1
  )
  select coalesce(jsonb_agg(g order by (g->>'nameAgreement')::real desc, g->>'matchKey'), '[]'::jsonb)
    into v
    from (
      select jsonb_build_object('basis', basis, 'matchKey', match_key,
                                'nameAgreement', round(name_agreement::numeric, 2),
                                'members', members) as g
        from by_email
      union all
      -- A phone group whose members are exactly an email group is the same
      -- group seen twice.
      select jsonb_build_object('basis', p.basis, 'matchKey', p.match_key,
                                'nameAgreement', round(p.name_agreement::numeric, 2),
                                'members', p.members)
        from by_phone p
       where not exists (select 1 from by_email e2 where e2.member_ids = p.member_ids)
    ) s;

  return v;
end;
$$;

revoke all on function public.customer_duplicate_groups() from public, anon;
grant execute on function public.customer_duplicate_groups() to authenticated;
