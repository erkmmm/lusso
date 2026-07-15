import { lazy, Suspense, useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Lazy so the WebGL shader chunk only downloads for users who turn the effect on.
const MeshGradient = lazy(() =>
  import('@paper-design/shaders-react').then((m) => ({ default: m.MeshGradient }))
);

// A slow, low-key animated mesh-gradient behind every page. Opt-in (Settings →
// General) and off by default — the primary context is mobile field use, where a
// constantly-animating WebGL canvas would cost battery. Palettes are tuned per
// colour theme so it reads as "the brand, breathing" rather than a light show:
// three deep surface tones and one restrained accent glow.
const PALETTES = {
  taupe:  { dark: ['#141210', '#2a201a', '#3b2e24', '#94715c'], light: ['#f4eee9', '#e8dace', '#d5bca8', '#bd9c83'] },
  green:  { dark: ['#0a140c', '#14251a', '#1b3a20', '#4caf50'], light: ['#eef6ef', '#d6ebd7', '#b7ddba', '#81c784'] },
  apex:   { dark: ['#0a0a0a', '#0f2a20', '#0b3b2c', '#10b77f'], light: ['#eef9f4', '#d7f0e6', '#a7e0cc', '#4bbd93'] },
  cyberpunk:      { dark: ['#0c0c1d', '#1a1a38', '#3a1a4a', '#ff00c8'] },
  matrix:         { dark: ['#000000', '#001a00', '#003b00', '#00ff41'] },
  mono:           { dark: ['#09090b', '#18181b', '#27272a', '#a1a1aa'] },
  'neon-magenta': { dark: ['#000000', '#161616', '#3a1030', '#ff2e9f'] },
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export default function ThemeBackground() {
  const { animBg, colorTheme, resolved } = useTheme();
  const reduced = usePrefersReducedMotion();

  // Respect the user's motion preference — never override it.
  if (!animBg || reduced) return null;

  const pal = PALETTES[colorTheme] || PALETTES.apex;
  const colors = resolved === 'dark' ? pal.dark : (pal.light || pal.dark);

  return (
    <div aria-hidden="true" className="anim-bg-layer" style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', backgroundColor: colors[0] }}>
      <Suspense fallback={null}>
        <MeshGradient
          style={{ width: '100%', height: '100%' }}
          colors={colors}
          speed={0.3}
          backgroundColor={colors[0]}
        />
      </Suspense>
    </div>
  );
}
