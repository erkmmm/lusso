import { v4 as uuidv4 } from 'uuid';

const KEY = 'lusso_user_profiles';
function get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function set(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

export function getProfiles() { return get(); }
export function getProfileByEmail(email) { return get().find(p => p.email?.toLowerCase() === email?.toLowerCase()); }

export function saveProfile(profile) {
  const list = get();
  const idx = list.findIndex(p => p.id === profile.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...profile };
  else list.push(profile);
  set(list);
  return profile;
}

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
