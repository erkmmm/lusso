import { useCallback, useState } from 'react';

/**
 * Remembers which sections a person has folded away, per page, per device.
 *
 * Stores only the sections they have ACTUALLY touched — `{ [id]: isOpen }` —
 * rather than a list of what is currently collapsed. Two reasons:
 *
 *   • A section added to a page later inherits its own `defaultOpen` instead
 *     of whatever the stored shape implies. With a bare "collapsed" list, a
 *     new section can only ever default to open; with this, a section that
 *     ships collapsed stays collapsed until someone opens it.
 *   • It records "I deliberately opened this", which a collapsed-only list
 *     cannot express. Today's sections are open by default, but the purchase
 *     order's product-family sections are not.
 *
 * Per device, never synced: this is a view preference like the theme, not
 * business data, and one person folding away a queue should not fold it away
 * for the installer on the other end of the job.
 *
 * @param scope  one bucket per page, e.g. 'today' → lusso_collapsed_today
 */
export default function useCollapsedSections(scope) {
  const key = `lusso_collapsed_${scope}`;

  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      // Guard the shape: a hand-edited or half-written value must not take the
      // page down, and an array from any earlier format is not usable here.
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });

  const isOpen = useCallback(
    (id, defaultOpen = true) => (typeof state[id] === 'boolean' ? state[id] : defaultOpen),
    [state],
  );

  const toggle = useCallback((id, defaultOpen = true) => {
    setState((prev) => {
      const now = typeof prev[id] === 'boolean' ? prev[id] : defaultOpen;
      const next = { ...prev, [id]: !now };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Out of quota, or Safari private mode. The toggle still works for
        // this visit; it just will not be there tomorrow. Losing a wallpaper
        // preference is not worth interrupting someone mid-job over.
      }
      return next;
    });
  }, [key]);

  /** Force one section open or closed (e.g. jumping to it from elsewhere). */
  const setOpen = useCallback((id, open) => {
    setState((prev) => {
      if (prev[id] === open) return prev;
      const next = { ...prev, [id]: open };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch { /* see above */ }
      return next;
    });
  }, [key]);

  /** Open or collapse every section on the page at once. */
  const setAll = useCallback((open, ids) => {
    const next = {};
    ids.forEach((id) => { next[id] = open; });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* see above */ }
    setState(next);
  }, [key]);

  return { isOpen, toggle, setOpen, setAll };
}
