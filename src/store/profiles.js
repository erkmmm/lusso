/**
 * User profile store — Supabase as source of truth, localStorage as cache.
 *
 * Supabase `profiles` table uses snake_case.
 * App profile objects use camelCase.
 *
 * Field naming:
 *   DB: role          →  App: accountType   (DB column is named 'role', app uses 'accountType')
 *   DB: employee_role →  App: employeeRole
 *   DB: status        →  App: status         (pending | active | suspended)
 *
 * The DB column is called 'role' (not 'account_type').
 * fromSupabaseRow reads row.role and maps it to accountType.
 * toSupabaseRow writes accountType back as the 'role' DB column.
 */
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';

// ── localStorage cache ────────────────────────────────────────────────────────
const KEY = 'lusso_user_profiles';
function get()    { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function set(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

export function getProfiles()           { return get(); }
export function getProfileByEmail(email) {
  return get().find(p => p.email?.toLowerCase() === email?.toLowerCase());
}

export function saveProfile(profile) {
  const list = get();
  const idx  = list.findIndex(p => p.id === profile.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...profile };
  else list.push(profile);
  set(list);
  return profile;
}

// ── Field converters ──────────────────────────────────────────────────────────

function toSupabaseRow(profile) {
  return {
    id:             profile.id,
    email:          profile.email,
    display_name:   profile.displayName  || '',
    role:           profile.accountType  || 'pending',   // DB column is 'role', not 'account_type'
    employee_role:  profile.employeeRole || null,
    status:         profile.status       || 'active',
    is_employee:    profile.isEmployee   ?? false,
    phone:          profile.phone        || null,
    position_title: profile.positionTitle || null,
  };
}

function fromSupabaseRow(row) {
  return {
    id:                       row.id,
    email:                    row.email,
    displayName:              row.display_name || '',
    // Transition-safe: prefer account_type; fall back to legacy role column
    accountType:              row.account_type || row.role || 'pending_user',
    employeeRole:             row.employee_role || null,
    status:                   row.status || 'pending',
    isEmployee:               row.is_employee ?? false,
    phone:                    row.phone || '',
    positionTitle:            row.position_title || '',
    address:                  row.address || '',
    emergencyContactName:     row.emergency_contact_name || '',
    emergencyContactPhone:    row.emergency_contact_phone || '',
    profilePhotoUrl:          row.profile_photo_url || '',
    employeeProfileCompleted: row.employee_profile_completed ?? false,
    approvedAt:               row.approved_at,
    approvedBy:               row.approved_by,
    createdAt:                row.created_at,
    updatedAt:                row.updated_at,
  };
}

// ── Role helper functions ─────────────────────────────────────────────────────
// Pass a profile object; returns boolean.

/** Admin/full access: account_type = account_manager AND status = active */
export function isAccountManager(profile) {
  return profile?.accountType === 'account_manager' && profile?.status === 'active';
}

/** Normal approved user: account_type = standard_user AND status = active */
export function isStandardUser(profile) {
  return profile?.accountType === 'standard_user' && profile?.status === 'active';
}

/** Active employee (any role): is_employee = true AND status = active */
export function isActiveEmployee(profile) {
  return profile?.isEmployee === true && profile?.status === 'active';
}

/** Sales work: employee_role = salesperson AND is_employee AND active */
export function isSalesperson(profile) {
  return (
    profile?.employeeRole === 'salesperson' &&
    profile?.isEmployee   === true &&
    profile?.status       === 'active'
  );
}

/** Install work: employee_role = installer AND is_employee AND active */
export function isInstaller(profile) {
  return (
    profile?.employeeRole === 'installer' &&
    profile?.isEmployee   === true &&
    profile?.status       === 'active'
  );
}

// ── Supabase-backed CRUD ──────────────────────────────────────────────────────

/** Fetch all profiles from Supabase (AM sees all; others see own — RLS enforced) */
export async function fetchProfilesFromSupabase() {
  if (!supabase) return getProfiles();
  const { data, error } = await supabase.from('profiles').select('*').order('created_at');
  if (error || !data) return getProfiles();
  const profiles = data.map(fromSupabaseRow);
  set(profiles);
  return profiles;
}

/** Create a profile record in Supabase (AM operation) */
export async function createProfileInSupabase({ email, displayName, accountType = 'pending_user' }) {
  if (!supabase) {
    const p = { id: uuidv4(), email, displayName, accountType, status: 'pending', isEmployee: false, createdAt: new Date().toISOString() };
    saveProfile(p);
    return { profile: p, error: null };
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, role: accountType, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    const profile = data ? fromSupabaseRow(data) : null;
    if (profile) saveProfile(profile);
    return { profile, error };
  }

  const pending = {
    id: email, email, displayName, accountType,
    status: 'pending', isEmployee: false,
    createdAt: new Date().toISOString(), pending: true,
  };
  saveProfile(pending);
  return { profile: pending, error: null };
}

/** Update a profile's accountType and/or other fields in Supabase */
export async function updateProfileInSupabase(id, updates) {
  const dbUpdates = {};
  if (updates.accountType  !== undefined) dbUpdates.role          = updates.accountType; // DB column is 'role'
  if (updates.employeeRole !== undefined) dbUpdates.employee_role = updates.employeeRole || null;
  if (updates.displayName  !== undefined) dbUpdates.display_name  = updates.displayName;
  if (updates.status       !== undefined) dbUpdates.status        = updates.status;

  if (supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...dbUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (data) {
      const profile = fromSupabaseRow(data);
      saveProfile(profile);
      return profile;
    }
  }

  const list = get().map(p => p.id === id ? { ...p, ...updates } : p);
  set(list);
  return list.find(p => p.id === id);
}

/**
 * Active salespeople — for quote/measure sheet dropdowns.
 * employee_role = 'salesperson', status = active, is_employee = true.
 */
export async function getActiveSalespeople() {
  if (supabase) {
    const { data, error } = await supabase.rpc('get_active_salespeople');
    if (!error && data) {
      return data.map(r => ({
        id:            r.id,
        displayName:   r.display_name || '',
        fullName:      r.display_name || '',
        email:         r.email || '',
        positionTitle: r.position_title || '',
        phone:         r.phone || '',
        employeeRole:  'salesperson',
      }));
    }
  }
  return get().filter(p => p.isEmployee && p.status === 'active' && p.employeeRole === 'salesperson');
}

/**
 * Active installers — for installer assignment dropdowns.
 * employee_role = 'installer', status = active, is_employee = true.
 */
export async function getActiveInstallers() {
  if (supabase) {
    const { data, error } = await supabase.rpc('get_active_installers');
    if (!error && data) {
      return data.map(r => ({
        id:            r.id,
        displayName:   r.display_name || '',
        fullName:      r.display_name || '',
        email:         r.email || '',
        positionTitle: r.position_title || '',
        phone:         r.phone || '',
        employeeRole:  'installer',
      }));
    }
  }
  return get().filter(p => p.isEmployee && p.status === 'active' && p.employeeRole === 'installer');
}

/**
 * All active employees — for AM-level assignment dropdowns.
 */
export async function getActiveEmployeesFromSupabase() {
  if (supabase) {
    const { data, error } = await supabase.rpc('get_active_employees');
    if (!error && data) {
      return data.map(r => ({
        id:            r.id,
        displayName:   r.display_name || '',
        fullName:      r.display_name || '',
        email:         r.email || '',
        accountType:   r.account_type || r.role || 'standard_user',
        employeeRole:  r.employee_role || null,
        positionTitle: r.position_title || '',
      }));
    }
  }
  return get().filter(p => p.isEmployee && p.status === 'active');
}

/** Fetch all employees (is_employee = true, any status except pending) */
export async function fetchEmployeesFromSupabase() {
  if (!supabase) return getProfiles().filter(p => p.isEmployee);
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_employee', true)
    .order('display_name');
  if (error || !data) return getProfiles().filter(p => p.isEmployee);
  return data.map(fromSupabaseRow);
}

/** Update employee details — calls secure DB function (AM only) */
export async function updateEmployeeProfile(targetUserId, updates) {
  if (!supabase) throw new Error('No Supabase connection');
  const { data, error } = await supabase.rpc('update_employee_profile', {
    target_user_id:  targetUserId,
    p_display_name:  updates.displayName   || null,
    p_role:          updates.accountType   || updates.role || null, // p_role maps to account_type in DB
    p_phone:         updates.phone         || null,
    p_position:      updates.positionTitle || null,
    p_status:        updates.status        || null,
    p_employee_role: updates.employeeRole !== undefined ? (updates.employeeRole || null) : null,
  });
  if (error) throw error;
  const list = get().map(p => p.id === targetUserId ? { ...p, ...updates } : p);
  set(list);
  return data;
}

/** Approve a pending user — calls the secure DB function (AM only) */
export async function approveUser(targetUserId, newAccountType) {
  if (!supabase) throw new Error('No Supabase connection');
  const { data, error } = await supabase.rpc('approve_user', {
    target_user_id: targetUserId,
    new_role:       newAccountType, // parameter name unchanged; DB function sets account_type
  });
  if (error) throw error;
  const list = get().map(p =>
    p.id === targetUserId
      ? { ...p, accountType: newAccountType, status: 'active', isEmployee: true }
      : p
  );
  set(list);
  return data;
}

/** Suspend a user — calls the secure DB function (AM only) */
export async function suspendUser(targetUserId) {
  if (!supabase) throw new Error('No Supabase connection');
  const { error } = await supabase.rpc('suspend_user', { target_user_id: targetUserId });
  if (error) throw error;
  const list = get().map(p => p.id === targetUserId ? { ...p, status: 'suspended' } : p);
  set(list);
}

/** Reactivate a suspended user — calls the secure DB function (AM only) */
export async function reactivateUser(targetUserId) {
  if (!supabase) throw new Error('No Supabase connection');
  const { error } = await supabase.rpc('reactivate_user', { target_user_id: targetUserId });
  if (error) throw error;
  const list = get().map(p => p.id === targetUserId ? { ...p, status: 'active' } : p);
  set(list);
}

/** Decline a pending signup — calls the secure DB function (AM only) */
export async function declineUser(targetUserId) {
  if (!supabase) throw new Error('No Supabase connection');
  const { error } = await supabase.rpc('decline_user', { target_user_id: targetUserId });
  if (error) throw error;
  const list = get().map(p => p.id === targetUserId ? { ...p, status: 'declined' } : p);
  set(list);
}

/**
 * Employee completes their own onboarding — calls secure DB function.
 * Only updates safe fields; cannot change accountType/status/isEmployee.
 */
export async function completeEmployeeProfile(updates) {
  if (!supabase) throw new Error('No Supabase connection');
  const { data, error } = await supabase.rpc('complete_employee_profile', {
    p_display_name:            updates.displayName          || null,
    p_phone:                   updates.phone                || null,
    p_address:                 updates.address              || null,
    p_emergency_contact_name:  updates.emergencyContactName  || null,
    p_emergency_contact_phone: updates.emergencyContactPhone || null,
    p_profile_photo_url:       updates.profilePhotoUrl      || null,
  });
  if (error) throw error;
  const list = get().map(p =>
    p.id === updates.id ? { ...p, ...updates, employeeProfileCompleted: true } : p
  );
  set(list);
  return data;
}

/**
 * Synchronous employee count for sidebar badge.
 * Excludes pending users (is_employee = false for them).
 */
export function getEmployeeCountSync() {
  return get().filter(
    p => p.isEmployee === true && (p.status === 'active' || p.status === 'suspended')
  ).length;
}

/** Fetch a single employee by UUID from Supabase. */
export async function getEmployeeByIdFromSupabase(id) {
  if (supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .eq('is_employee', true)
      .in('status', ['active', 'suspended'])
      .single();
    if (!error && data) return fromSupabaseRow(data);
  }
  return get().find(
    p => p.id === id && p.isEmployee && (p.status === 'active' || p.status === 'suspended')
  ) || null;
}

// ── Bootstrap / legacy helpers ────────────────────────────────────────────────

export function createProfile({ email, displayName, accountType = 'pending_user' }) {
  const p = { id: uuidv4(), email, displayName, accountType, status: 'pending', isEmployee: false, createdAt: new Date().toISOString() };
  saveProfile(p);
  return p;
}

export function bootstrapProfile(email, displayName) {
  const existing = getProfileByEmail(email);
  if (existing) return existing;
  const accountType = get().length === 0 ? 'account_manager' : 'pending_user';
  return createProfile({ email, displayName, accountType });
}

export function deactivateProfile(id) {
  set(get().map(p => p.id === id ? { ...p, status: 'suspended' } : p));
}

export function reactivateProfile(id) {
  set(get().map(p => p.id === id ? { ...p, status: 'active' } : p));
}
