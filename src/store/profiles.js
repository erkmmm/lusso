/**
 * User profile store — Supabase as source of truth, localStorage as cache.
 *
 * Supabase `profiles` table uses snake_case (display_name, created_at).
 * App profile objects use camelCase (displayName, createdAt).
 */
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';

// ── localStorage cache ────────────────────────────────────────────────────────
const KEY = 'lusso_user_profiles';
function get()      { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function set(arr)   { localStorage.setItem(KEY, JSON.stringify(arr)); }

export function getProfiles()          { return get(); }
export function getProfileByEmail(email) {
  return get().find(p => p.email?.toLowerCase() === email?.toLowerCase());
}

export function saveProfile(profile) {
  const list = get();
  const idx = list.findIndex(p => p.id === profile.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...profile };
  else list.push(profile);
  set(list);
  return profile;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
function toSupabaseRow(profile) {
  return {
    id:             profile.id,
    email:          profile.email,
    display_name:   profile.displayName || '',
    role:           profile.role || 'standard_user',
    employee_role:  profile.employeeRole || null,
    status:         profile.status || 'active',
    is_employee:    profile.isEmployee ?? false,
    phone:          profile.phone || null,
    position_title: profile.positionTitle || null,
  };
}

function fromSupabaseRow(row) {
  return {
    id:                       row.id,
    email:                    row.email,
    displayName:              row.display_name || '',
    role:                     row.role,           // account type: pending_user | standard_user | account_manager
    employeeRole:             row.employee_role || null, // job role: salesperson | account_manager
    status:                   row.status,
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

// ── Supabase-backed CRUD ──────────────────────────────────────────────────────

/** Fetch all profiles from Supabase (AM sees all; SP sees own — RLS enforced) */
export async function fetchProfilesFromSupabase() {
  if (!supabase) return getProfiles();
  const { data, error } = await supabase.from('profiles').select('*').order('created_at');
  if (error || !data) return getProfiles();
  const profiles = data.map(fromSupabaseRow);
  // Update localStorage cache
  set(profiles);
  return profiles;
}

/** Create a new salesperson profile in Supabase + localStorage cache */
export async function createProfileInSupabase({ email, displayName, role = 'salesperson' }) {
  // Supabase auth user must exist first (they sign up themselves via the login page)
  // We only create the profile row here — auth row created by Supabase trigger on signup
  if (!supabase) {
    // Offline fallback — localStorage only
    const p = { id: uuidv4(), email, displayName, role, active: true, createdAt: new Date().toISOString() };
    saveProfile(p);
    return { profile: p, error: null };
  }

  // First check if they already have an auth user (must sign up first)
  // We upsert into profiles — if their auth user doesn't exist yet the FK will fail
  // The correct flow: user signs up → trigger creates profiles row → AM edits role
  // This function is used when AM wants to pre-create/update a profile
  const row = toSupabaseRow({
    id: uuidv4(), // placeholder — will be overwritten if auth user exists
    email, displayName, role, active: true
  });

  // Try to find existing auth user by email via profiles table
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    // User already exists — update their role/display_name
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, role, active: true })
      .eq('id', existing.id)
      .select()
      .single();
    const profile = data ? fromSupabaseRow(data) : null;
    if (profile) saveProfile(profile);
    return { profile, error };
  }

  // User doesn't exist yet — save to localStorage as pending
  // They'll appear after they sign up and the trigger creates their profile row
  const pending = { id: email, email, displayName, role, active: true, createdAt: new Date().toISOString(), pending: true };
  saveProfile(pending);
  return { profile: pending, error: null };
}

/** Update a profile's role and/or active status in Supabase */
export async function updateProfileInSupabase(id, updates) {
  const dbUpdates = {};
  if (updates.role         !== undefined) dbUpdates.role          = updates.role;
  if (updates.employeeRole !== undefined) dbUpdates.employee_role = updates.employeeRole;
  if (updates.displayName  !== undefined) dbUpdates.display_name  = updates.displayName;
  if (updates.active       !== undefined) dbUpdates.active        = updates.active;

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

  // Fallback: localStorage only
  const list = get().map(p => p.id === id ? { ...p, ...updates } : p);
  set(list);
  return list.find(p => p.id === id);
}

/**
 * Returns active salespeople only — use this for quote/measure sheet dropdowns.
 * Pending and suspended users are never included.
 */
export async function getActiveSalespeople() {
  if (supabase) {
    const { data, error } = await supabase.rpc('get_active_salespeople');
    if (!error && data) {
      return data.map(r => ({
        id:            r.id,
        displayName:   r.display_name || '',
        email:         r.email || '',
        positionTitle: r.position_title || '',
        phone:         r.phone || '',
        fullName:      r.display_name || '', // compat alias
        role:          'salesperson',
      }));
    }
  }
  // Fallback: localStorage cache filtered to active salespeople by employee_role
  return get().filter(p => p.isEmployee && p.status === 'active' && p.employeeRole === 'salesperson');
}

/**
 * Returns all active employees — use for AM-level assignment dropdowns.
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
        role:          r.role,
        positionTitle: r.position_title || '',
      }));
    }
  }
  return get().filter(p => p.isEmployee && p.status === 'active');
}

/** Fetch only active employees (is_employee=true) */
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
    p_role:          updates.role          || null,
    p_phone:         updates.phone         || null,
    p_position:      updates.positionTitle || null,
    p_status:        updates.status        || null,
    p_employee_role: updates.employeeRole  || null,
  });
  if (error) throw error;
  // Update local cache
  const list = get().map(p => p.id === targetUserId ? { ...p, ...updates } : p);
  set(list);
  return data;
}

/** Approve a pending user — calls the secure DB function (AM only) */
export async function approveUser(targetUserId, newRole) {
  if (!supabase) throw new Error('No Supabase connection');
  const { data, error } = await supabase.rpc('approve_user', {
    target_user_id: targetUserId,
    new_role: newRole,
  });
  if (error) throw error;
  // Update local cache
  const list = get().map(p =>
    p.id === targetUserId ? { ...p, role: newRole, status: 'active' } : p
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

/**
 * Employee completes their own onboarding profile — calls secure DB function.
 * Only updates safe fields; cannot change role/status/is_employee.
 */
export async function completeEmployeeProfile(updates) {
  if (!supabase) throw new Error('No Supabase connection');
  const { data, error } = await supabase.rpc('complete_employee_profile', {
    p_display_name:          updates.displayName          || null,
    p_phone:                 updates.phone                || null,
    p_address:               updates.address              || null,
    p_emergency_contact_name:  updates.emergencyContactName  || null,
    p_emergency_contact_phone: updates.emergencyContactPhone || null,
    p_profile_photo_url:     updates.profilePhotoUrl      || null,
  });
  if (error) throw error;
  // Update local cache
  const list = get().map(p => p.id === updates.id
    ? { ...p, ...updates, employeeProfileCompleted: true }
    : p
  );
  set(list);
  return data;
}

/** Reactivate a suspended user — calls the secure DB function (AM only) */
export async function reactivateUser(targetUserId) {
  if (!supabase) throw new Error('No Supabase connection');
  const { error } = await supabase.rpc('reactivate_user', { target_user_id: targetUserId });
  if (error) throw error;
  const list = get().map(p => p.id === targetUserId ? { ...p, status: 'active' } : p);
  set(list);
}

/**
 * Synchronous count of employees from the localStorage profiles cache.
 * Used by the sidebar badge — avoids an async call on every 2 s interval.
 * Only counts is_employee=true AND status in active/suspended (not pending).
 */
export function getEmployeeCountSync() {
  return get().filter(
    p => p.isEmployee === true && (p.status === 'active' || p.status === 'suspended')
  ).length;
}

/** Fetch a single employee profile from Supabase by UUID. */
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
  // Fallback to localStorage cache
  return get().find(
    p => p.id === id && p.isEmployee && (p.status === 'active' || p.status === 'suspended')
  ) || null;
}

// ── Legacy sync helpers (kept for backward compat) ─────────────────────────────
export function createProfile({ email, displayName, role = 'salesperson' }) {
  const p = { id: uuidv4(), email, displayName, role, active: true, createdAt: new Date().toISOString() };
  saveProfile(p);
  return p;
}

export function deactivateProfile(id) {
  set(get().map(p => p.id === id ? { ...p, active: false } : p));
}

export function reactivateProfile(id) {
  set(get().map(p => p.id === id ? { ...p, active: true } : p));
}

export function bootstrapProfile(email, displayName) {
  const existing = getProfileByEmail(email);
  if (existing) return existing;
  const role = get().length === 0 ? 'account_manager' : 'salesperson';
  return createProfile({ email, displayName, role });
}
