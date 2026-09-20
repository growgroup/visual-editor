'use client';

/**
 * 「台帳から挿入」ダイアログ
 *
 * デザインシステムの台帳(利用側が束ねる目録)から、セクション / パーツ / ページの雛形を選んで
 * 紙面に入れる。エディタは目録の中身を知らない ── `io.loadInserts` が返した
 * グループと項目をそのまま出し、選ばれた id を `io.fetchInsert` / `io.createContent` に渡すだけ。
 *
 * 設計メモ:
 * - `loadInserts` が無ければ利用側がこのダイアログを開く導線ごと出さない(io の capability ベース)
 * - セクション・パーツは紙面へ挿入、ページの雛形(`level` が `TPL` / `PAG`)は
 *   「新しいページを作る」に回る。混ぜると「挿したのに紙面が変わらない」になるため、
 *   ボタンの文言も押したあとの動きも分ける
 * - 見本は `previewUrl` の iframe。紙面と同じ Tailwind を読ませたいので sandbox は付けない
 *   (台帳は利用側が用意した自分のページで、外から来た URL ではない)
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Loader2, Search, X, RefreshCw, LayoutTemplate, FilePlus2, Blocks } from 'lucide-react';
import { cn } from '../../lib/utils';
import { io, type EditorInsertCatalog, type EditorInsertGroup, type EditorInsertItem } from '../../io';

/** ページの雛形(紙面に挿さず、新しいページを作る)か */
export function isPageLevel(item: EditorInsertItem): boolean {
  const level = (item.level ?? '').toUpperCase();
  return level === 'TPL' || level === 'PAG';
}

/** パスとして受け付ける形。`/` 始まりの英小文字・数字・ハイフン・スラッシュ */
const PATH_PATTERN = /^\/[a-z0-9\-/]*$/;

/** 検索用の正規化(大文字小文字・全角空白を吸収) */
const normalize = (value: string) => value.toLowerCase().replace(/　/g, ' ').trim();

export interface CatalogInsertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** slide では TPL / PAG のグループと赤字ダミーの選択を出さない */
  editorMode: 'webpage' | 'slide';
  /** 紙面へ挿入する。呼び出し側が fetchInsert → 挿入 → 履歴 → 選択までを行う */
  onInsert: (item: EditorInsertItem, opts: { dummy: boolean }) => Promise<void>;
  /** ページを作る。`io.createContent` が無ければ渡さない(ボタンを出さない) */
  onCreatePage?: (item: EditorInsertItem, input: { title: string; path: string }) => Promise<void>;
}

export function CatalogInsertDialog({
  isOpen,
  onClose,
  editorMode,
  onInsert,
  onCreatePage,
}: CatalogInsertDialogProps) {
  const isSlide = editorMode === 'slide';

  const [catalog, setCatalog] = useState<EditorInsertCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string>('all');
  const [family, setFamily] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dummy, setDummy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pageFormOpen, setPageFormOpen] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const loadInserts = io().loadInserts;
    if (!loadInserts) return;
    setIsLoading(true);
    setError(null);
    try {
      setCatalog(await loadInserts());
    } catch (e) {
      setCatalog(null);
      setError(e instanceof Error ? e.message : '台帳を読み込めませんでした');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 開くたびに読み直し、絞り込みも戻す(前回の絞り込みが残ると迷子になる)
  useEffect(() => {
    if (!isOpen) return;
    setGroupId('all');
    setFamily('all');
    setQuery('');
    setSelectedId(null);
    setActionError(null);
    setPageFormOpen(false);
    void load();
  }, [isOpen, load]);

  /** slide では紙面に挿すものだけを出す(ページの雛形は「ページを作る」ものなので出さない) */
  const groups = useMemo<EditorInsertGroup[]>(() => {
    const all = catalog?.groups ?? [];
    if (!isSlide) return all;
    return all
      .map((g) => ({ ...g, items: g.items.filter((item) => !isPageLevel(item)) }))
      .filter((g) => g.items.length > 0);
  }, [catalog, isSlide]);

  const itemsOfGroup = useMemo(
    () => (groupId === 'all' ? groups.flatMap((g) => g.items) : (groups.find((g) => g.id === groupId)?.items ?? [])),
    [groups, groupId],
  );

  /** 系統(family)の一覧。選んでいるグループの中だけを出す */
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of itemsOfGroup) {
      if (!item.family) continue;
      counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([id, count]) => ({ id, count }));
  }, [itemsOfGroup]);

  // グループを変えると、前のグループにしか無い系統が残ることがある
  useEffect(() => {
    if (family !== 'all' && !families.some((f) => f.id === family)) setFamily('all');
  }, [families, family]);

  const filtered = useMemo(() => {
    const terms = normalize(deferredQuery).split(/\s+/).filter(Boolean);
    return itemsOfGroup.filter((item) => {
      if (family !== 'all' && item.family !== family) return false;
      if (terms.length === 0) return true;
      const haystack = normalize([item.name, item.description ?? '', item.family ?? ''].join(' '));
      return terms.every((term) => haystack.includes(term));
    });
  }, [itemsOfGroup, family, deferredQuery]);

  const selected = useMemo(
    () => filtered.find((i) => i.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  // 絞り込みで選択中の項目が消えたら、選択も外す(右の詰めだけが残らないように)
  useEffect(() => {
    if (selectedId && !filtered.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  const handleInsert = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await onInsert(selected, { dummy: isSlide ? false : dummy });
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '挿入できませんでした');
    } finally {
      setBusy(false);
    }
  }, [selected, busy, onInsert, isSlide, dummy, onClose]);

  const handleCreatePage = useCallback(
    async (input: { title: string; path: string }) => {
      if (!selected || !onCreatePage) return;
      setBusy(true);
      setActionError(null);
      try {
        await onCreatePage(selected, input);
        setPageFormOpen(false);
        onClose();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'ページを作れませんでした');
      } finally {
        setBusy(false);
      }
    },
    [selected, onCreatePage, onClose],
  );

  const selectedIsPage = !!selected && isPageLevel(selected);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          data-catalog-insert-dialog
          className="flex h-[82vh] max-h-[860px] w-[min(1180px,95vw)] max-w-none flex-col gap-0 overflow-hidden border-[#444444] bg-[#2c2c2c] p-0 text-white"
          onOpenAutoFocus={(e) => {
            // 検索欄にフォーカスを置きたいので既定のフォーカス移動は抑止
            e.preventDefault();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        >
          {/* ヘッダー */}
          <div className="flex flex-col gap-3 border-b border-[#444444] px-4 py-3">
            <div className="flex items-center gap-2 pr-8">
              <Blocks className="h-4 w-4 shrink-0 text-[#4fb8ff]" aria-hidden="true" />
              <DialogTitle className="text-sm font-medium text-white">台帳から挿入</DialogTitle>
              <span className="truncate text-xs text-gray-400">
                デザインシステムの台帳から、セクション・パーツ{isSlide ? '' : '・ページの雛形'}を選びます
              </span>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
                aria-hidden="true"
              />
              <label htmlFor="catalog-insert-search" className="sr-only">
                台帳を検索(名前・説明・系統)
              </label>
              <Input
                id="catalog-insert-search"
                ref={searchRef}
                data-catalog-search
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・説明・系統で検索(例: ヒーロー、お知らせ、フォーム)"
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
          </div>

          <div className="flex min-h-0 flex-1">
            {/* 左: グループと系統 */}
            <div className="w-48 shrink-0 overflow-y-auto border-r border-[#444444] px-2 py-3">
              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">分類</p>
              <RailButton
                label="すべて"
                count={groups.reduce((n, g) => n + g.items.length, 0)}
                isActive={groupId === 'all'}
                onClick={() => setGroupId('all')}
              />
              {groups.map((g) => (
                <RailButton
                  key={g.id}
                  label={g.label}
                  count={g.items.length}
                  isActive={groupId === g.id}
                  onClick={() => setGroupId(g.id)}
                />
              ))}

              {families.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wide text-gray-500">系統</p>
                  <RailButton
                    label="すべて"
                    count={itemsOfGroup.length}
                    isActive={family === 'all'}
                    onClick={() => setFamily('all')}
                  />
                  {families.map((f) => (
                    <RailButton
                      key={f.id}
                      label={f.id}
                      count={f.count}
                      isActive={family === f.id}
                      onClick={() => setFamily(f.id)}
                    />
                  ))}
                </>
              )}
            </div>

            {/* 中央: カード一覧 */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3">
              {isLoading && (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  台帳を読み込んでいます…
                </div>
              )}

              {error && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-gray-300">
                  <span>{error}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void load()}
                    className="h-7 gap-1.5 border border-[#444444] bg-[#383838] text-xs hover:bg-[#4a4a4a]"
                  >
                    <RefreshCw className="h-3 w-3" />
                    再読み込み
                  </Button>
                </div>
              )}

              {!isLoading && !error && filtered.length === 0 && (
                <div className="flex h-full items-center justify-center text-xs text-gray-400">
                  該当する項目がありません
                </div>
              )}

              {filtered.length > 0 && (
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
                  role="group"
                  aria-label="台帳の一覧"
                >
                  {filtered.map((item) => (
                    <InsertCard
                      key={item.id}
                      item={item}
                      isSelected={item.id === selectedId}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 右: 選んだ 1 件の詳細 */}
            <div className="flex w-[340px] shrink-0 flex-col border-l border-[#444444]">
              {selected ? (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <PreviewFrame item={selected} height={260} width={1280} />
                    <h3 className="mt-3 text-sm font-medium text-white">{selected.name}</h3>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {[selected.family, selected.level, selected.source === 'local' ? 'この案件' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {selected.description && (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-300">
                        {selected.description}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[#444444] p-3">
                    {actionError && (
                      <p role="alert" className="text-[11px] text-red-400">
                        {actionError}
                      </p>
                    )}
                    {!isSlide && !selectedIsPage && (
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-300">
                        <Checkbox
                          data-catalog-dummy
                          checked={dummy}
                          onCheckedChange={(v) => setDummy(v === true)}
                        />
                        見出し・リード文を赤字ダミーにする
                      </label>
                    )}
                    {selectedIsPage ? (
                      <Button
                        data-catalog-create-page
                        disabled={!onCreatePage || busy}
                        onClick={() => setPageFormOpen(true)}
                        className="h-8 w-full gap-1.5 bg-[#0d99ff] text-xs text-white hover:bg-[#0c8ce9]"
                        title={onCreatePage ? undefined : 'このエディタではページを作れません'}
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                        ページを作る
                      </Button>
                    ) : (
                      <Button
                        data-catalog-insert
                        disabled={busy}
                        onClick={() => void handleInsert()}
                        className="h-8 w-full gap-1.5 bg-[#0d99ff] text-xs text-white hover:bg-[#0c8ce9]"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <LayoutTemplate className="h-3.5 w-3.5" />
                        )}
                        挿入
                      </Button>
                    )}
                    <p className="text-[10px] leading-4 text-gray-500">
                      {selectedIsPage
                        ? 'タイトルとパスを決めて新しいページを作り、そのページを編集します'
                        : '選択中の要素の直後(選択が無ければページの末尾)に入ります'}
                    </p>
                  </div>
                </>
              ) : (
                <p className="flex h-full items-center justify-center px-6 text-center text-[11px] leading-5 text-gray-500">
                  左の一覧から 1 件選ぶと、
                  <br />
                  ここに見本と挿入ボタンが出ます
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {selected && selectedIsPage && onCreatePage && (
        <CreatePageDialog
          open={pageFormOpen}
          onOpenChange={setPageFormOpen}
          item={selected}
          busy={busy}
          error={actionError}
          onSubmit={handleCreatePage}
        />
      )}
    </>
  );
}

/* ============================ 部品 ============================ */

function RailButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0d99ff]',
        isActive ? 'bg-[#0d99ff] text-white' : 'text-gray-300 hover:bg-[#444444] hover:text-white',
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn('shrink-0 tabular-nums text-[10px]', isActive ? 'text-blue-100' : 'text-gray-500')}>
        {count}
      </span>
    </button>
  );
}

/**
 * 見本。`previewUrl` があれば iframe を縮小して出す。
 * 表示だけなので操作は通さない(pointer-events: none)。台帳のページを一覧で開くので `loading="lazy"`。
 */
function PreviewFrame({ item, height, width }: { item: EditorInsertItem; height: number; width: number }) {
  const boxRef = useRef<HTMLDivElement>(null);

  // 器の実幅に合わせて縮小率を決める。器はグリッドの列幅で伸び縮みするので
  // 大きさが変わるたびに測り直す(CSS 変数に書くので React の再描画は起きない)
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const apply = () => {
      const scale = (box.clientWidth || width) / width;
      box.style.setProperty('--catalog-preview-scale', String(scale));
      // 縮めたあとの高さが器を満たすように、縮める前の高さを逆算する(足りないと下に地が出る)
      box.style.setProperty('--catalog-preview-h', `${Math.ceil(height / scale)}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, [width, height]);

  if (!item.previewUrl) {
    return (
      <div
        className="flex items-center justify-center rounded border border-[#444444] bg-[#383838] text-[10px] text-gray-500"
        style={{ height }}
      >
        見本はありません
      </div>
    );
  }
  // 台帳の見本は紙面と同じ幅(PC)で作られている。器の幅に合うよう縮めて上から見せる
  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded border border-[#444444] bg-white"
      style={{ height }}
      aria-hidden="true"
    >
      <iframe
        src={item.previewUrl}
        title={`${item.name} の見本`}
        loading="lazy"
        tabIndex={-1}
        className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
        style={{
          width,
          height: 'var(--catalog-preview-h, 600px)',
          transform: 'scale(var(--catalog-preview-scale, 0.2))',
        }}
      />
    </div>
  );
}

function InsertCard({
  item,
  isSelected,
  onSelect,
}: {
  item: EditorInsertItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-catalog-item={item.id}
      onClick={onSelect}
      aria-pressed={isSelected}
      title={item.description ? `${item.name} — ${item.description}` : item.name}
      className={cn(
        'flex flex-col overflow-hidden rounded-md border text-left transition-colors',
        'border-[#444444] bg-[#2c2c2c] hover:border-[#0d99ff] hover:bg-[#333]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0d99ff]',
        isSelected && 'border-[#0d99ff] ring-1 ring-[#0d99ff]',
      )}
    >
      <PreviewFrame item={item} height={96} width={1280} />
      <span className="truncate border-t border-[#444444] px-2 pb-0.5 pt-1 text-[11px] leading-4 text-gray-200">
        {item.name}
      </span>
      <span className="truncate px-2 pb-1.5 text-[10px] leading-4 text-gray-500">
        {item.family ?? item.description ?? item.level ?? ''}
      </span>
    </button>
  );
}

/** 「ページを作る」の入力(タイトル・パス) */
function CreatePageDialog({
  open,
  onOpenChange,
  item,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: EditorInsertItem;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { title: string; path: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('/');

  useEffect(() => {
    if (!open) return;
    setTitle(item.name);
    setPath('/');
  }, [open, item.name]);

  const pathError = path && !PATH_PATTERN.test(path) ? '「/」で始まる半角英小文字・数字・ハイフンで入れてください' : null;
  const canSubmit = !!title.trim() && !!path && !pathError && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-catalog-page-dialog
        className="w-[min(420px,92vw)] border-[#444444] bg-[#2c2c2c] p-4 text-white"
      >
        <DialogTitle className="text-sm font-medium">ページを作る</DialogTitle>
        <p className="text-[11px] text-gray-400">雛形: {item.name}</p>
        <form
          className="mt-2 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void onSubmit({ title: title.trim(), path });
          }}
        >
          <div className="space-y-1">
            <label htmlFor="catalog-page-title" className="text-[11px] text-gray-400">
              タイトル
            </label>
            <Input
              id="catalog-page-title"
              data-catalog-page-title
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 border-[#444444] bg-[#383838] text-xs text-white"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="catalog-page-path" className="text-[11px] text-gray-400">
              パス
            </label>
            <Input
              id="catalog-page-path"
              data-catalog-page-path
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/company/about"
              aria-invalid={!!pathError}
              className="h-8 border-[#444444] bg-[#383838] font-mono text-xs text-white"
            />
            {pathError && (
              <p role="alert" className="text-[10px] text-red-400">
                {pathError}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-[11px] text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button
              type="submit"
              data-catalog-page-submit
              disabled={!canSubmit}
              className="h-8 gap-1.5 bg-[#0d99ff] text-xs text-white hover:bg-[#0c8ce9]"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              作る
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CatalogInsertDialog;
