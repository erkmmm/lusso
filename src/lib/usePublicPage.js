import { useLayoutEffect } from 'react';

/**
 * Marks a route as customer-facing.
 *
 * Sets `data-public` on <html> for as long as the page is mounted. Staff-only
 * chrome keys off its ABSENCE — most importantly the Glass theme, which is
 * scoped `html.theme-glass:not([data-public])`, so one attribute switches the
 * whole frosted skin off rather than each page having to opt out surface by
 * surface.
 *
 * Why the customer must never see it: these pages render the fixed Lusso brand
 * kit (Paper / Ink / Bronze) and have to look identical whatever theme the
 * staff member who sent the link happens to be running. Without this, the
 * quote a customer opens would inherit whichever skin was last chosen in
 * Settings.
 *
 * useLayoutEffect, not useEffect: this has to land before the browser paints,
 * or the page flashes frosted for a frame on the way in.
 */
export default function usePublicPage() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-public', '');
    return () => root.removeAttribute('data-public');
  }, []);
}
