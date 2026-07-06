import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [error, setError]     = useState('');
  // aal2 required = the account has MFA enrolled but this session is still at
  // aal1 (password only) and must complete a factor challenge before entering.
  const [mfaRequired, setMfaRequired] = useState(false);

  // Ask Supabase whether this session needs to step up to aal2. Never throws.
  const recheckMfa = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setMfaRequired(!!data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2');
    } catch {
      setMfaRequired(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setUser(null); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session) recheckMfa();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session) recheckMfa(); else setMfaRequired(false);
    });

    return () => subscription.unsubscribe();
  }, [recheckMfa]);

  const signIn = async (email, password) => {
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    else await recheckMfa();
    return !err;
  };

  const signUp = async (email, password) => {
    setError('');
    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) { setError(err.message); return { success: false, needsConfirm: false }; }
    // If session is set immediately → email confirmation is off → auto-signed in
    const { data: { session } } = await supabase.auth.getSession();
    return { success: true, needsConfirm: !session };
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, error, signIn, signUp, signOut, mfaRequired, recheckMfa }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
