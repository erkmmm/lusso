import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!supabase) { setUser(null); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Supabase checks the Turnstile token itself (Authentication → Attack
  // Protection → CAPTCHA). Omit the option entirely when there is no token so
  // local builds without a site key still authenticate.
  const captchaOptions = (captchaToken) =>
    captchaToken ? { options: { captchaToken } } : {};

  const signIn = async (email, password, captchaToken) => {
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email, password, ...captchaOptions(captchaToken),
    });
    if (err) setError(err.message);
    return !err;
  };

  const signUp = async (email, password, captchaToken) => {
    setError('');
    const { error: err } = await supabase.auth.signUp({
      email, password, ...captchaOptions(captchaToken),
    });
    if (err) { setError(err.message); return { success: false, needsConfirm: false }; }
    // If session is set immediately → email confirmation is off → auto-signed in
    const { data: { session } } = await supabase.auth.getSession();
    return { success: true, needsConfirm: !session };
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, error, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
