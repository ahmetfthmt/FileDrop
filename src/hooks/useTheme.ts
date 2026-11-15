import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'file-drop-theme';

function getStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', isDark);
      setResolvedTheme(isDark ? 'dark' : 'light');
    };

    apply();
    window.localStorage.setItem(STORAGE_KEY, theme);

    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);

  return { theme, setTheme, resolvedTheme };
}
