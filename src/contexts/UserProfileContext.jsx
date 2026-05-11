import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { getProfileByEmail, saveProfile, bootstrapProfile } from '../store/profiles';

const ProfileCtx = createContext(null);

// Convert Supabase snake_case row → app camelCase profile
function fromSupabase(row) {
  if (!row) return null;
  return {
    id:          row.id,
    email:       row.email,
    displayName: row.display_name || row.displayName || '',
    role:        row.role,
    active:      row.active,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// Convert app profile → Supabase snake_case row
function toSupabase(profile) {
  return {
    id:           profile.id,
    email:        profile.email,
    display_name: profile.displayName || '',
    role:         profile.role,
    active:       profile.active !== undefined ? profile.active : true,
  };
}

export function UserProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(undefined); // undefined = loading

  useEffect(() => {
    if (user === undefined) return; // auth still resolving
    if (!user) { setProfile(null); return; }

    let cancelled = false;

    const load = async () => {
      // 1. Try Supabase first (single source of truth)
      if (supabase) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!cancelled) {
          if (data && !error) {
            const p = fromSupabase(data);
            saveProfile(p); // keep localStorage in sync
            setProfile(p);
            return;
          }
        }
      }

      // 2. Fallback to localStorage cache
      if (!cancelled) {
        const meta = user.user_metadata || {};
        const fallbackName = meta.full_name || meta.name || user.email.split('@')[0];
        let local = getProfileByEmail(user.email);
        if (!local) local = bootstrapProfile(user.email, fallbackName);
        setProfile(local);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  const refreshProfile = async () => {
    if (!user?.id || !supabase) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (data) {
      const p = fromSupabase(data);
      saveProfile(p);
      setProfile(p);
    }
  };

  const updateProfile = async (updates) => {
    if (!profile) return;
    const updated = { ...profile, ...updates };

    // Write to Supabase
    if (supabase) {
      await supabase.from('profiles').upsert(toSupabase(updated), { onConflict: 'id' });
    }

    // Keep localStorage in sync
    saveProfile(updated);
    setProfile(updated);
  };

  // status may be absent in old localStorage cache — treat undefined as 'active'
  // so legacy data doesn't accidentally lock out existing users.
  // Pending is explicit: role === 'pending' OR status === 'pending'.
  const effectiveStatus = profile?.status ?? 'active';
  const isAM      = profile?.role === 'account_manager' && effectiveStatus === 'active';
  const isSP      = profile?.role === 'salesperson'     && effectiveStatus === 'active';
  const isPending = profile?.role === 'pending'         || profile?.status === 'pending';
  const displayName = profile?.displayName || '';

  return (
    <ProfileCtx.Provider value={{ profile, isAM, isSP, isPending, displayName, refreshProfile, updateProfile, toSupabase }}>
      {children}
    </ProfileCtx.Provider>
  );
}

export const useProfile = () => useContext(ProfileCtx);
