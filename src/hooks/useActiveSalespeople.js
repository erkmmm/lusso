import { useState, useEffect } from 'react';
import { getActiveEmployeesFromSupabase } from '../store/profiles';

/**
 * Returns all active employees for staff/measurer dropdowns.
 * Includes both salespeople and account managers.
 * Falls back to localStorage cache if Supabase is unavailable.
 */
export function useActiveSalespeople() {
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    let cancelled = false;
    getActiveEmployeesFromSupabase().then(data => {
      if (!cancelled) {
        // Normalise: ensure every entry has fullName for backward-compat
        const normalised = data.map(p => ({
          ...p,
          fullName: p.displayName || p.fullName || '',
        }));
        setSalespeople(normalised);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { salespeople, loading };
}
