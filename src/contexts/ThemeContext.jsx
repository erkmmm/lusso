import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext({});

const STORAGE_KEY = 'lusso_theme';
const COLOR_KEY = 'lusso_color_theme';

// Colour themes — class applied to <html> (taupe has no class).
const COLOR_THEMES = ['taupe', 'green', 'apex', 'cyberpunk', 'matrix', 'mono', 'neon-magenta'];

// These themes are neon-on-black by nature — they always render dark, overriding
// the light/dark setting (the app's dark-mode surface machinery is what makes
// them look right).
const FORCE_DARK_THEMES = new Set(['cyberpunk', 'matrix', 'mono', 'neon-magenta']);
export const themeForcesDark = (colorTheme) => FORCE_DARK_THEMES.has(colorTheme);

// One-time switch to the Apex (demo-matched) theme; after this runs the user
// can still pick any theme in Settings and it sticks.
const APEX_MIGRATION_KEY = 'lusso_theme_apex_migrated';
function initialColorTheme() {
  if (!localStorage.getItem(APEX_MIGRATION_KEY)) {
    localStorage.setItem(APEX_MIGRATION_KEY, '1');
    localStorage.setItem(COLOR_KEY, 'apex');
    return 'apex';
  }
  return localStorage.getItem(COLOR_KEY) || 'apex';
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

  const setTheme = useCallback((t) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const setColorTheme = useCallback((c) => {
    setColorThemeState(c);
    localStorage.setItem(COLOR_KEY, c);
    applyColorClass(c);
  }, []);

  // Apply the .dark class whenever either axis changes (covers mount + switches,
  // and re-applies when a force-dark colour theme is chosen/left)
  useEffect(() => { applyClass(theme, colorTheme); }, [theme, colorTheme]);

  // Apply colour theme class on mount + change
  useEffect(() => { applyColorClass(colorTheme); }, [colorTheme]);

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
    <ThemeContext.Provider value={{ theme, setTheme, resolved: isDark(theme, colorTheme) ? 'dark' : 'light', colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
