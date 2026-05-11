import { useState, useEffect } from 'react';
import { getActiveSalespeople } from '../store/profiles';

/**
 * Returns active salespeople from Supabase profiles.
 * Only includes: is_employee=true, status=active, role=salesperson.
 * Pending and suspended users are never included.
 * Falls back to localStorage cache if Supabase is unavailable.
 */
export function useActiveSalespeople() {
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    let cancelled = false;
    getActiveSalespeople().then(data => {
      if (!cancelled) { setSalespeople(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  return { salespeople, loading };
}
