import { useCallback, useEffect, useState } from 'react';

/**
 * Light/dark theme for Studio.
 *
 * Design spec §7: colors are CSS custom properties, so switching themes is a
 * single class flip on `<html>` — no re-render of any component is required and
 * no palette class may be hardcoded anywhere (see `styles.css`).
 *
 * Precedence: an explicit stored choice wins, otherwise the OS preference
 * (`prefers-color-scheme`) is followed live — including when it changes while
 * the app is open and nothing has been stored yet.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'orchestra-studio-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Pure resolution rule, split out so it is testable without a DOM. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'dark') return 'dark';
  if (stored === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'dark' || raw === 'light' ? raw : null;
  } catch {
    // Private mode / disabled storage — fall back to the system preference.
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Reflect the theme onto the document. `dark` is set as a class (the stylesheet
 * contract) and mirrored on `data-theme` so either selector can drive it.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
}

export interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveTheme(storedTheme(), systemPrefersDark())
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the class flip above is still applied.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Keep the DOM in sync when a different component (or the toggle) changed it.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS preference until the user makes an explicit choice.
  useEffect(() => {
    if (storedTheme() !== null) return undefined;
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setThemeState(resolveTheme(null, event.matches));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return { theme, setTheme, toggleTheme };
}

export default useTheme;
