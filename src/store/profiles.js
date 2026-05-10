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
    id:           profile.id,
    email:        profile.email,
    display_name: profile.displayName || '',
    role:         profile.role || 'salesperson',
    active:       profile.active !== undefined ? profile.active : true,
  };
}

function fromSupabaseRow(row) {
  return {
    id:          row.id,
    email:       row.email,
    displayName: row.display_name || '',
    role:        row.role,
    active:      row.active,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
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
  if (updates.role        !== undefined) dbUpdates.role         = updates.role;
  if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
  if (updates.active      !== undefined) dbUpdates.active       = updates.active;

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
