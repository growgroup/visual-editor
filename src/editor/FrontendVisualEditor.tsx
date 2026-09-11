'use client';

/**
 * フロントエンドビジュアルエディタ
 *
 * レイアウト構成:
 * - 左パネル (w-64): レイヤー/DOMツリー
 * - 中央 (flex-1): キャンバス + ツールバー
 * - 右パネル (w-72): プロパティパネル
 *
 * 汎用的なHTML編集エディタとして、スライド、ページ、コンポーネント等で利用可能
 */

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import {
  editorCancelDragRef,
  selectAllSiblingsIn,
  selectSiblingIn,
  exitTextEditingIn,
} from './hooks/useKeyboardShortcuts';
import type { MoveElementResult } from './hooks/useElementActions';
import { EditorProvider, useEditorContext, type ContentListItem, type EditorMode } from './EditorContext';
import { PptTitleBar, PptRibbon, PptThumbnails, PptStatusBar, initialPptTheme, PPT_PALETTES, type PptTheme } from './components/ppt/PptChrome';
import { LeftPanel } from './components/shell/LeftPanel';
import { useAltMeasure } from './hooks/useAltMeasure';
import { PptCommentsPanel, PptCommentMarkers } from './components/ppt/PptComments';
import { PptNotes } from './components/ppt/PptNotes';
import { PptFormatPane } from './components/ppt/PptFormatPane';
import { createAuthApi } from '../lib/api/auth-fetch';
import { useAuth } from '../components/auth/AuthProvider';
import { findSlideRoot, findInsertionParent } from './utils/slide-root';
import { registerAutoSaveFlush } from './autosave';
import { getCleanHtml } from './utils/html-utils';
import { EditorAppearanceContext, useEditorTheme } from './contexts/EditorAppearanceContext';
import { CanvasAppearance } from './components/shell/CanvasAppearance';
import { can, io } from '../io';
import { insertIntoFlow } from './parts';
import type { Slide } from '../types/slide';
import {
  useEditorMessages,
  useDrawingMode,
  useElementActions,
  useImageUpload,
  useRichPaste,
  useAiReplace,
  useBrowserZoomPrevention,
  usePageSettingsManager,
  useComponentEditMode,
  toEditorMediaUrl,
  editorZoomApiRef,
} from './hooks';
import type { MediaItem } from './hooks';
import {
  EditorHeader,
  EditorLayerPanel,
  EditorPropertyPanel,
  EditorFooter,
  EditorContextMenu,
  AiPromptPopover,
  EditorCanvas,
  VariablesPanel,
  ComponentPanel,
} from './components';
import { useEditorVariables, useEditorComponents } from './EditorContext';
import type { CSSVariableDefinition } from '../types/css-variables';
import { getCSSVariablesList, saveCSSVariables, type CSSVariableScope } from '../lib/firebase/css-variables';
import { BreakpointGuides } from './components/BreakpointGuides';
import type { ContextMenuPosition } from './components';
import { EditorToolbar } from './EditorToolbar';
import { MultiPageCanvasView } from './components/multi-page';
import { convertToAbsolutePositioning, buildDomTree, getArtboardContent, canUngroup, updateSelectionBox } from './utils/dom-utils';
import { extractElementInfo } from './utils/style-utils';
import { findTableCell, insertRow, insertColumn, deleteRow, deleteColumn } from './utils/table-edit';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

/**
 * 自動保存のデバウンス(ms)。
 * 変更が止まってからこの時間で保存する。連続編集中はタイマーが延び続けるので、
 * 打鍵やドラッグのたびに保存(=原本TSXへの書き戻しジョブ)が走ることはない。
 */
const AUTO_SAVE_DELAY_MS = 2000;
const MasterComponentEditor = lazy(() => import('./components/MasterComponentEditor').then((m) => ({ default: m.MasterComponentEditor })));
const MediaLibraryDialog = lazy(() => import('./components/MediaLibraryDialog').then((m) => ({ default: m.MediaLibraryDialog })));
const PageSettingsDialog = lazy(() => import('./components/PageSettingsDialog').then((m) => ({ default: m.PageSettingsDialog })));
const JsEditorDialog = lazy(() => import('./components/JsEditorDialog').then((m) => ({ default: m.JsEditorDialog })));
const CssEditorDialog = lazy(() => import('./components/CssEditorDialog').then((m) => ({ default: m.CssEditorDialog })));
const HtmlImportDialog = lazy(() => import('./components/HtmlImportDialog').then((m) => ({ default: m.HtmlImportDialog })));
const HtmlEditorDialog = lazy(() => import('./components/HtmlEditorDialog').then((m) => ({ default: m.HtmlEditorDialog })));

/**
 * 保存の状態表示。エディタの殻(Figma風ヘッダー / PowerPoint風タイトルバー)で共通に使う。
 * - dirty: 未保存の変更あり(このあと自動保存される)
 * - saving: 保存中
 * - saved: 保存済み
 * - error: 自動保存に失敗(手動保存で再試行できる)
 */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface FrontendVisualEditorProps {
  html: string;
  /** エディタモード: 'slide'（16:9固定）または 'webpage'（可変高さ） */
  editorMode?: EditorMode;
  /**
   * アートボードの幅（webpageモードのとき）。省略時は 1400。
   *
   * ここを変えると版面の幅が変わり、**文字の折り返し位置が実際の見え方とずれる**。
   * 「この幅で見る」と決まっているものを渡すこと。
   */
  artboardWidth?: number;
  /** コンテンツID（スライドID、ページID等） */
  contentId?: string;
  /** 親リソースID（プレゼンテーションID、プロジェクトID等） */
  parentId?: string;
  /** @deprecated slideId - contentIdを使用してください */
  slideId?: string;
  /** @deprecated presentationId - parentIdを使用してください */
  presentationId?: string;
  /**
   * 保存。options.auto は自動保存(ユーザーが押したのではない)を示す。
   * 保存結果のトーストは手動保存のときだけ出したいので、呼び出し側で見分けられるようにする
   */
  onSave: (html: string, options?: { auto?: boolean }) => Promise<void>;
  onClose: () => void;
  /** マルチページ無限キャンバスモードを有効にする (default: false) */
  enableMultiPageCanvas?: boolean;
  /** 外部から渡すコンテンツリスト（指定時はAPI取得をスキップ） */
  contentList?: ContentListItem[];
  /**
   * 左パネルの「ページ」タブに差し込む中身。
   *
   * 渡すと左パネルが ページ / レイヤー のタブになる。渡さなければ従来どおり。
   * ページ一覧を利用側が持つとき（ページが固定のサイト等）に、エディタの左へ
   * さらにもう1枚パネルを並べずに済ませるための口。左に2枚並ぶと
   * 「左=1枚 / 中央=キャンバス / 右=プロパティ」という骨格が崩れる。
   */
  pagesPanel?: React.ReactNode;
  /**
   * トップバーの左端に置く導線（プレビュー・関連画面へのリンク等）。
   *
   * 別画面への行き先はアプリごとに違うのでエディタは知らない。
   * ここに置くとタイトルの左、Figmaのメニュー位置に並ぶ。
   */
  headerExtra?: React.ReactNode;
}

/**
 * エディタの内部コンポーネント
 * EditorProviderの内部でHooksを使用
 */
function FrontendVisualEditorInner({
  onSave,
  onClose,
  parentId,
  contentId,
  pagesPanel,
  headerExtra,
  isMultiPageCanvas = false,
}: Pick<
  FrontendVisualEditorProps,
  'onSave' | 'onClose' | 'parentId' | 'contentId' | 'pagesPanel' | 'headerExtra'
> & {
  isMultiPageCanvas?: boolean;
}) {
  const {
    iframeRef,
    containerRef,
    activeTool,
    setActiveTool,
    originalHtml,
    // [自動保存] 変更検知と、保存できた分の基準の付け替えに使う
    html,
    hasChanges,
    setOriginalHtml,
    saving,
    setSaving,
    selectedElement,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
    undo,
    redo,
    canUndo,
    canRedo,
    pushHistory,
    zoom,
    setZoom,
    fitZoom,
    // [移植時の追加] ヘッダーに「何枚目の何というスライドを編集中か」を出すため
    contentList,
    currentContentId,
    domTree,
    setDomTree,
    notifyIframeChange,
    getIframeDoc,
    openSections,
    setOpenSections,
    showLayoutHint,
    setShowLayoutHint,
    setLayoutMode,
    layoutMode,
    setAutoLayoutHtml,
    setExpandedNodes,
    editorMode,
    restoreFocus,
    iframeReady,
  } = useEditorContext();

  const {
    deleteElement,
    duplicateElement,
    copyElements,
    pasteSerializedElements,
    pasteFromInternalIfFresh,
    resizeElements,
    cutElements,
    pasteElements,
    copyStyle,
    pasteStyle,
    hasStyleInClipboard,
    copyToFigma,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    groupElements,
    ungroupElements,
    moveUp,
    moveDown,
    moveLeft,
    moveRight,
    updateElementAttribute,
  } = useElementActions();

  // 画像アップロード
  const {
    isUploading,
    uploadError,
    uploadFromFile,
    uploadFromFiles,
    uploadFromClipboard,
    openFilePicker,
    insertImageFromUrl,
  } = useImageUpload({ presentationId: parentId, slideId: contentId });

  // リッチペースト（Excel, Word, HTML, SVG）
  const {
    canHandleRichPaste,
    pasteRichContent,
    debugClipboard,
    detectContentType,
  } = useRichPaste();

  // CSS変数管理
  const {
    variables,
    cssString,
    hasVariables,
    isSaving: isVariablesSaving,
    hasChanges: hasVariableChanges,
    addVariable,
    updateVariable,
    deleteVariable,
    saveVariables,
  } = useEditorVariables();

  // コンポーネント管理（メインコンポーネントで直接使用する値のみ）
  const {
    masterComponents,
    componentLibrary,
    createInstance,
    getMasterComponent,
    partsMode,
    materializePartInstance,
  } = useEditorComponents();

  const { getIdToken } = useAuth();
  const hasComponents = masterComponents.size > 0;

  // ドラッグ&ドロップ状態
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0); // ドラッグイベントのカウンター（子要素の出入りを追跡）
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // [移植時の修正] キーボードショートカット用の Ref 群（undoRef / deleteElementRef …）は削除した。
  // Stale Closure 回避のために置かれていたが、その利用者だった window capture ハンドラと
  // postMessage ブリッジを廃止したため不要。
  // 現在はディスパッチャ(useEditorShortcuts)が毎レンダー最新のコールバック表を
  // ref 経由で参照するので、この階層で個別に ref を持つ必要がない。

  // コンテキストメニュー状態
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);

  // AI生成ポップオーバー状態
  const [aiPromptPosition, setAiPromptPosition] = useState<{ x: number; y: number } | null>(null);

  // HTML編集モーダル状態
  const [htmlEditorState, setHtmlEditorState] = useState<{
    isOpen: boolean;
    elementId: string | null;
    initialHtml: string;
  }>({
    isOpen: false,
    elementId: null,
    initialHtml: '',
  });

  // HTMLインポートダイアログ状態
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  // PowerPoint風UIとFigma風UIの切り替え(殻だけ。エンジンは共通)
  const [uiMode, setUiMode] = useState<'figma' | 'ppt'>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('gg-editor:ui-mode') === 'ppt' ? 'ppt' : 'figma'),
  );
  const switchUi = (mode: 'figma' | 'ppt') => {
    // 殻を差し替えるだけで編集内容は残るが、どちらのUIから見ても同じ状態で始まるよう
    // 未保存があればここで保存しておく(切替の見た目は待たせない)
    void saveIfDirtyRef.current();
    setUiMode(mode);
    try { localStorage.setItem('gg-editor:ui-mode', mode); } catch { /* 記憶できなくても動作は継続 */ }
  };
  // PowerPoint風UIのテーマ(OS設定に追従・切替は記憶)とサムネイル検索
  const { theme: pptTheme, toggleTheme: togglePptTheme } = useEditorTheme();
  const [layersOpen, setLayersOpen] = useState(editorMode !== 'webpage' || !!pagesPanel);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [pptSearch, setPptSearch] = useState('');
  // コメントパネル(PowerPoint風UIのみ)。フォーカス合図はカウンタで送る
  const [pptCommentsOpen, setPptCommentsOpen] = useState(false);
  const [commentsMounted, setCommentsMounted] = useState(false);
  useEffect(() => { if (pptCommentsOpen) setCommentsMounted(true); }, [pptCommentsOpen]);
  // PowerPoint風UIの右ペイン「図の書式設定」(影・反射・光彩・ぼかし)
  const [pptFormatPaneOpen, setPptFormatPaneOpen] = useState(false);
  const [pptCommentFocus, setPptCommentFocus] = useState(0);
  const [pptActiveThread, setPptActiveThread] = useState<string | null>(null);

  // CSS変数パネル状態
  const [isVariablesPanelOpen, setIsVariablesPanelOpen] = useState(false);

  // メディアライブラリ状態
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);

  // ページ設定管理（CSS/JS編集、エクスポート、OGP、HTMLインポート含む）
  const {
    isCssEditorOpen,
    setIsCssEditorOpen,
    importedCss,
    handleOpenCssEditor,
    handleSaveCss,
    handleClearCss,
    isJsEditorOpen,
    setIsJsEditorOpen,
    importedJs,
    handleOpenJsEditor,
    handleSaveJs,
    handleClearJs,
    isPageSettingsOpen,
    setIsPageSettingsOpen,
    pageSettings,
    projectSettings,
    handleOpenPageSettings,
    handleSavePageSettings,
    handleSaveCurrentSettings,
    handleExport,
    handleUploadOgpImage,
    handleHtmlImport,
  } = usePageSettingsManager({ parentId, contentId });

  // CSS変数をiframeに反映（iframeReadyになってから）
  useEffect(() => {
    // iframeが準備できていない場合は何もしない
    if (!iframeReady) {
      console.log('[applyCssVariablesToIframe] Waiting for iframe to be ready...');
      return;
    }
    if (!cssString) return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      console.warn('[applyCssVariablesToIframe] iframe ready but document not accessible');
      return;
    }

    // CSS変数スタイル要素を作成または更新
    let styleElement = iframeDoc.getElementById('editor-css-variables');
    if (!styleElement) {
      styleElement = iframeDoc.createElement('style');
      styleElement.id = 'editor-css-variables';
      // CSS変数は他のスタイルより優先されるようheadの先頭に挿入
      iframeDoc.head.insertBefore(styleElement, iframeDoc.head.firstChild);
    }

    if (styleElement.textContent !== cssString) {
      styleElement.textContent = cssString;
      console.log('[applyCssVariablesToIframe] Applied CSS variables:', variables.length, 'variables');
      console.log('[applyCssVariablesToIframe] CSS String:', cssString);
      console.log('[applyCssVariablesToIframe] Variables:', variables.map(v => ({ name: v.name, cssName: v.cssName, value: v.value })));
    }
  }, [cssString, variables.length, getIframeDoc, iframeReady]);

  // キャンバスエリアのサイズ（ブレイクポイントガイド用）
  const [canvasAreaSize, setCanvasAreaSize] = useState({ width: 0, height: 0 });

  const prevLayoutModeRef = useRef(layoutMode);
  
  // レイアウトモードの変更を検知して保存
  useEffect(() => {
    // 初期ロード時や、値が変わっていない場合はスキップ
    if (prevLayoutModeRef.current === layoutMode) return;

    // 値を更新
    prevLayoutModeRef.current = layoutMode;

    // コンテンツIDと親IDがある場合のみ保存
    if (parentId && contentId) {
      const saveLayoutMode = async () => {
        try {
          const api = await createAuthApi(getIdToken);
          // editorModeに応じてAPIパスを切り替え
          const apiPath = editorMode === 'webpage'
            ? `/api/websites/${parentId}/pages/${contentId}`
            : `/api/presentations/${parentId}/slides/${contentId}`;
          await api.patch(apiPath, { layoutMode });
          console.log('[FrontendVisualEditor] Saved layout mode:', layoutMode);
        } catch (error) {
          console.error('[FrontendVisualEditor] Failed to save layout mode:', error);
        }
      };

      saveLayoutMode();
    }
  }, [layoutMode, parentId, contentId, getIdToken, editorMode]);

  // キャンバスエリアのサイズを監視（ブレイクポイントガイド用）
  useEffect(() => {
    if (!canvasAreaRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasAreaSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(canvasAreaRef.current);

    // 初期サイズを設定
    const rect = canvasAreaRef.current.getBoundingClientRect();
    setCanvasAreaSize({ width: rect.width, height: rect.height });

    return () => resizeObserver.disconnect();
  }, []);

  // ブラウザのネイティブズームを防止（最優先で登録）
  useBrowserZoomPrevention();

  // Hooks初期化
  useEditorMessages();
  useDrawingMode();
  // Alt(Option)ホバーで距離を測る(Figmaの計測線)
  useAltMeasure();

  // AI要素置換（editorModeに基づいてslide-agentまたはwebsite-agentを使用）
  const {
    generateAndReplace,
    isGenerating: isAiGenerating,
    getSelectedElementInfo,
  } = useAiReplace({
    // スライドモードならpresentationIdとして、WebページモードならwebsiteIdとしてparentIdを渡す
    presentationId: editorMode === 'slide' ? parentId : undefined,
    websiteId: editorMode === 'webpage' ? parentId : undefined,
  });

  // オーバーレイ（コンテキストメニュー/AIポップオーバー）を閉じた時刻。
  // Escape は「オーバーレイを閉じる」→「選択を1段上へ」→「選択解除」の順で1段だけ効かせたい。
  // オーバーレイ自身の Escape ハンドラは document(バブリング)にあり、
  // その中の setState が React のマイクロタスクで即座に反映されるため、
  // 後から window で受け取るディスパッチャからは「もう閉じている」ように見えてしまう。
  // 直前に閉じたかどうかを時刻で見て、同じ Escape が2段進むのを防ぐ。
  const overlayClosedAtRef = useRef(0);

  /**
   * 右クリックしたセル(表の編集の起点)。
   * iframe から届く IFRAME_CONTEXT_MENU は座標しか持たないので、
   * 同じ contextmenu イベントを自前でも拾って「どのセルか」を覚えておく。
   * 座標から elementFromPoint で引き直さないのは、アートボードがズームで
   * 拡大縮小されており、親ページとiframeで座標系が食い違うため。
   */
  const [contextCell, setContextCell] = useState<HTMLTableCellElement | null>(null);

  // コンテキストメニューを閉じる
  const closeContextMenu = useCallback(() => {
    overlayClosedAtRef.current = performance.now();
    setContextCell(null);
    setContextMenuPosition(null);
    // ショートカットが引き続き機能するようフォーカスを復元
    requestAnimationFrame(() => {
      restoreFocus();
    });
  }, [restoreFocus]);

  // コンポーネント編集モード管理
  const {
    isComponentPanelOpen,
    setIsComponentPanelOpen,
    selectedMasterComponentId,
    setSelectedMasterComponentId,
    editingMasterComponent,
    isMasterEditorOpen,
    setIsMasterEditorOpen,
    setEditingMasterComponent,
    isComponentEditMode,
    editingComponentId,
    createComponentDialogOpen,
    setCreateComponentDialogOpen,
    newComponentName,
    setNewComponentName,
    newComponentCategory,
    setNewComponentCategory,
    selectedElementInstance,
    isComponentInstance,
    hasOverrides,
    isPartInstance,
    partLabel,
    handleDetachPart,
    handleUpdatePart,
    handleCreateComponent,
    handleConfirmCreateComponent,
    handleEditMasterComponent,
    handleSaveMasterComponent,
    handleDeleteMasterComponent,
    enterComponentEditMode,
    exitComponentEditMode,
    handleGoToMainComponent,
    handleDetachInstance,
    handleResetOverrides,
    handlePushOverridesToMain,
  } = useComponentEditMode({ contentId, closeContextMenu });

  // HTML編集を開く
  const handleEditHtml = useCallback(() => {
    if (!selectedElement) return;
    
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    
    const element = iframeDoc.querySelector(`[data-element-id="${selectedElement.id}"]`);
    if (element) {
      setHtmlEditorState({
        isOpen: true,
        elementId: selectedElement.id,
        initialHtml: element.outerHTML,
      });
      // メニューを閉じる
      setContextMenuPosition(null);
    }
  }, [selectedElement, getIframeDoc]);

  // ===== メディアライブラリ =====

  /** <img> を選択中かどうか。選択中なら新規挿入ではなく src 差し替えになる */
  const isImageSelected =
    selectedElement?.tagName?.toUpperCase() === 'IMG' && selectedElementIds.length <= 1;

  /** 選択中 <img> の現在の src（ライブラリ内で選択状態を示すため） */
  const selectedImageSrc = isImageSelected ? selectedElement?.imageSrc : undefined;

  /**
   * メディアライブラリで画像が選ばれたとき。
   * - <img> 選択中: updateElementAttribute({ src }) で差し替え
   * - それ以外: insertImageFromUrl() で新規挿入（縦横比を保つため実寸を先に読む）
   */
  /**
   * 画像の変更(コンテキストメニュー)。実機PowerPointの「画像の変更」相当。
   * 位置・サイズ・スタイルは要素に付いているのでそのまま残り、srcだけ差し替わる。
   */
  const replaceImageFromFile = useCallback(() => {
    if (!isImageSelected) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { uploadEditorImage } = await import('../lib/firebase/storage');
        const result = await uploadEditorImage(file, { fileName: file.name });
        updateElementAttribute({ src: result.storageUrl, alt: file.name });
      } catch (e) {
        toast.error(`画像の差し替えに失敗しました: ${String(e).slice(0, 80)}`);
      }
    };
    input.click();
  }, [isImageSelected, updateElementAttribute]);

  /**
   * 「クリップボードから」のワンショット差し替え。
   * clipboard.read() は許可・OSの形式(Finderのファイルコピー等)で読めないことが
   * 多いため、読めないときは「次の⌘Vで差し替える」モードに切り替える。
   * pasteイベント経由なら権限プロンプトなしで確実に画像が取れる。
   */
  const replaceImageOnPasteRef = useRef<string | null>(null);

  const replaceImageFromClipboard = useCallback(async () => {
    if (!isImageSelected || !selectedElement?.id) return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const { uploadEditorImage } = await import('../lib/firebase/storage');
        const result = await uploadEditorImage(blob, { fileName: 'clipboard.png' });
        updateElementAttribute({ src: result.storageUrl });
        toast.success('画像を差し替えました');
        return;
      }
    } catch {
      // 読めない環境(許可なし・ファイル形式)はフォールバックへ
    }
    // フォールバック: 次のペーストを「差し替え」として扱う
    replaceImageOnPasteRef.current = selectedElement.id;
    toast.info('⌘V(Ctrl+V)を押すと、選択中の画像に貼り付けて差し替えます');
  }, [isImageSelected, selectedElement, updateElementAttribute]);

  const handleMediaSelect = useCallback(
    async (item: MediaItem) => {
      setIsMediaLibraryOpen(false);

      // blob: iframe では相対パスが解決できないため絶対URLへ（保存時に相対へ戻る）
      const src = toEditorMediaUrl(item.url);

      if (isImageSelected) {
        updateElementAttribute({ src, alt: item.label });
        return;
      }

      // 画像の実寸を取得して縦横比を保つ（取得失敗時はフックの既定サイズに任せる）
      const size = await new Promise<{ width?: number; height?: number }>((resolve) => {
        const probe = new window.Image();
        probe.onload = () =>
          resolve({ width: probe.naturalWidth || undefined, height: probe.naturalHeight || undefined });
        probe.onerror = () => resolve({});
        probe.src = item.url;
      });

      const elementId = insertImageFromUrl(src, {
        ...size,
        x: 100,
        y: 100,
      });

      if (!elementId) return;

      const iframeDoc = getIframeDoc();
      const inserted = iframeDoc?.querySelector<HTMLElement>(`[data-element-id="${elementId}"]`);
      if (!inserted) return;

      // 代替テキストに日本語ラベルを入れる
      inserted.setAttribute('alt', item.label);

      // スライドは高さ固定(overflow:hidden)なので、オートレイアウトのまま末尾に
      // 追加するとアートボード外に出て見えない。可視範囲に絶対配置する。
      if (editorMode === 'slide' && layoutMode !== 'absolute') {
        inserted.style.position = 'absolute';
        inserted.style.left = '100px';
        inserted.style.top = '100px';
        inserted.style.margin = '0';
      }

      // 履歴は挿入時の1件にまとめる（後処理で余計なUndoステップを作らない）
      notifyIframeChange(false);
    },
    [
      isImageSelected,
      updateElementAttribute,
      insertImageFromUrl,
      getIframeDoc,
      notifyIframeChange,
      editorMode,
      layoutMode,
    ]
  );

  // ================= 保存 / 自動保存 =================
  // 実機のPowerPointと同じく自動保存は常時オン。変更が止まって2秒で静かに保存する。
  // 保存の入口はこの effectiveSave 1本に絞ってあり、手動保存(ヘッダー/タイトルバー)も
  // 自動保存もページ切替直前のフラッシュもここを通る。

  /** 保存の実行中を指すPromise。同時に2本走らせないための番人 */
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  /** 直近で保存できた本文。同じ中身を何度も書き戻さないための番人 */
  const savedPayloadRef = useRef<string | null>(null);
  /** 自動保存が失敗したまま(状態表示に出し、成功で戻す) */
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  /**
   * 保存コールバックの中から見る「今の状態」。
   * 特に onSave はページ番号を閉じ込めているため、保存の開始時点の値で
   * 内容とページ番号を揃える必要がある(古い内容を新しいページへ書かないため)
   */
  const saveStateRef = useRef({ html, hasChanges, canUndo, contentId });
  useEffect(() => {
    saveStateRef.current = { html, hasChanges, canUndo, contentId };
  }, [html, hasChanges, canUndo, contentId]);

  const effectiveSave = useCallback(async (htmlToSave: string, options?: { auto?: boolean }) => {
    // 実行中の保存があれば終わるまで待つ。待っている間に来た保存要求は1本にまとまる
    while (saveInFlightRef.current) {
      await saveInFlightRef.current.catch(() => undefined);
    }
    // 保存し終えた分を「変更なし」の基準にするため、送る直前の姿を控える。
    // 保存中に加えられた編集は基準とずれたまま残るので、次のデバウンスで拾われる
    const baseline = saveStateRef.current.html;
    const savingContentId = saveStateRef.current.contentId;

    const task = (async () => {
      if (isMultiPageCanvas && parentId && contentId) {
        const api = await createAuthApi(getIdToken);
        await api.patch(`/api/websites/${parentId}/pages/${contentId}`, {
          html: htmlToSave,
          layoutMode,
        });
        toast.success('ページを保存しました');
        return;
      }
      await onSave(htmlToSave, options);
    })();
    saveInFlightRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    setSaving(true);
    try {
      await task;
      // 保存中にページが変わっていたら、基準の付け替えは別ページに効いてしまうので見送る
      if (saveStateRef.current.contentId === savingContentId) {
        savedPayloadRef.current = htmlToSave;
        setOriginalHtml(baseline);
      }
      setAutoSaveFailed(false);
    } catch (e) {
      setAutoSaveFailed(true);
      throw e;
    } finally {
      saveInFlightRef.current = null;
      setSaving(false);
    }
  }, [isMultiPageCanvas, parentId, contentId, getIdToken, layoutMode, onSave, setOriginalHtml, setSaving]);

  /**
   * 未保存の変更があれば保存する。戻り値は「保存できたか」。
   *
   * hasChanges だけでなく canUndo も見るのは、hasChanges が
   * 「今のHTML ≠ 開いた直後のHTML」の文字列比較で、エディタ側の一時的な差分でも
   * 立ちうるため。canUndo は実際の編集(履歴に積まれた操作)が無いと立たないので、
   * 「開いただけのスライドを勝手に上書きする」事故を防げる。
   */
  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    const state = saveStateRef.current;
    if (!state.hasChanges || !state.canUndo) return true;
    const iframeDoc = getIframeDoc();
    const payload = iframeDoc ? getCleanHtml(iframeDoc) : state.html;
    if (payload === savedPayloadRef.current) {
      // 保存済みと1文字も違わない = エディタ側の見た目の差でしかない。
      // 基準だけ合わせて終える(ここで送ると同じ書き戻しを延々と繰り返してしまう)
      setOriginalHtml(state.html);
      return true;
    }
    try {
      await effectiveSave(payload, { auto: true });
      return true;
    } catch (e) {
      console.error('[FrontendVisualEditor] 自動保存に失敗:', e);
      return false;
    }
  }, [effectiveSave, getIframeDoc, setOriginalHtml]);

  // saveIfDirty は onSave(毎レンダー作り直される)に依存するため、
  // そのまま効果の依存に入れるとレンダーのたびにデバウンスが延びて永久に発火しない。
  // 呼ぶ側は常に最新を ref 越しに掴む
  const saveIfDirtyRef = useRef(saveIfDirty);
  useEffect(() => {
    saveIfDirtyRef.current = saveIfDirty;
  }, [saveIfDirty]);

  /**
   * 変更が止まってから AUTO_SAVE_DELAY_MS で保存する。
   * html が変わるたびにこの効果が張り直されてタイマーが延びる = 連続編集中は走らない。
   * テキスト編集中(contenteditable)は保存がDOMを読み直してカーソル/選択を壊しうるので、
   * 編集が終わる(blurで contenteditable が外れる)まで待ってから発火させる。
   */
  useEffect(() => {
    if (!hasChanges || !canUndo) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const iframeDoc = getIframeDoc();
      if (iframeDoc?.querySelector('[contenteditable="true"]')) {
        timer = setTimeout(tick, AUTO_SAVE_DELAY_MS);
        return;
      }
      void saveIfDirtyRef.current();
    };
    timer = setTimeout(tick, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasChanges, canUndo, html, getIframeDoc]);

  /** ページ切替(サムネイル・新しいスライド)の直前に、殻から保存を呼べるようにする */
  useEffect(() => registerAutoSaveFlush(() => saveIfDirtyRef.current()), []);

  /**
   * この編集画面が消えるとき(ページ切替で key が変わる・閉じる)、保存待ちの変更を捨てない。
   *
   * 自動保存は2秒のデバウンス。編集して2秒以内にページを切り替えると、タイマーごと
   * 捨てられて編集が消えていた(構成ラフで実測: 見出しを直して隣のページへ移ると失われる)。
   * useLayoutEffect の後始末は iframe がまだ DOM にある間に走るので、ここで
   * 本文を読み取って保存を始める。onSave はこの画面のもの(古い閉包)なので、
   * 切替先ではなく編集していたページへ正しく保存される。
   */
  useLayoutEffect(() => () => { void saveIfDirtyRef.current(); }, []);

  /** ページが変わったら「保存済みの本文」の記憶も切り替える */
  useEffect(() => {
    savedPayloadRef.current = null;
  }, [contentId]);

  /** 保存しきれていない状態でタブを閉じられたときだけ、ブラウザ既定の離脱警告を出す */
  useEffect(() => {
    if (!hasChanges) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasChanges]);

  /** 閉じる/一覧へ戻る。未保存は黙って保存してから離れ、失敗したときだけ確認する */
  const handleClose = useCallback(() => {
    void saveIfDirty().then((ok) => {
      if (ok || window.confirm('保存に失敗しました。変更を破棄して閉じますか?')) onClose();
    });
  }, [saveIfDirty, onClose]);

  /** ヘッダー(Figma風)とタイトルバー(PowerPoint風)に出す保存状態 */
  const saveStatus: SaveStatus = autoSaveFailed
    ? 'error'
    : saving
      ? 'saving'
      : hasChanges
        ? 'dirty'
        : 'saved';

  // HTML保存処理
  const handleSaveHtml = useCallback((newHtml: string) => {
    const { elementId } = htmlEditorState;
    if (!elementId) return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const element = iframeDoc.querySelector(`[data-element-id="${elementId}"]`);
    if (element) {
      // outerHTMLを置換
      element.outerHTML = newHtml;

      // 変更通知
      window.postMessage({
        type: 'SLIDE_CONTENT_CHANGED',
        html: getArtboardContent(iframeDoc),
      }, '*');

      // 更新された要素を再選択（IDが変わっていなければ）
      // ※IDごと書き換えられると選択が外れるが、基本は外枠のIDを維持することを期待
      const newElement = iframeDoc.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement;
      if (newElement) {
        // useElementActions のロジックを参考に要素情報送信
        // ここでは簡易的に選択解除扱いになるのを避けるため何もしないか、
        // 必要なら再選択ロジックを入れる
      }
    }
  }, [htmlEditorState, getIframeDoc]);

  // AIプロンプトポップオーバーを開く
  const openAiPrompt = useCallback(() => {
    // コンテキストメニューを閉じる
    setContextMenuPosition(null);
    
    // 選択要素の位置を基準にポップオーバーを表示
    if (selectedElement) {
      const iframeDoc = getIframeDoc();
      const iframe = iframeRef.current;
      if (iframeDoc && iframe) {
        const element = iframeDoc.querySelector(
          `[data-element-id="${selectedElement.id}"]`
        ) as HTMLElement | null;
        
        if (element) {
          const rect = element.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          
          // ポップオーバーを要素の右側に表示
          setAiPromptPosition({
            x: iframeRect.left + rect.right + 10,
            y: iframeRect.top + rect.top,
          });
          return;
        }
      }
    }
    
    // フォールバック: 画面中央に表示
    setAiPromptPosition({
      x: window.innerWidth / 2 - 160,
      y: window.innerHeight / 2 - 100,
    });
  }, [selectedElement, getIframeDoc, iframeRef]);

  // AIプロンプトポップオーバーを閉じる
  const closeAiPrompt = useCallback(() => {
    overlayClosedAtRef.current = performance.now();
    setAiPromptPosition(null);
    // ショートカットが引き続き機能するようフォーカスを復元
    requestAnimationFrame(() => {
      restoreFocus();
    });
  }, [restoreFocus]);

  // AI生成ハンドラ
  const handleAiGenerate = useCallback(async (
    prompt: string,
    attachedFiles?: Array<{ name: string; type: string; size: number; data: string }>,
    engine?: 'codex' | 'claude'
  ) => {
    await generateAndReplace(prompt, attachedFiles, engine);
  }, [generateAndReplace]);

  /**
   * iframe 内の contextmenu を拾って、右クリックされたセルを控える。
   * useContextMenuHandler の登録とは別口だが、同じイベントで両方の setState が
   * 走るので、メニューが開くときには対象セルも揃っている。
   */
  useEffect(() => {
    const iframe = iframeRef.current;
    let attachedDoc: Document | null = null;
    const onContextMenu = (e: Event) => {
      setContextCell(findTableCell(e.target));
    };
    const attach = () => {
      const doc = iframe?.contentDocument;
      if (!doc || doc === attachedDoc) return; // 同じ文書に二重登録しない
      attachedDoc?.removeEventListener('contextmenu', onContextMenu);
      attachedDoc = doc;
      doc.addEventListener('contextmenu', onContextMenu);
    };
    attach();
    iframe?.addEventListener('load', attach);
    return () => {
      attachedDoc?.removeEventListener('contextmenu', onContextMenu);
      iframe?.removeEventListener('load', attach);
    };
  }, [iframeRef]);

  /** 表を編集したあとの後始末(履歴へ積み、行数が変わった分だけ選択枠を描き直す) */
  const afterTableEdit = useCallback(() => {
    notifyIframeChange();
    const doc = getIframeDoc();
    const el = selectedElement?.id ? doc?.querySelector<HTMLElement>(`[data-element-id="${selectedElement.id}"]`) : null;
    if (doc && el) requestAnimationFrame(() => updateSelectionBox(doc, el));
  }, [notifyIframeChange, getIframeDoc, selectedElement?.id]);

  /** 表の行・列操作。対象は右クリックしたセル */
  const tableActions = useMemo(() => {
    const cell = contextCell;
    if (!cell) return null;
    const run = (fn: () => unknown) => () => {
      if (fn()) afterTableEdit();
    };
    const table = cell.closest('table');
    const rowCount = table?.rows.length ?? 0;
    const colCount = table?.rows[0]?.cells.length ?? 0;
    return {
      insertRowAbove: run(() => insertRow(cell, 'above')),
      insertRowBelow: run(() => insertRow(cell, 'below')),
      insertColumnLeft: run(() => insertColumn(cell, 'left')),
      insertColumnRight: run(() => insertColumn(cell, 'right')),
      // 最後の1行/1列は消させない(空の表を作らない)
      deleteRow: rowCount > 1 ? run(() => deleteRow(cell)) : undefined,
      deleteColumn: colCount > 1 ? run(() => deleteColumn(cell)) : undefined,
    };
  }, [contextCell, afterTableEdit]);

  /**
   * リンク(href)の編集。
   * 選択が <a>(またはその中)なら href をそのまま書き換え、
   * それ以外の要素には data-href を持たせる(保存時に消えない属性)。
   */
  const handleEditLink = useCallback(() => {
    const doc = getIframeDoc();
    const el = selectedElement?.id ? doc?.querySelector<HTMLElement>(`[data-element-id="${selectedElement.id}"]`) : null;
    if (!el) return;
    const anchor = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.closest('a');
    const current = anchor?.getAttribute('href') ?? el.getAttribute('data-href') ?? '';
    const next = window.prompt('リンク先URL(空にすると解除)', current);
    if (next === null) return; // キャンセル
    const url = next.trim();
    if (anchor) {
      if (url) anchor.setAttribute('href', url);
      else anchor.removeAttribute('href');
    } else if (url) {
      el.setAttribute('data-href', url);
    } else {
      el.removeAttribute('data-href');
    }
    notifyIframeChange();
  }, [getIframeDoc, selectedElement?.id, notifyIframeChange]);

  // 右クリックハンドラ
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // コンテキストメニューを表示
    setContextMenuPosition({
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  // iframe内からのコンテキストメニュー/クリック/ドラッグ&ドロップ/ペーストイベントを受信
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'IFRAME_CONTEXT_MENU') {
        setContextMenuPosition({
          x: event.data.clientX,
          y: event.data.clientY,
        });
      } else if (event.data?.type === 'IFRAME_CLICK') {
        // iframe内のクリックでコンテキストメニューを閉じる
        setContextMenuPosition(null);
      } else if (event.data?.type === 'IFRAME_DRAG_ENTER') {
        // iframe内にドラッグが入った
        setIsDraggingOver(true);
      } else if (event.data?.type === 'IFRAME_DRAG_LEAVE') {
        // iframe内からドラッグが出た
        setIsDraggingOver(false);
      } else if (event.data?.type === 'IFRAME_DROP_FILE_DATA') {
        // iframe内にドロップされたファイルデータを処理
        setIsDraggingOver(false);
        const { dataUrl, fileName, fileType, x, y } = event.data;
        if (dataUrl && fileType?.startsWith('image/')) {
          // DataURLからFileオブジェクトを作成
          try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const file = new File([blob], fileName || 'dropped-image.png', { type: fileType });
            await uploadFromFile(file, { x: x || 100, y: y || 100 });
          } catch (error) {
            console.error('[FrontendVisualEditor] Failed to process dropped file:', error);
          }
        }
      } else if (event.data?.type === 'IFRAME_PASTE_IMAGE') {
        // iframe内でペーストされた画像を処理
        console.log('[FrontendVisualEditor] Received IFRAME_PASTE_IMAGE message', event.data);
        const { dataUrl, fileName, fileType } = event.data;
        if (dataUrl && fileType?.startsWith('image/')) {
          try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const file = new File([blob], fileName || 'pasted-image.png', { type: fileType });
            await uploadFromFile(file, { x: 100, y: 100 });
          } catch (error) {
            console.error('[FrontendVisualEditor] Failed to process pasted image:', error);
          }
        }
      } else if (event.data?.type === 'IFRAME_COMPONENT_DROP') {
        // iframe内にドロップされたコンポーネントを処理
        setIsDraggingOver(false);
        const { componentData, x, y } = event.data;
        console.log('[FrontendVisualEditor] Received IFRAME_COMPONENT_DROP:', componentData, 'at', x, y);
        if (componentData && contentId) {
          try {
            const { componentId } = JSON.parse(componentData);
            console.log('[FrontendVisualEditor] Parsed componentId:', componentId);
            if (componentId && partsMode) {
              // 部品モード: 実体化してフローへ(iframe 内の座標がそのまま来る)
              const iframeDoc = iframeRef.current?.contentDocument;
              const element = iframeDoc ? materializePartInstance(componentId, iframeDoc) : null;
              if (iframeDoc && element) {
                if (editorMode === 'webpage') {
                  insertIntoFlow(iframeDoc, element, x || 0, y || 0);
                } else {
                  element.style.position = 'absolute';
                  element.style.left = `${x || 100}px`;
                  element.style.top = `${y || 100}px`;
                  findInsertionParent(iframeDoc).appendChild(element);
                }
                if (!element.getAttribute('data-element-id')) {
                  element.setAttribute('data-editable', 'true');
                  element.setAttribute('data-element-id', `el-${Date.now()}-part`);
                }
                notifyIframeChange(true);
                const { extractElementInfo } = await import('./utils/style-utils');
                const elementInfo = extractElementInfo(element, iframeDoc);
                if (elementInfo) {
                  setSelectedElement(elementInfo);
                  setSelectedElementIds([element.getAttribute('data-element-id')!]);
                  element.classList.add('selected');
                }
              } else {
                console.error('[FrontendVisualEditor] 部品が見つかりません:', componentId);
              }
            } else if (componentId) {
              // インスタンスを作成
              const instance = createInstance(componentId, undefined, contentId);
              console.log('[FrontendVisualEditor] Created instance:', instance);
              if (instance) {
                // マスターコンポーネントを取得
                const master = getMasterComponent(componentId);
                console.log('[FrontendVisualEditor] Master component:', master);
                if (master && iframeRef.current) {
                  const iframeDoc = iframeRef.current.contentDocument;
                  if (iframeDoc) {
                    // インスタンスをHTMLにレンダリング
                    const { renderInstance } = await import('./utils/component-renderer');
                    const element = renderInstance(master, instance, iframeDoc);

                    // 位置を設定
                    element.style.position = 'absolute';
                    element.style.left = `${x || 100}px`;
                    element.style.top = `${y || 100}px`;

                    // [移植時の修正] スライドの中に追加する(外に出ると座標系がずれる)
                    findInsertionParent(iframeDoc).appendChild(element);

                    // 履歴を更新
                    notifyIframeChange(true);

                    // 要素を選択状態にする
                    const { extractElementInfo } = await import('./utils/style-utils');
                    const elementInfo = extractElementInfo(element, iframeDoc);
                    if (elementInfo) {
                      setSelectedElement(elementInfo);
                      setSelectedElementIds([instance.domElementId]);
                      element.classList.add('selected');
                    }

                    console.log('[FrontendVisualEditor] Component instance created via iframe message:', instance.id);
                  }
                } else {
                  console.error('[FrontendVisualEditor] Master component not found for id:', componentId);
                }
              } else {
                console.error('[FrontendVisualEditor] Failed to create instance');
              }
            }
          } catch (error) {
            console.error('[FrontendVisualEditor] Failed to handle iframe component drop:', error);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [uploadFromFile, contentId, createInstance, getMasterComponent, iframeRef, notifyIframeChange, setSelectedElement, setSelectedElementIds, partsMode, materializePartInstance, editorMode]);

  // ドラッグ&ドロップハンドラ
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current++;

    // コンポーネントまたはファイルがドラッグされているか確認
    if (e.dataTransfer.types.includes('application/x-editor-component') ||
        e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // コンポーネントまたはファイルがドラッグされているか確認
    if (e.dataTransfer.types.includes('application/x-editor-component') ||
        e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current--;
    
    // カウンターが0になったら本当に外に出た
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // ドラッグ状態をリセット
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    // コンポーネントのドロップをチェック
    const componentData = e.dataTransfer.getData('application/x-editor-component');
    console.log('[FrontendVisualEditor] Drop event - componentData:', componentData);
    if (componentData) {
      try {
        const { componentId, variantId } = JSON.parse(componentData);
        console.log('[FrontendVisualEditor] Parsed componentId:', componentId, 'variantId:', variantId, 'contentId:', contentId, 'iframeRef:', !!iframeRef.current);
        if (componentId && iframeRef.current && contentId) {
          const iframeDoc = iframeRef.current.contentDocument;
          if (iframeDoc) {
            // iframe内でのドロップ位置を計算
            // [移植時の修正] スライドは iframe 内でラッパーに包まれ、さらにズーム倍率で
            // 縮小表示されている。画面座標をそのまま使うとスライド左上を原点にできないので、
            // スライドのルート要素の実測矩形を基準に、スライド内座標へ換算する。
            const iframeRect = iframeRef.current.getBoundingClientRect();
            const slideRoot = findSlideRoot(iframeDoc);
            let x: number;
            let y: number;
            if (slideRoot) {
              const rootRect = slideRoot.getBoundingClientRect();
              const rootScale = rootRect.width / (slideRoot.offsetWidth || rootRect.width) || 1;
              x = (e.clientX - iframeRect.left - rootRect.left) / rootScale;
              y = (e.clientY - iframeRect.top - rootRect.top) / rootScale;
            } else {
              const dropScale = zoom || 1;
              x = (e.clientX - iframeRect.left) / dropScale;
              y = (e.clientY - iframeRect.top) / dropScale;
            }

            // 部品モード: 定義を実体化してそのまま置く(JSON のインスタンスは作らない)。
            // webpage はフローに差し込み、slide は従来どおり絶対配置
            if (partsMode) {
              const element = materializePartInstance(componentId, iframeDoc);
              if (!element) {
                console.error('[FrontendVisualEditor] 部品が見つかりません:', componentId);
                return;
              }
              if (editorMode === 'webpage') {
                insertIntoFlow(iframeDoc, element, e.clientX - iframeRect.left, e.clientY - iframeRect.top);
              } else {
                element.style.position = 'absolute';
                element.style.left = `${x}px`;
                element.style.top = `${y}px`;
                (slideRoot ?? iframeDoc.body).appendChild(element);
              }
              // MutationObserver が id を付けるのは非同期なので、選択できるよう先に付ける
              if (!element.getAttribute('data-element-id')) {
                element.setAttribute('data-editable', 'true');
                element.setAttribute('data-element-id', `el-${Date.now()}-part`);
              }
              notifyIframeChange(true);
              const { extractElementInfo } = await import('./utils/style-utils');
              const elementInfo = extractElementInfo(element, iframeDoc);
              if (elementInfo) {
                setSelectedElement(elementInfo);
                setSelectedElementIds([element.getAttribute('data-element-id')!]);
                element.classList.add('selected');
              }
              return;
            }

            // インスタンスを作成（バリアントIDが指定されていれば使用）
            // Pass position directly to createInstance to avoid React state batching race condition
            console.log('[FrontendVisualEditor] Creating instance for component:', componentId, 'variant:', variantId);
            const instance = createInstance(
              componentId,
              variantId,
              contentId,
              undefined,  // providedMaster
              undefined,  // customDomElementId
              undefined,  // initialOverrides
              undefined,  // initialPropertyValues
              { x, y }    // initialPosition
            );
            console.log('[FrontendVisualEditor] Created instance:', instance);
            if (instance) {
              // マスターコンポーネントを取得
              const master = getMasterComponent(componentId);
              console.log('[FrontendVisualEditor] Master component:', master);
              if (master) {
                // インスタンスをHTMLにレンダリング (position will be applied from instance.position)
                const { renderInstance } = await import('./utils/component-renderer');
                const element = renderInstance(master, instance, iframeDoc);

                // キャンバスに追加
                // [移植時の修正] スライドは 1920×1080 のルート要素の中で絶対配置されている。
                // body に足すとスライドの外に出てしまうので、ルートを追加先にする。
                (slideRoot ?? iframeDoc.body).appendChild(element);

                // 履歴を更新
                notifyIframeChange(true);

                // 要素を選択状態にする using proper element info extraction
                const { extractElementInfo } = await import('./utils/style-utils');
                const elementInfo = extractElementInfo(element, iframeDoc);
                if (elementInfo) {
                  setSelectedElement(elementInfo);
                  setSelectedElementIds([instance.domElementId]);
                  element.classList.add('selected');
                }

                console.log('[FrontendVisualEditor] Component instance created:', instance.id);
              } else {
                console.error('[FrontendVisualEditor] Master component not found for id:', componentId);
              }
            } else {
              console.error('[FrontendVisualEditor] Failed to create instance');
            }
          }
        } else {
          console.error('[FrontendVisualEditor] Missing required: componentId=', componentId, 'iframeRef=', !!iframeRef.current, 'contentId=', contentId);
        }
      } catch (error) {
        console.error('[FrontendVisualEditor] Failed to handle component drop:', error);
      }
      return;
    }

    // ファイルのドロップ
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // ドロップ位置を計算
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 画像ファイルのみフィルタ
        const imageFiles = Array.from(files).filter(file =>
          file.type.startsWith('image/')
        );

        if (imageFiles.length > 0) {
          await uploadFromFiles(imageFiles, { x, y });
        }
      }
    }
  }, [containerRef, uploadFromFiles, createInstance, getMasterComponent, setSelectedElement, contentId, pushHistory, iframeRef, zoom, partsMode, materializePartInstance, editorMode, notifyIframeChange, setSelectedElementIds]);

  // クリップボードからのペースト処理（画像、HTML、Excel、Word、SVG）
  // 同じpasteイベントを二度処理しないための記録。
  // iframeとメインドキュメントの両方にリスナーが載る構造なので、
  // 登録が重なると1回の貼り付けで画像が2枚入ってしまう。
  const handledPasteRef = useRef<WeakSet<Event>>(new WeakSet());

  const handlePaste = useCallback(async (e: Event) => {
    if (handledPasteRef.current.has(e)) return;
    handledPasteRef.current.add(e);
    console.log('[FrontendVisualEditor] handlePaste triggered');
    const clipboardEvent = e as ClipboardEvent;

    // テキスト編集中は通常のペーストを許可
    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      (activeElement as HTMLElement).isContentEditable
    )) {
      return;
    }

    // iframe内のテキスト編集中も通常のペーストを許可
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const iframeActiveElement = iframeDoc.activeElement;
      if (iframeActiveElement && (
        iframeActiveElement.tagName === 'INPUT' ||
        iframeActiveElement.tagName === 'TEXTAREA' ||
        (iframeActiveElement as HTMLElement).isContentEditable
      )) {
        return;
      }
    }

    // クリップボード処理
    if (clipboardEvent.clipboardData) {
      // このエディタがコピーした要素(スライド跨ぎ含む)。
      // ここで確定させて return するので、後段のリッチペーストと二重貼りにならない
      const ownHtml = clipboardEvent.clipboardData.getData('text/html');
      const ownPayload = ownHtml && ownHtml.match(/data-gg-payload="([^"]+)"/);
      if (ownPayload) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const list = JSON.parse(decodeURIComponent(escape(atob(ownPayload[1]))));
          pasteSerializedElements(list);
        } catch (err) {
          console.warn('[FrontendVisualEditor] ggペイロードの復元に失敗:', err);
        }
        return;
      }
      // OSクリップボードへ書けない環境のフォールバック(内部クリップボードが新しい場合のみ)
      if (pasteFromInternalIfFresh()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const items = Array.from(clipboardEvent.clipboardData.items);
      console.log('[FrontendVisualEditor] Clipboard items:', items.map(i => ({ type: i.type, kind: i.kind })));

      // デバッグ: クリップボードの内容を詳細ログ
      debugClipboard(clipboardEvent.clipboardData);

      // コンテンツタイプを最初に判定（Excel/Wordは画像より優先）
      const contentType = detectContentType(clipboardEvent.clipboardData);
      console.log('[FrontendVisualEditor] Detected content type:', contentType);

      // 画像の場合（純粋な画像ペーストのみ、Excel/Wordは除外済み）
      if (contentType === 'image') {
        e.preventDefault();
        e.stopPropagation();

        // 「画像の変更 > クリップボードから」の続き: 挿入ではなく選択中の画像を差し替える
        const replaceTargetId = replaceImageOnPasteRef.current;
        if (replaceTargetId) {
          replaceImageOnPasteRef.current = null;
          const item = Array.from(clipboardEvent.clipboardData.items).find((i) => i.type.startsWith('image/'));
          const file = item?.getAsFile();
          if (file) {
            try {
              const { uploadEditorImage } = await import('../lib/firebase/storage');
              const result = await uploadEditorImage(file, { fileName: file.name || 'clipboard.png' });
              const doc = getIframeDoc();
              const el = doc?.querySelector<HTMLElement>(`[data-element-id="${replaceTargetId}"]`);
              if (el && el.tagName === 'IMG') {
                el.setAttribute('src', result.storageUrl);
                notifyIframeChange();
                toast.success('画像を差し替えました');
                return;
              }
            } catch (err) {
              toast.error(`画像の差し替えに失敗しました: ${String(err).slice(0, 80)}`);
              return;
            }
          }
        }

        console.log('[FrontendVisualEditor] Calling uploadFromClipboard for image');
        await uploadFromClipboard(clipboardEvent.clipboardData, { x: 100, y: 100 });
        return;
      }

      // リッチコンテンツ（HTML、Excel、Word、SVG、プレーンテキスト）
      if (canHandleRichPaste(clipboardEvent.clipboardData)) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[FrontendVisualEditor] Calling pasteRichContent for:', contentType);
        const result = await pasteRichContent(clipboardEvent.clipboardData);
        console.log('[FrontendVisualEditor] Rich paste result:', result);

        // Figmaなどでデコード失敗した場合は画像としてフォールバック
        if (result.shouldFallbackToImage) {
          console.log('[FrontendVisualEditor] Rich paste failed, falling back to image upload');
          const imageResult = await uploadFromClipboard(clipboardEvent.clipboardData, { x: 100, y: 100 });

          // 画像もない場合はプレーンテキストとしてペースト
          if (!imageResult) {
            console.log('[FrontendVisualEditor] No image found, falling back to plain text');
            const plainText = clipboardEvent.clipboardData.getData('text/plain');
            if (plainText) {
              // プレーンテキストとして強制的に処理
              const textResult = await pasteRichContent(clipboardEvent.clipboardData, 'plain-text');
              console.log('[FrontendVisualEditor] Plain text paste result:', textResult);
            }
          }
        }
        return;
      }
    } else {
      console.log('[FrontendVisualEditor] No clipboardData available');
    }
  }, [getIframeDoc, uploadFromClipboard, canHandleRichPaste, pasteRichContent, debugClipboard, detectContentType]);

  // メインドキュメントとiframe両方にペーストイベントを登録
  useEffect(() => {
    console.log('[FrontendVisualEditor] Registering paste event listeners');

    // デバッグ用：ウィンドウレベルでキャプチャフェーズでリスナー追加
    const debugPasteHandler = (e: ClipboardEvent) => {
      console.log('[FrontendVisualEditor] Window paste event captured (capture phase)', e);
      console.log('[FrontendVisualEditor] Target:', e.target);
      console.log('[FrontendVisualEditor] ClipboardData:', e.clipboardData);
      if (e.clipboardData) {
        console.log('[FrontendVisualEditor] Items:', Array.from(e.clipboardData.items).map(i => ({ type: i.type, kind: i.kind })));
      }
    };
    window.addEventListener('paste', debugPasteHandler, true); // capture phase

    // メインドキュメントにリスナー追加
    document.addEventListener('paste', handlePaste);

    // iframeにも登録する。
    // [修正] 以前は「iframeロード時に登録する」effectが別にあり、後片付けで
    // paste を外していなかったため、再レンダリングのたびにハンドラが積み上がり、
    // 1回の貼り付けで画像が2枚以上入っていた。登録も解除もこの1か所に集約する。
    const iframe = iframeRef.current;
    let attachedDoc: Document | null = null;
    const attachToIframe = () => {
      const doc = iframe?.contentDocument;
      if (!doc || doc === attachedDoc) return; // 同じ文書に二重登録しない
      attachedDoc = doc;
      doc.addEventListener('paste', handlePaste);
    };
    attachToIframe();
    iframe?.addEventListener('load', attachToIframe);

    return () => {
      window.removeEventListener('paste', debugPasteHandler, true);
      document.removeEventListener('paste', handlePaste);
      attachedDoc?.removeEventListener('paste', handlePaste);
      iframe?.contentDocument?.removeEventListener('paste', handlePaste);
      iframe?.removeEventListener('load', attachToIframe);
    };
  }, [handlePaste, getIframeDoc, iframeRef]);

  // カスタムのCtrl+V / Cmd+V ハンドラ
  // 内部クリップボード（要素のコピー）がある場合はそれを使用
  // preventDefaultしないので、ネイティブのpasteイベントも発火し、画像ペーストが可能
  //
  // [注意] ここだけはディスパッチャに寄せていない。
  // KEYBOARD_SHORTCUTS には 'meta+v': 'paste' が載っているが、
  // ペーストは paste イベント(handlePaste)に一本化している。
  // 以前は Cmd+V の keydown でも内部クリップボードを貼っていたため、
  // ネイティブの paste イベントと二重発火し「要素と、無関係なOSクリップボードの
  // 中身が同時に貼られる」バグになっていた。keydown ではペーストしない。


  // [移植時の修正] ここにあった window capture のキーボードハンドラと、
  // iframe から SHORTCUT_* を postMessage で受け取るブリッジは削除した。
  // 同じキーを useEditorShortcuts / useKeyboardShortcuts とで三重に判定していたため、
  // Cmd+D で複製が2個できる・フォーカス位置で効くキーが入れ替わる、という状態だった。
  // キー処理は下部の shortcutCallbacks + useEditorShortcuts の1本に集約している。

  // iframe内の要素を取得するヘルパー
  const getIframeElement = (elementId: string): HTMLElement | null => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return null;
    return iframeDoc.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement | null;
  };

  // 選択が1つ以上あるか（ショートカットの有効判定に使う）
  // selectedElement(情報) と selectedElementIds(ID配列) は片方だけ立つ場面があるため両方見る
  const hasSelection = !!selectedElement || selectedElementIds.length > 0;

  // 要素がグループ解除可能かどうかをチェック
  // canUngroup関数で詳細な条件を判定
  const hasUngroupableChildren = (elementId: string): boolean => {
    const el = getIframeElement(elementId);
    if (!el) return false;
    return canUngroup(el);
  };

  // 矢印キー移動の結果を受けて、動かせなかった理由を利用者に見せる
  // （黙って何も起きない、という状態を作らない）
  // 通知には既存のレイアウトヒント（画面下の帯）を使う。
  // sonner の Toaster がアプリに設置されていないため toast() は表示されない。
  // この帯はドラッグで同じ状況になったときにも出るもので、
  // 「絶対配置モードに切り替える」ボタン付き＝解決手段まで提示できる。
  const reportMoveResult = useCallback((result: MoveElementResult) => {
    if (result.blocked === 'flow') {
      setShowLayoutHint(true);
    }
  }, [setShowLayoutHint]);

  /**
   * Escape の統一処理（Figma準拠）。1回のEscapeで1段だけ戻る。
   * 1. オーバーレイ表示中 → それを閉じるだけ
   * 2. テキスト編集中     → 編集を抜ける
   * 3. ドラッグ中         → ドラッグを取り消して元位置へ戻す（useDragResize の cancelDrag）
   * 4. 単一選択           → 1階層上へ（ダブルクリックで潜った分を戻る）
   * 5. それ以外           → 選択解除
   */
  const handleEscape = useCallback(() => {
    // オーバーレイ（コンテキストメニュー/AIポップオーバー/各種ダイアログ）が開いているときの
    // Escape は「それを閉じる」ためのもの。選択状態には手を出さない。
    // ディスパッチャはバブリングで動くので、先に走る各オーバーレイ自身の
    // Escape ハンドラが既に閉じ処理を行っている。
    const justClosedOverlay = performance.now() - overlayClosedAtRef.current < 150;
    if (
      contextMenuPosition ||
      aiPromptPosition ||
      justClosedOverlay ||
      document.querySelector('[role="dialog"]')
    ) {
      // オーバーレイが開いていた場合は確実に閉じるところまでは面倒を見る
      // （キャンバスにフォーカスがあると、オーバーレイ自身の document ハンドラには
      //   イベントが届かないため）
      if (contextMenuPosition) closeContextMenu();
      if (aiPromptPosition) closeAiPrompt();
      return;
    }

    const iframeDoc = getIframeDoc();

    // Scaleツールなど特定のツールを使用中の場合、選択ツールに戻す
    if (activeTool !== 'select') {
      setActiveTool('select');
    }

    if (iframeDoc) {
      // 1. テキスト編集の終了
      if (exitTextEditingIn(iframeDoc)) {
        restoreFocus();
        return;
      }

      // 2. ドラッグ中断
      if (editorCancelDragRef.current?.(iframeDoc)) {
        restoreFocus();
        return;
      }

      // 3. 1階層上へ
      const selectedEls = iframeDoc.querySelectorAll<HTMLElement>('.selected');
      const selected = selectedEls.length === 1 ? selectedEls[0] : null;
      const artboard = iframeDoc.getElementById('artboard');
      const parent = selected?.parentElement ?? null;
      const canGoUp =
        !!selected &&
        !!parent &&
        parent !== iframeDoc.body &&
        parent !== artboard &&
        parent.parentElement !== artboard; // スライドの面の直下(トップレベル)で止める

      if (canGoUp && parent) {
        selectedEls.forEach((el) => el.classList.remove('selected'));
        parent.classList.add('selected');
        setSelectedElementIds([parent.getAttribute('data-element-id') || '']);
        updateSelectionBox(iframeDoc, parent);
        const info = extractElementInfo(parent, iframeDoc);
        if (info) setSelectedElement(info);
        restoreFocus();
        return;
      }

      // 4. 選択解除
      iframeDoc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
      iframeDoc.querySelectorAll('.selection-box').forEach((box) => box.remove());
    }

    setSelectedElement(null);
    setSelectedElementIds([]);
    restoreFocus();
  }, [
    getIframeDoc,
    activeTool,
    setActiveTool,
    setSelectedElement,
    setSelectedElementIds,
    restoreFocus,
    contextMenuPosition,
    aiPromptPosition,
    closeContextMenu,
    closeAiPrompt,
  ]);

  /**
   * Cmd/Ctrl + A: 兄弟要素の全選択（無選択ならトップレベルを全選択）
   * postMessage 経由の迂回をやめ、ここで直接 iframe の DOM を触る
   */
  const handleSelectAll = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    const { ids, elements } = selectAllSiblingsIn(iframeDoc, selectedElementIds);
    if (ids.length === 0) return;
    setSelectedElementIds(ids);
    const info = extractElementInfo(elements[0], iframeDoc);
    if (info) setSelectedElement(info);
  }, [getIframeDoc, selectedElementIds, setSelectedElementIds, setSelectedElement]);

  /**
   * Tab / Shift+Tab: 兄弟要素を順に選び直す(Figma準拠)。
   * 選択枠はDOM側(selectSiblingIn)で作り直し、React側の選択状態をそれに合わせる。
   */
  const handleSelectSibling = useCallback(
    (direction: 1 | -1) => {
      const iframeDoc = getIframeDoc();
      if (!iframeDoc) return;
      const next = selectSiblingIn(iframeDoc, selectedElementIds, direction);
      if (!next) return;
      setSelectedElementIds([next.getAttribute('data-element-id') || '']);
      const info = extractElementInfo(next, iframeDoc);
      if (info) setSelectedElement(info);
      restoreFocus();
    },
    [getIframeDoc, selectedElementIds, setSelectedElementIds, setSelectedElement, restoreFocus],
  );

  /**
   * Cmd/Ctrl + Shift + G: グループ解除
   * [移植時の修正] data-is-group を持つ要素だけに限定する。
   * 以前は通常のコンテナ(div/section等)まで解体してしまい、Cmd+G と非対称だった。
   */
  const handleUngroup = useCallback(() => {
    const targetId = selectedElement?.id ?? selectedElementIds[0];
    const el = targetId ? getIframeElement(targetId) : null;
    if (!el) return;
    if (el.getAttribute('data-is-group') !== 'true') {
      // グループでないコンテナを黙って解体しない。
      // 通知は toast を用意しているが Toaster 未設置のため現状は出ない。
      // 可視の告知は item6 のプロパティパネル側に寄せる想定。
      console.info('[Shortcut] Cmd+Shift+G: グループ(data-is-group)ではないため解除しません', el);
      toast.info('グループではありません', {
        description: 'Cmd+Shift+G で解除できるのは Cmd+G で作ったグループだけです。',
        id: 'ungroup-not-a-group',
      });
      return;
    }
    ungroupElements();
  }, [selectedElement, selectedElementIds, ungroupElements]);

  /**
   * ズーム操作（Cmd+0 / Cmd+1 / Cmd+2）
   * ズームの実処理はキャンバス側の責務なので、ここでは EditorContext の
   * zoom 値の更新と、選択要素へのスクロールだけを行う最小実装にしてある。
   */
  const handleZoom = useCallback((kind: 'fit' | 'actual' | 'selection') => {
    // [移植時の修正] ズームの実処理はキャンバス側(useCanvasControls)に一本化した。
    // ここで setZoom するだけだと、固定点の扱いがヘッダーのメニューやホイールと
    // 食い違う（同じ「全体表示」でも押す場所で結果が変わる）ため、
    // 登録されていればそちらに委譲する。
    const zoomApi = editorZoomApiRef.current;
    if (zoomApi) {
      if (kind === 'actual') zoomApi.actual();
      else if (kind === 'fit') zoomApi.fit();
      else zoomApi.selection();
      return;
    }

    if (kind === 'actual') {
      setZoom(100);
      return;
    }
    if (kind === 'fit') {
      setZoom(fitZoom);
      return;
    }

    // selection: 選択要素が画面に収まる倍率にして、その要素を中央へ
    const iframeDoc = getIframeDoc();
    const targetId = selectedElement?.id ?? selectedElementIds[0];
    const el = targetId && iframeDoc ? getIframeElement(targetId) : null;
    if (!iframeDoc || !el) {
      setZoom(fitZoom);
      return;
    }
    const container = iframeDoc.getElementById('canvas-container');
    const artboard = iframeDoc.getElementById('artboard');
    if (!container || !artboard) return;

    // 現在のスケールで割り戻して、CSSピクセルでの要素サイズを得る
    const scale = artboard.getBoundingClientRect().width / (artboard.offsetWidth || 1) || 1;
    const rect = el.getBoundingClientRect();
    const w = rect.width / scale;
    const h = rect.height / scale;
    if (w <= 0 || h <= 0) return;

    const margin = 80;
    const fit = Math.min(
      (container.clientWidth - margin) / w,
      (container.clientHeight - margin) / h
    );
    setZoom(Math.max(10, Math.min(400, Math.floor(fit * 100))));
    // 倍率反映後にスクロール（#canvas-container がスクロール容器）
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
  }, [setZoom, fitZoom, getIframeDoc, selectedElement, selectedElementIds]);

  // キーボードショートカット用のコールバックマップ
  // [重要] キー割り当ては KEYBOARD_SHORTCUTS(src/types/editor.ts) が唯一の定義。
  // ここには「アクション名 → 実処理」だけを書く。
  const shortcutCallbacks = {
    // ツール切り替え
    select: () => setActiveTool('select'),
    // 選択解除 (Escape)
    deselect: handleEscape,
    scale: () => setActiveTool('scale'),
    move: () => setActiveTool('move'),
    rectangle: () => setActiveTool('rectangle'),
    ellipse: () => setActiveTool('ellipse'),
    line: () => setActiveTool('line'),
    arrow: () => setActiveTool('arrow'),
    pen: () => setActiveTool('pen'),
    pencil: () => setActiveTool('pencil'),
    eraser: () => setActiveTool('eraser'),
    text: () => setActiveTool('text'),
    frame: () => setActiveTool('frame'),
    // 編集操作
    // undo/redo は常に生やす（履歴が無いときは内部で何もしない）。
    // 条件付きで undefined にするとブラウザ既定の取り消しが走ってしまう。
    undo: () => {
      if (canUndo) undo();
      restoreFocus();
    },
    redo: () => {
      if (canRedo) redo();
      restoreFocus();
    },
    delete: hasSelection ? deleteElement : undefined,
    duplicate: hasSelection ? duplicateElement : undefined,
    copy: hasSelection ? copyElements : undefined,
    cut: hasSelection ? cutElements : undefined,
    // paste は意図的に未定義のまま（上部のカスタムハンドラで処理し、画像ペーストを許可）
    // スタイル操作
    copyStyle: hasSelection ? copyStyle : undefined,
    pasteStyle: hasSelection ? pasteStyle : undefined,
    // Figma形式でコピー
    copyToFigma: hasSelection ? () => { void copyToFigma(); } : undefined,
    // 選択
    selectAll: handleSelectAll,
    // Tab / Shift+Tab で兄弟要素を巡る
    selectNextSibling: () => handleSelectSibling(1),
    selectPrevSibling: () => handleSelectSibling(-1),
    // グループ操作（単一選択でもグループ化できる = Cmd+Shift+G と対称）
    group: hasSelection ? groupElements : undefined,
    ungroup: hasSelection ? handleUngroup : undefined,
    // レイヤー操作
    bringForward: hasSelection ? bringForward : undefined,
    sendBackward: hasSelection ? sendBackward : undefined,
    bringToFront: hasSelection ? bringToFront : undefined,
    sendToBack: hasSelection ? sendToBack : undefined,
    // 矢印キーでの移動（1px）
    moveUp: hasSelection ? () => reportMoveResult(moveUp(1)) : undefined,
    moveDown: hasSelection ? () => reportMoveResult(moveDown(1)) : undefined,
    moveLeft: hasSelection ? () => reportMoveResult(moveLeft(1)) : undefined,
    moveRight: hasSelection ? () => reportMoveResult(moveRight(1)) : undefined,
    // Shift + 矢印キーでの移動（10px）
    moveUpLarge: hasSelection ? () => reportMoveResult(moveUp(10)) : undefined,
    moveDownLarge: hasSelection ? () => reportMoveResult(moveDown(10)) : undefined,
    moveLeftLarge: hasSelection ? () => reportMoveResult(moveLeft(10)) : undefined,
    moveRightLarge: hasSelection ? () => reportMoveResult(moveRight(10)) : undefined,
    // Cmd+矢印でのリサイズ(1px) / Cmd+Shift+矢印(10px)。→↓で広がり←↑で縮む
    resizeGrowX: hasSelection ? () => resizeElements(1, 0) : undefined,
    resizeShrinkX: hasSelection ? () => resizeElements(-1, 0) : undefined,
    resizeGrowY: hasSelection ? () => resizeElements(0, 1) : undefined,
    resizeShrinkY: hasSelection ? () => resizeElements(0, -1) : undefined,
    resizeGrowXLarge: hasSelection ? () => resizeElements(10, 0) : undefined,
    resizeShrinkXLarge: hasSelection ? () => resizeElements(-10, 0) : undefined,
    resizeGrowYLarge: hasSelection ? () => resizeElements(0, 10) : undefined,
    resizeShrinkYLarge: hasSelection ? () => resizeElements(0, -10) : undefined,
    // ズーム
    zoomFit: () => handleZoom('fit'),
    zoomActual: () => handleZoom('actual'),
    zoomSelection: () => handleZoom('selection'),
  };

  // キーボード処理の唯一の入口。
  // 親 window と iframe の最新 document の両方へ同じハンドラが張られるので、
  // フォーカスがキャンバスの内か外かで効くキーが変わらない。
  useEditorShortcuts(shortcutCallbacks, { iframeRef });

  // ページ切替(htmlプロップ差し替え)で、前のiframeの要素を指したままの
  // 選択が残ると、リボンや削除が消えた要素を操作してしまう。切替時に空にする
  useEffect(() => {
    setSelectedElement(null);
    setSelectedElementIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalHtml]);

  // ================= UIモード(Figma風 / PowerPoint風) =================
  // ベース(キャンバス・選択・保存・書き戻し)は完全共通で、切り替わるのは殻だけ。
  // 選択はlocalStorageに記憶する
  const isPpt = uiMode === 'ppt' && editorMode === 'slide' && !isMultiPageCanvas;

  return (
    <EditorAppearanceContext.Provider value={pptTheme}>
    <div
      data-editor-theme={pptTheme}
      data-editor-mode={editorMode}
      className={cn(
        // [移植時の修正] gg-editor-skin でビューアと同じ配色に揃える(editor-skin.css)
        "gg-editor-skin gg-editor-ui flex flex-col",
        isMultiPageCanvas ? "absolute inset-0 z-40" : "fixed inset-0 z-50"
      )}
      data-frontend-visual-editor="true"
      style={{ backgroundColor: 'var(--ed-bg)' }}
    >
      <CanvasAppearance theme={pptTheme} />
      {/* ヘッダー(UIモードで切り替え) */}
      {isPpt ? (
        <>
          {(() => {
            const pptActions = {
              undo,
              redo,
              canUndo,
              canRedo,
              deleteElement: selectedElement ? deleteElement : undefined,
              duplicateElement: selectedElement ? duplicateElement : undefined,
              bringToFront: selectedElement ? bringToFront : undefined,
              bringForward: selectedElement ? bringForward : undefined,
              sendBackward: selectedElement ? sendBackward : undefined,
              sendToBack: selectedElement ? sendToBack : undefined,
              groupElements: selectedElementIds.length > 1 ? groupElements : undefined,
              ungroupElements:
                selectedElement?.id && hasUngroupableChildren(selectedElement.id) ? ungroupElements : undefined,
              openFilePicker: () => openFilePicker({ x: 100, y: 100 }),
              openMediaLibrary: () => setIsMediaLibraryOpen(true),
              openComponents: () => setIsComponentPanelOpen(true),
              openVariables: () => setIsVariablesPanelOpen(true),
              activeTool,
              setActiveTool,
              toggleFormatPane: () => {
                setPptFormatPaneOpen((v) => {
                  if (!v) setPptCommentsOpen(false);
                  return !v;
                });
              },
              formatPaneOpen: pptFormatPaneOpen,
            };
            const pageNo = Number(currentContentId ?? contentId) || 1;
            const deckTitle = contentList.find((c) => c.id === (currentContentId ?? contentId))?.title;
            return (
              <>
                <PptTitleBar
                  title={deckTitle}
                  page={pageNo}
                  theme={pptTheme}
                  onToggleTheme={togglePptTheme}
                  search={pptSearch}
                  onSearch={setPptSearch}
                  onSave={effectiveSave}
                  onClose={handleClose}
                  onSwitchUi={() => switchUi('figma')}
                  saveStatus={saveStatus}
                  actions={pptActions}
                />
                <PptRibbon
                  actions={pptActions}
                  theme={pptTheme}
                  onToggleTheme={togglePptTheme}
                  onSwitchUi={() => switchUi('figma')}
                  page={pageNo}
                  deckTitle={deckTitle}
                  comments={{
                    open: pptCommentsOpen,
                    toggle: () =>
                      setPptCommentsOpen((v) => {
                        if (!v) setPptFormatPaneOpen(false);
                        return !v;
                      }),
                    newComment: () => {
                      setPptFormatPaneOpen(false);
                      setPptCommentsOpen(true);
                      setPptCommentFocus((n) => n + 1);
                    },
                  }}
                />
              </>
            );
          })()}
        </>
      ) : (
      <EditorHeader
        theme={pptTheme}
        onToggleTheme={togglePptTheme}
        layersOpen={layersOpen}
        onToggleLayers={() => setLayersOpen((v) => !v)}
        guidesOpen={guidesOpen}
        onToggleGuides={() => setGuidesOpen((v) => !v)}
        comments={{
          open: pptCommentsOpen,
          toggle: () =>
            setPptCommentsOpen((v) => {
              if (!v) setPptFormatPaneOpen(false);
              return !v;
            }),
          page: Number(currentContentId ?? contentId) || 1,
        }}
        onSwitchUi={() => switchUi('ppt')}
        onSave={effectiveSave}
        onSaveSettings={handleSaveCurrentSettings}
        onClose={handleClose}
        saveStatus={saveStatus}
        isCanvasEditing={isMultiPageCanvas}
        onImport={() => setIsImportDialogOpen(true)}
        onCssEdit={can('apiFetch') ? handleOpenCssEditor : undefined}
        hasCss={!!importedCss}
        onJsEdit={can('apiFetch') ? handleOpenJsEditor : undefined}
        hasJs={!!importedJs}
        onPageSettings={can('apiFetch') ? handleOpenPageSettings : undefined}
        hasPageSettings={!!(pageSettings.title || pageSettings.description || pageSettings.ogp?.image)}
        onExport={can('apiFetch') && parentId && contentId ? handleExport : undefined}
        contextNumber={Number(currentContentId ?? contentId) || undefined}
        contextTitle={contentList.find((c) => c.id === (currentContentId ?? contentId))?.title}
        headerExtra={headerExtra}
      />
      )}

      {/* メインコンテンツ: 左パネル + キャンバス + 右パネル */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左パネル: スライドサムネイル(PowerPoint風) /
            上下2段=ページ切替+レイヤー(Figma風。キャンバス編集中はページの並びがキャンバス側にあるので出さない) */}
        {isPpt ? (
          <PptThumbnails page={Number(currentContentId ?? contentId) || 1} theme={pptTheme} search={pptSearch} />
        ) : isMultiPageCanvas ? (
          <EditorLayerPanel />
        ) : (
          <div className={layersOpen && !isComponentPanelOpen ? "flex min-h-0" : "hidden"}>
            <LeftPanel page={Number(currentContentId ?? contentId) || 1} pagesSlot={pagesPanel} />
          </div>
        )}

        {/* コンポーネントパネル（左側、レイヤーパネルの隣） */}
        {isComponentPanelOpen && (
          <ComponentPanel
            onClose={() => {
              setIsComponentPanelOpen(false);
              setSelectedMasterComponentId(null);
              // ショートカットが引き続き機能するようフォーカスを復元
              requestAnimationFrame(() => {
                restoreFocus();
              });
            }}
            websiteId={parentId}
            selectedComponentId={selectedMasterComponentId}
            onClearSelection={() => setSelectedMasterComponentId(null)}
            onEditComponent={enterComponentEditMode}
          />
        )}

        {/* 中央: キャンバス + ツールバー */}
        <div
          ref={canvasAreaRef}
          className="flex-1 relative overflow-hidden"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
        >
          {/* キャンバスエリア: マルチページ or シングルページ */}
          {isMultiPageCanvas ? (
            <MultiPageCanvasView />
          ) : (
            <>
              <EditorCanvas />
              {/* ブレイクポイントガイド（webpageモード用） */}
              {guidesOpen && <BreakpointGuides
                containerWidth={canvasAreaSize.width}
                containerHeight={canvasAreaSize.height}
              />}
            </>
          )}

          {/* コンポーネント編集モードバナー */}
          {isComponentEditMode && editingComponentId && (
            <div className="absolute top-0 left-0 right-0 z-50 bg-purple-600 text-white px-4 py-2 flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                </svg>
                <span className="font-medium">
                  コンポーネント編集中: {getMasterComponent(editingComponentId)?.name || 'Unknown'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-purple-700"
                  onClick={() => exitComponentEditMode(false)}
                >
                  キャンセル
                </Button>
                <Button
                  size="sm"
                  className="bg-white text-purple-600 hover:bg-gray-100"
                  onClick={() => exitComponentEditMode(true)}
                >
                  保存して終了
                </Button>
              </div>
            </div>
          )}

          {/* ツールバー（キャンバス上に配置。PowerPoint風ではリボンが担う） */}
          {!isPpt && (
          <EditorToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            selectedCount={selectedElementIds.length > 0 ? selectedElementIds.length : (selectedElement ? 1 : 0)}
            onGroup={selectedElementIds.length > 1 ? groupElements : undefined}
            onUngroup={selectedElement?.id && hasUngroupableChildren(selectedElement.id) ? ungroupElements : undefined}
            onDelete={selectedElement ? deleteElement : undefined}
            onDuplicate={selectedElement ? duplicateElement : undefined}
            onBringForward={selectedElement ? bringForward : undefined}
            onSendBackward={selectedElement ? sendBackward : undefined}
            onBringToFront={selectedElement ? bringToFront : undefined}
            onSendToBack={selectedElement ? sendToBack : undefined}
            onImageUpload={() => openFilePicker({ x: 100, y: 100 })}
            onOpenMediaLibrary={can('apiFetch') ? () => setIsMediaLibraryOpen(true) : undefined}
            isMediaReplaceMode={isImageSelected}
            onAiRegenerate={can('apiFetch') && selectedElement && selectedElementIds.length <= 1 ? openAiPrompt : undefined}
            onOpenVariables={() => setIsVariablesPanelOpen(true)}
            hasVariables={hasVariables}
            onOpenComponents={() => setIsComponentPanelOpen(true)}
            hasComponents={hasComponents}
          />
          )}

          {/* ドラッグオーバーのオーバーレイ */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-[#0d99ff]/20 border-4 border-[#0d99ff] z-50 flex items-center justify-center backdrop-blur-sm pointer-events-none">
              <div className="text-white font-bold text-xl drop-shadow-md">
                ここに画像をドロップ
              </div>
            </div>
          )}

          {/* アップロード中オーバーレイ */}
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-[#1e1e1e] px-6 py-4 rounded-lg shadow-lg flex items-center gap-3">
                {/* SVGアニメーションはdivラッパーで適用（ハードウェアアクセラレーション対応） */}
                <div className="animate-spin">
                  <Loader2 className="w-5 h-5 text-blue-500" />
                </div>
                <p className="text-white">画像をアップロード中...</p>
              </div>
            </div>
          )}

          {/* アップロードエラー表示 */}
          {uploadError && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg z-50">
              {uploadError}
            </div>
          )}
        </div>

        {/* 右パネルは同時に1つだけ出す。
            コメントを開いている間はプロパティ(詳細編集)を引っ込め、閉じると戻る。
            2つ並ぶと「いまどちらを操作しているのか」が分からなくなるため */}
        {!isPpt && !pptCommentsOpen && (editorMode === 'slide' || selectedElement || selectedElementIds.length > 0 || activeTool === 'scale') && <EditorPropertyPanel />}
        {!isMultiPageCanvas && can('commentAction') && (
          <PptCommentMarkers
            page={Number(currentContentId ?? contentId) || 1}
            onOpenThread={(id) => {
              setPptCommentsOpen(true);
              setPptActiveThread(id);
            }}
          />
        )}
        {isPpt && pptFormatPaneOpen && (
          <PptFormatPane theme={pptTheme} onClose={() => setPptFormatPaneOpen(false)} />
        )}
        {!isMultiPageCanvas && can('commentAction') && (pptCommentsOpen || commentsMounted) && (
          <div className={pptCommentsOpen ? 'flex min-h-0' : 'hidden'}>
          <PptCommentsPanel
            page={Number(currentContentId ?? contentId) || 1}
            theme={pptTheme}
            onClose={() => setPptCommentsOpen(false)}
            focusSignal={pptCommentFocus}
            activeThreadId={pptActiveThread}
            onActiveThread={setPptActiveThread}
          />
          </div>
        )}
      </div>

      {/* ノート欄(トークスクリプト)。PowerPoint風・Figma風の両方に出す。
          Figma風はダーク配色で固定(スキンと馴染む) */}
      {/* ノート欄は発表原稿。Webページには無い概念なので出さない */}
      {!isMultiPageCanvas && editorMode !== 'webpage' && can('apiFetch') && (
        <PptNotes page={Number(currentContentId ?? contentId) || 1} theme={pptTheme} />
      )}

      {/* フッター(Figma風) / ステータスバー(PowerPoint風) */}
      {isPpt ? (
        <PptStatusBar page={Number(currentContentId ?? contentId) || 1} total={contentList.length} theme={pptTheme} />
      ) : (
        <EditorFooter />
      )}

      {/* コンテキストメニュー */}
      <EditorContextMenu
        position={contextMenuPosition}
        onClose={closeContextMenu}
        hasSelection={!!selectedElement || selectedElementIds.length > 0}
        selectionCount={selectedElementIds.length > 0 ? selectedElementIds.length : (selectedElement ? 1 : 0)}
        isGroup={selectedElement?.id ? hasUngroupableChildren(selectedElement.id) : false}
        hasStyleInClipboard={hasStyleInClipboard()}
        isComponentInstance={isComponentInstance}
        hasOverrides={hasOverrides}
        partsMode={partsMode}
        isPartInstance={isPartInstance}
        partLabel={partLabel}
        onDetachPart={handleDetachPart}
        onUpdatePart={can('savePart') ? handleUpdatePart : undefined}
        onCopy={selectedElement ? copyElements : undefined}
        onCut={selectedElement ? cutElements : undefined}
        onPaste={pasteElements}
        onDelete={selectedElement ? deleteElement : undefined}
        onDuplicate={selectedElement ? duplicateElement : undefined}
        onReplaceImageFromFile={isImageSelected ? replaceImageFromFile : undefined}
        onReplaceImageFromLibrary={can('apiFetch') && isImageSelected ? () => setIsMediaLibraryOpen(true) : undefined}
        onReplaceImageFromClipboard={isImageSelected ? () => void replaceImageFromClipboard() : undefined}
        onCopyStyle={selectedElement ? copyStyle : undefined}
        onPasteStyle={selectedElement ? pasteStyle : undefined}
        onBringForward={selectedElement ? bringForward : undefined}
        onSendBackward={selectedElement ? sendBackward : undefined}
        onBringToFront={selectedElement ? bringToFront : undefined}
        onSendToBack={selectedElement ? sendToBack : undefined}
        onGroup={selectedElementIds.length > 1 ? groupElements : undefined}
        onUngroup={selectedElement?.id && hasUngroupableChildren(selectedElement.id) ? ungroupElements : undefined}
        onInsertRowAbove={tableActions?.insertRowAbove}
        onInsertRowBelow={tableActions?.insertRowBelow}
        onInsertColumnLeft={tableActions?.insertColumnLeft}
        onInsertColumnRight={tableActions?.insertColumnRight}
        onDeleteRow={tableActions?.deleteRow}
        onDeleteColumn={tableActions?.deleteColumn}
        onEditLink={selectedElement ? handleEditLink : undefined}
        onAiRegenerate={can('apiFetch') && selectedElement && selectedElementIds.length <= 1 ? openAiPrompt : undefined}
        onEditHtml={selectedElement ? handleEditHtml : undefined}
        onCreateComponent={handleCreateComponent}
        onGoToMainComponent={handleGoToMainComponent}
        onDetachInstance={handleDetachInstance}
        onResetOverrides={handleResetOverrides}
        onPushOverridesToMain={handlePushOverridesToMain}
      />

      {/* AI生成ポップオーバー */}
      <AiPromptPopover
        isOpen={!!aiPromptPosition}
        position={aiPromptPosition || { x: 0, y: 0 }}
        onClose={closeAiPrompt}
        onGenerate={handleAiGenerate}
        isGenerating={isAiGenerating}
        selectedElementInfo={getSelectedElementInfo()}
      />

      {/* HTML編集ダイアログ */}
      {htmlEditorState.isOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <HtmlEditorDialog
        isOpen={htmlEditorState.isOpen}
        onClose={() => {
          setHtmlEditorState({ isOpen: false, elementId: null, initialHtml: '' });
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        onSave={handleSaveHtml}
        initialHtml={htmlEditorState.initialHtml}
      />
      </Suspense>}

      {/* HTMLインポートダイアログ */}
      {isImportDialogOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <HtmlImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => {
          setIsImportDialogOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        onImport={handleHtmlImport}
        presentationId={parentId}
        slideId={contentId}
      />
      </Suspense>}

      {/* CSS編集ダイアログ */}
      {isCssEditorOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <CssEditorDialog
        isOpen={isCssEditorOpen}
        onClose={() => {
          setIsCssEditorOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        initialCss={importedCss}
        onSave={handleSaveCss}
        onClear={handleClearCss}
      />
      </Suspense>}

      {/* JS編集ダイアログ */}
      {isJsEditorOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <JsEditorDialog
        isOpen={isJsEditorOpen}
        onClose={() => {
          setIsJsEditorOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        initialJs={importedJs}
        onSave={handleSaveJs}
        onClear={handleClearJs}
      />
      </Suspense>}

      {/* ページ設定ダイアログ */}
      {isPageSettingsOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <PageSettingsDialog
        isOpen={isPageSettingsOpen}
        onClose={() => {
          setIsPageSettingsOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        pageSettings={pageSettings}
        projectSettings={projectSettings}
        onSave={handleSavePageSettings}
        onUploadImage={handleUploadOgpImage}
      />
      </Suspense>}

      {/* メディアライブラリ */}
      {isMediaLibraryOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <MediaLibraryDialog
        isOpen={isMediaLibraryOpen}
        onClose={() => {
          setIsMediaLibraryOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        onSelect={handleMediaSelect}
        mode={isImageSelected ? 'replace' : 'insert'}
        currentSrc={selectedImageSrc}
      />
      </Suspense>}

      {/* CSS変数パネル */}
      <VariablesPanel
        isOpen={isVariablesPanelOpen}
        onClose={() => {
          setIsVariablesPanelOpen(false);
          // ショートカットが引き続き機能するようフォーカスを復元
          requestAnimationFrame(() => {
            restoreFocus();
          });
        }}
        variables={variables}
        isSaving={isVariablesSaving}
        hasChanges={hasVariableChanges}
        onAddVariable={addVariable}
        onUpdateVariable={updateVariable}
        onDeleteVariable={deleteVariable}
        onSave={saveVariables}
      />

      {/* コンポーネント作成ダイアログ */}
      <Dialog open={createComponentDialogOpen} onOpenChange={setCreateComponentDialogOpen}>
        <DialogContent className="bg-[#2c2c2c] border-[#444444] text-white">
          <DialogHeader>
            <DialogTitle>{partsMode ? '部品として保存' : 'コンポーネントを作成'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">コンポーネント名</label>
              <Input
                value={newComponentName}
                onChange={(e) => setNewComponentName(e.target.value)}
                placeholder="例: Primary Button"
                className="bg-[#383838] border-[#444444] text-white"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">カテゴリ</label>
              <Select value={newComponentCategory} onValueChange={setNewComponentCategory}>
                <SelectTrigger className="bg-[#383838] border-[#444444] text-white">
                  <SelectValue placeholder="カテゴリを選択" />
                </SelectTrigger>
                <SelectContent className="bg-[#2c2c2c] border-[#444444] z-[9999]">
                  {componentLibrary.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id} className="text-white hover:bg-[#444444]">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateComponentDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleConfirmCreateComponent} disabled={!newComponentName.trim()}>
              作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* マスターコンポーネントエディタ */}
      {isMasterEditorOpen && <Suspense fallback={<div role="status" className="absolute bottom-16 left-4 rounded bg-[#2c2c2c] p-3">読み込み中…</div>}>
      <MasterComponentEditor
        master={editingMasterComponent}
        open={isMasterEditorOpen}
        onOpenChange={(open) => {
          setIsMasterEditorOpen(open);
          if (!open) {
            setEditingMasterComponent(null);
          }
        }}
        onSave={handleSaveMasterComponent}
        onDelete={handleDeleteMasterComponent}
        categories={componentLibrary}
        availableComponents={Array.from(masterComponents.values()).map(c => ({
          id: c.id,
          name: c.name,
        }))}
      />
      </Suspense>}

      {/* レイアウトモード切替ヒントトースト。
          Webページでは絶対配置に倒さないので、それを勧めるこの導線も出さない */}
      {showLayoutHint && editorMode !== 'webpage' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-black/90 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-4">
            <span className="text-sm">要素の移動は絶対配置モードに切り替えてください</span>
            <button
              onClick={() => {
                // 変換前のHTMLを保存
                const iframeDoc = getIframeDoc();
                if (iframeDoc) {
                  setAutoLayoutHtml(getArtboardContent(iframeDoc));
                  
                  // 絶対配置に変換（トップレベルでimport済み）
                  const count = convertToAbsolutePositioning(iframeDoc);
                  console.log('[Toast] Converted', count, 'elements to absolute positioning');
                  
                  // DOMツリーを再構築
                  const tree = buildDomTree(iframeDoc);
                  setDomTree(tree);
                  setExpandedNodes(new Set(tree.map((n: { id: string }) => n.id)));
                  
                  // 変更を通知
                  notifyIframeChange();
                }
                
                setLayoutMode('absolute');
                setShowLayoutHint(false);
              }}
              className="bg-[#0d99ff] hover:bg-[#0c8ce9] text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              絶対配置モードに切り替える
            </button>
            <button
              onClick={() => setShowLayoutHint(false)}
              className="text-gray-400 hover:text-white text-lg leading-none ml-1"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Webページ用の案内。
          Webページでは「絶対配置モードに切り替える」を勧めない(版面が固定pxに固まる)ので、
          代わりに逃げ道だけを伝える。sonner の Toaster はアプリ側に無く toast() が
          表示されないため、既存のこの帯を流用している */}
      {showLayoutHint && editorMode === 'webpage' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-black/90 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-4">
            <span className="text-sm">
              並べ替える相手がありません。Cmd/Ctrl+ドラッグで自由配置、ダブルクリックで中に入れます
            </span>
            <button
              onClick={() => setShowLayoutHint(false)}
              className="text-gray-400 hover:text-white text-lg leading-none ml-1"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
    </EditorAppearanceContext.Provider>
  );
}

/**
 * フロントエンドビジュアルエディタ
 *
 * 汎用的なHTML編集エディタとして、スライド、ページ、コンポーネント等で利用可能
 */
export function FrontendVisualEditor({
  html,
  editorMode = 'slide', // デフォルトはスライドモード（後方互換性）
  artboardWidth,
  contentId,
  parentId,
  // deprecated props for backward compatibility
  slideId,
  presentationId,
  onSave,
  onClose,
  enableMultiPageCanvas = false,
  contentList: externalContentList,
  pagesPanel,
  headerExtra,
}: FrontendVisualEditorProps) {
  const { getIdToken } = useAuth();
  const [contentList, setContentList] = useState<ContentListItem[]>(externalContentList || []);
  const [currentHtml, setCurrentHtml] = useState(html);

  // Support deprecated props for backward compatibility
  const effectiveContentId = contentId ?? slideId;
  const effectiveParentId = parentId ?? presentationId;

  const [currentContentId, setCurrentContentId] = useState(effectiveContentId);
  // ページ遷移(サムネイル・URL)で contentId が変わったら追随する。
  // 殻(EditorProvider)は保ち、iframeの中身だけが html プロップ経由で差し替わる
  useEffect(() => {
    setCurrentContentId(effectiveContentId);
  }, [effectiveContentId]);
  const [currentLayoutMode, setCurrentLayoutMode] = useState<'absolute' | 'auto'>('auto');
  const [isLoading, setIsLoading] = useState(false);

  // CSS変数の初期値（プロジェクト単位で保存）
  const [initialVariables, setInitialVariables] = useState<CSSVariableDefinition[]>([]);
  const [isVariablesLoaded, setIsVariablesLoaded] = useState(false);

  // CSS変数をロード（webpageモード・slideモード両対応）。
  // 利用側が io.loadVariables を渡していればそれ(ファイル等)から、無ければブラウザ内(localStorage)から
  useEffect(() => {
    const fromIo = io().loadVariables;
    if (!effectiveParentId && !fromIo) {
      setIsVariablesLoaded(true);
      return;
    }

    const loadVariables = async () => {
      try {
        // editorModeに応じてスコープを決定
        const scope: CSSVariableScope = editorMode === 'webpage' ? 'website' : 'presentation';
        const variables = fromIo
          ? await fromIo()
          : await getCSSVariablesList(effectiveParentId!, scope);
        setInitialVariables(variables);
        console.log(`[FrontendVisualEditor] Loaded CSS variables (${fromIo ? 'io' : scope}):`, variables.length);
      } catch (error) {
        console.error('[FrontendVisualEditor] Failed to load CSS variables:', error);
      } finally {
        setIsVariablesLoaded(true);
      }
    };

    loadVariables();
  }, [effectiveParentId, editorMode]);

  // CSS変数を保存するコールバック
  const handleSaveVariables = useCallback(async (variables: CSSVariableDefinition[]) => {
    const toIo = io().saveVariables;
    if (toIo) {
      await toIo(variables);
      console.log('[FrontendVisualEditor] Saved CSS variables (io):', variables.length);
      return;
    }
    if (!effectiveParentId) {
      throw new Error('Parent ID is required to save CSS variables');
    }
    // editorModeに応じてスコープを決定
    const scope: CSSVariableScope = editorMode === 'webpage' ? 'website' : 'presentation';
    await saveCSSVariables(effectiveParentId, variables, { scope });
    console.log(`[FrontendVisualEditor] Saved CSS variables (${scope}):`, variables.length);
  }, [effectiveParentId, editorMode]);

  // CSS変数をロードするコールバック
  const handleLoadVariables = useCallback(async (resourceId: string) => {
    const fromIo = io().loadVariables;
    if (fromIo) return fromIo();
    // editorModeに応じてスコープを決定
    const scope: CSSVariableScope = editorMode === 'webpage' ? 'website' : 'presentation';
    return getCSSVariablesList(resourceId, scope);
  }, [editorMode]);

  // 外部contentListの同期
  useEffect(() => {
    if (externalContentList && externalContentList.length > 0) {
      setContentList(externalContentList);
    }
  }, [externalContentList]);

  // コンテンツリストを取得（editorModeに応じてAPIを切り替え）
  // 外部からcontentListが渡されている場合はスキップ
  useEffect(() => {
    if (!effectiveParentId) return;
    if (externalContentList && externalContentList.length > 0) return;

    const fetchContentList = async () => {
      try {
        const api = await createAuthApi(getIdToken);

        if (editorMode === 'webpage') {
          // Webページモード
          const data = await api.get(`/api/websites/${effectiveParentId}/pages`);
          const items: ContentListItem[] = (data.pages || [])
            .toSorted((a: { pageNumber: number }, b: { pageNumber: number }) => a.pageNumber - b.pageNumber)
            .map((page: { id: string; title?: string; pageNumber: number; content?: { html?: string }; layoutMode?: string }) => ({
              id: page.id,
              title: page.title || '',
              order: page.pageNumber,
              thumbnailHtml: page.content?.html,
            }));
          setContentList(items);

          // 現在のコンテンツのlayoutModeを取得して設定
          const currentContent = (data.pages || []).find((p: { id: string; layoutMode?: string }) => p.id === (effectiveContentId || items[0]?.id));
          if (currentContent) {
            setCurrentLayoutMode(currentContent.layoutMode || 'auto');
          }
        } else {
          // スライドモード（デフォルト）
          const data = await api.get(`/api/presentations/${effectiveParentId}/slides`);
          const items: ContentListItem[] = (data.slides || [])
            .toSorted((a: Slide, b: Slide) => a.slideNumber - b.slideNumber)
            .map((slide: Slide) => ({
              id: slide.id,
              title: slide.title || slide.content?.title || '',
              order: slide.slideNumber,
              thumbnailHtml: slide.generatedHtml || slide.content?.html,
            }));
          setContentList(items);

          // 現在のコンテンツのlayoutModeを取得して設定
          const currentContent = (data.slides || []).find((s: Slide) => s.id === (effectiveContentId || items[0]?.id));
          if (currentContent) {
            setCurrentLayoutMode(currentContent.layoutMode || 'auto');
          }
        }
      } catch (error) {
        console.error('Failed to fetch content list:', error);
      }
    };

    fetchContentList();
  }, [effectiveParentId, effectiveContentId, getIdToken, editorMode]);

  // コンテンツ変更ハンドラ（editorModeに応じてAPIを切り替え）
  const handleContentChange = useCallback(async (newContentId: string) => {
    if (!effectiveParentId || newContentId === currentContentId) return;

    // キャンバスモード時はisLoadingをスキップ（EditorProviderのアンマウントを防止）
    if (!enableMultiPageCanvas) {
      setIsLoading(true);
    }
    try {
      // 新しいコンテンツのHTMLを取得
      const api = await createAuthApi(getIdToken);

      if (editorMode === 'webpage') {
        // Webページモード
        const data = await api.get(`/api/websites/${effectiveParentId}/pages/${newContentId}`);
        const newHtml = data.page?.content?.html || '';
        const newLayoutMode = data.page?.layoutMode || 'auto';

        setCurrentHtml(newHtml);
        setCurrentLayoutMode(newLayoutMode);
        setCurrentContentId(newContentId);
      } else {
        // スライドモード（デフォルト）
        const data = await api.get(`/api/presentations/${effectiveParentId}/slides/${newContentId}`);
        const newHtml = data.slide?.generatedHtml || data.slide?.content?.html || '';
        const newLayoutMode = data.slide?.layoutMode || 'auto';

        setCurrentHtml(newHtml);
        setCurrentLayoutMode(newLayoutMode);
        setCurrentContentId(newContentId);
      }
    } catch (error) {
      console.error('Failed to fetch content:', error);
    } finally {
      if (!enableMultiPageCanvas) {
        setIsLoading(false);
      }
    }
  }, [effectiveParentId, currentContentId, getIdToken, editorMode, enableMultiPageCanvas]);

  useEffect(() => {
    if (html) {
      setCurrentHtml(html);
    }
  }, [html]);

  // EditorProviderのキーはparentIdのみ（コンテンツ変更で状態をリセットしない）
  // マルチアートボード対応: 状態はEditorContext内のartboardStatesで管理
  const editorKey = `editor-${effectiveParentId}`;

  // CSS変数のロードも待つ
  if (isLoading || !isVariablesLoaded) {
    return (
      <div className={cn(
        "gg-editor-skin bg-[#1e1e1e] flex items-center justify-center",
        enableMultiPageCanvas ? "absolute inset-0" : "fixed inset-0 z-50"
      )}>
        <div className="flex items-center gap-3 text-gray-400">
          {/* SVGアニメーションはdivラッパーで適用（ハードウェアアクセラレーション対応） */}
          <div className="animate-spin">
            <Loader2 className="w-6 h-6" />
          </div>
          <span>読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <EditorProvider
      key={editorKey}
      initialHtml={currentHtml}
      editorMode={editorMode}
      artboardWidth={artboardWidth}
      contentList={contentList}
      currentContentId={currentContentId}
      onContentChange={handleContentChange}
      initialLayoutMode={currentLayoutMode}
      initialVariables={initialVariables}
      onSaveVariables={handleSaveVariables}
      onLoadVariables={handleLoadVariables}
      websiteId={effectiveParentId}
      enableMultiPageCanvas={enableMultiPageCanvas}
    >
      <FrontendVisualEditorInner
        onSave={onSave}
        onClose={onClose}
        parentId={effectiveParentId}
        contentId={currentContentId}
        pagesPanel={pagesPanel}
        headerExtra={headerExtra}
        isMultiPageCanvas={enableMultiPageCanvas}
      />
    </EditorProvider>
  );
}

/** @deprecated Use FrontendVisualEditor instead */
export const SlideVisualEditor = FrontendVisualEditor;

export default FrontendVisualEditor;
