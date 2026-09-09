-- Blocker 3: an active standard_user could read the business but not write to it.
--
-- Every write policy on the core tables read
--     is_account_manager() OR (is_active_salesperson() AND is_active_user())
-- and is_active_salesperson() tests employee_role = 'salesperson'. An employee
-- whose job title is anything else — Tony is employee_role 'account_manager'
-- on role 'standard_user' — failed both arms and got a read-only app: no new
-- job, no new quote, no new customer, no measure sheet, no PO.
--
-- The second arm becomes "is an active employee". That is the condition these
-- policies were reaching for, and it is what tasks, calendar_events,
-- installations and communications have always used. DELETE is deliberately
-- untouched: destroying a record stays an account-manager act.
do $$
declare
  t text;
  v_write constant text :=
    '(( SELECT is_account_manager()) OR (( SELECT is_active_employee()) AND ( SELECT is_active_user())))';
  tables constant text[] := array[
    'customers', 'jobs', 'quotes', 'measure_sheets', 'purchase_orders',
    'activity', 'suppliers', 'po_message_presets', 'review_requests', 'takeoffs'
  ];
  r record;
begin
  foreach t in array tables loop
    for r in
      select p.polname, p.polcmd
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = t
         and p.polcmd in ('a', 'w')   -- INSERT (WITH CHECK) and UPDATE (USING)
    loop
      if r.polcmd = 'a' then
        execute format('alter policy %I on public.%I with check %s', r.polname, t, v_write);
      else
        execute format('alter policy %I on public.%I using %s', r.polname, t, v_write);
      end if;
    end loop;
  end loop;
end $$;
