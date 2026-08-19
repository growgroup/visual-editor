'use client';

/**
 * メディアライブラリダイアログ
 *
 * 生成済みの画像・イラスト（GET /__media, 381件）を
 * カテゴリ絞り込み＋インクリメンタル検索で選び、キャンバスに挿入する。
 *
 * 設計メモ:
 * - 381件を一度にDOMへ吐くと初回描画が重いので、IntersectionObserver の
 *   センチネルで PAGE_SIZE 件ずつ追加描画する。加えて <img loading="lazy"> で
 *   実際のデコード・ネットワーク取得もビューポート近傍まで遅延させる。
 * - 透過PNGが多いためサムネイル背景はチェッカー柄。
 * - <img> 選択中は「新規挿入」ではなく「src差し替え」モードで開く。
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Loader2, Search, X, ImageOff, RefreshCw, Replace, ImagePlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMediaLibrary, type MediaItem } from '../hooks/useMediaLibrary';

/** 一度に追加描画する件数 */
const PAGE_SIZE = 60;

/** カテゴリの表示順と日本語表記 */
const CATEGORY_ORDER = [
  'object',
  'concept',
  'deco',
  'background',
  'photo',
  'illust',
  'template',
  'upload',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  object: '素材',
  concept: '概念図',
  deco: 'あしらい',
  background: '背景',
  photo: '写真',
  illust: '人物イラスト',
  template: 'テンプレート',
  upload: 'アップロード',
  other: 'その他',
};

const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;

/** 透過素材が見やすいチェッカー柄 */
const CHECKER_STYLE: React.CSSProperties = {
  backgroundColor: '#323232',
  backgroundImage:
    'linear-gradient(45deg, #444444 25%, transparent 25%),' +
    'linear-gradient(-45deg, #444444 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, #444444 75%),' +
    'linear-gradient(-45deg, transparent 75%, #444444 75%)',
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
};

export type MediaLibraryMode = 'insert' | 'replace';

export interface MediaLibraryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 画像が選ばれたときに呼ばれる。挿入/差し替えの実処理は呼び出し側 */
  onSelect: (item: MediaItem) => void;
  /** 'replace' なら選択中の <img> の src を差し替える文言になる */
  mode?: MediaLibraryMode;
  /** 差し替えモードのとき、現在の src（選択状態の表示に使う） */
  currentSrc?: string;
}

/** 検索用の正規化（大文字小文字・全角空白を吸収） */
const normalize = (value: string) => value.toLowerCase().replace(/　/g, ' ').trim();

interface MediaThumbProps {
  item: MediaItem;
  isCurrent: boolean;
  onSelect: (item: MediaItem) => void;
  onPreview: (item: MediaItem | null) => void;
}

function MediaThumb({ item, isCurrent, onSelect, onPreview }: MediaThumbProps) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onMouseEnter={() => onPreview(item)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(item)}
      onBlur={() => onPreview(null)}
      title={item.usage ? `${item.label} — ${item.usage}` : item.label}
      aria-label={`${item.label}（${categoryLabel(item.category)}）${item.usage ? ` ${item.usage}` : ''}`}
      aria-current={isCurrent || undefined}
      className={cn(
        'group flex flex-col overflow-hidden rounded-md border text-left transition-colors',
        'border-[#444444] bg-[#2c2c2c] hover:border-[#0d99ff] hover:bg-[#333]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0d99ff] focus-visible:ring-offset-1 focus-visible:ring-offset-[#2c2c2c]',
        isCurrent && 'border-[#0d99ff] ring-1 ring-[#0d99ff]'
      )}
    >
      <div
        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden p-1.5"
        style={CHECKER_STYLE}
      >
        {failed ? (
          <ImageOff className="h-5 w-5 text-gray-500" aria-hidden="true" />
        ) : (
          <img
            src={item.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="max-h-full max-w-full object-contain transition-transform duration-150 group-hover:scale-[1.04]"
          />
        )}
      </div>
      <span className="truncate border-t border-[#444444] px-1.5 py-1 text-[10px] leading-4 text-gray-300 group-hover:text-white">
        {item.label}
      </span>
    </button>
  );
}

export function MediaLibraryDialog({
  isOpen,
  onClose,
  onSelect,
  mode = 'insert',
  currentSrc,
}: MediaLibraryDialogProps) {
  const { items, isLoading, error, reload } = useMediaLibrary({ enabled: isOpen });

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const deferredQuery = useDeferredValue(query);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 開くたびに検索条件をリセット（前回の絞り込みが残っていると迷子になる）
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCategory('all');
      setVisibleCount(PAGE_SIZE);
      setPreview(null);
    }
  }, [isOpen]);

  // カテゴリ一覧（件数付き）。APIに無いカテゴリが増えても末尾に出す
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    const known = CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => c as string);
    const unknown = [...counts.keys()].filter((c) => !known.includes(c)).sort();
    return [...known, ...unknown].map((id) => ({
      id,
      label: categoryLabel(id),
      count: counts.get(id) ?? 0,
    }));
  }, [items]);

  // label / tags / name を対象にしたインクリメンタル検索
  const filtered = useMemo(() => {
    const q = normalize(deferredQuery);
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (terms.length === 0) return true;
      const haystack = normalize([item.label, item.name, ...item.tags].join(' '));
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, category, deferredQuery]);

  // 絞り込みが変わったら描画件数とスクロール位置を戻す
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [category, deferredQuery]);

  const visibleItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  // 遅延描画: センチネルが見えたら次のページを描画
  useEffect(() => {
    if (!isOpen || !hasMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
        }
      },
      { root, rootMargin: '400px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, hasMore, filtered.length]);

  const handleSelect = useCallback(
    (item: MediaItem) => {
      onSelect(item);
    },
    [onSelect]
  );

  const isReplace = mode === 'replace';
  const detail = preview;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[82vh] max-h-[860px] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden border-[#444444] bg-[#2c2c2c] p-0 text-white"
        onOpenAutoFocus={(e) => {
          // 検索欄にフォーカスを置きたいので既定のフォーカス移動は抑止
          e.preventDefault();
        }}
      >
        {/* ヘッダー */}
        <div className="flex flex-col gap-3 border-b border-[#444444] px-4 py-3">
          <div className="flex items-center gap-2 pr-8">
            {isReplace ? (
              <Replace className="h-4 w-4 shrink-0 text-[#4fb8ff]" aria-hidden="true" />
            ) : (
              <ImagePlus className="h-4 w-4 shrink-0 text-[#4fb8ff]" aria-hidden="true" />
            )}
            <DialogTitle className="text-sm font-medium text-white">メディアライブラリ</DialogTitle>
            <span className="truncate text-xs text-gray-400">
              {isReplace ? '選択中の画像を差し替えます' : 'キャンバスに画像を挿入します'}
            </span>
          </div>

          {/* 検索 */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
              aria-hidden="true"
            />
            <label htmlFor="media-library-search" className="sr-only">
              メディアを検索（名前・タグ）
            </label>
            <Input
              id="media-library-search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・タグで検索（例: アイコン、SEO、人物）"
              className="h-8 border-[#444444] bg-[#383838] pl-8 pr-8 text-xs text-white placeholder:text-gray-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="検索条件をクリア"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-[#4a4a4a] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0d99ff]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* カテゴリ絞り込み */}
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label="カテゴリで絞り込み"
          >
            <CategoryChip
              label="すべて"
              count={items.length}
              isActive={category === 'all'}
              onClick={() => setCategory('all')}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.label}
                count={c.count}
                isActive={category === c.id}
                onClick={() => setCategory(c.id)}
              />
            ))}
          </div>
        </div>

        {/* グリッド */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading && items.length === 0 && (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              メディアを読み込んでいます…
            </div>
          )}

          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-gray-300">
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void reload()}
                className="h-7 gap-1.5 border border-[#444444] bg-[#383838] text-xs hover:bg-[#4a4a4a]"
              >
                <RefreshCw className="h-3 w-3" />
                再読み込み
              </Button>
            </div>
          )}

          {!error && !isLoading && filtered.length === 0 && (
            <div className="flex h-full items-center justify-center text-xs text-gray-400">
              該当するメディアがありません
            </div>
          )}

          {filtered.length > 0 && (
            <>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}
                role="group"
                aria-label="メディア一覧"
              >
                {visibleItems.map((item) => (
                  <MediaThumb
                    key={item.url}
                    item={item}
                    isCurrent={!!currentSrc && currentSrc.endsWith(item.url)}
                    onSelect={handleSelect}
                    onPreview={setPreview}
                  />
                ))}
              </div>
              {/* 遅延描画のセンチネル */}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-4 text-[11px] text-gray-500"
                >
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
                  さらに読み込み中…
                </div>
              )}
            </>
          )}
        </div>

        {/* フッター: ホバー/フォーカス中の詳細 */}
        <div className="flex min-h-[52px] items-center gap-3 border-t border-[#444444] bg-[#2c2c2c] px-4 py-2">
          {detail ? (
            <>
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-[#444444]"
                style={CHECKER_STYLE}
              >
                <img src={detail.url} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-medium text-white">{detail.label}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">
                    {categoryLabel(detail.category)}
                  </span>
                </div>
                <p className="truncate text-[11px] text-gray-400">
                  {detail.usage || detail.tags.join('・') || detail.name}
                </p>
              </div>
              {detail.tags.length > 0 && (
                <div className="hidden shrink-0 gap-1 md:flex">
                  {detail.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-[#383838] px-1.5 py-0.5 text-[10px] text-gray-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="flex items-center gap-2 text-[11px] text-gray-400" aria-live="polite">
              <span>
                {filtered.length}件表示中
                {filtered.length !== items.length && ` / 全${items.length}件`}
              </span>
              <span className="text-gray-600" aria-hidden="true">
                |
              </span>
              <span>クリックで{isReplace ? '選択中の画像を差し替え' : 'キャンバスに挿入'}</span>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CategoryChipProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

function CategoryChip({ label, count, isActive, onClick }: CategoryChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0d99ff]',
        isActive
          ? 'border-[#0d99ff] bg-[#0d99ff] text-white'
          : 'border-[#444444] bg-[#383838] text-gray-300 hover:bg-[#4a4a4a] hover:text-white'
      )}
    >
      {label}
      <span className={cn('ml-1 tabular-nums', isActive ? 'text-blue-100' : 'text-gray-500')}>
        {count}
      </span>
    </button>
  );
}

export default MediaLibraryDialog;
