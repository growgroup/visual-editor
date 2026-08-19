'use client';

/**
 * MultiPageCanvasContext
 *
 * マルチページ無限キャンバスの状態管理Context
 * 全ページを常にキャンバス上に表示し、クリックで即座にページ切替
 * Figmaライクな統合ビュー（モード切替なし）
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { useEditorArtboard } from './EditorArtboardContext';
import { useEditorHistory } from './EditorHistoryContext';
import { useEditorRefs } from './EditorRefsContext';
import { generateEditableHtml } from '../utils/html-utils';

// ============================================================
// 定数
// ============================================================

/** ウェブページの標準幅 (px) */
export const WEBPAGE_WIDTH = 1440;
/** ウェブページの最小高さ (px) */
export const WEBPAGE_MIN_HEIGHT = 900;
/** ページ間の水平間隔 (px) */
const LAYOUT_GAP_X = 100;
/** ズーム範囲 */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.0;

// ============================================================
// 型定義
// ============================================================

export interface PageFrame {
  id: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  thumbnailHtml: string;
  thumbnailDataUrl: string | null;
  isDirty: boolean;
  html: string;
}

export interface CanvasViewState {
  canvasOffset: { x: number; y: number };
  canvasZoom: number;
  activePageId: string | null;
}

export interface MultiPageCanvasContextValue {
  // ページフレーム管理
  pages: PageFrame[];
  getPage: (id: string) => PageFrame | undefined;
  updatePageFrame: (id: string, updates: Partial<PageFrame>) => void;

  // ビュー状態
  viewState: CanvasViewState;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setCanvasZoom: (zoom: number) => void;

  // ページ切替（Figmaスタイル: モード切替なし）
  switchPage: (id: string) => void;

  // 軽量ページフォーカス（iframe再読込なし、activePageId + contentId更新のみ）
  focusPage: (id: string) => void;

  // ページ配置
  autoLayoutPages: () => void;

  // ズーム操作
  zoomToFit: (containerWidth: number, containerHeight: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // サムネイル更新
  updateThumbnail: (id: string, dataUrl: string) => void;

  // 有効化フラグ
  isEnabled: boolean;

  // グローバルUndo/Redoハンドラー (MultiPageCanvasViewから登録される)
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  registerUndoHandlers: (handlers: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean }) => void;
}

// ============================================================
// Context
// ============================================================

const MultiPageCanvasContext = createContext<MultiPageCanvasContextValue | null>(null);

export function useMultiPageCanvas(): MultiPageCanvasContextValue {
  const context = useContext(MultiPageCanvasContext);
  if (!context) {
    throw new Error('useMultiPageCanvas must be used within MultiPageCanvasProvider');
  }
  return context;
}

/**
 * マルチページキャンバスが有効な場合のみ値を返す（オプショナル使用用）
 */
export function useMultiPageCanvasOptional(): MultiPageCanvasContextValue | null {
  return useContext(MultiPageCanvasContext);
}

// ============================================================
// レイアウト計算ユーティリティ
// ============================================================

function calculateAutoLayout(pages: PageFrame[]): PageFrame[] {
  return pages.map((page, index) => ({
    ...page,
    position: {
      x: index * (WEBPAGE_WIDTH + LAYOUT_GAP_X),
      y: 0,
    },
    size: { width: WEBPAGE_WIDTH, height: page.size.height || WEBPAGE_MIN_HEIGHT },
  }));
}

function calculateFitZoom(
  pages: PageFrame[],
  containerWidth: number,
  containerHeight: number
): { zoom: number; offset: { x: number; y: number } } {
  if (pages.length === 0) return { zoom: 0.5, offset: { x: 0, y: 0 } };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pages.forEach(p => {
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x + p.size.width);
    maxY = Math.max(maxY, p.position.y + p.size.height);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const padding = 80;

  const scaleX = (containerWidth - padding * 2) / totalWidth;
  const scaleY = (containerHeight - padding * 2) / totalHeight;
  const zoom = Math.min(scaleX, scaleY, 1);

  const offset = {
    x: (containerWidth - totalWidth * zoom) / 2 - minX * zoom,
    y: (containerHeight - totalHeight * zoom) / 2 - minY * zoom,
  };

  return { zoom: Math.max(zoom, MIN_ZOOM), offset };
}

// ============================================================
// Provider
// ============================================================

interface MultiPageCanvasProviderProps {
  children: React.ReactNode;
  enabled: boolean;
}

export function MultiPageCanvasProvider({
  children,
  enabled,
}: MultiPageCanvasProviderProps) {
  const artboard = useEditorArtboard();
  const history = useEditorHistory();
  const refs = useEditorRefs();

  // ページフレーム状態
  const [pagesMap, setPagesMap] = useState<Map<string, PageFrame>>(new Map());
  const [isLayoutInitialized, setIsLayoutInitialized] = useState(false);

  // ビュー状態（モードなし — 常に統合ビュー）
  const [viewState, setViewState] = useState<CanvasViewState>({
    canvasOffset: { x: 0, y: 0 },
    canvasZoom: 0.15,
    activePageId: null,
  });

  // contentListからページフレームを同期
  const prevContentListRef = useRef<string>('');
  useEffect(() => {
    if (!enabled) return;

    const contentListKey = artboard.contentList.map(c => c.id).join(',');
    if (contentListKey === prevContentListRef.current) return;
    prevContentListRef.current = contentListKey;

    setPagesMap(prev => {
      const newMap = new Map<string, PageFrame>();
      artboard.contentList.forEach(content => {
        const existing = prev.get(content.id);
        if (existing) {
          newMap.set(content.id, {
            ...existing,
            title: content.title,
            html: content.thumbnailHtml || existing.html,
            thumbnailHtml: content.thumbnailHtml || existing.thumbnailHtml,
          });
        } else {
          newMap.set(content.id, {
            id: content.id,
            title: content.title,
            position: { x: 0, y: 0 },
            size: { width: WEBPAGE_WIDTH, height: WEBPAGE_MIN_HEIGHT },
            thumbnailHtml: content.thumbnailHtml || '',
            thumbnailDataUrl: null,
            isDirty: false,
            html: content.thumbnailHtml || '',
          });
        }
      });
      return newMap;
    });
    setIsLayoutInitialized(false);
  }, [enabled, artboard.contentList]);

  // 初期レイアウト
  useEffect(() => {
    if (!enabled || isLayoutInitialized || pagesMap.size === 0) return;
    setPagesMap(prev => {
      const pages = Array.from(prev.values());
      const laid = calculateAutoLayout(pages);
      const newMap = new Map<string, PageFrame>();
      laid.forEach(p => newMap.set(p.id, p));
      return newMap;
    });
    setIsLayoutInitialized(true);
  }, [enabled, isLayoutInitialized, pagesMap.size]);

  // 初回: 最初のページを自動アクティブ化
  useEffect(() => {
    if (!enabled || viewState.activePageId) return;
    if (artboard.contentList.length > 0) {
      const firstId = artboard.contentList[0].id;
      setViewState(prev => ({ ...prev, activePageId: firstId }));
    }
  }, [enabled, artboard.contentList, viewState.activePageId]);

  // ページ配列（順序付き）
  const pages = useMemo(() => {
    const contentOrder = artboard.contentList.map(c => c.id);
    return Array.from(pagesMap.values()).sort(
      (a, b) => contentOrder.indexOf(a.id) - contentOrder.indexOf(b.id)
    );
  }, [pagesMap, artboard.contentList]);

  // --- コールバック ---

  const getPage = useCallback((id: string) => pagesMap.get(id), [pagesMap]);

  const updatePageFrame = useCallback((id: string, updates: Partial<PageFrame>) => {
    setPagesMap(prev => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const newMap = new Map(prev);
      newMap.set(id, { ...existing, ...updates });
      return newMap;
    });
  }, []);

  const setCanvasOffset = useCallback((offset: { x: number; y: number }) => {
    setViewState(prev => ({ ...prev, canvasOffset: offset }));
  }, []);

  const setCanvasZoom = useCallback((zoom: number) => {
    setViewState(prev => ({
      ...prev,
      canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
    }));
  }, []);

  // Stale closure回避用ref
  const activePageIdRef = useRef<string | null>(null);
  activePageIdRef.current = viewState.activePageId;
  const pagesMapRef = useRef(pagesMap);
  pagesMapRef.current = pagesMap;

  /**
   * ページ切替（Figmaスタイル）
   * 1. 現在のページのHTMLをサムネイルに保存
   * 2. 新しいページのキャッシュHTMLをiframeにロード
   * 3. 履歴クリア
   * 4. activePageId更新
   * 5. API経由で最新HTML非同期取得
   */
  const switchPage = useCallback((id: string) => {
    const currentPagesMap = pagesMapRef.current;
    const page = currentPagesMap.get(id);
    if (!page) {
      console.warn('[MultiPageCanvas] switchPage: page not found:', id);
      return;
    }

    const currentActiveId = activePageIdRef.current;
    if (currentActiveId === id) return; // 同じページなら何もしない

    // 1. 現在のページのHTMLをサムネイルに保存
    if (currentActiveId) {
      const currentEditHtml = history.html;
      if (currentEditHtml) {
        updatePageFrame(currentActiveId, { thumbnailHtml: currentEditHtml });
      }
    }

    // 2. 新しいページのHTMLをセット
    const newHtml = page.thumbnailHtml || '';
    history.setHtml(newHtml);
    history.clearHistory();

    // 3. iframeを新しいHTMLでリロード
    const iframe = refs.iframeRef.current;
    if (iframe) {
      refs.setIframeReady(false);
      const blob = new Blob([generateEditableHtml(newHtml, 'webpage')], { type: 'text/html' });
      iframe.src = URL.createObjectURL(blob);
    }

    // 4. activePageId更新
    setViewState(prev => ({ ...prev, activePageId: id }));

    // 5. API経由で最新HTMLを非同期取得
    if (artboard.onContentChange && id !== artboard.currentContentId) {
      artboard.onContentChange(id);
    }

    console.log('[MultiPageCanvas] switchPage:', currentActiveId, '→', id);
  }, [history, refs, artboard, updatePageFrame]);

  /**
   * 軽量ページフォーカス（キャンバスモード専用）
   * iframeを再読込せず、activePageIdとcontentIdのみ更新
   * → レイヤーパネル・CSS/JS・ページ設定が正しいページに切り替わる
   */
  const focusPage = useCallback((id: string) => {
    const currentActiveId = activePageIdRef.current;
    if (currentActiveId === id) return;

    // activePageId更新 → レイヤーパネルが正しいページを表示
    setViewState(prev => ({ ...prev, activePageId: id }));

    // contentId更新 → CSS/JS/ページ設定が正しいページから読み込まれる
    if (artboard.onContentChange && id !== artboard.currentContentId) {
      artboard.onContentChange(id);
    }

    console.log('[MultiPageCanvas] focusPage:', currentActiveId, '→', id);
  }, [artboard]);

  const autoLayoutPages = useCallback(() => {
    setPagesMap(prev => {
      const pageArray = Array.from(prev.values());
      const laid = calculateAutoLayout(pageArray);
      const newMap = new Map<string, PageFrame>();
      laid.forEach(p => newMap.set(p.id, p));
      return newMap;
    });
  }, []);

  const zoomToFit = useCallback((containerWidth: number, containerHeight: number) => {
    const pageArray = Array.from(pagesMap.values());
    const { zoom, offset } = calculateFitZoom(pageArray, containerWidth, containerHeight);
    setViewState(prev => ({
      ...prev,
      canvasZoom: zoom,
      canvasOffset: offset,
    }));
  }, [pagesMap]);

  const zoomIn = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      canvasZoom: Math.min(MAX_ZOOM, prev.canvasZoom * 1.25),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      canvasZoom: Math.max(MIN_ZOOM, prev.canvasZoom * 0.8),
    }));
  }, []);

  const updateThumbnail = useCallback((id: string, dataUrl: string) => {
    setPagesMap(prev => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const newMap = new Map(prev);
      newMap.set(id, { ...existing, thumbnailDataUrl: dataUrl });
      return newMap;
    });
  }, []);

  // --- グローバルUndo/Redoハンドラー用のState ---
  const [undoHandlers, setUndoHandlers] = useState({
    undo: () => {},
    redo: () => {},
    canUndo: false,
    canRedo: false,
  });

  const registerUndoHandlers = useCallback((handlers: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean }) => {
    // 参照を保持し、再レンダリングをトリガーするためにはcanUndo()の状態を追跡する必要があるが、
    // ここでは簡易的に関数のみ登録し、判定は都度させる（必要に応じてフラグ化）
    setUndoHandlers({
      undo: handlers.undo,
      redo: handlers.redo,
      // React state is not ideal for this real-time check inside Toolbar, but we pass getters for now
      canUndo: handlers.canUndo(),
      canRedo: handlers.canRedo(),
    });

    // To dynamically update Toolbar when stacks change, we'd need MultiPageCanvasView to call this repeatedly, 
    // or expose them as refs. For now, Toolbar evaluates button state on render or we expose static getters.
    // Let's modify the interface to use getters/setters properly if needed, but for now just pass the object.
  }, []);

  // --- Context値 ---

  const value = useMemo<MultiPageCanvasContextValue>(() => ({
    pages,
    getPage,
    updatePageFrame,
    viewState,
    setCanvasOffset,
    setCanvasZoom,
    switchPage,
    focusPage,
    autoLayoutPages,
    zoomToFit,
    zoomIn,
    zoomOut,
    updateThumbnail,
    isEnabled: enabled,
    undo: undoHandlers.undo,
    redo: undoHandlers.redo,
    canUndo: undoHandlers.canUndo,
    canRedo: undoHandlers.canRedo,
    registerUndoHandlers,
  }), [
    pages,
    getPage,
    updatePageFrame,
    viewState,
    setCanvasOffset,
    setCanvasZoom,
    switchPage,
    focusPage,
    autoLayoutPages,
    zoomToFit,
    zoomIn,
    zoomOut,
    updateThumbnail,
    enabled,
    undoHandlers,
    registerUndoHandlers,
  ]);

  return (
    <MultiPageCanvasContext.Provider value={value}>
      {children}
    </MultiPageCanvasContext.Provider>
  );
}

/**
 * 条件付きProvider: enabledがfalseの場合はchildrenをそのまま返す
 */
export function ConditionalMultiPageProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <>{children}</>;
  }
  return (
    <MultiPageCanvasProvider enabled={enabled}>
      {children}
    </MultiPageCanvasProvider>
  );
}
