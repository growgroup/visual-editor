'use client';

/**
 * メディアライブラリ（生成済み画像・イラスト）を取得するHook
 *
 * `GET /__media` は開発サーバー(vite-plugin-slide-io)が返す静的カタログで、
 * セッション中に内容が変わるのはアップロード時のみ。
 * 381件を毎回取り直すのは無駄なのでモジュールスコープでキャッシュし、
 * 同時オープン時のリクエスト重複も in-flight promise で防ぐ。
 */

import { io, notProvided } from '../../io';
import { useCallback, useEffect, useState } from 'react';

export interface MediaItem {
  /** そのまま <img src> に使えるパス（例: /media/assets/seo-ranking.png） */
  url: string;
  /** ファイル名ベースのID */
  name: string;
  /** object / concept / deco / background / photo / illust / template / upload */
  category: string;
  /** 日本語名 */
  label: string;
  /** 日本語タグ */
  tags: string[];
  /** 想定用途（assets系のみ） */
  usage?: string;
}

interface MediaResponse {
  items?: MediaItem[];
}

let cachedItems: MediaItem[] | null = null;
let inFlight: Promise<MediaItem[]> | null = null;

function normalizeItem(raw: unknown): MediaItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<MediaItem>;
  if (typeof item.url !== 'string' || !item.url) return null;
  return {
    url: item.url,
    name: typeof item.name === 'string' ? item.name : item.url.split('/').pop() || item.url,
    category: typeof item.category === 'string' ? item.category : 'other',
    label: typeof item.label === 'string' && item.label ? item.label : (item.name ?? item.url),
    tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [],
    usage: typeof item.usage === 'string' ? item.usage : undefined,
  };
}

async function fetchMediaItems(): Promise<MediaItem[]> {
  const fetchCatalog = io().apiFetch;
  if (!fetchCatalog) throw notProvided('apiFetch');
  const data = await fetchCatalog('/__media') as MediaResponse;
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(normalizeItem).filter((i): i is MediaItem => i !== null);
}

/**
 * カタログのURL(`/media/...`)をエディタのiframeで解決できる形へ変換する。
 *
 * エディタのキャンバスは埋め込みiframe。実行時のbaseに依存させず、元のページと同じ素材を参照する。
 * `src/lib/slide-html.ts` の toEditorUrls / fromEditorUrls と同じ規約に合わせ、
 * 挿入時は絶対URLにしておく（保存時に fromEditorUrls が相対へ戻す）。
 */
export function toEditorMediaUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  if (!url.startsWith('/media/')) return url;
  return `${window.location.origin}${url}`;
}

/** アップロード後などにキャッシュを破棄する */
export function invalidateMediaLibraryCache() {
  cachedItems = null;
  inFlight = null;
}

interface UseMediaLibraryOptions {
  /** true の間だけ取得する（ダイアログが開いたときに初回ロード） */
  enabled?: boolean;
}

export function useMediaLibrary({ enabled = true }: UseMediaLibraryOptions = {}) {
  const [items, setItems] = useState<MediaItem[]>(() => cachedItems ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && cachedItems) {
      setItems(cachedItems);
      return;
    }
    if (force) invalidateMediaLibraryCache();

    setIsLoading(true);
    setError(null);
    try {
      if (!inFlight) inFlight = fetchMediaItems();
      const result = await inFlight;
      cachedItems = result;
      setItems(result);
    } catch (e) {
      inFlight = null;
      const message = e instanceof Error ? e.message : 'メディア一覧の取得に失敗しました';
      setError(message);
      console.error('[useMediaLibrary] load failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (cachedItems) {
      setItems(cachedItems);
      return;
    }
    void load();
  }, [enabled, load]);

  return {
    items,
    isLoading,
    error,
    /** 再取得（アップロード直後など） */
    reload: useCallback(() => load(true), [load]),
  };
}
