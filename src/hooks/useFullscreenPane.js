import { useEffect } from 'react';

// A `fixed inset-0` pane is not actually fullscreen on a phone or an iPad.
// Three things go wrong on site and this fixes all three:
//
//   1. 100vh / inset-0 sits UNDER the iOS status bar and home indicator
//      (we ship apple-mobile-web-app-status-bar-style=black-translucent), and
//      under Safari's collapsing toolbar. The pane's own CSS handles that with
//      100dvh + env(safe-area-inset-*) — see `.fullscreen-pane` in index.css.
//   2. The page behind keeps scrolling and rubber-banding while you're typing
//      in the pane, so a stray swipe drags the whole sheet around. Locked here.
//   3. Browser chrome stays on screen, eating 15% of an already short viewport.
//      Where the Fullscreen API exists (Android Chrome, desktop) we ask for it;
//      iOS Safari has no such API, which is why 1 and 2 have to work anyway.
//
// Best-effort throughout: a refused fullscreen request is not an error, it just
// means we're on iOS and the CSS is doing the work.
export default function useFullscreenPane(active) {
  useEffect(() => {
    if (!active) return;

    const body = document.body;
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      width: body.style.width,
      top: body.style.top,
    };
    const scrollY = window.scrollY;

    // position:fixed rather than overflow:hidden — iOS Safari ignores the
    // latter on <body> and keeps scrolling the page under the pane.
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.top = `-${scrollY}px`;

    const el = document.documentElement;
    let asked = false;
    if (el.requestFullscreen && !document.fullscreenElement) {
      asked = true;
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { asked = false; });
    } else if (el.webkitRequestFullscreen && !document.webkitFullscreenElement) {
      // Android/older WebKit. iOS Safari exposes this on <video> only.
      try { el.webkitRequestFullscreen(); asked = true; } catch { /* not available */ }
    }

    return () => {
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.width = prev.width;
      body.style.top = prev.top;
      window.scrollTo(0, scrollY);
      if (asked) {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
          try { document.webkitExitFullscreen(); } catch { /* already out */ }
        }
      }
    };
  }, [active]);
}
