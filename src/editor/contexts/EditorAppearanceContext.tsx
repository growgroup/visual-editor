'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { PptTheme } from '../components/ppt/PptChrome';

const THEME_KEY = 'gg-editor:ppt-theme';
export const EditorAppearanceContext = createContext<PptTheme | undefined>(undefined);

export function initialEditorTheme(): PptTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ストレージが使えなくてもOS設定で開く */ }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useEditorTheme() {
  const [theme, setTheme] = useState<PptTheme>(initialEditorTheme);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(initialEditorTheme());
    query.addEventListener('change', update);
    window.addEventListener('storage', update);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 今回の表示には適用する */ }
    setTheme(next);
  };
  return { theme, toggleTheme };
}

/** PortalはDOM上の親から継承できないためReactの文脈から同じスキンを付ける。 */
export function useEditorAppearance() {
  const theme = useContext(EditorAppearanceContext);
  return {
    className: theme ? 'gg-editor-skin gg-editor-ui' : undefined,
    'data-editor-theme': theme,
  };
}
