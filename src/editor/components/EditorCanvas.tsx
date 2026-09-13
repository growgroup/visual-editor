"use client";

import { useEffect, useCallback, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useEditorContext } from "../EditorContext";
import { useCanvasControls } from "../hooks/useCanvasControls";
import { useElementActions } from "../hooks/useElementActions";
import { useTouchGestures } from "../hooks/useTouchGestures";
import { useKeyboardShortcuts, editorCancelDragRef } from "../hooks/useKeyboardShortcuts";
import { useElementSelection } from "../hooks/useElementSelection";
import { useMarqueeSelection } from "../hooks/useMarqueeSelection";
import { useDragResize } from "../hooks/useDragResize";
import { useContextMenuHandler } from "../hooks/useContextMenuHandler";
import { useIframeSetup } from "../hooks/useIframeSetup";
import { useFocusManagement } from "../hooks/useFocusManagement";
import {
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  WEBPAGE_MIN_HEIGHT,
} from "../constants";
import {
  applyCanvasZoomDom,
  convertToAbsolutePositioning,
  stampBaselines,
  buildDomTree,
  getArtboardContent,
  refreshSelectionOverlay,
} from "../utils/dom-utils";
import { generateEditableHtml } from "../utils/html-utils";
import { setupInlineFormatToolbar } from "../utils/inline-format";
import { recalculateViewportUnits } from "../utils/viewport-utils";
import { useMultiPageCanvasOptional } from "../contexts/MultiPageCanvasContext";
import { applyDocumentAttributes } from "./multi-page/PageFramePreview";
import { setupEmbeddedCanvasBridge } from "../utils/embedded-canvas-bridge";
import { endContentSwitch } from "../autosave";
import { showPartDropIndicator, clearPartDropIndicator, findFlowInsertion } from "../utils/drop-target";
import { debugLog } from '../utils/debug';
import { useEditorComponents } from "../contexts/EditorComponentsContext";
import type {
  DOMTreeNode,
  DragState,
  ResizeState,
  EditorTool,
  MarqueeState,
} from "../types";

/**
 * 初期ドラッグ状態
 */
const INITIAL_DRAG_STATE: DragState = {
  element: null,
  elements: [],
  startX: 0,
  startY: 0,
  origLeft: 0,
  origTop: 0,
  origPositions: [],
  isDragging: false,
  hasMoved: false,
  // Flex reorder mode (auto-layout)
  flexReorderMode: false,
  flexParent: null,
  originalIndex: -1,
  targetIndex: -1,
  // Enhanced auto-layout drag (hierarchy change support)
  autoLayoutDragMode: false,
  dragGhost: null,
  originalParent: null,
  currentDropTarget: null,
  dropPosition: null,
  dropIndex: -1,
};

/**
 * 初期リサイズ状態
 */
const INITIAL_RESIZE_STATE: ResizeState = {
  isResizing: false,
  isRotating: false,
  element: null,
  elements: [],
  handle: "",
  startX: 0,
  startY: 0,
  origLeft: 0,
  origTop: 0,
  origWidth: 0,
  origHeight: 0,
  origRadius: 0,
  selectionBounds: null,
  origElementStates: [],
  origScaleX: 1,
  origScaleY: 1,
  rotation: 0,
  rotationStartAngle: 0,
  centerX: 0,
  centerY: 0,
};

/**
 * iframeをラップするキャンバスコンポーネント
 * iframeの初期化とイベントハンドリングを担う
 *
 * キャンバス操作:
 * - Ctrl/Cmd + ホイール: ズーム
 * - ホイール: パン（縦）
 * - Shift + ホイール: パン（横）
 * - ピンチ: ズーム
 * - スペース + ドラッグ: パン
 */
export function EditorCanvas() {
  const {
    iframeRef,
    containerRef,
    zoom,
    originalHtml,
    sourceHtml,
    activeTool,
    getIframeDoc,
    setFitZoom,
    setZoom,
    setDomTree,
    setExpandedNodes,
    setHtml,
    setOriginalHtml,
    clearHistory,
    layoutMode,
    editorMode,
    setShowLayoutHint,
    viewportWidth,
    setIframeReady,
    documentAttributes,
    currentContentId,
  } = useEditorContext();
  // 高さの報告先は「本文が載っているページ」(利用側の currentContentId)。
  // クリックしただけでまだ本文が来ていないページへ、前のページの高さを書かない
  const currentContentIdRef = useRef(currentContentId);
  currentContentIdRef.current = currentContentId;

  // マルチページモード判定
  const multiPageCanvas = useMultiPageCanvasOptional();
  // 文書(<html>)に付ける属性(利用側の documentAttributes)。読み込み時と、変わったときに付け替える
  const documentAttributesRef = useRef(documentAttributes);
  documentAttributesRef.current = documentAttributes;
  useEffect(() => {
    try {
      applyDocumentAttributes(iframeRef.current?.contentDocument, documentAttributes);
    } catch {
      /* まだ読めなければ読み込み時に付く */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentAttributes]);
  const isInMultiPageMode = !!multiPageCanvas?.isEnabled;
  // ロードハンドラ(deps=[])から最新の値を読むための ref
  const multiPageCanvasRef = useRef(multiPageCanvas);
  multiPageCanvasRef.current = multiPageCanvas;
  const isInMultiPageModeRef = useRef(isInMultiPageMode);
  isInMultiPageModeRef.current = isInMultiPageMode;

  // Figmaライクなキャンバス操作
  useCanvasControls();

  // グループ化/グループ解除/スタイルコピー&ペースト/Figmaエクスポート
  const { groupElements, ungroupElements, copyStyle, pasteStyle, copyToFigma } = useElementActions();

  // ========== State Refs ==========
  // ドラッグ・リサイズ状態（ミュータブル）
  const dragStateRef = useRef<DragState>({ ...INITIAL_DRAG_STATE });
  const resizeStateRef = useRef<ResizeState>({ ...INITIAL_RESIZE_STATE });

  // マーキー選択用refs
  const marqueeStartPendingRef = useRef(false);
  const marqueeClickTargetRef = useRef<HTMLElement | null>(null);
  // Shift+マーキー（既存選択への加算）フラグ。mousedown で決めて mouseup で使う
  const marqueeAdditiveRef = useRef(false);
  // マーキーの矩形。React state だと mousedown → 最初の mousemove の間に
  // 反映が間に合わず、始点が (0,0) のまま読まれて矩形がずれる（速いドラッグで再現）。
  // 判定に使う値は必ずこの ref（同期書き込み）を正とする。
  const marqueeGeomRef = useRef<MarqueeState>({
    isActive: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // クロージャ問題回避のためのref
  const activeToolRef = useRef<EditorTool>(activeTool);
  const layoutModeRef = useRef<"absolute" | "auto">(layoutMode);
  const setShowLayoutHintRef = useRef(setShowLayoutHint);
  const setDomTreeRef = useRef(setDomTree);
  const setExpandedNodesRef = useRef(setExpandedNodes);
  const setHtmlRef = useRef(setHtml);
  const clearHistoryRef = useRef(clearHistory);
  const editorModeRef = useRef(editorMode);
  // 部品モードか(io に loadParts があるか)。挿入位置の印を出してよいかの判定に使う
  const { partsMode } = useEditorComponents();
  const partsModeRef = useRef(partsMode);

  // Webページモード用のコンテンツ高さ追跡
  const [contentHeight, setContentHeight] = useState(WEBPAGE_MIN_HEIGHT);
  const contentHeightRef = useRef(contentHeight);

  // イベントリスナーのクリーンアップ関数を保存するref
  // これにより、iframeがリロードされた際に古いリスナーを確実に削除できる
  const cleanupFunctionsRef = useRef<(() => void)[]>([]);

  // refを最新値に同期
  useEffect(() => {
    activeToolRef.current = activeTool;
    layoutModeRef.current = layoutMode;
    setShowLayoutHintRef.current = setShowLayoutHint;
    setDomTreeRef.current = setDomTree;
    setExpandedNodesRef.current = setExpandedNodes;
    setHtmlRef.current = setHtml;
    clearHistoryRef.current = clearHistory;
    editorModeRef.current = editorMode;
    partsModeRef.current = partsMode;
    contentHeightRef.current = contentHeight;
  }, [
    activeTool,
    layoutMode,
    setShowLayoutHint,
    setDomTree,
    setExpandedNodes,
    setHtml,
    clearHistory,
    editorMode,
    partsMode,
    contentHeight,
  ]);

  // ========== Hooks ==========

  // フォーカス管理（ショートカットが効かなくなる問題対策）
  const { setupFocusRecovery } = useFocusManagement();

  // タッチジェスチャー（ピンチズーム、ホイールズーム）
  const { setupTouchGestureListeners } = useTouchGestures();

  // キーボードショートカット
  const { setupKeyboardShortcuts } = useKeyboardShortcuts({
    groupElements,
    ungroupElements,
    copyStyle,
    pasteStyle,
    copyToFigma,
  });

  // 要素選択
  const {
    getEditableElement,
    setupSelectionListeners,
    resolveHoverTarget,
    handleSelectionMouseUp,
  } = useElementSelection({
    dragStateRef,
    resizeStateRef,
    marqueeStartPendingRef,
    marqueeClickTargetRef,
    layoutModeRef,
    // 群移動できないケース（オートレイアウト中のフロー要素）でヒントを出すため
    setShowLayoutHintRef,
    marqueeAdditiveRef,
    marqueeGeomRef,
  });

  // マーキー選択
  const {
    marqueeBoxRef: _marqueeBoxRef, // used internally by hook
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
    initMarqueeBox,
  } = useMarqueeSelection({
    marqueeStartPendingRef,
    marqueeClickTargetRef,
    marqueeAdditiveRef,
    marqueeGeomRef,
  });

  // ドラッグ・リサイズ
  const {
    handleDragResizeMouseMove,
    handleDragResizeMouseUp,
    cancelDrag,
    sendElementInfo: _sendElementInfo, // used internally by hooks
  } = useDragResize({
    dragStateRef,
    resizeStateRef,
    activeToolRef,
    layoutModeRef,
    setShowLayoutHintRef,
  });

  // ドラッグ中断(Escape)はキーボードのディスパッチャ側から呼ばれる。
  // ドラッグ状態はこのコンポーネントのrefが持っているため、モジュールレベルの
  // レジストリ経由で最新の cancelDrag を渡す（keydownの経路を1本に保つための橋渡し）
  editorCancelDragRef.current = cancelDrag;

  // コンテキストメニュー
  const { setupContextMenuListener } = useContextMenuHandler({
    getEditableElement,
    contentHeightRef,
  });

  // iframe初期化
  const { initializeIframeDocument, setupMutationObserver, setupTextHoverListener } = useIframeSetup();

  // ========== Canvas Dimensions ==========
  // webpageモードではviewportWidth（ブレイクポイント）を使用
  const canvasWidth = editorMode === "webpage" ? viewportWidth : SLIDE_WIDTH;
  const canvasHeight =
    editorMode === "webpage" ? contentHeight : SLIDE_HEIGHT;

  // Webページモードでコンテンツ高さを更新する関数
  const updateContentHeightFromIframe = useCallback(() => {
    if (editorModeRef.current !== "webpage") return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const artboard = iframeDoc.getElementById("artboard");
    const targetElement = artboard || iframeDoc.body;

    const elements = targetElement.querySelectorAll("*");
    let maxBottom = 0;

    elements.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const bottom = rect.bottom;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    });

    const scrollHeight = targetElement.scrollHeight;
    const computedHeight = Math.max(scrollHeight, maxBottom);
    // 埋め込み(マルチフレーム)ではフレーム = 紙面そのもの。下の余白は付けず、
    // 実測をキャンバス側へ渡してフレームの高さにする
    if (isInMultiPageModeRef.current) {
      const frameHeight = Math.max(200, Math.ceil(computedHeight));
      setContentHeight(frameHeight);
      contentHeightRef.current = frameHeight;
      const mpc = multiPageCanvasRef.current;
      const activeId = currentContentIdRef.current;
      if (mpc && activeId) mpc.setPageHeight(activeId, frameHeight, "editor");
      return;
    }
    const newHeight = Math.max(WEBPAGE_MIN_HEIGHT, computedHeight + 100);

    setContentHeight(newHeight);
    contentHeightRef.current = newHeight;
  }, [getIframeDoc]);

  const updateContentHeightRef = useRef(updateContentHeightFromIframe);
  useEffect(() => {
    updateContentHeightRef.current = updateContentHeightFromIframe;
  }, [updateContentHeightFromIframe]);

  // ========== Center Slide ==========
  const centerSlide = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
    // webpage は上端固定(紙面は #canvas-scroll-area で flex-start)。
    // 初期表示もページの先頭から見えるべきで、縦の中央へ飛ばさない
    const scrollTop =
      editorMode === "webpage"
        ? 0
        : (container.scrollHeight - container.clientHeight) / 2;

    container.scrollTo({
      left: scrollLeft,
      top: scrollTop,
      behavior: "instant",
    });
  }, [containerRef, editorMode]);

  useEffect(() => {
    if (isInMultiPageMode) return; // マルチページモードではキャンバスがスクロールを管理
    if (containerRef.current) {
      centerSlide();
      requestAnimationFrame(centerSlide);
      setTimeout(centerSlide, 50);
      setTimeout(centerSlide, 150);
      setTimeout(centerSlide, 300);
    }
  }, [centerSlide, isInMultiPageMode]);

  // iframeロード後にも中央配置を実行
  useEffect(() => {
    if (isInMultiPageMode) return; // マルチページモードではスキップ
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      requestAnimationFrame(centerSlide);
      setTimeout(centerSlide, 100);
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [iframeRef, centerSlide, isInMultiPageMode]);

  // ========== Fit Zoom Calculation ==========
  const calculateFitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 100;

    const containerRect = container.getBoundingClientRect();
    const padding = 64;
    const availableWidth = containerRect.width - padding;
    const availableHeight = containerRect.height - padding;

    const scaleX = availableWidth / canvasWidth;
    const scaleY = availableHeight / canvasHeight;
    const fitScale = Math.min(scaleX, scaleY);

    return Math.floor(fitScale * 100);
  }, [containerRef, canvasWidth, canvasHeight]);

  const initialZoomSetRef = useRef(false);

  useEffect(() => {
    // マルチページモードではキャンバスズームが全体を制御
    // エディタズームは100%固定（MultiPageCanvasViewで設定）
    if (isInMultiPageMode) return;

    const updateFitZoomValue = () => {
      const newFitZoom = calculateFitZoom();
      setFitZoom(newFitZoom);

      if (!initialZoomSetRef.current) {
        setZoom(newFitZoom);
        initialZoomSetRef.current = true;
      }
    };

    const timer = setTimeout(updateFitZoomValue, 100);
    window.addEventListener("resize", updateFitZoomValue);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateFitZoomValue);
    };
  }, [calculateFitZoom, setFitZoom, setZoom, isInMultiPageMode]);

  // ========== iframe HTML ==========
  // iframe のロードハンドラ(deps=[])から最新のズーム倍率を読むための ref。
  // ページ切替では zoom 状態が変わらず、ズーム反映の effect が走らないため、
  // 読み込み完了時にこの値で塗り直す(でないと新しい文書が倍率1で巨大に出る)
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // 埋め込みでは版面の幅を最初から入れて組む(後から書き換えると一瞬 1440px で描かれる)。
  // 単独表示では幅は effect が書くので、ここでは依存に入れない(幅変更で iframe を作り直さない)
  const embeddedWidth = isInMultiPageMode ? viewportWidth : 0;
  const iframeHtml = useMemo(
    // sourceHtml(ページ切替でのみ変わる)から組む。originalHtml は
    // initLayout が変更判定の基準として書き換えるため、ここに使うとループする
    () =>
      generateEditableHtml(
        sourceHtml,
        editorMode,
        embeddedWidth ? { embedded: true, artboardWidth: embeddedWidth } : undefined,
      ),
    [sourceHtml, editorMode, embeddedWidth]
  );

  // ========== iframe Load Handler ==========
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    debugLog("[Canvas] iframe loaded, initializing...");

    // 最初のペイントより先に現在の倍率を当ててから見せる。
    // initLayout はフォント待ち等で数百msかかるため、その後に適用すると
    // 「等倍の巨大な一瞬 → 縮む」のフラッシュがノイズになる
    applyCanvasZoomDom(iframeDoc, zoomRef.current);
    applyDocumentAttributes(iframeDoc, documentAttributesRef.current);
    const wrapperEl = iframeDoc.getElementById("artboard-wrapper");
    if (wrapperEl) wrapperEl.style.visibility = "visible";

    // 重要: 新しいリスナーを追加する前に、既存のクリーンアップを実行
    // これにより、iframeがリロードされたり状態が変わるたびに
    // 古いリスナーを削除せずに新しいリスナーが追加される問題を防ぐ
    if (cleanupFunctionsRef.current.length > 0) {
      debugLog("[Canvas] Cleaning up", cleanupFunctionsRef.current.length, "previous listeners");
      cleanupFunctionsRef.current.forEach(cleanup => {
        try {
          cleanup();
        } catch (e) {
          console.error("[Canvas] Cleanup error:", e);
        }
      });
      cleanupFunctionsRef.current = [];
    }

    // 1. iframe ドキュメントの初期化（スタイル注入、data-editable属性付与）
    initializeIframeDocument(iframeDoc);

    // 2. キャンバス構造の確認
    const artboard = iframeDoc.getElementById("artboard");
    if (!artboard) {
      console.error("[Canvas] #artboard not found");
      return;
    }

    // 3. イベントリスナーのセットアップ（ローカル配列に収集後、refに保存）
    const cleanupFunctions: (() => void)[] = [];

    // タッチジェスチャー。埋め込み(マルチフレーム)では倍率も位置も外側が持つので、
    // ホイール・ピンチ・Space・中ボタンをそのまま親へ転送する
    if (isInMultiPageModeRef.current) {
      cleanupFunctions.push(setupEmbeddedCanvasBridge(iframeDoc, iframe));
    } else {
      cleanupFunctions.push(setupTouchGestureListeners(iframeDoc));
    }

    // キーボードショートカット
    cleanupFunctions.push(setupKeyboardShortcuts(iframeDoc));

    // フォーカス自動復元（ショートカットが効かなくなる問題対策）
    cleanupFunctions.push(setupFocusRecovery());

    // 選択リスナー（mousedown, dblclick）
    cleanupFunctions.push(setupSelectionListeners(iframeDoc));
    // テキスト編集中の範囲選択に、マーカー・太字のツールバーを出す
    cleanupFunctions.push(setupInlineFormatToolbar(iframeDoc));

    // コンテキストメニュー
    cleanupFunctions.push(setupContextMenuListener(iframeDoc));

    // テキスト要素ホバー（Figmaスタイルの下線表示 + クリック結果の予告輪郭）
    // 予告の対象は選択側とまったく同じ判別器で決める
    cleanupFunctions.push(setupTextHoverListener(iframeDoc, resolveHoverTarget));

    // 4. マウス移動・アップのグローバルハンドラ
    const handleMouseMove = (e: MouseEvent) => {
      // マーキー選択を先に処理
      if (handleMarqueeMouseMove(e, iframeDoc)) return;
      // ドラッグ・リサイズを処理
      handleDragResizeMouseMove(e, iframeDoc);
    };

    const handleMouseUp = (e: MouseEvent) => {
      // マーキー選択を先に処理
      if (!handleMarqueeMouseUp(iframeDoc)) {
        // ドラッグ・リサイズを処理
        handleDragResizeMouseUp(iframeDoc);
      }
      // 選択の確定（Shiftトグル / 群→単独の畳み込み）は
      // ドラッグ確定処理の *後* に行う。先に行うと、群ドラッグの終了処理が
      // 古い選択セットを見て枠と情報パネルを取り違える。
      handleSelectionMouseUp(e, iframeDoc);
    };

    iframeDoc.addEventListener("mousemove", handleMouseMove);
    iframeDoc.addEventListener("mouseup", handleMouseUp);
    cleanupFunctions.push(() => {
      iframeDoc.removeEventListener("mousemove", handleMouseMove);
      iframeDoc.removeEventListener("mouseup", handleMouseUp);
    });

    // 4-b. iframe の外で離した場合の確定処理
    //
    // [なぜ親ウィンドウにも張るか]
    // iframe 内で発生したマウスイベントは親ウィンドウへは伝播しない。
    // 従来は mousemove/mouseup が iframeDoc にしか無かったため、
    // ドラッグの終点がプロパティパネル等の iframe 外に出ると mouseup が
    // 届かず、確定処理が走らないまま選択が飛んでいた。
    //
    // 親のイベント座標は「親ビューポート基準」だが、この先の処理
    // （マーキー矩形 vs getBoundingClientRect、dragState.startX）はすべて
    // 「iframe ビューポート基準」なので、iframe の矩形分だけ平行移動して渡す。
    // iframe 自体は等倍（scale は iframe 内の #artboard-wrapper に掛かる）なので
    // 平行移動だけで正しく一致する。
    // 埋め込み(マルチフレーム)では iframe 要素自体が外側の transform で縮んでいるので、
    // 実測の矩形と iframe の内寸の比(= 外側の倍率)で割ってから渡す。単独表示では比は 1
    const toIframeCoords = (e: MouseEvent): MouseEvent => {
      const frameEl = iframeRef.current;
      if (!frameEl) return e;
      const r = frameEl.getBoundingClientRect();
      const outerScale = r.width / (frameEl.clientWidth || r.width) || 1;
      return new MouseEvent(e.type, {
        clientX: (e.clientX - r.left) / outerScale,
        clientY: (e.clientY - r.top) / outerScale,
        screenX: e.screenX,
        screenY: e.screenY,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      // 何も掴んでいなければ無視（通常のマウス移動でコストを払わない）
      if (
        !dragStateRef.current.isDragging &&
        !resizeStateRef.current.isResizing &&
        !resizeStateRef.current.isRotating &&
        !marqueeStartPendingRef.current
      ) {
        return;
      }
      handleMouseMove(toIframeCoords(e));
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      handleMouseUp(toIframeCoords(e));
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    cleanupFunctions.push(() => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    });

    // 5. 背景クリック後のフォーカス復帰
    //
    // [変更] 選択解除そのものは mousedown の判別器（useElementSelection）へ移した。
    // ここで解除していた頃は
    //   - e.target === body 限定なので #artboard に覆われて発火しない
    //   - マーキーで選択を確定した直後の click で選択を消してしまう
    // という2つの食い違いがあった。ここではフォーカス復帰だけを担う。
    const handleBackgroundClick = (e: MouseEvent) => {
      if (
        e.target === iframeDoc.body ||
        e.target === iframeDoc.documentElement
      ) {
        // フォーカスをiframeとbodyに確実に維持してショートカットが引き続き機能するようにする
        requestAnimationFrame(() => {
          // まずiframe要素自体にフォーカス
          if (iframe) iframe.focus();
          if (iframeDoc.body) {
            iframeDoc.body.focus();
            debugLog('[Canvas] Focus restored after background click');
          }
        });
      }
    };
    iframeDoc.addEventListener("click", handleBackgroundClick);
    cleanupFunctions.push(() =>
      iframeDoc.removeEventListener("click", handleBackgroundClick)
    );

    // 6. テキスト編集終了（フォーカスアウト）
    const handleFocusOut = (e: FocusEvent) => {
      const element = getEditableElement(e.target, iframeDoc);
      if (element && element.getAttribute("contenteditable") === "true") {
        element.classList.remove("editing");
        element.removeAttribute("contenteditable");
        window.postMessage(
          {
            type: "SLIDE_CONTENT_CHANGED",
            html: getArtboardContent(iframeDoc),
          },
          "*"
        );
      }
    };
    iframeDoc.addEventListener("focusout", handleFocusOut);
    cleanupFunctions.push(() =>
      iframeDoc.removeEventListener("focusout", handleFocusOut)
    );

    // 7. ドラッグ&ドロップ（画像アップロード用）
    let dragCounter = 0;

    // 部品のドラッグか(ファイルのドラッグと見分ける)。
    // dragover 中は getData が使えないので types だけで判定する
    const isPartDrag = (e: DragEvent) =>
      !!e.dataTransfer?.types.includes("application/x-editor-component");

    // 挿入位置の横棒を出してよい場面か。
    // FrontendVisualEditor の drop 処理が insertIntoFlow(フローに差し込む)を使うのは
    // 「部品モード かつ Web ページモード」のときだけで、それ以外(スライド、および
    // Firestore のコンポーネント)は落とした座標に絶対配置する。条件を揃えないと
    // 「横棒の位置と実際に入る位置が違う」という一番たちの悪いズレ方をする
    const canShowFlowIndicator = () =>
      partsModeRef.current && editorModeRef.current === "webpage";

    // 前回の挿入先。同じなら描き直さない(dragover は毎秒数十回来るので、
    // 毎回 DOM を差し替えると強制レイアウトが走り、印もちらつく)
    let lastTarget: { parent: Element; before: Element | null } | null = null;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      // 画像のオーバーレイはファイルのときだけ。部品は挿入位置の横棒で示す
      if (e.dataTransfer?.types.includes("Files")) {
        window.parent.postMessage({ type: "IFRAME_DRAG_ENTER" }, "*");
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes("Files")) {
        e.dataTransfer.dropEffect = "copy";
        return;
      }
      if (isPartDrag(e)) {
        e.dataTransfer!.dropEffect = "copy";
        if (!canShowFlowIndicator()) return;
        // 落とす先を紙面の中に描く。実際の挿入と同じ関数で位置を出しているので、
        // 印の場所とずれない(drop-target.ts)
        const next = findFlowInsertion(iframeDoc, e.clientX, e.clientY);
        if (lastTarget && lastTarget.parent === next.parent && lastTarget.before === next.before) return;
        lastTarget = next;
        showPartDropIndicator(iframeDoc, e.clientX, e.clientY);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) {
        lastTarget = null;
        clearPartDropIndicator(iframeDoc);
        window.parent.postMessage({ type: "IFRAME_DRAG_LEAVE" }, "*");
      }
    };

    // ドラッグが途中で捨てられた(Esc・パネルの上で離した)ときも印を残さない。
    // dragend が起きるのはドラッグ「元」= 親ドキュメントのパネル項目なので、
    // iframe ではなく親の document で受ける
    const handleDragEnd = () => {
      dragCounter = 0;
      lastTarget = null;
      clearPartDropIndicator(iframeDoc);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      lastTarget = null;
      // 印は挿入より先に消す。残っていると履歴と保存HTMLに混ざる
      clearPartDropIndicator(iframeDoc);

      // コンポーネントのドロップをチェックして親ウィンドウに転送
      const componentData = e.dataTransfer?.getData('application/x-editor-component');
      if (componentData) {
        debugLog('[EditorCanvas] Component drop detected, forwarding to parent:', componentData);
        window.parent.postMessage(
          {
            type: "IFRAME_COMPONENT_DROP",
            componentData,
            x: e.clientX,
            y: e.clientY,
          },
          "*"
        );
        return;
      }

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        window.parent.postMessage(
          {
            type: "IFRAME_DROP",
            files: Array.from(files).map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
            })),
            x: e.clientX,
            y: e.clientY,
          },
          "*"
        );

        Array.from(files).forEach((file, index) => {
          if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = () => {
              window.parent.postMessage(
                {
                  type: "IFRAME_DROP_FILE_DATA",
                  index,
                  fileName: file.name,
                  fileType: file.type,
                  dataUrl: reader.result,
                  x: e.clientX,
                  y: e.clientY,
                },
                "*"
              );
            };
            reader.readAsDataURL(file);
          }
        });
      }
    };

    iframeDoc.addEventListener("dragenter", handleDragEnter);
    iframeDoc.addEventListener("dragover", handleDragOver);
    iframeDoc.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragend", handleDragEnd);
    iframeDoc.addEventListener("drop", handleDrop);
    cleanupFunctions.push(() => {
      iframeDoc.removeEventListener("dragenter", handleDragEnter);
      iframeDoc.removeEventListener("dragover", handleDragOver);
      iframeDoc.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragend", handleDragEnd);
      iframeDoc.removeEventListener("drop", handleDrop);
      clearPartDropIndicator(iframeDoc);
    });

    // [修正] ここにあった「iframe内のpasteを親へpostMessageして画像を挿入する」
    // ブリッジは削除した。FrontendVisualEditor が iframe の document にも
    // 直接 paste リスナーを張っており、2系統が同時に走るため1回の貼り付けで
    // 画像が2枚入っていた。ペーストの処理は FrontendVisualEditor の1本に集約する。

    debugLog("[Canvas] Drag/drop handlers registered");

    // 9. レイアウトモードに応じた初期化とDOMツリー構築
    const initLayout = async () => {
      try {
        if (iframeDoc.fonts && iframeDoc.fonts.ready) {
          await iframeDoc.fonts.ready;
        }
        // 画像も待つ。ロード前に採寸すると、高さ0の画像の分だけ後続要素の座標が
        // ずれた状態で絶対配置に固定される(「編集に入った瞬間に崩れる」の原因)。
        // fonts.ready は画像を待たない
        await Promise.all(
          Array.from(iframeDoc.images)
            .filter((img) => !img.complete)
            .map(
              (img) =>
                new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }),
            ),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        // レイアウトが完全に確定してから採寸する(Tailwindの遅延適用対策)。
        // 注意: タブが背面にあると Chrome は requestAnimationFrame を止めるため、
        // rAF だけを待つと初期化が永久に走らない(変換もベースラインも無いまま
        // 編集が始まってしまう)。タイムアウトとの競争にして必ず先へ進む
        const win = iframeDoc.defaultView;
        if (win) {
          await Promise.race([
            new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => r(null)))),
            new Promise((r) => setTimeout(r, 300)),
          ]);
        }

        // [開いた時に一括で絶対配置へ倒す]
        // 1要素ずつ倒す遅延変換は、倒した瞬間にその要素が流れから抜けて
        // 未選択の兄弟が詰め上がり、版面が動く(選択・リサイズで実害が出た)。
        // 一括変換は「親を基準化 → offsetLeft/offsetTop を全要素まとめて採寸 → 書き込み」
        // の順で行うので、変換の前後で見た目は変わらない(dom-utils側で担保)。
        //
        // かつて「一括変換すると崩れる」が起きたのは、採寸が rect÷ズーム倍率で
        // 端数がずれていたため。offsetベースに直してから再有効化した。
        // 絶対配置へ倒すのはスライド(固定キャンバス)のための最適化。
          // Webページは流し込み(フロー)レイアウトで、可変パディングや flex カラムが
          // そのまま次工程の入力になる。倒すと版面が固定ピクセルに固まり、
          // 別の幅で崩れ、デザインツールへの取り込みで意味を失う。
        if (editorModeRef.current !== "webpage") {
          const converted = convertToAbsolutePositioning(iframeDoc);
          debugLog('[Canvas] 絶対配置へ一括変換:', converted, '要素');
        }

        // ここまでが「開いただけ」の姿。以後の変化=ユーザーの編集、と
        // 切り分けるための指紋を全要素に刻む(保存時の変換ノイズ巻き戻しに使う)
        const stamped = stampBaselines(iframeDoc);
        debugLog('[Canvas] 書き戻し用ベースライン:', stamped, '要素');

        const artboardEl = iframeDoc.getElementById("artboard");
        const tree = buildDomTree(iframeDoc, artboardEl || undefined);
        debugLog("[Canvas] Built DOM tree with", tree.length, "root nodes");

        setDomTreeRef.current(tree);
        const firstLevelIds = new Set<string>(
          tree.map((n: DOMTreeNode) => n.id)
        );
        setExpandedNodesRef.current(firstLevelIds);

        const initializedHtml = artboardEl
          ? artboardEl.innerHTML
          : iframeDoc.body.innerHTML;
        clearHistoryRef.current();
        setHtmlRef.current(initializedHtml);
        // 変換後の姿を「変更なし」の基準にする。これをしないと開いただけで
        // 未保存扱いになり、サムネイル移動のたびに確認ダイアログが出る
        setOriginalHtml(initializedHtml);
        debugLog(
          "[Canvas] History reset with initialized HTML from artboard"
        );

        // マーキーボックスを作成
        initMarqueeBox(iframeDoc);
      } catch (err) {
        console.error("[Canvas] Error during initialization:", err);
      }
    };

    initLayout().then(() => {
      // ページ切替直後の文書へ現在の倍率を適用(上記 zoomRef のコメント参照)
      applyCanvasZoomDom(iframeDoc, zoomRef.current);
      // 履歴の本文がこの文書の姿になった = ページ切替が終わった(自動保存を再開してよい)
      endContentSwitch();
      if (isInMultiPageModeRef.current) {
        const mpc = multiPageCanvasRef.current;
        if (mpc) {
          iframeDoc.documentElement.dataset.outerZoom = String(mpc.viewStore.get().canvasZoom);
        }
      }
      const artboardEl = iframeDoc.getElementById("artboard");
      if (editorModeRef.current === "webpage" && artboardEl) {
        updateContentHeightRef.current();

        const cleanupMutation = setupMutationObserver(iframeDoc);
        cleanupFunctions.push(cleanupMutation);

        const resizeObserver = new ResizeObserver(() => {
          updateContentHeightRef.current();
        });
        resizeObserver.observe(artboardEl);
        cleanupFunctions.push(() => resizeObserver.disconnect());

        debugLog(
          "[Canvas] Webpage mode: content height tracking initialized on artboard"
        );
      }
    });

    // 重要: クリーンアップ関数をrefに保存して、
    // 次のiframeロード時やアンマウント時にクリーンアップできるようにする
    cleanupFunctionsRef.current = cleanupFunctions;
    debugLog("[Canvas] Registered", cleanupFunctions.length, "cleanup functions");

    // iframeの読み込み完了をマーク（CSS変数注入等のトリガー用）
    setIframeReady(true);
    debugLog("[Canvas] iframe ready, setIframeReady(true) called");

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iframeのsrcを設定。
  // 依存に iframeHtml(=originalHtml由来)を含めることで、ページ切替(サムネイル/URL)で
  // コンテンツが差し替わったときに**iframeだけ**を作り直す。殻(ヘッダー・パネル・
  // サムネイル)は残るので、切替のたびに画面全体がリロードされたようには見えない
  // useLayoutEffect なのは、setIframeReady(false)(エディタを隠す)を、枠が新しいページへ移る
  // 描画と同じフレームに載せるため。useEffect だと 1 フレームだけ前のページの姿が新しい枠に見える
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    iframe.addEventListener("load", handleIframeLoad);
    // 新しい本文を読み込む間は「準備できていない」に戻す。
    // マルチフレームのキャンバスはこれを見て、前のページの姿が新しい枠に
    // 見えないようエディタを隠す(読み込みが済むまで見るだけの紙面が透ける)
    setIframeReady(false);
    const blob = new Blob([iframeHtml], { type: "text/html" });
    iframe.src = URL.createObjectURL(blob);

    return () => {
      iframe.removeEventListener("load", handleIframeLoad);
      if (iframe.src.startsWith("blob:")) {
        URL.revokeObjectURL(iframe.src);
      }

      // 重要: アンマウント時にすべてのイベントリスナーをクリーンアップ
      // これにより、メモリリークとゴーストリスナーを防ぐ
      if (cleanupFunctionsRef.current.length > 0) {
        debugLog("[Canvas] Unmounting: cleaning up", cleanupFunctionsRef.current.length, "listeners");
        cleanupFunctionsRef.current.forEach(cleanup => {
          try {
            cleanup();
          } catch (e) {
            console.error("[Canvas] Cleanup error during unmount:", e);
          }
        });
        cleanupFunctionsRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeHtml]);

  // モード変更をiframeに直接適用
  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc?.body) {
      iframeDoc.body.classList.remove(
        "move-mode",
        "draw-mode",
        "text-mode",
        "comment-mode",
        "tool-rectangle",
        "tool-ellipse",
        "tool-line",
        "tool-arrow",
        "tool-pen",
        "tool-pencil",
        "tool-text",
        "tool-frame",
        "tool-shape",
        "tool-eraser"
      );

      if (activeTool === "move") {
        iframeDoc.body.classList.add("move-mode");
      } else if (
        [
          "rectangle",
          "ellipse",
          "line",
          "arrow",
          "pen",
          "pencil",
          "frame",
          "shape",
        ].includes(activeTool)
      ) {
        iframeDoc.body.classList.add("draw-mode", `tool-${activeTool}`);
      } else if (activeTool === "text") {
        iframeDoc.body.classList.add("text-mode", "tool-text");
      } else if (activeTool === "comment") {
        // コメントの範囲指定。要素の選択・ホバーを止め、紙面のドラッグを範囲にする
        iframeDoc.body.classList.add("comment-mode");
      }
    }
  }, [activeTool, getIframeDoc]);

  // ズーム状態を iframe 内の #artboard-wrapper に適用
  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const artboardWrapper = iframeDoc.getElementById("artboard-wrapper");
    const canvasScrollArea = iframeDoc.getElementById("canvas-scroll-area");
    const canvasContainer = iframeDoc.getElementById("canvas-container");

    if (!artboardWrapper || !canvasScrollArea || !canvasContainer) return;

    const currentScale = zoom / 100;
    // 反映は共通関数(ホイールの即時経路と同じもの)へ寄せる。
    // 二重実装にすると片方だけ補正式がずれる事故が起きる
    applyCanvasZoomDom(iframeDoc, zoom);

    requestAnimationFrame(() => {
      // ズーム変更で枠の座標基準が変わるので選択セット全体から作り直す
      // （群バウンディングボックスもここで再計算される）
      refreshSelectionOverlay(iframeDoc);
    });

    debugLog(
      `[Canvas] Applied zoom: ${zoom}%, wrapper transform: scale(${currentScale})`
    );
  }, [zoom, editorMode, contentHeight, viewportWidth, getIframeDoc]);

  // 埋め込み(マルチフレーム): 外側の倍率を iframe に知らせ、選択枠・ハンドルの太さを
  // 画面上で一定に保つ(applyOverlayScale が data-outer-zoom を読む)
  // ズーム・パンは毎目盛り起きるので、ここでは描き直さず(再レンダーせず)ストアを購読して
  // 直接 DOM に書く。選択枠の描き直しは 1 フレームに 1 回にまとめる
  const viewStore = multiPageCanvas?.viewStore ?? null;
  useEffect(() => {
    if (!isInMultiPageMode || !viewStore) return;
    let raf: number | null = null;
    let lastZoom: number | null = null;
    const apply = () => {
      const zoom = viewStore.get().canvasZoom;
      if (zoom === lastZoom) return;
      lastZoom = zoom;
      const iframeDoc = getIframeDoc();
      if (!iframeDoc?.documentElement) return;
      iframeDoc.documentElement.dataset.outerZoom = String(zoom);
      if (raf != null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        refreshSelectionOverlay(iframeDoc);
      });
    };
    apply();
    const unsubscribe = viewStore.subscribe(apply);
    return () => {
      unsubscribe();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [isInMultiPageMode, viewStore, getIframeDoc]);

  // ビューポート幅変更時にiframe内のartboard幅を更新
  useEffect(() => {
    if (editorMode !== "webpage") return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const artboard = iframeDoc.getElementById("artboard");
    const artboardWrapper = iframeDoc.getElementById("artboard-wrapper");

    if (artboard) {
      artboard.style.width = `${viewportWidth}px`;
    }
    if (artboardWrapper) {
      artboardWrapper.style.width = `${viewportWidth}px`;
    }

    // fitZoomを再計算
    const newFitZoom = calculateFitZoom();
    setFitZoom(newFitZoom);

    // viewport単位を使用している要素を再計算
    // キャンバス/アートボードの設計寸法を基準に計算
    // slideモード: SLIDE_WIDTH x SLIDE_HEIGHT
    // webpageモード: viewportWidth x アートボードの高さ
    const canvasWidth = editorMode === "webpage" ? viewportWidth : SLIDE_WIDTH;
    const canvasHeight = editorMode === "webpage"
      ? (artboard?.scrollHeight || SLIDE_HEIGHT)
      : SLIDE_HEIGHT;
    recalculateViewportUnits(iframeDoc, canvasWidth, canvasHeight);

    debugLog(`[Canvas] Viewport width changed to ${viewportWidth}px, recalculated viewport units with canvas dimensions: ${canvasWidth}x${canvasHeight}`);
  }, [viewportWidth, editorMode, getIframeDoc, calculateFitZoom, setFitZoom]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      data-editor-canvas={isInMultiPageMode ? "embedded" : "single"}
      style={{
        backgroundColor: isInMultiPageMode ? "transparent" : "var(--ed-bg)",
      }}
    >
      <iframe
        ref={iframeRef}
        className="w-full h-full border-0"
        title={editorMode === "webpage" ? "Webpage Editor" : "Slide Editor"}
        sandbox="allow-same-origin allow-scripts"
        style={isInMultiPageMode ? { display: "block", background: "#fff" } : undefined}
      />
    </div>
  );
}
