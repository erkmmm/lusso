-- ============================================================
-- Lusso CRM — Role Structure Migration
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Add account_type column (safe — does nothing if it already exists)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'pending_user';

-- 2. Migrate existing role data → account_type with correct mapping
UPDATE profiles
SET account_type = CASE
  WHEN role = 'account_manager'          THEN 'account_manager'
  WHEN role = 'standard_user'            THEN 'standard_user'
  WHEN role = 'salesperson'              THEN 'standard_user'   -- salesperson is now employee_role only
  WHEN role IN ('pending','pending_user') THEN 'pending_user'
  ELSE 'pending_user'
END
WHERE account_type IS NULL OR account_type = 'pending_user';

-- 3. Fix employee_role for legacy accounts where role = 'salesperson'
UPDATE profiles
SET employee_role = 'salesperson'
WHERE role = 'salesperson'
  AND (employee_role IS NULL OR employee_role = '');

-- 4. Ensure is_employee = true for all approved active/suspended accounts
UPDATE profiles
SET is_employee = true
WHERE account_type IN ('standard_user','account_manager')
  AND status IN ('active','suspended')
  AND is_employee IS DISTINCT FROM true;

-- 5. Set status = 'pending' for any pending_user with no status
UPDATE profiles
SET status = 'pending'
WHERE account_type = 'pending_user'
  AND (status IS NULL OR status NOT IN ('pending','active','suspended'));

-- 6. Set is_employee = false for pending users
UPDATE profiles
SET is_employee = false
WHERE account_type = 'pending_user';

-- ============================================================
-- RPC Functions
-- ============================================================

-- 7. approve_user — sets account_type, status, is_employee, approved_at
CREATE OR REPLACE FUNCTION public.approve_user(
  target_user_id uuid,
  new_role        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT account_type FROM profiles WHERE id = auth.uid()) != 'account_manager' THEN
    RAISE EXCEPTION 'Unauthorized: only account managers can approve users';
  END IF;
  UPDATE profiles SET
    account_type = new_role,
    status       = 'active',
    is_employee  = true,
    approved_at  = NOW(),
    approved_by  = auth.uid(),
    updated_at   = NOW()
  WHERE id = target_user_id;
END;
$$;

-- 8. update_employee_profile — AM-only secure update (parameter p_role now maps to account_type)
CREATE OR REPLACE FUNCTION public.update_employee_profile(
  target_user_id  uuid,
  p_display_name  text DEFAULT NULL,
  p_role          text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_position      text DEFAULT NULL,
  p_status        text DEFAULT NULL,
  p_employee_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT account_type FROM profiles WHERE id = auth.uid()) != 'account_manager' THEN
    RAISE EXCEPTION 'Unauthorized: only account managers can update employee profiles';
  END IF;
  UPDATE profiles SET
    display_name   = COALESCE(p_display_name,  display_name),
    account_type   = COALESCE(p_role,          account_type),
    phone          = COALESCE(p_phone,         phone),
    position_title = COALESCE(p_position,      position_title),
    status         = COALESCE(p_status,        status),
    employee_role  = CASE
                       WHEN p_employee_role IS NOT NULL
                       THEN NULLIF(p_employee_role, '')
                       ELSE employee_role
                     END,
    updated_at     = NOW()
  WHERE id = target_user_id;
END;
$$;

-- 9. get_active_salespeople — active employees with employee_role = 'salesperson'
CREATE OR REPLACE FUNCTION public.get_active_salespeople()
RETURNS TABLE(
  id             uuid,
  display_name   text,
  email          text,
  phone          text,
  position_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, email, phone, position_title
  FROM profiles
  WHERE is_employee = true
    AND status = 'active'
    AND employee_role = 'salesperson';
$$;

-- 10. get_active_installers — active employees with employee_role = 'installer'
CREATE OR REPLACE FUNCTION public.get_active_installers()
RETURNS TABLE(
  id             uuid,
  display_name   text,
  email          text,
  phone          text,
  position_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, email, phone, position_title
  FROM profiles
  WHERE is_employee = true
    AND status = 'active'
    AND employee_role = 'installer';
$$;

-- 11. get_active_employees — all active employees (includes account_type)
CREATE OR REPLACE FUNCTION public.get_active_employees()
RETURNS TABLE(
  id             uuid,
  display_name   text,
  email          text,
  account_type   text,
  employee_role  text,
  position_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, email, account_type, employee_role, position_title
  FROM profiles
  WHERE is_employee = true
    AND status = 'active';
$$;

-- ============================================================
-- RLS Policies  (run only if you need to update them)
-- The policies below protect account_type, status, is_employee
-- from direct user edits. Only AMs can change these fields.
-- ============================================================

-- Allow users to read their own profile; AMs can read all
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR (SELECT account_type FROM profiles WHERE id = auth.uid()) = 'account_manager'
  );

-- Users cannot directly UPDATE account_type/status/is_employee (use secure functions)
-- AMs can update any profile
DROP POLICY IF EXISTS "profiles_update_am" ON profiles;
CREATE POLICY "profiles_update_am"
  ON profiles FOR UPDATE
  USING (
    (SELECT account_type FROM profiles WHERE id = auth.uid()) = 'account_manager'
  );

-- ============================================================
-- Verification queries (run after migration to confirm)
-- ============================================================
-- SELECT id, email, role, account_type, employee_role, status, is_employee FROM profiles ORDER BY created_at;
-- SELECT account_type, count(*) FROM profiles GROUP BY account_type;
-- SELECT employee_role, count(*) FROM profiles GROUP BY employee_role;
