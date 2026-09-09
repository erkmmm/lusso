-- Blocker 6: log_record_change() was a no-op stub, so the audit_* triggers on
-- customers, jobs and measure_sheets fired and wrote nothing. Its own comment
-- named the cause: activity_logs.record_id is uuid while every business table
-- keys on text. Fix the column, then actually write the log.

-- 1. The type mismatch that killed it in the first place.
alter table public.activity_logs alter column record_id type text using record_id::text;

-- 2. A row written by a trigger under a cron job, an edge function or the
--    public quote link has no auth.uid(). That must be recorded as "not a
--    signed-in person", not rejected.
alter table public.activity_logs alter column performed_by drop not null;

-- 3. Reading the log means asking "what happened to this record", so index it
--    that way rather than scanning.
create index if not exists activity_logs_record_idx  on public.activity_logs (table_name, record_id, created_at desc);
create index if not exists activity_logs_created_idx on public.activity_logs (created_at desc);

-- 4. The real thing.
--
--    Two things keep this from becoming a second copy of the database:
--    an UPDATE records only the columns that actually moved (the app re-upserts
--    whole rows on sync, and an updated_at-only write is an echo, not an edit),
--    and the fat jsonb columns are summarised rather than duplicated — except
--    on DELETE, which is the one time their contents are the thing you want.
create or replace function public.log_record_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old       jsonb;
  v_new       jsonb;
  v_old_diff  jsonb := '{}'::jsonb;
  v_new_diff  jsonb := '{}'::jsonb;
  v_record_id text;
  v_key       text;
  c_bulky constant text[] := array[
    'line_items','snapshot','plan_snapshot','revisions','pages','markers',
    'measurements','items','comments','specs','options','pickup_locations',
    'selected_line_item_ids','rates','meta','photo_paths'
  ];
begin
  begin
    if tg_op = 'DELETE' then
      v_old       := to_jsonb(old);
      v_record_id := v_old ->> 'id';
      v_old_diff  := v_old;
      v_new_diff  := null;
    else
      v_new       := to_jsonb(new);
      v_record_id := v_new ->> 'id';

      if tg_op = 'INSERT' then
        for v_key in select jsonb_object_keys(v_new) loop
          v_new_diff := v_new_diff || jsonb_build_object(
            v_key, case when v_key = any(c_bulky) then '"«set»"'::jsonb else v_new -> v_key end);
        end loop;
        v_old_diff := null;
      else
        v_old := to_jsonb(old);
        for v_key in select jsonb_object_keys(v_new) loop
          if v_new -> v_key is distinct from v_old -> v_key then
            if v_key = 'updated_at' then continue; end if;   -- moves on every sync write
            if v_key = any(c_bulky) then
              v_old_diff := v_old_diff || jsonb_build_object(v_key, '"«changed»"'::jsonb);
              v_new_diff := v_new_diff || jsonb_build_object(v_key, '"«changed»"'::jsonb);
            else
              v_old_diff := v_old_diff || jsonb_build_object(v_key, v_old -> v_key);
              v_new_diff := v_new_diff || jsonb_build_object(v_key, v_new -> v_key);
            end if;
          end if;
        end loop;
        if v_new_diff = '{}'::jsonb then return new; end if;  -- sync echo, not an edit
      end if;
    end if;

    insert into public.activity_logs (performed_by, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), lower(tg_op), tg_table_name, v_record_id, v_old_diff, v_new_diff);
  exception when others then
    -- An audit failure is not a reason to lose the customer's job.
    raise warning 'log_record_change(% on %): %', tg_op, tg_table_name, sqlerrm;
  end;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- 5. customers, jobs and measure_sheets already had (dead) triggers and start
--    working as-is. These four are the ones the checklist calls out as
--    unrecorded: quotes, purchase orders, installations, calendar events.
drop trigger if exists audit_quotes           on public.quotes;
drop trigger if exists audit_purchase_orders  on public.purchase_orders;
drop trigger if exists audit_installations    on public.installations;
drop trigger if exists audit_calendar_events  on public.calendar_events;

create trigger audit_quotes          after insert or update or delete on public.quotes          for each row execute function public.log_record_change();
create trigger audit_purchase_orders after insert or update or delete on public.purchase_orders for each row execute function public.log_record_change();
create trigger audit_installations   after insert or update or delete on public.installations   for each row execute function public.log_record_change();
create trigger audit_calendar_events after insert or update or delete on public.calendar_events for each row execute function public.log_record_change();
