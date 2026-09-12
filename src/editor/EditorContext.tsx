'use client';

/**
 * エディタのコンテキスト（ファサード）
 *
 * Phase 1: Context分割によるパフォーマンス最適化
 * - 51個のstateを8つの専門Contextに分割
 * - ファサードパターンで後方互換性を100%維持
 * - 既存のuseEditorContext()は変更なしで動作
 *
 * パフォーマンス最適化:
 * - 個別のContext hookを使用することで、必要な状態のみを購読可能
 * - 例: useEditorSelection() - 選択状態のみを購読
 */

import React, { createContext, useContext, useCallback, useEffect, MutableRefObject } from 'react';
import { buildDomTree } from './utils/dom-utils';
import type {
  EditorTool,
  DOMTreeNode,
  SelectedElementInfo,
  PanelSections,
  ClipboardData,
  DrawingState,
  MarqueeState,
  StyleClipboard,
} from './types';

// 個別Context
import {
  EditorRefsProvider,
  useEditorRefs,
  globalStyleClipboardRef,
  globalLastUsedStylesRef,
} from './contexts/EditorRefsContext';
import {
  EditorSelectionProvider,
  useEditorSelection,
} from './contexts/EditorSelectionContext';
import {
  EditorToolProvider,
  useEditorTool,
  type EditorMode,
} from './contexts/EditorToolContext';
import {
  EditorViewProvider,
  useEditorView,
  type ViewMode,
} from './contexts/EditorViewContext';
import {
  EditorHistoryProvider,
  useEditorHistory,
} from './contexts/EditorHistoryContext';
import {
  EditorDocumentProvider,
  useEditorDocument,
} from './contexts/EditorDocumentContext';
import {
  EditorArtboardProvider,
  useEditorArtboard,
  type ContentListItem,
  type ArtboardState,
} from './contexts/EditorArtboardContext';
import {
  EditorUIStateProvider,
  useEditorUIState,
} from './contexts/EditorUIStateContext';
import {
  EditorVariablesProvider,
  useEditorVariables,
} from './contexts/EditorVariablesContext';
import {
  EditorComponentsProvider,
  useEditorComponents,
} from './contexts/EditorComponentsContext';
import {
  ConditionalMultiPageProvider,
  useMultiPageCanvasOptional,
} from './contexts/MultiPageCanvasContext';
import type { CSSVariableDefinition } from '../types/css-variables';

// 型の再エクスポート
export type { ContentListItem, ArtboardState, EditorMode, ViewMode };
export { globalStyleClipboardRef };

/** @deprecated Use ContentListItem instead */
export type SlideListItem = ContentListItem;

// ============================================================
// EditorContextValue インターフェース（後方互換性維持）
// ============================================================

interface EditorContextValue {
  // エディタモード
  editorMode: EditorMode;

  // ビューモード（シングルまたはグリッド表示）
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Refs
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  clipboardRef: MutableRefObject<ClipboardData | null>;
  styleClipboardRef: typeof globalStyleClipboardRef;
  lastUsedStylesRef: typeof globalLastUsedStylesRef;
  iframeHtmlRef: MutableRefObject<string>;
  isUndoRedoRef: MutableRefObject<boolean>;
  drawingStateRef: MutableRefObject<DrawingState>;

  // アートボード状態管理（マルチアートボード対応）
  artboardStates: Map<string, ArtboardState>;
  activeArtboardId: string | null;
  setActiveArtboard: (id: string) => void;
  getArtboardState: (id: string) => ArtboardState | undefined;
  updateArtboardState: (id: string, updates: Partial<ArtboardState>) => void;

  // グローバルキャンバス状態（グリッド表示用）
  globalZoom: number;
  setGlobalZoom: (zoom: number) => void;
  globalScrollPosition: { x: number; y: number };
  setGlobalScrollPosition: (pos: { x: number; y: number }) => void;

  // 基本状態
  originalHtml: string;
  html: string;
  setHtml: (html: string) => void;
  hasChanges: boolean;
  setOriginalHtml: (html: string) => void;
  sourceHtml: string;
  saving: boolean;
  setSaving: (saving: boolean) => void;

  // コンテンツリスト（他コンテンツへのナビゲーション用）
  contentList: ContentListItem[];
  currentContentId: string | null;
  onContentChange: ((contentId: string) => void) | null;

  /** @deprecated Use contentList instead */
  slides: ContentListItem[];
  /** @deprecated Use currentContentId instead */
  currentSlideId: string | null;
  /** @deprecated Use onContentChange instead */
  onSlideChange: ((slideId: string) => void) | null;

  // ツール・選択
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  selectedElement: SelectedElementInfo | null;
  setSelectedElement: (element: SelectedElementInfo | null) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;

  // レイアウトモード
  layoutMode: 'absolute' | 'auto';
  setLayoutMode: (mode: 'absolute' | 'auto') => void;
  showLayoutHint: boolean;
  setShowLayoutHint: (show: boolean) => void;
  autoLayoutHtml: string | null;
  setAutoLayoutHtml: (html: string | null) => void;

  // ズーム
  zoom: number;
  setZoom: (zoom: number) => void;
  fitZoom: number;
  setFitZoom: (zoom: number) => void;

  // ビューポート幅（webpageモードのレスポンシブプレビュー用）
  viewportWidth: number;
  setViewportWidth: (width: number) => void;

  // DOMツリー
  domTree: DOMTreeNode[];
  setDomTree: (tree: DOMTreeNode[]) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  expandedNodes: Set<string>;
  setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;

  // パネル状態
  openSections: PanelSections;
  setOpenSections: React.Dispatch<React.SetStateAction<PanelSections>>;

  // 履歴
  pushHistory: (html: string, selectedId?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;

  // マーキー選択（範囲選択）
  marqueeState: MarqueeState;
  setMarqueeState: React.Dispatch<React.SetStateAction<MarqueeState>>;

  // iframe操作ヘルパー
  getIframeDoc: () => Document | null;
  notifyIframeChange: (saveToHistory?: boolean) => void;

  // iframe読み込み状態
  iframeReady: boolean;
  setIframeReady: (ready: boolean) => void;

  // フォーカス管理
  restoreFocus: () => void;
}

// ============================================================
// ファサードContext
// ============================================================

const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * エディタコンテキストを取得（後方互換性維持）
 *
 * パフォーマンス最適化が必要な場合は、個別のContextフックを使用:
 * - useEditorRefs() - Refs関連のみ
 * - useEditorSelection() - 選択状態のみ
 * - useEditorTool() - ツール状態のみ
 * - useEditorView() - 表示/ズーム状態のみ
 * - useEditorHistory() - 履歴管理のみ
 * - useEditorDocument() - ドキュメント状態のみ
 * - useEditorArtboard() - アートボード管理のみ
 * - useEditorUIState() - UI状態のみ
 */
export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within EditorProvider');
  }
  return context;
}

// 個別Context hookの再エクスポート（パフォーマンス最適化用）
export {
  useEditorRefs,
  useEditorSelection,
  useEditorTool,
  useEditorView,
  useEditorHistory,
  useEditorDocument,
  useEditorArtboard,
  useEditorUIState,
  useEditorVariables,
  useEditorComponents,
  useMultiPageCanvasOptional,
};

// ============================================================
// EditorProvider Props
// ============================================================

interface EditorProviderProps {
  initialHtml: string;
  children: React.ReactNode;
  editorMode?: EditorMode;
  /**
   * アートボードの幅（webpageモードの初期表示幅）。
   * 省略時はブレイクポイントプリセットの先頭。
   * 「この幅で見る」と決まっている用途（構成ラフ等）で指定する。
   */
  artboardWidth?: number;
  contentList?: ContentListItem[];
  currentContentId?: string;
  onContentChange?: (contentId: string) => void;
  initialLayoutMode?: 'absolute' | 'auto';
  /** CSS変数の初期値 */
  initialVariables?: CSSVariableDefinition[];
  /** CSS変数保存コールバック */
  onSaveVariables?: (variables: CSSVariableDefinition[]) => Promise<void>;
  /** CSS変数読み込みコールバック */
  onLoadVariables?: (websiteId: string) => Promise<CSSVariableDefinition[]>;
  /** Website ID for component management */
  websiteId?: string;
  /** マルチページ無限キャンバスモードを有効にする (default: false) */
  enableMultiPageCanvas?: boolean;
  /** キャンバスの表示位置(倍率・スクロール)を記憶するキー */
  canvasStorageKey?: string | null;
  /** @deprecated Use contentList instead */
  slides?: ContentListItem[];
  /** @deprecated Use currentContentId instead */
  currentSlideId?: string;
  /** @deprecated Use onContentChange instead */
  onSlideChange?: (slideId: string) => void;
}

// ============================================================
// 内部コンポーネント: Context値の集約
// ============================================================

interface EditorContextAggregatorProps {
  children: React.ReactNode;
}

function EditorContextAggregator({ children }: EditorContextAggregatorProps) {
  // 全ての個別Contextから値を取得
  const refs = useEditorRefs();
  const selection = useEditorSelection();
  const tool = useEditorTool();
  const view = useEditorView();
  const history = useEditorHistory();
  const document = useEditorDocument();
  const artboard = useEditorArtboard();
  const uiState = useEditorUIState();

  // notifyIframeChange: 複数Contextに跨る操作
  const notifyIframeChange = useCallback((saveToHistory = true) => {
    const iframeDoc = refs.getIframeDoc();
    if (iframeDoc) {
      const artboardEl = iframeDoc.getElementById('artboard');
      const newHtml = artboardEl ? artboardEl.innerHTML : iframeDoc.body.innerHTML;
      if (saveToHistory) {
        history.pushHistory(newHtml, selection.selectedElement?.id);
      } else {
        history.setHtml(newHtml);
      }
      const newTree = buildDomTree(iframeDoc);
      uiState.setDomTree(newTree);
      window.postMessage({ type: 'DOM_TREE_UPDATED', tree: newTree }, '*');
    }
  }, [refs, history, selection.selectedElement?.id, uiState]);

  // setActiveArtboard: 状態保存・復元付きのアートボード切り替え
  const setActiveArtboard = useCallback((id: string) => {
    // 現在のアートボードの状態を保存
    if (artboard.activeArtboardId) {
      artboard.updateArtboardState(artboard.activeArtboardId, {
        zoom: view.zoom,
        selectedElementIds: selection.selectedElementIds,
        domTree: uiState.domTree,
        expandedNodes: uiState.expandedNodes,
        html: history.html,
      });
    }

    // 元のsetActiveArtboardを呼び出し（内部でactiveArtboardIdを更新）
    artboard.setActiveArtboard(id);

    // 新しいアートボードの状態を復元
    const newState = artboard.artboardStates.get(id);
    if (newState) {
      view.setZoom(newState.zoom);
      selection.setSelectedElementIds(newState.selectedElementIds);
      uiState.setDomTree(newState.domTree);
      uiState.setExpandedNodes(newState.expandedNodes);
      if (newState.html) {
        history.setHtml(newState.html);
      }
    }
  }, [artboard, view, selection, uiState, history]);

  // Undo/Redo時にiframeを同期
  useEffect(() => {
    if (history.isUndoRedoRef.current) {
      history.isUndoRedoRef.current = false;
      const iframe = refs.iframeRef.current;
      const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
      if (iframeDoc && history.html !== refs.iframeHtmlRef.current) {
        console.log('[EditorContext] Syncing iframe after undo/redo');
        const artboardEl = iframeDoc.getElementById('artboard');
        if (artboardEl) {
          artboardEl.innerHTML = history.html;
        } else {
          console.warn('[EditorContext] #artboard not found, falling back to body.innerHTML');
          iframeDoc.body.innerHTML = history.html;
        }
        refs.iframeHtmlRef.current = history.html;
        selection.setSelectedElement(null);
        selection.setSelectedElementIds([]);
        setTimeout(() => {
          window.postMessage({ type: 'REQUEST_DOM_TREE_UPDATE' }, '*');
        }, 50);

        // フォーカス復元
        const restoreFocusToIframe = () => {
          const currentIframe = refs.iframeRef.current;
          const currentIframeDoc = currentIframe?.contentDocument || currentIframe?.contentWindow?.document;
          if (currentIframe && currentIframeDoc?.body) {
            currentIframe.focus();
            currentIframeDoc.body.focus();
            console.log('[EditorContext] Focus restored to iframe and body after undo/redo');
          }
        };
        restoreFocusToIframe();
        requestAnimationFrame(restoreFocusToIframe);
        setTimeout(restoreFocusToIframe, 100);
      }
    }
  }, [history.html, history.isUndoRedoRef, refs, selection]);

  // ファサード値の構築
  const value: EditorContextValue = {
    // エディタモード
    editorMode: tool.editorMode,

    // ビューモード
    viewMode: view.viewMode,
    setViewMode: view.setViewMode,

    // Refs
    iframeRef: refs.iframeRef,
    containerRef: refs.containerRef,
    clipboardRef: refs.clipboardRef,
    styleClipboardRef: refs.styleClipboardRef,
    lastUsedStylesRef: refs.lastUsedStylesRef,
    iframeHtmlRef: refs.iframeHtmlRef,
    isUndoRedoRef: history.isUndoRedoRef,
    drawingStateRef: refs.drawingStateRef,

    // アートボード状態管理
    artboardStates: artboard.artboardStates,
    activeArtboardId: artboard.activeArtboardId,
    setActiveArtboard,
    getArtboardState: artboard.getArtboardState,
    updateArtboardState: artboard.updateArtboardState,

    // グローバルキャンバス状態
    globalZoom: view.globalZoom,
    setGlobalZoom: view.setGlobalZoom,
    globalScrollPosition: view.globalScrollPosition,
    setGlobalScrollPosition: view.setGlobalScrollPosition,

    // 基本状態
    originalHtml: document.originalHtml,
    html: history.html,
    setHtml: history.setHtml,
    hasChanges: document.hasChanges,
    setOriginalHtml: document.setOriginalHtml,
    sourceHtml: document.sourceHtml,
    saving: document.saving,
    setSaving: document.setSaving,

    // コンテンツリスト
    contentList: artboard.contentList,
    currentContentId: artboard.currentContentId,
    onContentChange: artboard.onContentChange,

    // Deprecated aliases
    slides: artboard.slides,
    currentSlideId: artboard.currentSlideId,
    onSlideChange: artboard.onSlideChange,

    // ツール・選択
    activeTool: tool.activeTool,
    setActiveTool: tool.setActiveTool,
    selectedElement: selection.selectedElement,
    setSelectedElement: selection.setSelectedElement,
    selectedElementIds: selection.selectedElementIds,
    setSelectedElementIds: selection.setSelectedElementIds,

    // レイアウトモード
    layoutMode: document.layoutMode,
    setLayoutMode: document.setLayoutMode,
    showLayoutHint: document.showLayoutHint,
    setShowLayoutHint: document.setShowLayoutHint,
    autoLayoutHtml: document.autoLayoutHtml,
    setAutoLayoutHtml: document.setAutoLayoutHtml,

    // ズーム
    zoom: view.zoom,
    setZoom: view.setZoom,
    fitZoom: view.fitZoom,
    setFitZoom: view.setFitZoom,

    // ビューポート幅
    viewportWidth: view.viewportWidth,
    setViewportWidth: view.setViewportWidth,

    // DOMツリー
    domTree: uiState.domTree,
    setDomTree: uiState.setDomTree,
    searchQuery: uiState.searchQuery,
    setSearchQuery: uiState.setSearchQuery,
    expandedNodes: uiState.expandedNodes,
    setExpandedNodes: uiState.setExpandedNodes,

    // パネル状態
    openSections: uiState.openSections,
    setOpenSections: uiState.setOpenSections,

    // マーキー選択
    marqueeState: uiState.marqueeState,
    setMarqueeState: uiState.setMarqueeState,

    // 履歴
    pushHistory: history.pushHistory,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    clearHistory: history.clearHistory,

    // ヘルパー
    getIframeDoc: refs.getIframeDoc,
    notifyIframeChange,

    // iframe読み込み状態
    iframeReady: refs.iframeReady,
    setIframeReady: refs.setIframeReady,

    // フォーカス管理
    restoreFocus: uiState.restoreFocus,
  };

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

// ============================================================
// EditorProvider（公開API - 後方互換性維持）
// ============================================================

export function EditorProvider({
  initialHtml,
  children,
  editorMode = 'slide',
  artboardWidth,
  contentList,
  currentContentId,
  onContentChange,
  initialLayoutMode = 'auto',
  // CSS変数関連
  initialVariables,
  onSaveVariables,
  onLoadVariables,
  // Component system
  websiteId,
  // Multi-page canvas
  enableMultiPageCanvas = false,
  canvasStorageKey,
  // deprecated props
  slides,
  currentSlideId,
  onSlideChange,
}: EditorProviderProps) {
  return (
    <EditorRefsProvider initialHtml={initialHtml}>
      <EditorHistoryProvider initialHtml={initialHtml}>
        <EditorHistoryConsumer initialHtml={initialHtml} initialLayoutMode={initialLayoutMode}>
          {(html) => (
            <EditorDocumentProvider
              initialHtml={initialHtml}
              currentHtml={html}
              initialLayoutMode={initialLayoutMode}
            >
              <EditorSelectionProvider>
                <EditorToolProvider editorMode={editorMode}>
                  <EditorViewProvider initialViewportWidth={artboardWidth}>
                    <EditorArtboardProvider
                      contentList={contentList}
                      currentContentId={currentContentId}
                      onContentChange={onContentChange}
                      slides={slides}
                      currentSlideId={currentSlideId}
                      onSlideChange={onSlideChange}
                    >
                      <ConditionalMultiPageProvider enabled={enableMultiPageCanvas} storageKey={canvasStorageKey}>
                        <EditorUIStateProviderWrapper>
                          <EditorVariablesProviderWrapper
                            initialVariables={initialVariables}
                            onSaveVariables={onSaveVariables}
                            onLoadVariables={onLoadVariables}
                          >
                            <EditorComponentsProvider websiteId={websiteId} pageId={currentContentId || currentSlideId}>
                              <EditorContextAggregator>
                                {children}
                              </EditorContextAggregator>
                            </EditorComponentsProvider>
                          </EditorVariablesProviderWrapper>
                        </EditorUIStateProviderWrapper>
                      </ConditionalMultiPageProvider>
                    </EditorArtboardProvider>
                  </EditorViewProvider>
                </EditorToolProvider>
              </EditorSelectionProvider>
            </EditorDocumentProvider>
          )}
        </EditorHistoryConsumer>
      </EditorHistoryProvider>
    </EditorRefsProvider>
  );
}

// EditorHistoryのhtmlを子に渡すためのコンシューマ
interface EditorHistoryConsumerProps {
  initialHtml: string;
  initialLayoutMode: 'absolute' | 'auto';
  children: (html: string) => React.ReactNode;
}

function EditorHistoryConsumer({ children }: EditorHistoryConsumerProps) {
  const history = useEditorHistory();
  return <>{children(history.html)}</>;
}

// EditorUIStateProviderのラッパー（getIframeDocを渡すため）
function EditorUIStateProviderWrapper({ children }: { children: React.ReactNode }) {
  const refs = useEditorRefs();
  return (
    <EditorUIStateProvider getIframeDoc={refs.getIframeDoc}>
      {children}
    </EditorUIStateProvider>
  );
}

// EditorVariablesProviderのラッパー（保存・読み込みコールバックを渡すため）
interface EditorVariablesProviderWrapperProps {
  children: React.ReactNode;
  onSaveVariables?: (variables: CSSVariableDefinition[]) => Promise<void>;
  onLoadVariables?: (websiteId: string) => Promise<CSSVariableDefinition[]>;
  initialVariables?: CSSVariableDefinition[];
}

function EditorVariablesProviderWrapper({
  children,
  onSaveVariables,
  onLoadVariables,
  initialVariables,
}: EditorVariablesProviderWrapperProps) {
  return (
    <EditorVariablesProvider
      initialVariables={initialVariables}
      onSave={onSaveVariables}
      onLoad={onLoadVariables}
    >
      {children}
    </EditorVariablesProvider>
  );
}

export default EditorContext;
