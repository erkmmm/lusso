import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { getProfileByEmail, saveProfile, bootstrapProfile } from '../store/profiles';

const ProfileCtx = createContext(null);

// Convert Supabase snake_case row → app camelCase profile
function fromSupabase(row) {
  if (!row) return null;
  return {
    id:                       row.id,
    email:                    row.email,
    displayName:              row.display_name || row.displayName || '',
    accountType:              row.account_type || row.role || 'pending_user',
    employeeRole:             row.employee_role || null,
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

function toSupabase(profile) {
  return {
    id:             profile.id,
    email:          profile.email,
    display_name:   profile.displayName  || '',
    account_type:   profile.accountType  || 'pending_user',
    status:         profile.status,
    is_employee:    profile.isEmployee   ?? false,
    phone:          profile.phone        || null,
    position_title: profile.positionTitle || null,
  };
}

export function UserProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(undefined); // undefined = loading

  useEffect(() => {
    if (user === undefined) return;
    if (!user) { setProfile(null); return; }

    let cancelled = false;

    const load = async () => {
      if (supabase) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!cancelled) {
          if (data && !error) {
            const p = fromSupabase(data);
            saveProfile(p);
            setProfile(p);
            return;
          }
        }
      }

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
    if (supabase) {
      await supabase.from('profiles').upsert(toSupabase(updated), { onConflict: 'id' });
    }
    saveProfile(updated);
    setProfile(updated);
  };

  // ── Role booleans — based solely on the real logged-in user's account ─────────
  // status may be absent in old localStorage cache — treat undefined as 'active'
  const effectiveStatus = profile?.status ?? 'active';

  /** Admin access — account_type = account_manager AND status = active */
  const isAM = profile?.accountType === 'account_manager' && effectiveStatus === 'active';

  /** Normal approved user — account_type = standard_user AND status = active */
  const isStandardUser = profile?.accountType === 'standard_user' && effectiveStatus === 'active';

  /** Kept for backward compat — same as isStandardUser */
  const isSP = isStandardUser;

  /** Sales work — employee_role = salesperson, is_employee, active */
  const isSalesperson = (
    profile?.employeeRole === 'salesperson' &&
    profile?.isEmployee   === true &&
    effectiveStatus       === 'active'
  );

  /** Install work — employee_role = installer, is_employee, active */
  const isInstallerRole = (
    profile?.employeeRole === 'installer' &&
    profile?.isEmployee   === true &&
    effectiveStatus       === 'active'
  );

  /** Any active employee */
  const isActiveEmployee = profile?.isEmployee === true && effectiveStatus === 'active';

  /**
   * Pending — account hasn't been approved yet.
   * Transition-safe: checks both accountType and legacy role/status fields.
   */
  const isPending = (
    profile?.accountType === 'pending_user' ||
    profile?.accountType === 'pending'      || // legacy
    profile?.role        === 'pending'      || // legacy localStorage cache
    profile?.role        === 'pending_user' || // legacy localStorage cache
    profile?.status      === 'pending'
  );

  const displayName = profile?.displayName || '';

  const needsOnboarding = (
    profile?.isEmployee             === true &&
    effectiveStatus                 === 'active' &&
    !isPending &&
    profile?.employeeProfileCompleted === false
  );

  return (
    <ProfileCtx.Provider value={{
      profile,
      displayName,
      refreshProfile,
      updateProfile,
      toSupabase,
      // Role booleans — always the real logged-in user, never overridden
      isAM,
      isSP,
      isPending,
      needsOnboarding,
      isAccountManager:  isAM,
      isStandardUser,
      isSalesperson,
      isInstaller:       isInstallerRole,
      isActiveEmployee,
    }}>
      {children}
    </ProfileCtx.Provider>
  );
}

export const useProfile = () => useContext(ProfileCtx);
