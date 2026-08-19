'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Google Fontの情報
 */
export interface GoogleFont {
  family: string;
  variants: string[];
  subsets: string[];
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
  /**
   * 適用時に書き込む実際の font-family 値(デバイスフォント用)。
   * 游ゴシックは macOS と Windows で family 名が違うため、単一名で書くと
   * 片方のOSで外れる。スタックごと書き込んで両対応にする。
   */
  stack?: string;
}

/**
 * フォントカテゴリ
 */
export const FONT_CATEGORIES = [
  { value: 'all', label: 'すべて' },
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: '手書き' },
  { value: 'monospace', label: 'Monospace' },
] as const;

export type FontCategory = typeof FONT_CATEGORIES[number]['value'];

/**
 * 人気のGoogle Fontsリスト（APIなしでも使えるフォールバック）
 */
const POPULAR_GOOGLE_FONTS: GoogleFont[] = [
  { family: 'Noto Sans JP', variants: ['100', '300', '400', '500', '700', '900'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Noto Serif JP', variants: ['200', '300', '400', '500', '600', '700', '900'], subsets: ['japanese', 'latin'], category: 'serif' },
  { family: 'M PLUS 1p', variants: ['100', '300', '400', '500', '700', '800', '900'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'M PLUS Rounded 1c', variants: ['100', '300', '400', '500', '700', '800', '900'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Kosugi Maru', variants: ['400'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Kosugi', variants: ['400'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Sawarabi Gothic', variants: ['400'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Sawarabi Mincho', variants: ['400'], subsets: ['japanese', 'latin'], category: 'serif' },
  { family: 'Zen Kaku Gothic New', variants: ['300', '400', '500', '700', '900'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Zen Maru Gothic', variants: ['300', '400', '500', '700', '900'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'Shippori Mincho', variants: ['400', '500', '600', '700', '800'], subsets: ['japanese', 'latin'], category: 'serif' },
  { family: 'BIZ UDGothic', variants: ['400', '700'], subsets: ['japanese', 'latin'], category: 'sans-serif' },
  { family: 'BIZ UDMincho', variants: ['400', '700'], subsets: ['japanese', 'latin'], category: 'serif' },
  { family: 'Roboto', variants: ['100', '300', '400', '500', '700', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Open Sans', variants: ['300', '400', '500', '600', '700', '800'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Lato', variants: ['100', '300', '400', '700', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Montserrat', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Poppins', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Inter', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Oswald', variants: ['200', '300', '400', '500', '600', '700'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Raleway', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Playfair Display', variants: ['400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'serif' },
  { family: 'Merriweather', variants: ['300', '400', '700', '900'], subsets: ['latin'], category: 'serif' },
  { family: 'Lora', variants: ['400', '500', '600', '700'], subsets: ['latin'], category: 'serif' },
  { family: 'PT Serif', variants: ['400', '700'], subsets: ['latin'], category: 'serif' },
  { family: 'Source Code Pro', variants: ['200', '300', '400', '500', '600', '700', '800', '900'], subsets: ['latin'], category: 'monospace' },
  { family: 'Fira Code', variants: ['300', '400', '500', '600', '700'], subsets: ['latin'], category: 'monospace' },
  { family: 'JetBrains Mono', variants: ['100', '200', '300', '400', '500', '600', '700', '800'], subsets: ['latin'], category: 'monospace' },
  { family: 'Dancing Script', variants: ['400', '500', '600', '700'], subsets: ['latin'], category: 'handwriting' },
  { family: 'Pacifico', variants: ['400'], subsets: ['latin'], category: 'handwriting' },
  { family: 'Caveat', variants: ['400', '500', '600', '700'], subsets: ['latin'], category: 'handwriting' },
  { family: 'Bebas Neue', variants: ['400'], subsets: ['latin'], category: 'display' },
  { family: 'Anton', variants: ['400'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Abril Fatface', variants: ['400'], subsets: ['latin'], category: 'display' },
];

/**
 * システムフォント
 */
const SYSTEM_FONTS: GoogleFont[] = [
  // 日本語のデバイスフォント。読み込み不要で即座に効き、書き出したPPTX(游ゴシック)とも揃う
  {
    family: '游ゴシック',
    variants: ['400', '500', '700'],
    subsets: ['japanese'],
    category: 'sans-serif',
    stack: '"Yu Gothic Medium", "游ゴシック Medium", YuGothic, "游ゴシック体", "Yu Gothic", "游ゴシック", sans-serif',
  },
  {
    family: '游明朝',
    variants: ['400', '500', '700'],
    subsets: ['japanese'],
    category: 'serif',
    stack: '"Yu Mincho", "游明朝", YuMincho, "游明朝体", serif',
  },
  {
    family: 'ヒラギノ角ゴシック',
    variants: ['400', '600'],
    subsets: ['japanese'],
    category: 'sans-serif',
    stack: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif',
  },
  {
    family: 'ヒラギノ明朝',
    variants: ['400', '600'],
    subsets: ['japanese'],
    category: 'serif',
    stack: '"Hiragino Mincho ProN", serif',
  },
  {
    family: 'メイリオ',
    variants: ['400', '700'],
    subsets: ['japanese'],
    category: 'sans-serif',
    stack: 'Meiryo, sans-serif',
  },
  { family: 'Arial', variants: ['400', '700'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Helvetica', variants: ['400', '700'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Georgia', variants: ['400', '700'], subsets: ['latin'], category: 'serif' },
  { family: 'Times New Roman', variants: ['400', '700'], subsets: ['latin'], category: 'serif' },
  { family: 'Verdana', variants: ['400', '700'], subsets: ['latin'], category: 'sans-serif' },
  { family: 'Courier New', variants: ['400', '700'], subsets: ['latin'], category: 'monospace' },
  { family: 'system-ui', variants: ['400', '700'], subsets: ['latin'], category: 'sans-serif' },
];

// ローカルストレージのキー
const FONTS_CACHE_KEY = 'google-fonts-cache';
const FONTS_CACHE_EXPIRY_KEY = 'google-fonts-cache-expiry';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7日間

/**
 * Google Fontsを取得・管理するhook
 */
export function useGoogleFonts() {
  const [fonts, setFonts] = useState<GoogleFont[]>([...SYSTEM_FONTS, ...POPULAR_GOOGLE_FONTS]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFonts, setLoadedFonts] = useState<Set<string>>(new Set());

  // Google Fonts APIからフォントリストを取得
  const fetchGoogleFonts = useCallback(async () => {
    // キャッシュをチェック
    try {
      const cachedFonts = localStorage.getItem(FONTS_CACHE_KEY);
      const cacheExpiry = localStorage.getItem(FONTS_CACHE_EXPIRY_KEY);

      if (cachedFonts && cacheExpiry && Date.now() < parseInt(cacheExpiry, 10)) {
        const parsed = JSON.parse(cachedFonts) as GoogleFont[];
        setFonts([...SYSTEM_FONTS, ...parsed]);
        return;
      }
    } catch {
      // キャッシュ読み込みエラーは無視
    }

    setIsLoading(true);
    setError(null);

    try {
      // Google Fonts APIキーを環境変数から取得（オプション）
      // [移植時の修正] Vite には process.env が無い。
      // 未設定なら取得をスキップする(以前は毎回 ReferenceError を投げていた)
      // [パッケージ化での変更] Next/Vite どちらでも読める形にする
      const apiKey =
        (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_GOOGLE_FONTS_API_KEY : undefined) ??
        undefined;

      // APIキーがある場合は直接Google Fonts APIを使用
      // ない場合は内部APIエンドポイント経由で取得
      const apiUrl = apiKey
        ? `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`
        : '/api/google-fonts';

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error('Failed to fetch Google Fonts');
      }

      const data = await response.json();

      // APIエラーまたは空の場合はフォールバック
      if (data.error || !data.items || data.items.length === 0) {
        console.log('[useGoogleFonts] API returned empty, using popular fonts');
        setFonts([...SYSTEM_FONTS, ...POPULAR_GOOGLE_FONTS]);
        return;
      }

      const googleFonts: GoogleFont[] = data.items.map((item: any) => ({
        family: item.family,
        variants: item.variants,
        subsets: item.subsets,
        category: item.category,
      }));

      // キャッシュに保存
      try {
        localStorage.setItem(FONTS_CACHE_KEY, JSON.stringify(googleFonts));
        localStorage.setItem(FONTS_CACHE_EXPIRY_KEY, String(Date.now() + CACHE_DURATION));
      } catch {
        // ストレージが一杯の場合は無視
      }

      setFonts([...SYSTEM_FONTS, ...googleFonts]);
    } catch (err) {
      console.error('[useGoogleFonts] Error fetching fonts:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      // エラー時は人気フォントを使用
      setFonts([...SYSTEM_FONTS, ...POPULAR_GOOGLE_FONTS]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回ロード
  useEffect(() => {
    fetchGoogleFonts();
  }, [fetchGoogleFonts]);

  /**
   * フォントをiframe内にロードする
   */
  const loadFontInIframe = useCallback((
    fontFamily: string,
    iframeDoc: Document,
    weights: string[] = ['400', '700']
  ) => {
    // システムフォントはロード不要
    const isSystemFont = SYSTEM_FONTS.some(f => f.family === fontFamily);
    if (isSystemFont) return;

    // 既にロード済みの場合はスキップ
    const fontKey = `${fontFamily}-${weights.join(',')}`;
    if (loadedFonts.has(fontKey)) return;

    // linkタグが既に存在するかチェック
    const existingLink = iframeDoc.querySelector(`link[data-font-family="${fontFamily}"]`);
    if (existingLink) return;

    // Google Fonts URLを生成
    const encodedFamily = encodeURIComponent(fontFamily);
    const weightsParam = weights.join(';');
    const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weightsParam}&display=swap`;

    // linkタグを作成してheadに追加
    const link = iframeDoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.fontFamily = fontFamily;
    iframeDoc.head.appendChild(link);

    // ロード済みセットに追加
    setLoadedFonts(prev => new Set(prev).add(fontKey));

    console.log(`[useGoogleFonts] Loaded font: ${fontFamily}`);
  }, [loadedFonts]);

  /**
   * フォントのプレビュー用CSSを取得
   */
  const getFontPreviewStyle = useCallback((fontFamily: string): React.CSSProperties => {
    // スタック(カンマ入り)やデバイスフォントの表示名はそのまま/変換して使う。
    // 二重に引用すると `""Yu Gothic", sans-serif"` のような壊れた値になる
    if (fontFamily.includes(',')) return { fontFamily };
    const sys = SYSTEM_FONTS.find((f) => f.family === fontFamily);
    if (sys?.stack) return { fontFamily: sys.stack };
    return { fontFamily: `"${fontFamily}", sans-serif` };
  }, []);

  return {
    fonts,
    isLoading,
    error,
    loadFontInIframe,
    getFontPreviewStyle,
    systemFonts: SYSTEM_FONTS,
    popularFonts: POPULAR_GOOGLE_FONTS,
  };
}

/**
 * フォントをフィルタリングするhook
 */
export function useFilteredFonts(
  fonts: GoogleFont[],
  searchQuery: string,
  category: FontCategory
) {
  return useMemo(() => {
    let filtered = fonts;

    // カテゴリフィルター
    if (category !== 'all') {
      filtered = filtered.filter(f => f.category === category);
    }

    // 検索フィルター
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(f =>
        f.family.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [fonts, searchQuery, category]);
}
