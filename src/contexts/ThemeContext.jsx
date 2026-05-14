import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext({});

const STORAGE_KEY = 'lusso_theme';

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

function applyClass(theme) {
  if (resolve(theme) === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'light'
  );

  const setTheme = useCallback((t) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyClass(t);
  }, []);

  // Apply whenever theme changes (covers mount + explicit switches)
  useEffect(() => { applyClass(theme); }, [theme]);

  // System: react to OS preference changes in real time
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyClass('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Schedule: re-check every minute
  useEffect(() => {
    if (theme !== 'schedule') return;
    const id = setInterval(() => applyClass('schedule'), 60_000);
    return () => clearInterval(id);
  }, [theme]);

  // Re-apply when tab becomes visible again (catches OS changes while backgrounded)
  useEffect(() => {
    if (theme !== 'system' && theme !== 'schedule') return;
    const handler = () => { if (!document.hidden) applyClass(theme); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved: resolve(theme) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
