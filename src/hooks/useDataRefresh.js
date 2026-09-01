/**
 * useDataRefresh — forces the calling component to re-render whenever
 * the 'lusso:data-changed' event fires.
 *
 * For pages that read data directly in the render body (e.g. Jobs, Customers),
 * a re-render is all that's needed — they automatically get fresh localStorage data.
 *
 * For pages that compute lists in a useMemo, spread the returned tick into the
 * dependency array — a re-render on its own will not recompute a memo:
 *
 *   const tick = useDataRefresh();
 *   const lists = useMemo(() => buildLists(), [tick]);
 *
 * For pages that store data in useState (e.g. JobProfile, CustomerProfile),
 * pass an optional `onRefresh` callback that calls the page's refresh function:
 *
 *   const refresh = () => { setJob(getJob(id)); setQuotes(getQuotesByJob(id)); };
 *   useDataRefresh(refresh);
 */

import { useState, useEffect, useRef } from 'react';

export function useDataRefresh(onRefresh) {
  const [tick, setTick] = useState(0);
  // Keep a stable ref so the effect never needs to re-register when onRefresh changes
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    const handler = () => {
      setTick(t => t + 1);       // force re-render for direct-read pages
      callbackRef.current?.();   // call optional setState refresh for state-based pages
    };
    window.addEventListener('lusso:data-changed', handler);
    return () => window.removeEventListener('lusso:data-changed', handler);
  }, []); // stable — never re-registers

  // Returned so a page that computes its lists in a useMemo can depend on it.
  // A re-render alone does NOT recompute a memo, so `useMemo(..., [])` on a
  // page using this hook silently freezes at mount — which is how Today ended
  // up showing the list it had when you opened it, however much changed after.
  return tick;
}
