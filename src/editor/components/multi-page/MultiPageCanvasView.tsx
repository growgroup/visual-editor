'use client';

/**
 * MultiPageCanvasView
 *
 * 全ページ同時編集可能な無限キャンバス
 * - 全ページのiframeに親側から編集ハンドラをアタッチ
 * - updateSelectionBox / extractElementInfo を直接使用
 * - キーボードショートカット、リサイズハンドル、ドラッグ完備
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMultiPageCanvas } from '../../contexts/MultiPageCanvasContext';
import { useEditorContext } from '../../EditorContext';
import { useEditorRefs } from '../../contexts/EditorRefsContext';
import { useInfiniteCanvas } from '../../hooks/useInfiniteCanvas';
import { extractElementInfo } from '../../utils/style-utils';
import {
  buildDomTree,
  updateSelectionBox,
  removeSelectionBox,
} from '../../utils/dom-utils';
import { EDITOR_IFRAME_STYLES } from '../../constants';
import {
  startAutoLayoutDrag,
  updateDragPosition,
  endAutoLayoutDrag,
  cancelAutoLayoutDrag,
  findDropTarget,
  showDropIndicator,
  hideFlexDropIndicator,
  type AutoLayoutDragState,
  type DropTargetInfo,
} from '../../utils/flex-utils';
import { PageLivePreview } from './PageLivePreview';
import { PageLabel } from './PageLabel';
import { CanvasZoomControls } from './CanvasZoomControls';

/** キャンバスモード用の追加CSS（data-element-idベース） */
const CANVAS_EDITING_STYLES = `
  /* トップレベル要素のホバー */
  #artboard > [data-element-id]:hover:not(.selected):not(.editing) {
    outline: 2px solid rgba(13, 153, 255, 0.3);
    outline-offset: -1px;
  }
  /* 全要素のホバー（Ctrl/Cmd押下で子要素選択可） */
  [data-element-id]:hover:not(.selected):not(.editing) {
    outline: 1px solid rgba(13, 153, 255, 0.15);
    outline-offset: -1px;
  }
  [data-element-id].selected {
    outline: none !important;
    cursor: move;
  }
  [data-element-id].dragging {
    opacity: 0.7;
    cursor: grabbing !important;
  }
  [data-element-id].editing {
    outline: 2px solid #0d99ff !important;
    outline-offset: 2px;
    cursor: text !important;
    min-height: 1em;
  }
  .marquee-hover {
    outline: 2px solid rgba(13, 153, 255, 0.6) !important;
    outline-offset: 1px;
  }
  /* 描画ツール: 既存要素のpointer-events無効化 */
  body.draw-mode [data-element-id] {
    pointer-events: none;
  }
  body.text-mode [data-element-id] {
    pointer-events: none;
  }
`;

export const MultiPageCanvasView = memo(function MultiPageCanvasView() {
  const {
    viewState,
    pages,
    updatePageFrame,
    focusPage,
    zoomToFit,
    setCanvasZoom,
    setCanvasOffset,
    registerUndoHandlers,
  } = useMultiPageCanvas();
  const {
    setZoom,
    setFitZoom,
    setSelectedElement,
    setSelectedElementIds,
    setDomTree,
    setExpandedNodes,
    activeTool,
    layoutMode,
  } = useEditorContext();
  const refs = useEditorRefs();
  const { canvasOffset, canvasZoom } = viewState;
  const containerRef = useRef<HTMLDivElement>(null);

  // 各ページのiframe参照を保持
  const iframeMapRef = useRef(new Map<string, HTMLIFrameElement>());

  // 無限キャンバスのズーム/パン操作
  useInfiniteCanvas(containerRef);

  // エディタズームを100%に固定（キャンバスズームが全体スケーリングを担う）
  useEffect(() => {
    setZoom(100);
    setFitZoom(100);
  }, [setZoom, setFitZoom]);

  const [isInteracting, setIsInteracting] = useState(false);
  const interactingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleInteractData = (e?: Event) => {
      // For message events, only trigger if it's a relevant one
      if (e && e.type === 'message') {
        const msg = (e as MessageEvent).data;
        if (!['PAGE_PREVIEW_WHEEL', 'IFRAME_WHEEL_EVENT', 'IFRAME_PINCH_EVENT'].includes(msg?.type)) {
          return;
        }
      }

      setIsInteracting(true);
      if (interactingTimeoutRef.current) {
        window.clearTimeout(interactingTimeoutRef.current);
      }
      interactingTimeoutRef.current = window.setTimeout(() => {
        setIsInteracting(false);
      }, 150);
    };

    window.addEventListener('wheel', handleInteractData, { passive: true, capture: true });
    window.addEventListener('touchstart', handleInteractData, { passive: true, capture: true });
    window.addEventListener('touchmove', handleInteractData, { passive: true, capture: true });
    window.addEventListener('message', handleInteractData);

    return () => {
      window.removeEventListener('wheel', handleInteractData, { capture: true });
      window.removeEventListener('touchstart', handleInteractData, { capture: true });
      window.removeEventListener('touchmove', handleInteractData, { capture: true });
      window.removeEventListener('message', handleInteractData);
      if (interactingTimeoutRef.current) window.clearTimeout(interactingTimeoutRef.current);
    };
  }, []);

  // 初回フィットズーム
  const hasInitialFitRef = useRef(false);
  useEffect(() => {
    if (hasInitialFitRef.current || pages.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const timer = setTimeout(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        zoomToFit(rect.width, rect.height);
        hasInitialFitRef.current = true;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [pages.length, zoomToFit]);

  // Stale closure回避用ref
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const setSelectedElementRef = useRef(setSelectedElement);
  setSelectedElementRef.current = setSelectedElement;
  const setSelectedElementIdsRef = useRef(setSelectedElementIds);
  setSelectedElementIdsRef.current = setSelectedElementIds;
  const setDomTreeRef = useRef(setDomTree);
  setDomTreeRef.current = setDomTree;
  const setExpandedNodesRef = useRef(setExpandedNodes);
  setExpandedNodesRef.current = setExpandedNodes;
  const updatePageFrameRef = useRef(updatePageFrame);
  updatePageFrameRef.current = updatePageFrame;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const focusPageRef = useRef(focusPage);
  focusPageRef.current = focusPage;
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;

  // --- Global Undo/Redo Stack for Multi-Page ---
  // A single sequential timeline across all iframes
  const globalUndoStackRef = useRef<{ pageId: string; html: string }[]>([]);
  const globalRedoStackRef = useRef<{ pageId: string; html: string }[]>([]);

  const canUndo = useCallback(() => globalUndoStackRef.current.length > 0, []);
  const canRedo = useCallback(() => globalRedoStackRef.current.length > 0, []);

  const performGlobalUndo = useCallback(() => {
    const stack = globalUndoStackRef.current;
    if (stack.length === 0) return;

    const lastAction = stack.pop()!;
    const targetIframe = containerRef.current?.querySelector(`iframe[data-page-id="${lastAction.pageId}"]`) as HTMLIFrameElement;
    const targetDoc = targetIframe?.contentDocument || targetIframe?.contentWindow?.document;
    const targetArtboard = targetDoc?.getElementById('artboard');
    
    if (!targetArtboard || !targetDoc) {
      stack.push(lastAction);
      return;
    }

    globalRedoStackRef.current.push({
      pageId: lastAction.pageId,
      html: targetArtboard.innerHTML
    });

    targetArtboard.innerHTML = lastAction.html;
    
    // Clear selections explicitly at context level
    setSelectedElementRef.current(null);
    setSelectedElementIdsRef.current([]);

    // Trigger update
    updatePageFrameRef.current(lastAction.pageId, {
      thumbnailHtml: lastAction.html,
      isDirty: true,
    });

    // Fix Tree
    const tree = buildDomTree(targetDoc);
    setDomTreeRef.current(tree);
  }, []);

  const performGlobalRedo = useCallback(() => {
    const redoStack = globalRedoStackRef.current;
    if (redoStack.length === 0) return;

    const nextAction = redoStack.pop()!;
    const targetIframe = containerRef.current?.querySelector(`iframe[data-page-id="${nextAction.pageId}"]`) as HTMLIFrameElement;
    const targetDoc = targetIframe?.contentDocument || targetIframe?.contentWindow?.document;
    const targetArtboard = targetDoc?.getElementById('artboard');
    
    if (!targetArtboard || !targetDoc) {
      redoStack.push(nextAction);
      return;
    }

    globalUndoStackRef.current.push({
      pageId: nextAction.pageId,
      html: targetArtboard.innerHTML
    });

    targetArtboard.innerHTML = nextAction.html;
    
    setSelectedElementRef.current(null);
    setSelectedElementIdsRef.current([]);

    updatePageFrameRef.current(nextAction.pageId, {
      thumbnailHtml: nextAction.html,
      isDirty: true,
    });

    const tree = buildDomTree(targetDoc);
    setDomTreeRef.current(tree);
  }, []);

  // Register these globally to the Toolbar Context
  useEffect(() => {
    if (registerUndoHandlers) {
      registerUndoHandlers({
        undo: performGlobalUndo,
        redo: performGlobalRedo,
        canUndo,
        canRedo,
      });
    }
  }, [performGlobalUndo, performGlobalRedo, canUndo, canRedo, registerUndoHandlers]);

  /**
   * 各ページのiframeに完全な編集機能を初期化
   * 親コンテキストから直接 updateSelectionBox / extractElementInfo を使用
   */
  const handlePageIframeLoad = useCallback((pageId: string, iframe: HTMLIFrameElement) => {
    iframeMapRef.current.set(pageId, iframe);

    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) return;

    // 既に初期化済みなら何もしない
    if (iframeDoc.querySelector('[data-canvas-editor-css]')) return;

    // ===== 1. CSS注入 =====
    const style = iframeDoc.createElement('style');
    style.setAttribute('data-canvas-editor-css', 'true');
    style.textContent = EDITOR_IFRAME_STYLES + CANVAS_EDITING_STYLES;
    iframeDoc.head.appendChild(style);

    // ===== 1.1 data-editable属性の補完 =====
    // レイアウトモード変換で必要な data-editable="true" を #artboard 直下の子要素に付与
    const artboard = iframeDoc.getElementById('artboard');
    if (artboard) {
      Array.from(artboard.children).forEach(child => {
        if (child.nodeType !== 1) return;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') return;
        if (!child.hasAttribute('data-editable')) {
          child.setAttribute('data-editable', 'true');
        }
      });
    }

    // ===== 1.5 iframe内ブラウザズーム防止 =====
    let meta = iframeDoc.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = iframeDoc.createElement('meta');
      meta.setAttribute('name', 'viewport');
      iframeDoc.head.appendChild(meta);
    }
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0');

    iframeDoc.body.style.touchAction = 'none';
    iframeDoc.documentElement.style.touchAction = 'none';

    // === ブラウザネイティブズーム防止徹底 ===
    const preventZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    iframeDoc.addEventListener('wheel', preventZoom, { passive: false, capture: true });
    iframe.contentWindow?.addEventListener('wheel', preventZoom, { passive: false, capture: true });

    const preventGesture = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    iframeDoc.addEventListener('gesturestart', preventGesture, { passive: false, capture: true } as EventListenerOptions);
    iframeDoc.addEventListener('gesturechange', preventGesture, { passive: false, capture: true } as EventListenerOptions);
    iframeDoc.addEventListener('gestureend', preventGesture, { passive: false, capture: true } as EventListenerOptions);
    iframe.contentWindow?.addEventListener('gesturestart', preventGesture, { passive: false, capture: true } as EventListenerOptions);
    iframe.contentWindow?.addEventListener('gesturechange', preventGesture, { passive: false, capture: true } as EventListenerOptions);
    iframe.contentWindow?.addEventListener('gestureend', preventGesture, { passive: false, capture: true } as EventListenerOptions);

    const preventTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) { e.preventDefault(); e.stopPropagation(); }
    };
    iframeDoc.addEventListener('touchstart', preventTouch, { passive: false, capture: true });
    iframeDoc.addEventListener('touchmove', preventTouch, { passive: false, capture: true });
    iframe.contentWindow?.addEventListener('touchstart', preventTouch, { passive: false, capture: true });
    iframe.contentWindow?.addEventListener('touchmove', preventTouch, { passive: false, capture: true });

    const preventShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
      }
    };
    iframeDoc.addEventListener('keydown', preventShortcuts, { passive: false, capture: true });
    iframe.contentWindow?.addEventListener('keydown', preventShortcuts, { passive: false, capture: true });

    // ===== 2. 編集状態 =====
    let selectedEl: HTMLElement | null = null;

    let dragState = {
      element: null as HTMLElement | null,
      startX: 0,
      startY: 0,
      origLeft: 0,
      origTop: 0,
      isDragging: false,
      hasMoved: false,
      // Auto-layout drag fields
      autoLayoutDragMode: false,
      autoLayoutState: null as AutoLayoutDragState | null,
      originalParent: null as HTMLElement | null,
      currentDropTarget: null as HTMLElement | null,
      dropPosition: null as string | null,
      dropIndex: -1,
    };

    let resizeState = {
      isResizing: false,
      isRotating: false,
      element: null as HTMLElement | null,
      handle: '',
      startX: 0,
      startY: 0,
      origLeft: 0,
      origTop: 0,
      origWidth: 0,
      origHeight: 0,
      origRadius: 0,
      rotation: 0,
      rotationStartAngle: 0,
      centerX: 0,
      centerY: 0,
    };

    // ===== 3. ヘルパー関数 =====
    const wireIframeToRefs = () => {
      const prevIframe = (refs.iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current;
      (refs.iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
      if (prevIframe !== iframe) {
        // iframe切替: useDrawingMode等のiframe依存hookを再アタッチさせる
        refs.setIframeReady(false);
        setTimeout(() => refs.setIframeReady(true), 0);
      } else {
        refs.setIframeReady(true);
      }
    };

    const selectElement = (el: HTMLElement | null) => {
      // 前の選択を解除
      if (selectedEl) {
        selectedEl.classList.remove('selected');
      }
      removeSelectionBox(iframeDoc);

      selectedEl = el;

      if (el) {
        el.classList.add('selected');
        updateSelectionBox(iframeDoc, el);
        wireIframeToRefs();

        // プロパティパネル更新
        const info = extractElementInfo(el, iframeDoc);
        if (info) {
          setSelectedElementRef.current(info);
          setSelectedElementIdsRef.current([info.id]);
        }
      } else {
        setSelectedElementRef.current(null);
        setSelectedElementIdsRef.current([]);
      }
    };

    // iframe単位の `saveSnapshot` 関数内でグローバルスタックに積ませる

    // React更新デバウンス用
    let notifyTimer: ReturnType<typeof setTimeout> | null = null;
    const notifyContentChanged = () => {
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => {
        const artboard = iframeDoc.getElementById('artboard');
        if (artboard) {
          updatePageFrameRef.current(pageId, {
            thumbnailHtml: artboard.innerHTML,
            isDirty: true,
          });
        }
      }, 300);
    };

    // --- Undo/Redo (Global DOM スナップショット) ---
    const saveSnapshot = () => {
      const artboard = iframeDoc.getElementById('artboard');
      if (!artboard) return;

      const stack = globalUndoStackRef.current;
      stack.push({ pageId, html: artboard.innerHTML });
      
      // Limit global history depth to 100
      if (stack.length > 100) stack.shift();
      
      // 操作が行われたらRedoスタックは破棄
      globalRedoStackRef.current = [];
    };

    const performUndo = () => {
      const stack = globalUndoStackRef.current;
      if (stack.length === 0) return;

      // Pop the most recent action across ALL pages
      const lastAction = stack.pop()!;
      
      // Find the specific iframe that this action belongs to
      const targetIframe = containerRef.current?.querySelector(`iframe[data-page-id="${lastAction.pageId}"]`) as HTMLIFrameElement;
      const targetDoc = targetIframe?.contentDocument || targetIframe?.contentWindow?.document;
      const targetArtboard = targetDoc?.getElementById('artboard');
      
      if (!targetArtboard || !targetDoc) {
        // Fallback: IF frame not found, push back and abort
        stack.push(lastAction);
        return;
      }

      // Save current state to Redo stack before applying Undo
      globalRedoStackRef.current.push({
        pageId: lastAction.pageId,
        html: targetArtboard.innerHTML
      });

      // Apply the historical HTML
      targetArtboard.innerHTML = lastAction.html;
      
      // Clear selection gracefully
      selectElement(null);
      // Trigger update
      if (lastAction.pageId === pageId) {
        notifyContentChanged();
      } else {
        // Directly call the update on the target page if different
        updatePageFrameRef.current(lastAction.pageId, {
          thumbnailHtml: lastAction.html,
          isDirty: true,
        });
      }

      // Fix Tree
      const tree = buildDomTree(targetDoc);
      setDomTreeRef.current(tree);
    };

    const performRedo = () => {
      const redoStack = globalRedoStackRef.current;
      if (redoStack.length === 0) return;

      const nextAction = redoStack.pop()!;
      
      // Find the specific iframe
      const targetIframe = containerRef.current?.querySelector(`iframe[data-page-id="${nextAction.pageId}"]`) as HTMLIFrameElement;
      const targetDoc = targetIframe?.contentDocument || targetIframe?.contentWindow?.document;
      const targetArtboard = targetDoc?.getElementById('artboard');
      
      if (!targetArtboard || !targetDoc) {
        redoStack.push(nextAction);
        return;
      }

      // Save current state to Undo stack before applying Redo
      globalUndoStackRef.current.push({
        pageId: nextAction.pageId,
        html: targetArtboard.innerHTML
      });

      // Apply the redo HTML
      targetArtboard.innerHTML = nextAction.html;
      
      selectElement(null);
      if (nextAction.pageId === pageId) {
        notifyContentChanged();
      } else {
        updatePageFrameRef.current(nextAction.pageId, {
          thumbnailHtml: nextAction.html,
          isDirty: true,
        });
      }

      const tree = buildDomTree(targetDoc);
      setDomTreeRef.current(tree);
    };

    // --- テキスト編集状態 ---
    let isEditing = false;

    // ===== 4. マウスダウン（選択 + ドラッグ開始 + リサイズハンドル） =====
    iframeDoc.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;

      // --- テキスト編集中は通常のマウスイベントを許可 ---
      if (isEditing) {
        // 編集中要素の外側クリックで編集終了
        if (selectedEl && !selectedEl.contains(target)) {
          selectedEl.contentEditable = 'false';
          selectedEl.classList.remove('editing');
          isEditing = false;
          saveSnapshot();
          notifyContentChanged();
          const info = extractElementInfo(selectedEl, iframeDoc);
          if (info) setSelectedElementRef.current(info);
        }
        return;
      }

      // --- selection-box内（breadcrumb等）のクリックはスキップ ---
      if (target.closest('.selection-box') && !target.getAttribute('data-handle')) {
        return;
      }

      // --- 描画ツールが有効な場合はselection/dragをスキップ ---
      const drawingTools = ['rectangle', 'ellipse', 'line', 'arrow', 'pen', 'pencil', 'frame', 'text'];
      if (drawingTools.includes(activeToolRef.current)) {
        wireIframeToRefs();
        // useDrawingModeにイベント処理を委譲（preventDefault/stopPropagationしない）
        return;
      }

      // --- リサイズ/回転ハンドル ---
      const handle = target.getAttribute('data-handle');
      if (handle && selectedEl) {
        e.preventDefault();
        e.stopPropagation();

        const rect = selectedEl.getBoundingClientRect();
        const computedLeft = parseFloat(selectedEl.style.left) || 0;
        const computedTop = parseFloat(selectedEl.style.top) || 0;
        const computedStyle = iframeDoc.defaultView?.getComputedStyle(selectedEl);

        if (handle.startsWith('rotate-')) {
          const transform = selectedEl.style.transform || '';
          const rotateMatch = transform.match(/rotate\(([^)]+)deg\)/);
          const currentRotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

          resizeState = {
            isResizing: false, isRotating: true, element: selectedEl, handle,
            startX: e.clientX, startY: e.clientY,
            origLeft: computedLeft, origTop: computedTop,
            origWidth: rect.width, origHeight: rect.height,
            origRadius: 0, rotation: currentRotation, rotationStartAngle: startAngle,
            centerX, centerY,
          };
          iframeDoc.body.classList.add('rotating');
        } else {
          resizeState = {
            isResizing: true, isRotating: false, element: selectedEl, handle,
            startX: e.clientX, startY: e.clientY,
            origLeft: computedLeft, origTop: computedTop,
            origWidth: rect.width, origHeight: rect.height,
            origRadius: parseInt(computedStyle?.borderRadius || '0') || 0,
            rotation: 0, rotationStartAngle: 0, centerX: 0, centerY: 0,
          };
        }
        return;
      }

      // --- 要素選択 + ドラッグ開始 ---
      // ページフォーカス切替（レイヤーパネル・CSS/JS・設定を正しいページに同期）
      if (viewStateRef.current.activePageId !== pageId) {
        focusPageRef.current(pageId);
      }
      // PAGE_FOCUSED: レイヤーパネル用DOMツリー構築
      wireIframeToRefs();
      const tree = buildDomTree(iframeDoc);
      setDomTreeRef.current(tree);
      const firstLevelIds = new Set<string>(tree.map(n => n.id));
      setExpandedNodesRef.current(firstLevelIds);

      const isMeta = e.ctrlKey || e.metaKey;

      // 既に選択済みの要素内をクリック（Ctrl/Cmd未押下時）→ 再選択せずドラッグ開始
      // Ctrl/Cmd押下時は子要素選択を優先
      let dragTarget: HTMLElement;
      if (!isMeta && selectedEl && (selectedEl === target || selectedEl.contains(target))) {
        e.preventDefault();
        e.stopPropagation();
        dragTarget = selectedEl;
      } else {
        // Ctrl/Cmd+クリック: 子要素を直接選択
        // 通常クリック: トップレベル要素（#artboard直下）を選択
        let selectable: HTMLElement | null;
        if (isMeta) {
          selectable = target.closest('[data-element-id]') as HTMLElement | null;
          if (selectable && selectable.id === 'artboard') selectable = null;
        } else {
          selectable = target.closest('#artboard > [data-element-id]') as HTMLElement | null;
        }
        if (!selectable) {
          selectElement(null);
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        selectElement(selectable);
        dragTarget = selectable;
      }

      // DOM変更前のスナップショット保存（undo用）
      saveSnapshot();

      if (layoutModeRef.current === 'auto') {
        // Auto-layout: ドラッグ状態のみ設定（ghost は mousemove で作成）
        dragState = {
          element: dragTarget,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: 0,
          origTop: 0,
          isDragging: true,
          hasMoved: false,
          autoLayoutDragMode: true,
          autoLayoutState: null,
          originalParent: dragTarget.parentElement,
          currentDropTarget: null,
          dropPosition: null,
          dropIndex: -1,
        };
      } else {
        // Absolute: ドラッグ準備（絶対配置モード時）
        const cs = iframeDoc.defaultView?.getComputedStyle(dragTarget);
        let computedLeft = parseFloat(dragTarget.style.left) || 0;
        let computedTop = parseFloat(dragTarget.style.top) || 0;
        if (cs?.position === 'static') {
          dragTarget.style.position = 'relative';
          computedLeft = 0;
          computedTop = 0;
        }

        dragState = {
          element: dragTarget,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: computedLeft,
          origTop: computedTop,
          isDragging: true,
          hasMoved: false,
          autoLayoutDragMode: false,
          autoLayoutState: null,
          originalParent: null,
          currentDropTarget: null,
          dropPosition: null,
          dropIndex: -1,
        };
      }
    });

    // ===== 5. マウスムーブ（ドラッグ移動 + リサイズ + 回転） =====
    iframeDoc.addEventListener('mousemove', (e) => {
      // --- 回転 ---
      if (resizeState.isRotating && resizeState.element) {
        const currentAngle = Math.atan2(
          e.clientY - resizeState.centerY,
          e.clientX - resizeState.centerX
        ) * (180 / Math.PI);
        const angleDelta = currentAngle - resizeState.rotationStartAngle;
        const newRotation = resizeState.rotation + angleDelta;
        const existingTransform = resizeState.element.style.transform || '';
        const scaleMatch = existingTransform.match(/scale\(([^)]+)\)/);
        const scaleValue = scaleMatch ? scaleMatch[0] : '';
        resizeState.element.style.transform = `rotate(${newRotation}deg) ${scaleValue}`.trim();
        updateSelectionBox(iframeDoc, resizeState.element);
        return;
      }

      // --- リサイズ ---
      if (resizeState.isResizing && resizeState.element) {
        const deltaX = e.clientX - resizeState.startX;
        const deltaY = e.clientY - resizeState.startY;
        const el = resizeState.element;
        const h = resizeState.handle;
        let newLeft = resizeState.origLeft;
        let newTop = resizeState.origTop;
        let newWidth = resizeState.origWidth;
        let newHeight = resizeState.origHeight;
        const minSize = 10;

        if (h === 'radius') {
          const maxRadius = Math.min(resizeState.origWidth, resizeState.origHeight) / 2;
          const newRadius = Math.max(0, Math.min(maxRadius, resizeState.origRadius - deltaX - deltaY));
          el.style.borderRadius = `${newRadius}px`;
          updateSelectionBox(iframeDoc, el);
          return;
        }

        switch (h) {
          case 'nw': newWidth = Math.max(minSize, resizeState.origWidth - deltaX); newHeight = Math.max(minSize, resizeState.origHeight - deltaY); newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth); newTop = resizeState.origTop + (resizeState.origHeight - newHeight); break;
          case 'n': newHeight = Math.max(minSize, resizeState.origHeight - deltaY); newTop = resizeState.origTop + (resizeState.origHeight - newHeight); break;
          case 'ne': newWidth = Math.max(minSize, resizeState.origWidth + deltaX); newHeight = Math.max(minSize, resizeState.origHeight - deltaY); newTop = resizeState.origTop + (resizeState.origHeight - newHeight); break;
          case 'e': newWidth = Math.max(minSize, resizeState.origWidth + deltaX); break;
          case 'se': newWidth = Math.max(minSize, resizeState.origWidth + deltaX); newHeight = Math.max(minSize, resizeState.origHeight + deltaY); break;
          case 's': newHeight = Math.max(minSize, resizeState.origHeight + deltaY); break;
          case 'sw': newWidth = Math.max(minSize, resizeState.origWidth - deltaX); newHeight = Math.max(minSize, resizeState.origHeight + deltaY); newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth); break;
          case 'w': newWidth = Math.max(minSize, resizeState.origWidth - deltaX); newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth); break;
        }

        const cs = iframeDoc.defaultView?.getComputedStyle(el);
        if (cs?.position !== 'absolute' && cs?.position !== 'fixed') {
          el.style.position = 'absolute';
        }
        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
        el.style.width = `${newWidth}px`;
        el.style.height = `${newHeight}px`;
        updateSelectionBox(iframeDoc, el);
        return;
      }

      // --- ドラッグ移動 ---
      if (dragState.isDragging && dragState.element) {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          if (dragState.autoLayoutDragMode) {
            // Auto-layout: Ghost clone ドラッグ
            if (!dragState.hasMoved) {
              dragState.hasMoved = true;
              // scale=1: iframe内は1:1、外側CSSトランスフォームがズーム担当
              dragState.autoLayoutState = startAutoLayoutDrag(dragState.element, iframeDoc, 1);
              removeSelectionBox(iframeDoc);
            }
            if (dragState.autoLayoutState) {
              updateDragPosition(dragState.autoLayoutState, e.clientX, e.clientY);
              const dropInfo = findDropTarget(iframeDoc, e.clientX, e.clientY, dragState.element);
              if (dropInfo) {
                showDropIndicator(iframeDoc, dropInfo, dragState.element);
                dragState.currentDropTarget = dropInfo.container;
                dragState.dropPosition = dropInfo.position;
                dragState.dropIndex = dropInfo.index;
              } else {
                hideFlexDropIndicator(iframeDoc);
                dragState.currentDropTarget = null;
                dragState.dropPosition = null;
                dragState.dropIndex = -1;
              }
            }
          } else {
            // Absolute: 既存の left/top ドラッグ
            dragState.hasMoved = true;
            dragState.element.classList.add('dragging');
            dragState.element.style.left = `${dragState.origLeft + dx}px`;
            dragState.element.style.top = `${dragState.origTop + dy}px`;
            updateSelectionBox(iframeDoc, dragState.element);
          }
        }
      }
    });

    // ===== 6. マウスアップ =====
    iframeDoc.addEventListener('mouseup', () => {
      // 回転終了
      if (resizeState.isRotating && resizeState.element) {
        iframeDoc.body.classList.remove('rotating');
        notifyContentChanged();
        const info = extractElementInfo(resizeState.element, iframeDoc);
        if (info) setSelectedElementRef.current(info);
      }
      // リサイズ終了
      else if (resizeState.isResizing && resizeState.element) {
        notifyContentChanged();
        const info = extractElementInfo(resizeState.element, iframeDoc);
        if (info) setSelectedElementRef.current(info);
      }

      resizeState = {
        isResizing: false, isRotating: false, element: null, handle: '',
        startX: 0, startY: 0, origLeft: 0, origTop: 0,
        origWidth: 0, origHeight: 0, origRadius: 0,
        rotation: 0, rotationStartAngle: 0, centerX: 0, centerY: 0,
      };

      // ドラッグ終了
      if (dragState.isDragging && dragState.element) {
        if (dragState.autoLayoutDragMode && dragState.autoLayoutState) {
          // Auto-layout ドラッグ終了
          const autoState = dragState.autoLayoutState;

          // ドロップ先を構築（artboard内のみ許可）
          let dropInfo: DropTargetInfo | null = null;
          if (dragState.currentDropTarget && dragState.dropPosition !== null) {
            const artboard = iframeDoc.getElementById('artboard');
            const isValidDrop = dragState.currentDropTarget === artboard ||
              (artboard && artboard.contains(dragState.currentDropTarget));
            if (isValidDrop) {
              dropInfo = {
                container: dragState.currentDropTarget,
                position: dragState.dropPosition as 'before' | 'after' | 'inside',
                index: dragState.dropIndex,
                referenceElement: null,
              };
            }
          }

          const domChanged = endAutoLayoutDrag(autoState, dropInfo, iframeDoc);
          if (domChanged) {
            notifyContentChanged();
            const tree = buildDomTree(iframeDoc);
            setDomTreeRef.current(tree);
          }

          // 選択ボックス更新（DOM安定後）
          const droppedElement = dragState.element;
          setTimeout(() => {
            if (droppedElement) {
              updateSelectionBox(iframeDoc, droppedElement);
              const info = extractElementInfo(droppedElement, iframeDoc);
              if (info) setSelectedElementRef.current(info);
            }
          }, 0);
        } else {
          // Absolute: 既存のドラッグ終了
          dragState.element.classList.remove('dragging');
          if (dragState.hasMoved) {
            notifyContentChanged();
            // プロパティパネル更新
            const info = extractElementInfo(dragState.element, iframeDoc);
            if (info) setSelectedElementRef.current(info);
          }
        }
      }
      dragState = {
        element: null, startX: 0, startY: 0,
        origLeft: 0, origTop: 0, isDragging: false, hasMoved: false,
        autoLayoutDragMode: false, autoLayoutState: null,
        originalParent: null, currentDropTarget: null,
        dropPosition: null, dropIndex: -1,
      };
    });

    // ===== 7. キーボードショートカット =====
    iframeDoc.addEventListener('keydown', (e) => {
      // テキスト編集中はEscape以外のショートカットを無効化
      if (isEditing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (selectedEl) {
            selectedEl.contentEditable = 'false';
            selectedEl.classList.remove('editing');
            isEditing = false;
            saveSnapshot();
            notifyContentChanged();
            updateSelectionBox(iframeDoc, selectedEl);
            const info = extractElementInfo(selectedEl, iframeDoc);
            if (info) setSelectedElementRef.current(info);
          }
        }
        return;
      }

      const isMeta = e.ctrlKey || e.metaKey;

      // Undo (per-iframe DOM snapshot)
      if (isMeta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
        return;
      }
      // Redo (per-iframe DOM snapshot)
      if (isMeta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        performRedo();
        return;
      }

      if (!selectedEl) return;

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        saveSnapshot();
        const el = selectedEl;
        selectElement(null);
        el.remove();
        notifyContentChanged();
        // DOMツリー再構築
        const tree = buildDomTree(iframeDoc);
        setDomTreeRef.current(tree);
        return;
      }

      // Arrow keys (nudge)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        const cs = iframeDoc.defaultView?.getComputedStyle(selectedEl);
        if (cs?.position === 'static') selectedEl.style.position = 'relative';
        const cl = parseFloat(selectedEl.style.left) || 0;
        const ct = parseFloat(selectedEl.style.top) || 0;
        if (e.key === 'ArrowLeft') selectedEl.style.left = `${cl - n}px`;
        if (e.key === 'ArrowRight') selectedEl.style.left = `${cl + n}px`;
        if (e.key === 'ArrowUp') selectedEl.style.top = `${ct - n}px`;
        if (e.key === 'ArrowDown') selectedEl.style.top = `${ct + n}px`;
        updateSelectionBox(iframeDoc, selectedEl);
        notifyContentChanged();
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        // 進行中のオートレイアウトドラッグをキャンセル
        if (dragState.autoLayoutDragMode && dragState.autoLayoutState) {
          cancelAutoLayoutDrag(dragState.autoLayoutState, iframeDoc);
          dragState = {
            element: null, startX: 0, startY: 0,
            origLeft: 0, origTop: 0, isDragging: false, hasMoved: false,
            autoLayoutDragMode: false, autoLayoutState: null,
            originalParent: null, currentDropTarget: null,
            dropPosition: null, dropIndex: -1,
          };
        }
        selectElement(null);
        return;
      }

      // Duplicate (Ctrl+D)
      if (isMeta && e.key === 'd') {
        e.preventDefault();
        saveSnapshot();
        const clone = selectedEl.cloneNode(true) as HTMLElement;
        // 新しいIDを付与
        let idCounter = iframeDoc.querySelectorAll('[data-element-id]').length;
        clone.setAttribute('data-element-id', 'el-' + (idCounter++));
        const assignNewIds = (parent: Element) => {
          Array.from(parent.children).forEach(child => {
            if (child.nodeType === 1 && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') {
              (child as HTMLElement).setAttribute('data-element-id', 'el-' + (idCounter++));
              assignNewIds(child);
            }
          });
        };
        assignNewIds(clone);
        // オフセット配置
        const left = parseFloat(clone.style.left) || 0;
        const top = parseFloat(clone.style.top) || 0;
        clone.style.left = `${left + 20}px`;
        clone.style.top = `${top + 20}px`;
        clone.classList.remove('selected');
        selectedEl.parentElement?.appendChild(clone);
        selectElement(clone);
        notifyContentChanged();
        const tree = buildDomTree(iframeDoc);
        setDomTreeRef.current(tree);
        return;
      }
    });

    // ===== 8. リンクナビゲーション防止 =====
    iframeDoc.addEventListener('click', (e) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (anchor) e.preventDefault();
    }, true);

    // ===== 8.5 コンテキストメニュー（右クリック） =====
    iframeDoc.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // テキスト編集中はスキップ
      if (isEditing) return;

      // ページフォーカス切替
      if (viewStateRef.current.activePageId !== pageId) {
        focusPageRef.current(pageId);
        wireIframeToRefs();
      }

      const target = e.target as HTMLElement;

      // 右クリックされた要素を選択（選択済み要素の内部なら維持）
      if (!target.closest('.selection-box')) {
        const isInsideSelected = selectedEl && (selectedEl === target || selectedEl.contains(target) || target.contains(selectedEl));
        if (!isInsideSelected) {
          const selectable = target.closest('#artboard > [data-element-id]') as HTMLElement | null;
          if (selectable) {
            wireIframeToRefs();
            selectElement(selectable);
          }
        }
      }

      // スクリーン座標を計算（iframe内座標 → 親ウィンドウ座標）
      const iframeRect = iframe.getBoundingClientRect();
      const scaleX = iframeRect.width / (iframe.clientWidth || 1);
      const scaleY = iframeRect.height / (iframe.clientHeight || 1);

      window.parent.postMessage({
        type: 'IFRAME_CONTEXT_MENU',
        clientX: iframeRect.left + e.clientX * scaleX,
        clientY: iframeRect.top + e.clientY * scaleY,
      }, '*');
    });

    // ===== 9. ダブルクリックでテキスト編集（選択済み要素のみ） =====
    iframeDoc.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.selection-box')) return;

      // ページフォーカス切替
      if (viewStateRef.current.activePageId !== pageId) {
        focusPageRef.current(pageId);
        wireIframeToRefs();
      }

      // data-element-idを持つ最も近い要素を検索
      const editable = target.closest('[data-element-id]') as HTMLElement | null;
      if (!editable || editable.id === 'artboard') return;

      // 選択済み要素、またはその親要素が選択済みの場合のみ編集モードに入る
      if (!selectedEl || (editable !== selectedEl && !selectedEl.contains(editable) && !editable.contains(selectedEl))) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // スナップショット保存（編集前状態）
      saveSnapshot();

      // 編集対象を決定（selectedElの子孫をダブルクリックした場合はその要素を編集）
      const editTarget = editable.contains(selectedEl) ? selectedEl : editable;
      selectElement(editTarget);
      selectedEl = editTarget;

      // contentEditable有効化
      editTarget.contentEditable = 'true';
      editTarget.classList.add('editing');
      editTarget.classList.remove('selected');
      isEditing = true;

      // selection boxを非表示（テキスト選択と干渉するため）
      removeSelectionBox(iframeDoc);

      // フォーカスしてカーソル配置
      editTarget.focus();

      // ダブルクリック位置にカーソルを配置
      const selection = iframeDoc.defaultView?.getSelection();
      if (selection) {
        const range = iframeDoc.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (range) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    // ===== 10. 描画ツール用: マウスが入った時にiframeを事前ワイヤリング =====
    iframeDoc.addEventListener('pointerenter', () => {
      const dTools = ['rectangle', 'ellipse', 'line', 'arrow', 'pen', 'pencil', 'frame', 'text'];
      if (dTools.includes(activeToolRef.current)) {
        if (viewStateRef.current.activePageId !== pageId) {
          focusPageRef.current(pageId);
        }
        wireIframeToRefs();
      }
    });

    // ===== 11. 初期DOMツリー構築 =====
    setTimeout(() => {
      wireIframeToRefs();
      const tree = buildDomTree(iframeDoc);
      setDomTreeRef.current(tree);
      const firstLevelIds = new Set<string>(tree.map(n => n.id));
      setExpandedNodesRef.current(firstLevelIds);
    }, 600);
  }, [refs]);

  // ===== 描画ツール: 全iframeのbody classを同期 =====
  useEffect(() => {
    const drawingTools = ['rectangle', 'ellipse', 'line', 'arrow', 'pen', 'pencil', 'frame'];
    const isDrawing = drawingTools.includes(activeTool);
    const isText = activeTool === 'text';

    for (const [, iframe] of iframeMapRef.current) {
      const doc = iframe.contentDocument;
      if (!doc?.body) continue;

      doc.body.classList.remove(
        'draw-mode', 'text-mode', 'move-mode',
        'tool-rectangle', 'tool-ellipse', 'tool-line', 'tool-arrow',
        'tool-pen', 'tool-pencil', 'tool-text', 'tool-frame'
      );

      if (isDrawing) {
        doc.body.classList.add('draw-mode', `tool-${activeTool}`);
      } else if (isText) {
        doc.body.classList.add('text-mode', 'tool-text');
      }
    }
  }, [activeTool]);

  // ===== ホイール転送メッセージ処理 =====
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // ホイール転送 → キャンバスズーム/パン
      if (e.data?.type === 'PAGE_PREVIEW_WHEEL') {
        const container = containerRef.current;
        if (!container) return;

        const vs = viewStateRef.current;
        const co = vs.canvasOffset;
        const cz = vs.canvasZoom;

        if (e.data.ctrlKey || e.data.metaKey) {
          const rect = container.getBoundingClientRect();
          const mouseX = rect.width / 2;
          const mouseY = rect.height / 2;

          const delta = -(e.data.deltaY || 0);
          const factor = delta > 0 ? 1.05 : 0.95;
          const newZoom = Math.max(0.02, Math.min(2.0, cz * factor));

          setCanvasZoom(newZoom);
          setCanvasOffset({
            x: mouseX - (mouseX - co.x) * (newZoom / cz),
            y: mouseY - (mouseY - co.y) * (newZoom / cz),
          });
        } else {
          setCanvasOffset({
            x: co.x - (e.data.deltaX || 0),
            y: co.y - (e.data.deltaY || 0),
          });
        }
      }

      // タッチ転送 → ピンチズーム
      if (e.data?.type === 'PAGE_PREVIEW_TOUCH' && e.data.touchType === 'move') {
        const container = containerRef.current;
        if (!container) return;
        const touches = e.data.touches;
        const prevTouches = e.data.prevTouches;
        if (!touches || touches.length < 2 || !prevTouches || prevTouches.length < 2) return;

        const vs = viewStateRef.current;
        const co = vs.canvasOffset;
        const cz = vs.canvasZoom;

        // ピンチ距離計算
        const prevDist = Math.hypot(
          prevTouches[0].clientX - prevTouches[1].clientX,
          prevTouches[0].clientY - prevTouches[1].clientY
        );
        const currDist = Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY
        );
        if (prevDist === 0) return;

        const scale = currDist / prevDist;
        const newZoom = Math.max(0.02, Math.min(2.0, cz * scale));

        const rect = container.getBoundingClientRect();
        const centerX = (touches[0].clientX + touches[1].clientX) / 2 - rect.left;
        const centerY = (touches[0].clientY + touches[1].clientY) / 2 - rect.top;

        setCanvasZoom(newZoom);
        setCanvasOffset({
          x: centerX - (centerX - co.x) * (newZoom / cz),
          y: centerY - (centerY - co.y) * (newZoom / cz),
        });
      }

      // breadcrumb-select: パンくずクリックで要素選択
      if (e.data?.type === 'breadcrumb-select' && e.data.elementId) {
        for (const [, iframe] of iframeMapRef.current) {
          if (e.source === iframe.contentWindow) {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc) break;
            const targetEl = iframeDoc.querySelector(`[data-element-id="${e.data.elementId}"]`) as HTMLElement;
            if (targetEl) {
              // 既存の選択を解除
              const existingSelected = iframeDoc.querySelector('.selected');
              if (existingSelected) existingSelected.classList.remove('selected');
              removeSelectionBox(iframeDoc);
              // 新しい要素を選択
              targetEl.classList.add('selected');
              updateSelectionBox(iframeDoc, targetEl);
              // refs更新 + パネル更新
              (refs.iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
              refs.setIframeReady(true);
              const info = extractElementInfo(targetEl, iframeDoc);
              if (info) {
                setSelectedElementRef.current(info);
                setSelectedElementIdsRef.current([info.id]);
              }
            }
            break;
          }
        }
      }

      // 描画ツール/画像アップロード後のページフレーム同期
      if (e.data?.type === 'DOM_TREE_UPDATED') {
        const currentIframe = (refs.iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current;
        if (currentIframe) {
          for (const [pid, ifr] of iframeMapRef.current) {
            if (ifr === currentIframe) {
              const doc = ifr.contentDocument;
              if (doc) {
                const artboard = doc.getElementById('artboard');
                if (artboard) {
                  updatePageFrameRef.current(pid, {
                    thumbnailHtml: artboard.innerHTML,
                    isDirty: true,
                  });
                }
              }
              break;
            }
          }
        }
      }

      // コンテンツ高さ通知
      if (e.data?.type === 'PAGE_CONTENT_HEIGHT') {
        const { pageId, height } = e.data;
        if (pageId && typeof height === 'number' && height > 0) {
          const existingPage = pagesRef.current.find(p => p.id === pageId);
          if (existingPage && Math.abs(existingPage.size.height - height) > 10) {
            updatePageFrame(pageId, { size: { width: existingPage.size.width, height } });
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setCanvasZoom, setCanvasOffset, updatePageFrame, refs]);

  // スペースキーでiframeのpointer-eventsを一時無効化（パンモード）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const container = containerRef.current;
        if (!container) return;
        container.querySelectorAll('iframe').forEach(iframe => {
          (iframe as HTMLElement).style.pointerEvents = 'none';
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const container = containerRef.current;
        if (!container) return;
        container.querySelectorAll('iframe').forEach(iframe => {
          (iframe as HTMLElement).style.pointerEvents = '';
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      className="absolute inset-0 overflow-hidden select-none overscroll-none"
      style={{ backgroundColor: '#1a1a1a', touchAction: 'none', overscrollBehavior: 'none' }}
    >
      {/* ドットグリッド背景 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
          backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px`,
          backgroundPosition: `${canvasOffset.x % (24 * canvasZoom)}px ${canvasOffset.y % (24 * canvasZoom)}px`,
        }}
      />

      {/* CSS transform 無限キャンバス */}
      <div
        className="canvas-transform-layer"
        style={{
          transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasZoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {/*
          * イベントキャプチャ用オーバーレイ
          * ズームやスクロール中にiframeをまたぐとイベントが途切れる問題を防ぐため、
          * ホイールやタッチ操作中のみポインターイベントを横取りする
          */}
        <div
          className="absolute inset-x-0 inset-y-0 z-50 transition-opacity duration-150"
          style={{
            pointerEvents: isInteracting ? 'auto' : 'none',
            opacity: 0
          }}
        />

        {/* 全ページ: 同時編集可能 */}
        {pages.map(page => (
          <div
            key={page.id}
            className="absolute"
            style={{
              left: page.position.x,
              top: page.position.y,
              width: page.size.width,
              height: page.size.height,
            }}
          >
            <PageLabel
              title={page.title}
              isDirty={page.isDirty}
            />

            <div className="w-full h-full bg-white rounded-sm shadow-lg overflow-hidden">
              <PageLivePreview
                html={page.thumbnailHtml}
                pageId={page.id}
                onIframeLoad={handlePageIframeLoad}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ズームコントロール */}
      <CanvasZoomControls />

      {/* ページ数表示 */}
      <div className="absolute top-4 left-4 z-10 text-xs text-gray-500 select-none">
        {pages.length} pages
      </div>
    </div>
  );
});
