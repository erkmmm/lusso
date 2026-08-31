import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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
 * A page can ask for the rail on entry (`autoCollapse`), but only until someone
 * expresses a preference. After that their choice wins everywhere, forever —
 * a layout that keeps re-deciding itself against you is worse than one that
 * never helps.
 */

const COLLAPSED_KEY = 'lusso_sidebar_collapsed';
const MANUAL_KEY    = 'lusso_sidebar_manual';
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
   * A canvas-heavy page asking for the rail as it opens. Silently ignored once
   * the user has set the sidebar themselves.
   */
  const autoCollapse = useCallback((want = true) => {
    if (read(MANUAL_KEY)) return;
    setCollapsedState(want);
    write(COLLAPSED_KEY, want);
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
    autoCollapse,
  }), [collapsed, isDesktop, manual, setCollapsed, toggle, autoCollapse]);

  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}

/** Safe outside the provider (public quote page, login) — returns inert defaults. */
export const useSidebar = () => useContext(SidebarCtx) || {
  rail: false, collapsed: false, isDesktop: true, manual: false,
  setCollapsed: () => {}, toggle: () => {}, autoCollapse: () => {},
};
