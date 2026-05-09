import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getProfileByEmail, bootstrapProfile, saveProfile } from '../store/profiles';

const ProfileCtx = createContext(null);

export function UserProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(undefined);

  useEffect(() => {
    if (user === undefined) return;
    if (!user) { setProfile(null); return; }
    const meta = user.user_metadata || {};
    const fallbackName = meta.full_name || meta.name || user.email.split('@')[0];
    let p = getProfileByEmail(user.email);
    if (!p) p = bootstrapProfile(user.email, fallbackName);
    setProfile(p);
  }, [user]);

  const refreshProfile = () => {
    if (!user?.email) return;
    const p = getProfileByEmail(user.email);
    if (p) setProfile({ ...p });
  };

  const updateProfile = (updates) => {
    if (!profile) return;
    const updated = saveProfile({ ...profile, ...updates });
    setProfile(updated);
  };

  const isAM = profile?.role === 'account_manager';
  const isSP = profile?.role === 'salesperson';
  const displayName = profile?.displayName || '';

  return (
    <ProfileCtx.Provider value={{ profile, isAM, isSP, displayName, refreshProfile, updateProfile }}>
      {children}
    </ProfileCtx.Provider>
  );
}

export const useProfile = () => useContext(ProfileCtx);
