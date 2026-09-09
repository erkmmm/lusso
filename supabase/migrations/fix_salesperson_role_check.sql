-- Blocker 2: two conflicting definitions of "salesperson" were live.
--
--   is_active_salesperson()        -> employee_role = 'salesperson'   (RLS)
--   is_active_salesperson_by_id()  -> role          = 'salesperson'   (triggers)
--   get_active_salespeople()       -> employee_role = 'salesperson'   (the dropdown)
--
-- `role` only ever holds 'pending' | 'standard_user' | 'account_manager' —
-- approve_user() refuses to write anything else — so the by-id form returned
-- false for every profile that exists. The validate_*_salesperson triggers
-- therefore rejected every salesperson_id write, including the one the dropdown
-- had just offered. `employee_role` is where the job title actually lives, so
-- that is what all three now agree on.
create or replace function public.is_active_salesperson_by_id(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id
      AND is_employee = true
      AND status = 'active'
      AND employee_role = 'salesperson'
  );
$function$;
