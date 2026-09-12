'use client';

/**
 * MultiPageCanvasContext
 *
 * Figma 風のマルチフレームキャンバスの状態。
 * 全ページをフレームとして 1 枚のキャンバスに並べ、1 つのフレームだけが「生きている」
 * エディタ(EditorCanvas)で、残りは見るだけの紙面(srcdoc の iframe)。
 * クリックしたフレームへ編集が移る。倍率・位置はこの Context が持ち、
 * 外側の CSS transform で全体を拡大縮小する(iframe の中は常に等倍)。
 *
 * [設計]
 * - 編集エンジンは 1 つ(EditorCanvas)。ページごとの編集ロジックの二重実装はしない
 * - フレームの寸法: 幅は版面の幅(webpage は artboardWidth、slide は 1920)、
 *   高さは実測(生きているページはエディタ、他は見るだけの紙面が測る)
 * - 位置は寸法から毎回計算する(状態に持たない)。高さが変わっても流れ直すだけ
 * - 見えている範囲は localStorage に保存し、開き直しても同じ場所に戻る
 *
 * [ビュー状態は Context の外に置く]
 * 倍率・位置(viewState)はホイールの 1 目盛りごとに変わる。これを Context の値に
 * 入れると、購読しているもの(エディタ本体・150 枚の紙面・左パネル…)が毎目盛り
 * 描き直しになる。そこで viewState は小さな外部ストア(viewStore)に置き、
 * 必要な部品だけが useCanvasViewState() で購読する。Context の値そのものは
 * ズーム・パンでは変わらない
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useEditorArtboard } from './EditorArtboardContext';
import { useEditorTool } from './EditorToolContext';
import { useEditorView } from './EditorViewContext';
import { SLIDE_HEIGHT, SLIDE_WIDTH, WEBPAGE_WIDTH } from '../constants';
import type { EditorMode } from './EditorToolContext';
import { io, type PreviewStyle } from '../../io';

// ============================================================
// 定数
// ============================================================

/** 互換のために残す(旧実装が公開していた)。フレームの幅は viewportWidth を使う */
export { WEBPAGE_WIDTH };
/** 高さが未測定の webpage フレームに仮に与える高さ */
export const WEBPAGE_MIN_HEIGHT = 1200;
/** ズーム範囲(Figma は 2%〜25600%。紙面の編集で要るのはこの範囲) */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;
/** ホイール 1 段のズーム倍率(ボタン・キー操作) */
const ZOOM_STEP = 1.25;
/** 全体表示・ページ表示のときの余白(px、画面上) */
const FIT_PADDING = 72;
/** 上と左の定規の太さ(px)。全体表示の余白に足す */
export const RULER_SIZE = 20;
/** ビューのアニメーション(ms) */
const VIEW_ANIMATION_MS = 240;
/** 見るだけの紙面を同時に読む枚数 */
const PREVIEW_PARALLEL = 4;

/** フレームどうしの間隔(紙面の座標系、等倍のとき)。フレーム名を出すかの判定にも使う */
export const FRAME_GAP: Record<EditorMode, { x: number; y: number }> = {
  webpage: { x: 200, y: 260 },
  slide: { x: 160, y: 220 },
};
const GAP = FRAME_GAP;
/** 1 行に並べる数。webpage は横一列が基本だが、多いと横に長すぎるので折り返す */
const WRAP_AT: Record<EditorMode, (count: number) => number> = {
  webpage: () => 8,
  slide: (count) => Math.min(6, Math.max(3, Math.ceil(Math.sqrt(count)))),
};

// ============================================================
// 型定義
// ============================================================

export interface PageFrame {
  id: string;
  title: string;
  /** 本文。null = まだ読んでいない */
  html: string | null;
  /** 本文を読んでいる途中 */
  loading: boolean;
  /** 読めなかったときの理由 */
  error: string | null;
  size: { width: number; height: number };
  /** 高さを実測済みか(未測定はレイアウト用の仮の高さ) */
  measured: boolean;
  /** 未保存の変更がある(生きているページだけ立つ) */
  isDirty: boolean;
}

/** レイアウト済み(位置付き)のフレーム */
export interface PageFrameLayout extends PageFrame {
  position: { x: number; y: number };
  index: number;
}

export interface CanvasViewState {
  canvasOffset: { x: number; y: number };
  canvasZoom: number;
  /** 生きているエディタが載っているページ(利用側の currentContentId と同じ) */
  activePageId: string | null;
}

export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** ビュー状態の外部ストア(購読した部品だけが描き直る) */
export interface CanvasViewStore {
  get: () => CanvasViewState;
  set: (updater: (prev: CanvasViewState) => CanvasViewState) => void;
  subscribe: (listener: () => void) => () => void;
}

export interface MultiPageCanvasContextValue {
  isEnabled: boolean;
  editorMode: EditorMode;

  // ---- ページフレーム
  pages: PageFrameLayout[];
  bounds: CanvasBounds;
  getPage: (id: string) => PageFrameLayout | undefined;
  updatePageFrame: (
    id: string,
    updates: Partial<Pick<PageFrame, 'title' | 'html' | 'size' | 'isDirty' | 'measured' | 'loading' | 'error'>>,
  ) => void;
  /** 本文を差し替える(保存後・読み込み後) */
  setPageHtml: (id: string, html: string) => void;
  /**
   * 高さの実測を反映する。source が 'preview' のときは、生きているページには効かない
   * (エディタの実測が正。見るだけの紙面はフォントや画像の読み込み前に測ることがある)
   */
  setPageHeight: (id: string, height: number, source: 'editor' | 'preview') => void;
  /** 本文がまだ無ければ読む(contentList の thumbnailHtml → io.loadContent) */
  ensurePageHtml: (id: string) => Promise<void>;
  /** 見るだけの紙面に足すスタイル(io.previewStyles。無ければ空) */
  previewStyles: PreviewStyle[];

  // ---- ビュー
  /** 倍率・位置。描画に使うなら useCanvasViewState() で購読する。ハンドラから読むだけなら get() */
  viewStore: CanvasViewStore;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  setCanvasZoom: (zoom: number) => void;
  /** 倍率と位置を同時に決める(アニメーションも可) */
  setView: (view: { zoom: number; offset: { x: number; y: number } }, options?: { animate?: boolean }) => void;
  /** 画面上の点(容器の座標)を固定したまま倍率を変える */
  zoomAt: (zoom: number, point: { x: number; y: number }) => void;
  /** 容器の中心を固定して倍率を変える */
  zoomTo: (zoom: number, options?: { animate?: boolean }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (options?: { animate?: boolean }) => void;
  zoomToPage: (id: string, options?: { animate?: boolean }) => void;
  zoomToActual: () => void;
  /** 指定のフレームが画面に入っていなければ、見える位置まで寄せる(倍率は変えない) */
  revealPage: (id: string) => void;

  // ---- ページ切替
  /**
   * 編集するページを移す。中身の読み込みと未保存の変更の保存は利用側
   * (onContentChange → FrontendVisualEditor.handleContentChange)が行う。
   * 生きているエディタは本文が読めてから移る(activePageId はそのとき変わる)。
   * 戻り値は移れたか
   */
  activatePage: (id: string, options?: { reveal?: boolean }) => Promise<boolean>;
  /** 切替の途中(クリックしてから本文が読めるまで)のページ。リングはこちらへ先に移る */
  activatingPageId: string | null;

  // ---- 容器・操作状態
  /** キャンバスの容器(ズームの基準になる矩形)。MultiPageCanvasView が登録する */
  registerContainer: (el: HTMLDivElement | null) => void;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  /** ホイール・ドラッグの最中(見るだけの紙面の当たり判定を切る) */
  isInteracting: boolean;
  markInteracting: () => void;
  /** 見えている範囲を localStorage から復元できた(初回表示で全体表示を省く) */
  initialViewRestored: boolean;
  /** 定規 */
  rulersVisible: boolean;
  toggleRulers: () => void;
  /**
   * 見るだけの紙面の読み込み枠。同時に読むのは数枚まで(順番待ち。編集中のページに近い順)。
   * 150 枚を一度に読むと、接続枠と主スレッドをそれらが占め、編集中のページの切替が
   * 1 秒近く待たされる(実測 82ms → 912ms)
   */
  requestPreviewSlot: (id: string, grant: () => void) => void;
  releasePreviewSlot: (id: string) => void;
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

/** マルチページキャンバスが有効な場合のみ値を返す(オプショナル使用用) */
export function useMultiPageCanvasOptional(): MultiPageCanvasContextValue | null {
  return useContext(MultiPageCanvasContext);
}

/** 倍率・位置を購読する(ズーム・パンのたびに描き直る部品だけが使う) */
export function useCanvasViewState(): CanvasViewState {
  const { viewStore } = useMultiPageCanvas();
  return useSyncExternalStore(viewStore.subscribe, viewStore.get, viewStore.get);
}

const NULL_VIEW_STORE: CanvasViewStore = {
  get: () => NULL_VIEW,
  set: () => undefined,
  subscribe: () => () => undefined,
};
const NULL_VIEW: CanvasViewState = { canvasOffset: { x: 0, y: 0 }, canvasZoom: 1, activePageId: null };

/** キャンバスが無ければ null(単独表示でも同じ部品を使うとき用) */
export function useCanvasViewStateOptional(): CanvasViewState | null {
  const context = useContext(MultiPageCanvasContext);
  const store = context?.viewStore ?? NULL_VIEW_STORE;
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return context ? state : null;
}

// ============================================================
// レイアウト
// ============================================================

/**
 * 寸法から位置を決める。行ごとに折り返し、行の高さはその行で一番高いフレームに合わせる。
 * 位置を状態に持たないので、高さが実測で変わっても流れ直すだけで済む
 */
export function layoutFrames(
  frames: PageFrame[],
  editorMode: EditorMode,
): { pages: PageFrameLayout[]; bounds: CanvasBounds } {
  const gap = GAP[editorMode];
  const perRow = WRAP_AT[editorMode](frames.length);
  const pages: PageFrameLayout[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  frames.forEach((frame, index) => {
    if (index > 0 && index % perRow === 0) {
      x = 0;
      y += rowHeight + gap.y;
      rowHeight = 0;
    }
    pages.push({ ...frame, index, position: { x, y } });
    x += frame.size.width + gap.x;
    rowHeight = Math.max(rowHeight, frame.size.height);
  });
  const bounds: CanvasBounds = pages.length
    ? {
        minX: Math.min(...pages.map((p) => p.position.x)),
        minY: Math.min(...pages.map((p) => p.position.y)),
        maxX: Math.max(...pages.map((p) => p.position.x + p.size.width)),
        maxY: Math.max(...pages.map((p) => p.position.y + p.size.height)),
      }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { pages, bounds };
}

function fitView(
  rect: CanvasBounds,
  container: { width: number; height: number },
  options: { padding: number; maxZoom: number; rulers: boolean },
): { zoom: number; offset: { x: number; y: number } } {
  const inset = options.rulers ? RULER_SIZE : 0;
  const availW = Math.max(1, container.width - inset - options.padding * 2);
  const availH = Math.max(1, container.height - inset - options.padding * 2);
  const w = Math.max(1, rect.maxX - rect.minX);
  const h = Math.max(1, rect.maxY - rect.minY);
  const zoom = Math.max(MIN_ZOOM, Math.min(options.maxZoom, availW / w, availH / h));
  return {
    zoom,
    offset: {
      x: inset + (container.width - inset - w * zoom) / 2 - rect.minX * zoom,
      y: inset + (container.height - inset - h * zoom) / 2 - rect.minY * zoom,
    },
  };
}

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function createViewStore(initial: CanvasViewState): CanvasViewStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (updater) => {
      const next = updater(state);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ============================================================
// Provider
// ============================================================

interface MultiPageCanvasProviderProps {
  children: React.ReactNode;
  enabled: boolean;
  /** 見えている範囲を保存するキー(利用側の parentId 等)。無ければ保存しない */
  storageKey?: string | null;
}

type PersistedView = { zoom: number; offset: { x: number; y: number }; rulers?: boolean };

function readPersistedView(key: string | null | undefined): PersistedView | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`gg-editor:canvas-view:${key}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as PersistedView;
    if (!Number.isFinite(v.zoom) || !v.offset || !Number.isFinite(v.offset.x) || !Number.isFinite(v.offset.y)) return null;
    return v;
  } catch {
    return null;
  }
}

export function MultiPageCanvasProvider({ children, enabled, storageKey }: MultiPageCanvasProviderProps) {
  const artboard = useEditorArtboard();
  const { editorMode } = useEditorTool();
  const { viewportWidth } = useEditorView();

  const frameWidth = editorMode === 'webpage' ? viewportWidth : SLIDE_WIDTH;
  const defaultHeight = editorMode === 'webpage' ? WEBPAGE_MIN_HEIGHT : SLIDE_HEIGHT;

  // ---- フレーム(寸法・本文)
  const [framesMap, setFramesMap] = useState<Map<string, PageFrame>>(() => new Map());
  const framesMapRef = useRef(framesMap);
  framesMapRef.current = framesMap;

  // contentList からフレームを同期(既存の実測・本文は保つ)
  useEffect(() => {
    if (!enabled) return;
    setFramesMap((prev) => {
      const next = new Map<string, PageFrame>();
      let changed = prev.size !== artboard.contentList.length;
      artboard.contentList.forEach((content) => {
        const existing = prev.get(content.id);
        if (existing) {
          const title = content.title || existing.title;
          const html = existing.html ?? content.thumbnailHtml ?? null;
          const width = frameWidth;
          if (title !== existing.title || html !== existing.html || width !== existing.size.width) changed = true;
          next.set(content.id, { ...existing, title, html, size: { width, height: existing.size.height } });
        } else {
          changed = true;
          next.set(content.id, {
            id: content.id,
            title: content.title || '',
            html: content.thumbnailHtml ?? null,
            loading: false,
            error: null,
            size: { width: frameWidth, height: defaultHeight },
            measured: editorMode === 'slide',
            isDirty: false,
          });
        }
      });
      return changed ? next : prev;
    });
  }, [enabled, artboard.contentList, frameWidth, defaultHeight, editorMode]);

  const { pages, bounds } = useMemo(() => {
    const order = artboard.contentList.map((c) => c.id);
    const frames = order.map((id) => framesMap.get(id)).filter((f): f is PageFrame => !!f);
    return layoutFrames(frames, editorMode);
  }, [framesMap, artboard.contentList, editorMode]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const getPage = useCallback((id: string) => pagesRef.current.find((p) => p.id === id), []);

  const updatePageFrame = useCallback<MultiPageCanvasContextValue['updatePageFrame']>((id, updates) => {
    setFramesMap((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const merged = { ...existing, ...updates };
      // 変わっていなければ参照を保つ(レイアウト再計算・再描画を起こさない)
      const same = (Object.keys(updates) as (keyof typeof updates)[]).every((k) => {
        const a = existing[k];
        const b = merged[k];
        if (k === 'size') {
          const sa = a as PageFrame['size'];
          const sb = b as PageFrame['size'];
          return sa.width === sb.width && sa.height === sb.height;
        }
        return a === b;
      });
      if (same) return prev;
      const next = new Map(prev);
      next.set(id, merged);
      return next;
    });
  }, []);

  const setPageHtml = useCallback(
    (id: string, html: string) => updatePageFrame(id, { html, loading: false, error: null }),
    [updatePageFrame],
  );

  // ---- ビュー状態(外部ストア。ズーム・パンで Context の値は変えない)
  const persisted = useMemo(() => readPersistedView(storageKey), [storageKey]);
  const [viewStore] = useState<CanvasViewStore>(() =>
    createViewStore({
      canvasOffset: persisted?.offset ?? { x: 0, y: 0 },
      canvasZoom: persisted ? clampZoom(persisted.zoom) : 0.25,
      activePageId: artboard.currentContentId ?? null,
    }),
  );
  const [rulersVisible, setRulersVisible] = useState<boolean>(persisted?.rulers ?? true);
  const rulersRef = useRef(rulersVisible);
  rulersRef.current = rulersVisible;

  const setPageHeight = useCallback<MultiPageCanvasContextValue['setPageHeight']>(
    (id, height, source) => {
      if (!Number.isFinite(height) || height <= 0) return;
      if (source === 'preview' && viewStore.get().activePageId === id) {
        // 生きているページはエディタの実測が正。ただし一度も測っていなければ受ける
        const frame = framesMapRef.current.get(id);
        if (frame?.measured) return;
      }
      const frame = framesMapRef.current.get(id);
      if (!frame) return;
      const h = Math.max(200, Math.round(height));
      if (frame.measured && Math.abs(frame.size.height - h) < 1) return;
      updatePageFrame(id, { size: { width: frame.size.width, height: h }, measured: true });
    },
    [updatePageFrame, viewStore],
  );

  // 生きているページは利用側(currentContentId)と揃える。
  // 本文が読めて currentContentId が変わったときに初めてエディタが移る
  // (クリックの時点では移さない。移すと前のページの本文が新しい枠に見えてしまう)
  useEffect(() => {
    if (!enabled) return;
    const id = artboard.currentContentId ?? artboard.contentList[0]?.id ?? null;
    viewStore.set((prev) => (prev.activePageId === id ? prev : { ...prev, activePageId: id }));
  }, [enabled, artboard.currentContentId, artboard.contentList, viewStore]);

  // 見えている範囲の保存(変化が止まってから)
  useEffect(() => {
    if (!storageKey || typeof localStorage === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const persist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          const { canvasZoom, canvasOffset } = viewStore.get();
          const v: PersistedView = { zoom: canvasZoom, offset: canvasOffset, rulers: rulersRef.current };
          localStorage.setItem(`gg-editor:canvas-view:${storageKey}`, JSON.stringify(v));
        } catch {
          /* 保存できなくても表示には影響しない */
        }
      }, 250);
    };
    const unsubscribe = viewStore.subscribe(persist);
    persist();
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [storageKey, viewStore, rulersVisible]);

  // ---- 容器
  const containerRef = useRef<HTMLDivElement | null>(null);
  const registerContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);
  const containerSize = () => {
    const el = containerRef.current;
    if (!el) return { width: 1200, height: 800 };
    return { width: el.clientWidth || 1200, height: el.clientHeight || 800 };
  };

  // ---- アニメーション
  const animationRef = useRef<number | null>(null);
  const cancelAnimation = () => {
    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };

  const setView = useCallback<MultiPageCanvasContextValue['setView']>((view, options) => {
    cancelAnimation();
    const target = { zoom: clampZoom(view.zoom), offset: view.offset };
    if (!options?.animate || prefersReducedMotion()) {
      viewStore.set((prev) => ({ ...prev, canvasZoom: target.zoom, canvasOffset: target.offset }));
      return;
    }
    const from = { zoom: viewStore.get().canvasZoom, offset: viewStore.get().canvasOffset };
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / VIEW_ANIMATION_MS);
      const k = easeOutCubic(t);
      // 倍率は対数で補間する(拡大と縮小で速さが揃う)
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * k);
      const offset = {
        x: from.offset.x + (target.offset.x - from.offset.x) * k,
        y: from.offset.y + (target.offset.y - from.offset.y) * k,
      };
      viewStore.set((prev) => ({ ...prev, canvasZoom: zoom, canvasOffset: offset }));
      if (t < 1) animationRef.current = requestAnimationFrame(tick);
      else animationRef.current = null;
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [viewStore]);
  useEffect(() => () => cancelAnimation(), []);

  const setCanvasOffset = useCallback((offset: { x: number; y: number }) => {
    cancelAnimation();
    viewStore.set((prev) => ({ ...prev, canvasOffset: offset }));
  }, [viewStore]);

  const setCanvasZoom = useCallback((zoom: number) => {
    cancelAnimation();
    viewStore.set((prev) => ({ ...prev, canvasZoom: clampZoom(zoom) }));
  }, [viewStore]);

  const zoomAt = useCallback<MultiPageCanvasContextValue['zoomAt']>((zoom, point) => {
    cancelAnimation();
    viewStore.set((prev) => {
      const next = clampZoom(zoom);
      if (next === prev.canvasZoom) return prev;
      const ratio = next / prev.canvasZoom;
      return {
        ...prev,
        canvasZoom: next,
        canvasOffset: {
          x: point.x - (point.x - prev.canvasOffset.x) * ratio,
          y: point.y - (point.y - prev.canvasOffset.y) * ratio,
        },
      };
    });
  }, [viewStore]);

  const zoomTo = useCallback<MultiPageCanvasContextValue['zoomTo']>(
    (zoom, options) => {
      const { width, height } = containerSize();
      const inset = rulersRef.current ? RULER_SIZE : 0;
      const center = { x: inset + (width - inset) / 2, y: inset + (height - inset) / 2 };
      const prev = viewStore.get();
      const next = clampZoom(zoom);
      const ratio = next / prev.canvasZoom;
      setView(
        {
          zoom: next,
          offset: {
            x: center.x - (center.x - prev.canvasOffset.x) * ratio,
            y: center.y - (center.y - prev.canvasOffset.y) * ratio,
          },
        },
        options,
      );
    },
    [setView, viewStore],
  );

  const zoomIn = useCallback(() => zoomTo(viewStore.get().canvasZoom * ZOOM_STEP, { animate: true }), [zoomTo, viewStore]);
  const zoomOut = useCallback(() => zoomTo(viewStore.get().canvasZoom / ZOOM_STEP, { animate: true }), [zoomTo, viewStore]);
  const zoomToActual = useCallback(() => zoomTo(1, { animate: true }), [zoomTo]);

  const zoomToFit = useCallback<MultiPageCanvasContextValue['zoomToFit']>(
    (options) => {
      if (!pagesRef.current.length) return;
      setView(fitView(boundsRef.current, containerSize(), { padding: FIT_PADDING, maxZoom: 1, rulers: rulersRef.current }), options);
    },
    [setView],
  );

  const zoomToPage = useCallback<MultiPageCanvasContextValue['zoomToPage']>(
    (id, options) => {
      const page = pagesRef.current.find((p) => p.id === id);
      if (!page) return;
      const rect = {
        minX: page.position.x,
        minY: page.position.y,
        maxX: page.position.x + page.size.width,
        maxY: page.position.y + page.size.height,
      };
      const { width, height } = containerSize();
      // 長いページは全体を収めると小さすぎる。幅を合わせて先頭を見せる(Figma のフレーム選択と同じ感覚)
      const fitted = fitView(rect, { width, height }, { padding: FIT_PADDING, maxZoom: 1, rulers: rulersRef.current });
      const inset = rulersRef.current ? RULER_SIZE : 0;
      const widthZoom = Math.min(1, (width - inset - FIT_PADDING * 2) / page.size.width);
      if (fitted.zoom < widthZoom * 0.6) {
        const zoom = clampZoom(widthZoom);
        setView(
          {
            zoom,
            offset: {
              x: inset + (width - inset - page.size.width * zoom) / 2 - page.position.x * zoom,
              y: inset + FIT_PADDING - page.position.y * zoom,
            },
          },
          options,
        );
        return;
      }
      setView(fitted, options);
    },
    [setView],
  );

  const revealPage = useCallback<MultiPageCanvasContextValue['revealPage']>(
    (id) => {
      const page = pagesRef.current.find((p) => p.id === id);
      if (!page) return;
      const { width, height } = containerSize();
      const { canvasZoom: z, canvasOffset: o } = viewStore.get();
      const inset = rulersRef.current ? RULER_SIZE : 0;
      const left = o.x + page.position.x * z;
      const top = o.y + page.position.y * z;
      const right = left + page.size.width * z;
      const bottom = top + page.size.height * z;
      const margin = 48;
      // 一部でも見えていればそのまま。見えていなければ、そのフレームの左上を画面へ寄せる
      const visible = right > inset + margin && left < width - margin && bottom > inset + margin && top < height - margin;
      if (visible) return;
      const w = page.size.width * z;
      const h = page.size.height * z;
      const offset = {
        x: w <= width - inset ? inset + (width - inset - w) / 2 - page.position.x * z : inset + margin - page.position.x * z,
        y: h <= height - inset ? inset + (height - inset - h) / 2 - page.position.y * z : inset + margin - page.position.y * z,
      };
      setView({ zoom: z, offset }, { animate: true });
    },
    [setView, viewStore],
  );

  // ---- 本文の読み込み
  const loadingRef = useRef(new Set<string>());
  const ensurePageHtml = useCallback<MultiPageCanvasContextValue['ensurePageHtml']>(
    async (id) => {
      const frame = framesMapRef.current.get(id);
      if (!frame || frame.html != null || loadingRef.current.has(id)) return;
      const fromList = artboard.contentList.find((c) => c.id === id)?.thumbnailHtml;
      if (fromList != null) {
        setPageHtml(id, fromList);
        return;
      }
      const loader = io().loadContent;
      if (!loader) return;
      loadingRef.current.add(id);
      updatePageFrame(id, { loading: true, error: null });
      try {
        const html = await loader(id);
        setPageHtml(id, html ?? '');
      } catch (e) {
        updatePageFrame(id, { loading: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        loadingRef.current.delete(id);
      }
    },
    [artboard.contentList, setPageHtml, updatePageFrame],
  );

  // ---- 見るだけの紙面のスタイル(利用側から 1 回だけ取る)
  const [previewStyles, setPreviewStyles] = useState<PreviewStyle[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const loader = io().previewStyles;
    if (!loader) return;
    let alive = true;
    Promise.resolve()
      .then(() => loader())
      .then((styles) => { if (alive && Array.isArray(styles)) setPreviewStyles(styles); })
      .catch((e) => console.warn('[MultiPageCanvas] previewStyles を取れませんでした:', e));
    return () => { alive = false; };
  }, [enabled]);

  // ---- ページ切替
  // 保存と読み込みは利用側(FrontendVisualEditor.handleContentChange)が 1 か所で行う。
  // ここでは「どこへ移ろうとしているか」を持ち、リングを先に動かして押した手応えを返す
  const [activatingPageId, setActivatingPageId] = useState<string | null>(null);
  const onContentChangeRef = useRef(artboard.onContentChange);
  onContentChangeRef.current = artboard.onContentChange;
  const activatePage = useCallback<MultiPageCanvasContextValue['activatePage']>(
    async (id, options) => {
      if (!framesMapRef.current.has(id)) return false;
      if (viewStore.get().activePageId === id) {
        if (options?.reveal) revealPage(id);
        return true;
      }
      const notify = onContentChangeRef.current;
      if (!notify) return false;
      setActivatingPageId(id);
      if (options?.reveal) revealPage(id);
      try {
        const result = await (notify as (contentId: string) => unknown)(id);
        return result !== false;
      } finally {
        setActivatingPageId((v) => (v === id ? null : v));
      }
    },
    [revealPage, viewStore],
  );

  // ---- 操作状態
  const [isInteracting, setIsInteracting] = useState(false);
  const interactingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markInteracting = useCallback(() => {
    setIsInteracting(true);
    if (interactingTimer.current) clearTimeout(interactingTimer.current);
    interactingTimer.current = setTimeout(() => setIsInteracting(false), 160);
  }, []);
  useEffect(() => () => { if (interactingTimer.current) clearTimeout(interactingTimer.current); }, []);

  const toggleRulers = useCallback(() => setRulersVisible((v) => !v), []);

  // ---- 見るだけの紙面の読み込み枠(同時に PREVIEW_PARALLEL 枚まで。編集中のページに近い順)
  const slotQueueRef = useRef<{ id: string; grant: () => void }[]>([]);
  const slotHoldersRef = useRef(new Set<string>());
  const pumpPreviewSlots = useCallback(() => {
    const holders = slotHoldersRef.current;
    const queue = slotQueueRef.current;
    if (holders.size >= PREVIEW_PARALLEL || queue.length === 0) return;
    const indexOf = (id: string) => pagesRef.current.find((p) => p.id === id)?.index ?? 0;
    const activeId = viewStore.get().activePageId;
    const activeIndex = activeId ? indexOf(activeId) : 0;
    queue.sort((a, b) => Math.abs(indexOf(a.id) - activeIndex) - Math.abs(indexOf(b.id) - activeIndex));
    while (holders.size < PREVIEW_PARALLEL && queue.length > 0) {
      const next = queue.shift()!;
      holders.add(next.id);
      next.grant();
    }
  }, [viewStore]);
  const requestPreviewSlot = useCallback<MultiPageCanvasContextValue['requestPreviewSlot']>(
    (id, grant) => {
      if (slotHoldersRef.current.has(id)) {
        grant();
        return;
      }
      if (!slotQueueRef.current.some((q) => q.id === id)) slotQueueRef.current.push({ id, grant });
      pumpPreviewSlots();
    },
    [pumpPreviewSlots],
  );
  const releasePreviewSlot = useCallback<MultiPageCanvasContextValue['releasePreviewSlot']>(
    (id) => {
      slotQueueRef.current = slotQueueRef.current.filter((q) => q.id !== id);
      if (slotHoldersRef.current.delete(id)) pumpPreviewSlots();
    },
    [pumpPreviewSlots],
  );

  const value = useMemo<MultiPageCanvasContextValue>(
    () => ({
      isEnabled: enabled,
      editorMode,
      pages,
      bounds,
      getPage,
      updatePageFrame,
      setPageHtml,
      setPageHeight,
      ensurePageHtml,
      previewStyles,
      viewStore,
      setCanvasOffset,
      setCanvasZoom,
      setView,
      zoomAt,
      zoomTo,
      zoomIn,
      zoomOut,
      zoomToFit,
      zoomToPage,
      zoomToActual,
      revealPage,
      activatePage,
      activatingPageId,
      registerContainer,
      containerRef,
      isInteracting,
      markInteracting,
      initialViewRestored: !!persisted,
      rulersVisible,
      toggleRulers,
      requestPreviewSlot,
      releasePreviewSlot,
    }),
    [
      enabled, editorMode, pages, bounds, getPage, updatePageFrame, setPageHtml, setPageHeight, ensurePageHtml,
      previewStyles, viewStore, setCanvasOffset, setCanvasZoom, setView, zoomAt, zoomTo, zoomIn, zoomOut, zoomToFit, zoomToPage,
      zoomToActual, revealPage, activatePage, activatingPageId, registerContainer, isInteracting, markInteracting,
      persisted, rulersVisible, toggleRulers, requestPreviewSlot, releasePreviewSlot,
    ],
  );

  return <MultiPageCanvasContext.Provider value={value}>{children}</MultiPageCanvasContext.Provider>;
}

/**
 * 条件付きProvider: enabledがfalseの場合はchildrenをそのまま返す
 */
export function ConditionalMultiPageProvider({
  enabled,
  storageKey,
  children,
}: {
  enabled: boolean;
  storageKey?: string | null;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <>{children}</>;
  }
  return (
    <MultiPageCanvasProvider enabled={enabled} storageKey={storageKey}>
      {children}
    </MultiPageCanvasProvider>
  );
}
