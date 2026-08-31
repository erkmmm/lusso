import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Collapsing the main navigation to an icon rail.
 *
 * The sidebar is 256px and permanently on from `lg` up. On a page that is
 * mostly canvas — the plan takeoff, the measure-sheet table — that plus a
 * right-hand panel eats more than a third of a laptop screen. Collapsing to a
 * 64px rail hands ~192px back without hiding navigation behind a menu.
 *
 * Two pieces of state, and the second is the one that matters:
 *   • `collapsed`  — is the rail on
 *   • `manual`     — has the user ever chosen for themselves
 *
 * A canvas page can ask for the rail while it is open (`requestRail`), but that
 * request is TRANSIENT — it is never written to storage and it unwinds when you
 * leave the page. Opening one plan should not silently collapse the navigation
 * on every other screen for the rest of time.
 *
 * The moment the user works the toggle themselves it becomes `manual`: their
 * choice is stored, applies everywhere, and pages stop asking. A layout that
 * keeps re-deciding itself against you is worse than one that never helps.
 */

// Deliberately NOT `lusso_`-prefixed. `initDurableStore` mirrors every
// `lusso_` key into IndexedDB and restores it if localStorage ever loses it —
// that machinery exists to protect unsynced on-site job data, and sweeping a
// chrome preference into it means the preference outlives being cleared and
// rides along with the business records. This is a view setting; it belongs to
// the device and nothing else.
const COLLAPSED_KEY = 'ui.sidebar.collapsed';
const MANUAL_KEY    = 'ui.sidebar.manual';
const DESKTOP_QUERY = '(min-width: 1024px)';   // Tailwind's `lg`

const read = (key) => {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
};
const write = (key, val) => {
  try { window.localStorage.setItem(key, val ? '1' : '0'); } catch { /* private mode */ }
};

const SidebarCtx = createContext(null);

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsedState] = useState(() => read(COLLAPSED_KEY));
  const [manual, setManual] = useState(() => read(MANUAL_KEY));
  // Read by `requestRail`, which must know the CURRENT value to restore it and
  // can't depend on `collapsed` without re-firing every page's effect.
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  // Below `lg` the sidebar is already an off-canvas drawer with a bottom nav,
  // so the rail must not apply there — it would collapse the drawer itself.
  const [isDesktop, setIsDesktop] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true)
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** The user chose. Their choice sticks and auto-collapse stands down. */
  const setCollapsed = useCallback((next) => {
    setCollapsedState(next);
    write(COLLAPSED_KEY, next);
    setManual(true);
    write(MANUAL_KEY, true);
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  /**
   * A canvas-heavy page asking for the rail while it is open.
   *
   * Returns the undo, so `useEffect(() => requestRail(), [requestRail])` puts
   * the sidebar back on the way out. Silently inert once the user has set the
   * sidebar themselves — including if they set it WHILE the page is open, which
   * is why the undo re-checks rather than trusting the flag it captured.
   */
  const requestRail = useCallback(() => {
    if (read(MANUAL_KEY)) return () => {};
    const previous = collapsedRef.current;
    setCollapsedState(true);
    return () => { if (!read(MANUAL_KEY)) setCollapsedState(previous); };
  }, []);

  // ⌘\ / Ctrl+\ — a modifier chord, because the takeoff has claimed most of
  // the bare letters for its tools.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      setCollapsed(!collapsed);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, setCollapsed]);

  const value = useMemo(() => ({
    // What the layout should actually render: the preference AND the room for it.
    rail: collapsed && isDesktop,
    collapsed,
    isDesktop,
    manual,
    setCollapsed,
    toggle,
    requestRail,
  }), [collapsed, isDesktop, manual, setCollapsed, toggle, requestRail]);

  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}

/** Safe outside the provider (public quote page, login) — returns inert defaults. */
export const useSidebar = () => useContext(SidebarCtx) || {
  rail: false, collapsed: false, isDesktop: true, manual: false,
  setCollapsed: () => {}, toggle: () => {}, requestRail: () => () => {},
};
