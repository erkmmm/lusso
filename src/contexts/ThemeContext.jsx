import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadWallpaper, saveWallpaper, clearWallpaper } from '../lib/wallpaperStore';

const ThemeContext = createContext({});

const STORAGE_KEY = 'lusso_theme';
const COLOR_KEY = 'lusso_color_theme';
const ANIM_BG_KEY = 'lusso_anim_bg';
const ANIM_BG_STYLE_KEY = 'lusso_anim_bg_style'; // 'mesh' | 'plasma'

// Glass theme wallpaper. The CHOICE lives in localStorage (a few bytes); the
// custom image itself lives in IndexedDB (see wallpaperStore) because it is
// megabytes and this app is already tight on its localStorage budget.
const GLASS_BG_KEY = 'lusso_glass_bg';      // 'default' | 'none' | 'custom'
const GLASS_DIM_KEY = 'lusso_glass_dim';    // 0–0.85, how far the photo is dimmed

const GLASS_DIM_DEFAULT = 0.46;

// Colour themes — class applied to <html> (taupe has no class).
const COLOR_THEMES = ['lusso', 'taupe', 'green', 'apex', 'cyberpunk', 'matrix', 'mono', 'neon-magenta', 'twitter', 'glass'];

// These themes are neon-on-black by nature — they always render dark, overriding
// the light/dark setting (the app's dark-mode surface machinery is what makes
// them look right).
// Glass joins them for a different reason: it is translucent panels over a
// photograph, so there is no light surface for a light mode to sit on.
const FORCE_DARK_THEMES = new Set(['cyberpunk', 'matrix', 'mono', 'neon-magenta', 'glass']);

// One-time switch to Glass, the current default. After this has run once the
// user can still pick any theme in Settings and it sticks.
//
// Supersedes the Lusso brand-kit migration, which superseded Apex before it —
// same shape each time, and a new key each time, because the point is to move
// everyone onto the new look ONCE. A plain `|| 'glass'` fallback would not do
// it: every existing staff member already has a stored choice, so a redesign
// shipped that way would be seen by nobody but new starters.
//
// The previous keys are deliberately not read any more — their only job was to
// make their own migration run once, and that has long since happened.
const GLASS_MIGRATION_KEY = 'lusso_theme_glass_migrated';
function initialColorTheme() {
  if (!localStorage.getItem(GLASS_MIGRATION_KEY)) {
    localStorage.setItem(GLASS_MIGRATION_KEY, '1');
    localStorage.setItem(COLOR_KEY, 'glass');
    return 'glass';
  }
  return localStorage.getItem(COLOR_KEY) || 'glass';
}

function applyColorClass(colorTheme) {
  const root = document.documentElement;
  COLOR_THEMES.forEach(c => root.classList.remove(`theme-${c}`));
  if (colorTheme && colorTheme !== 'taupe') {
    root.classList.add(`theme-${colorTheme}`);
  }
}

// Schedule: dark 7 pm → 7 am
const DARK_FROM = 19;
const DARK_TO   = 7;

function scheduleIsDark() {
  const h = new Date().getHours();
  return h >= DARK_FROM || h < DARK_TO;
}

function systemIsDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme) {
  if (theme === 'dark')     return 'dark';
  if (theme === 'light')    return 'light';
  if (theme === 'system')   return systemIsDark()   ? 'dark' : 'light';
  if (theme === 'schedule') return scheduleIsDark() ? 'dark' : 'light';
  return 'light';
}

function isDark(theme, colorTheme) {
  if (FORCE_DARK_THEMES.has(colorTheme)) return true;
  return resolve(theme) === 'dark';
}

function applyClass(theme, colorTheme) {
  document.documentElement.classList.toggle('dark', isDark(theme, colorTheme));
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'light'
  );

  const [colorTheme, setColorThemeState] = useState(initialColorTheme);

  const [animBg, setAnimBgState] = useState(
    () => localStorage.getItem(ANIM_BG_KEY) === '1'
  );

  const [bgStyle, setBgStyleState] = useState(
    () => localStorage.getItem(ANIM_BG_STYLE_KEY) || 'mesh'
  );

  const setBgStyle = useCallback((s) => {
    setBgStyleState(s);
    localStorage.setItem(ANIM_BG_STYLE_KEY, s);
  }, []);

  /* ── Glass wallpaper ─────────────────────────────────────────────────── */
  const [glassBg, setGlassBgState] = useState(
    () => localStorage.getItem(GLASS_BG_KEY) || 'default'
  );

  const [glassDim, setGlassDimState] = useState(() => {
    const v = parseFloat(localStorage.getItem(GLASS_DIM_KEY));
    return Number.isFinite(v) ? v : GLASS_DIM_DEFAULT;
  });

  // An object URL for the stored custom image. Held in state rather than
  // rebuilt on render so the <img> URL is stable — a new URL every render
  // would re-decode the photo and re-run its fade-in on every keystroke.
  const [customUrl, setCustomUrl] = useState(null);

  // Load (or drop) the custom image whenever the mode changes. The cleanup
  // revokes the previous URL: without it, every switch leaks a few MB that the
  // browser cannot collect while the blob URL is alive.
  useEffect(() => {
    if (glassBg !== 'custom') return undefined;
    let url = null;
    let cancelled = false;
    loadWallpaper().then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setCustomUrl(url);
    });
    // Clearing happens here rather than in the effect body so that leaving
    // 'custom' both revokes the URL and drops the reference in one place.
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setCustomUrl(null);
    };
  }, [glassBg]);

  const setGlassBg = useCallback((mode) => {
    setGlassBgState(mode);
    localStorage.setItem(GLASS_BG_KEY, mode);
  }, []);

  const setGlassDim = useCallback((v) => {
    setGlassDimState(v);
    localStorage.setItem(GLASS_DIM_KEY, String(v));
  }, []);

  /**
   * Take a file from the picker, store it, and switch to it.
   * Throws with a readable message so the Settings UI can show it — a
   * wallpaper that silently fails to apply is indistinguishable from a bug.
   */
  const uploadGlassWallpaper = useCallback(async (file) => {
    await saveWallpaper(file);
    setGlassBgState('custom');
    localStorage.setItem(GLASS_BG_KEY, 'custom');
    // Re-read rather than reusing the blob we just wrote, so the displayed
    // image is provably the one that landed in the database.
    const blob = await loadWallpaper();
    setCustomUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
  }, []);

  const removeGlassWallpaper = useCallback(async () => {
    await clearWallpaper();
    setGlassBgState('default');
    localStorage.setItem(GLASS_BG_KEY, 'default');
  }, []);

  // The dim is a CSS variable so the shade layer can read it without a
  // re-render, and so it is live-adjustable while dragging the slider.
  useEffect(() => {
    document.documentElement.style.setProperty('--bg-dim', String(glassDim));
  }, [glassDim]);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const setColorTheme = useCallback((c) => {
    setColorThemeState(c);
    localStorage.setItem(COLOR_KEY, c);
    applyColorClass(c);
  }, []);

  const setAnimBg = useCallback((on) => {
    setAnimBgState(on);
    localStorage.setItem(ANIM_BG_KEY, on ? '1' : '0');
    document.documentElement.classList.toggle('anim-bg', on);
  }, []);

  // Apply the .dark class whenever either axis changes (covers mount + switches,
  // and re-applies when a force-dark colour theme is chosen/left)
  useEffect(() => { applyClass(theme, colorTheme); }, [theme, colorTheme]);

  // Apply colour theme class on mount + change
  useEffect(() => { applyColorClass(colorTheme); }, [colorTheme]);

  // Apply the animated-background flag class on mount + change
  useEffect(() => { document.documentElement.classList.toggle('anim-bg', animBg); }, [animBg]);

  // System: react to OS preference changes in real time
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyClass('system', colorTheme);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, colorTheme]);

  // Schedule: re-check every minute
  useEffect(() => {
    if (theme !== 'schedule') return;
    const id = setInterval(() => applyClass('schedule', colorTheme), 60_000);
    return () => clearInterval(id);
  }, [theme, colorTheme]);

  // Re-apply when tab becomes visible again (catches OS changes while backgrounded)
  useEffect(() => {
    if (theme !== 'system' && theme !== 'schedule') return;
    const handler = () => { if (!document.hidden) applyClass(theme, colorTheme); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [theme, colorTheme]);

  return (
    <ThemeContext.Provider value={{
      theme, setTheme, resolved: isDark(theme, colorTheme) ? 'dark' : 'light',
      colorTheme, setColorTheme, animBg, setAnimBg, bgStyle, setBgStyle,
      glassBg, setGlassBg, glassDim, setGlassDim, customUrl,
      uploadGlassWallpaper, removeGlassWallpaper,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
