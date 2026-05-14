/**
 * useVersionCheck — detects new deployments and prompts the user to reload.
 *
 * How it works:
 *   1. On mount, reads /version.json and caches the build timestamp.
 *   2. Every time the tab/PWA becomes visible again (e.g. user switches back
 *      from another app), re-fetches /version.json.
 *   3. If the timestamp changed, sets `updateAvailable = true`.
 *   4. The app can show a banner with a "Tap to update" button.
 *
 * This solves the iOS/Android PWA stale-cache problem — the JSON file is
 * tiny and always fetched fresh (cache-busted with a timestamp query param),
 * so the phone detects a new deployment within seconds of opening the app.
 */

import { useState, useEffect, useRef } from 'react';

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const knownVersion = useRef(null);

  const fetchVersion = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.v ?? null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    // Read the version on mount and remember it
    fetchVersion().then(v => { if (v) knownVersion.current = v; });

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = await fetchVersion();
      if (!current || !knownVersion.current) return;
      if (current !== knownVersion.current) {
        setUpdateAvailable(true);
      }
    };

    document.addEventListener('visibilitychange', check);
    // Also check every 5 minutes while the app is open
    const interval = setInterval(check, 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', check);
      clearInterval(interval);
    };
  }, []);

  const applyUpdate = () => window.location.reload();

  return { updateAvailable, applyUpdate };
}
