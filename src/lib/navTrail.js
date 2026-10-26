/**
 * Back navigation — "go to the page that was open last".
 *
 * Back used to decide with `window.history.length > 1`, which answers a
 * different question from the one Back is asking. That number counts the whole
 * tab's session history, including pages visited before the app was ever
 * opened. Measured in this app: open another page in the tab, then load Lusso,
 * and the first app page reports history.length 4 with React Router's own index
 * at 0 — so the old test said "there is somewhere to go back to", called
 * navigate(-1), and popped out of the app's history into whatever preceded it.
 * When the entry behind the app is its own start URL, that is the dashboard,
 * which is exactly how Back ended up there from a page that had a perfectly
 * good predecessor.
 *
 * The right question has two parts:
 *
 *   1. Did THIS APP push an earlier entry? React Router already tracks that as
 *      `idx` in history.state — its index within the session history, counting
 *      only entries the router created. idx > 0 means navigate(-1) lands on a
 *      page of this app. idx === 0 means it does not, whatever history.length
 *      claims, so Back must never use -1 there.
 *
 *   2. If not, was a page of this app open earlier in this browser session?
 *      A fresh document with idx 0 is the normal shape of a reload, a PWA
 *      launch, and a push notification opening a deep link — the session's
 *      earlier pages are still the ones "last" means. So the trail below keeps
 *      the recent paths in sessionStorage, which survives a reload (verified)
 *      and is per-tab.
 *
 * The dashboard is the last resort only: no in-app history entry AND no earlier
 * page in the session.
 */

import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const TRAIL_KEY = 'lusso_nav_trail';
const TRAIL_MAX = 20;

const readTrail = () => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRAIL_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

// Snapshotted at module load, BEFORE this document records anything — so it is
// the trail as the previous document left it. Held in memory and consumed as
// Back walks it, so pressing Back repeatedly on a freshly opened deep link
// keeps moving instead of sticking on one page.
const priorTrail = readTrail();

/** Record a visit. Consecutive duplicates (a replace, a re-render) collapse. */
export function recordVisit(path) {
  if (!path) return;
  const trail = readTrail();
  if (trail[trail.length - 1] === path) return;
  trail.push(path);
  while (trail.length > TRAIL_MAX) trail.shift();
  try { sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail)); } catch { /* private mode / full */ }
}

/**
 * Take the most recent page from earlier in this session that isn't the one
 * we're on, removing it so a second Back goes further rather than nowhere.
 */
export function consumePreviousPageInSession(currentPath) {
  while (priorTrail.length) {
    const candidate = priorTrail.pop();
    if (candidate && candidate !== currentPath) return candidate;
  }
  return null;
}

/**
 * Back handler. `fallback` is used only when there is genuinely nothing to go
 * back to — no in-app history entry and no earlier page in this session.
 */
export function useGoBack(fallback = '/') {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    // Only the router's own index can say whether -1 stays inside the app.
    // Anything else (including a missing index) is treated as "it cannot",
    // because being thrown out of the app is the worse failure.
    if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) {
      navigate(-1);
      return;
    }
    const here = location.pathname + location.search;
    const prev = consumePreviousPageInSession(here);
    // replace, not push: going back should not add to history.
    navigate(prev || fallback, { replace: true });
  }, [navigate, location.pathname, location.search, fallback]);
}
