import { useEffect, useState } from 'react';

// Flips to true one frame after mount so CSS transitions animate from the
// initial (hidden/zero) state — the standard "draw in on load" trick.
// Respects prefers-reduced-motion by starting as already-mounted.
export function useMountAnimation() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [on, setOn] = useState(!!reduced);
  useEffect(() => {
    if (reduced) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return on;
}
