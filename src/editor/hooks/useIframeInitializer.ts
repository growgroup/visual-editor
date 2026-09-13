'use client';

/**
 * iframeの初期化を管理するHook
 */

import { useEffect, useCallback, useRef } from 'react';
import { useEditorContext } from '../EditorContext';
import { EDITOR_IFRAME_STYLES, SLIDE_WIDTH, SLIDE_HEIGHT } from '../constants';
import {
  convertToAbsolutePositioning,
  buildDomTree,
  updateSelectionBox,
  removeSelectionBox,
  getIframeElement,
  getArtboardContent,
} from '../utils/dom-utils';
import { generateEditableHtml } from '../utils/html-utils';
import { extractElementInfo } from '../utils/style-utils';
import { debugLog } from '../utils/debug';

/**
 * iframeの初期化とイベントハンドラ設定を行うHook
 */
export function useIframeInitializer() {
  const {
    iframeRef,
    html,
    setHtml,
    isUndoRedoRef,
    iframeHtmlRef,
    activeTool,
    setSelectedElement,
    selectedElement,
    pushHistory,
    getIframeDoc,
    editorMode,
  } = useEditorContext();

  // ズームフィット計算
  const { containerRef, setFitZoom, setZoom, zoom } = useEditorContext();

  // ズーム値をrefで追跡（イベントハンドラ内で使用するため）
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const calculateFitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 100;

    const containerRect = container.getBoundingClientRect();
    const padding = 64;
    const availableWidth = containerRect.width - padding;
    const availableHeight = containerRect.height - padding;

    const scaleX = availableWidth / SLIDE_WIDTH;
    const scaleY = availableHeight / SLIDE_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    return Math.floor(scale * 100);
  }, [containerRef]);

  // 初期化時とウィンドウリサイズ時にフィットズームを計算
  useEffect(() => {
    const updateFitZoom = () => {
      const newFitZoom = calculateFitZoom();
      setFitZoom(newFitZoom);
      setZoom(newFitZoom);
    };

    const timer = setTimeout(updateFitZoom, 100);
    window.addEventListener('resize', updateFitZoom);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateFitZoom);
    };
  }, [calculateFitZoom, setFitZoom, setZoom]);

  // iframe初期化
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      // iframeがまだマウントされていない場合、次のレンダリングを待つ
      return;
    }

    const handleLoad = () => {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      // スタイルを注入
      const style = iframeDoc.createElement('style');
      style.textContent = EDITOR_IFRAME_STYLES;
      iframeDoc.head.appendChild(style);

      // ドラッグ状態
      let dragState = {
        element: null as HTMLElement | null,
        startX: 0,
        startY: 0,
        origLeft: 0,
        origTop: 0,
        isDragging: false,
        hasMoved: false,
      };

      // リサイズ状態
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
        // 回転用の追加プロパティ
        rotation: 0,
        rotationStartAngle: 0,
        centerX: 0,
        centerY: 0,
      };

      // 要素情報を親に送信
      const sendElementInfo = (element: HTMLElement) => {
        const info = extractElementInfo(element, iframeDoc);
        if (info) {
          window.postMessage({ type: 'ELEMENT_SELECTED', element: info }, '*');
        }
      };

      // リサイズ/回転ハンドルのマウスダウン
      iframeDoc.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        const handle = target.getAttribute('data-handle');
        const elementId = target.getAttribute('data-element-id');

        if (!handle || !elementId) return;

        // data-editable="true"を追加してリサイズハンドル自体を選択しないようにする
        const element = iframeDoc.querySelector(`[data-editable="true"][data-element-id="${elementId}"]`) as HTMLElement;
        if (!element) return;

        e.preventDefault();
        e.stopPropagation();

        const style = iframeDoc.defaultView?.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        const computedLeft = parseFloat(element.style.left) || 0;
        const computedTop = parseFloat(element.style.top) || 0;

        // ズームスケールを考慮（getBoundingClientRectはスケール後の値を返す）
        const scale = zoomRef.current / 100;
        const actualWidth = rect.width / scale;
        const actualHeight = rect.height / scale;

        // 回転ハンドルの場合
        if (handle.startsWith('rotate-')) {
          // 現在の回転角度を取得
          const transform = element.style.transform || '';
          const rotateMatch = transform.match(/rotate\(([^)]+)deg\)/);
          const currentRotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;

          // 要素の中心点を計算
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          // マウス位置から中心への初期角度を計算
          const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

          resizeState = {
            isResizing: false,
            isRotating: true,
            element,
            handle,
            startX: e.clientX,
            startY: e.clientY,
            origLeft: computedLeft,
            origTop: computedTop,
            origWidth: actualWidth,
            origHeight: actualHeight,
            origRadius: 0,
            rotation: currentRotation,
            rotationStartAngle: startAngle,
            centerX,
            centerY,
          };

          iframeDoc.body.classList.add('rotating');
          return;
        }

        // 通常のリサイズハンドルの場合
        resizeState = {
          isResizing: true,
          isRotating: false,
          element,
          handle,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: computedLeft,
          origTop: computedTop,
          origWidth: actualWidth,
          origHeight: actualHeight,
          origRadius: parseInt(style?.borderRadius || '0') || 0,
          rotation: 0,
          rotationStartAngle: 0,
          centerX: 0,
          centerY: 0,
        };
      });

      // リサイズ/回転中のマウス移動
      iframeDoc.addEventListener('mousemove', (e) => {
        // 回転中の処理
        if (resizeState.isRotating && resizeState.element) {
          const element = resizeState.element;

          // 現在のマウス位置から中心への角度を計算
          const currentAngle = Math.atan2(
            e.clientY - resizeState.centerY,
            e.clientX - resizeState.centerX
          ) * (180 / Math.PI);

          // 回転差分を計算
          const angleDelta = currentAngle - resizeState.rotationStartAngle;
          const newRotation = resizeState.rotation + angleDelta;

          // 既存のスケール値を維持しつつ回転を適用
          const existingTransform = element.style.transform || '';
          const scaleMatch = existingTransform.match(/scale\(([^)]+)\)/);
          const scaleValue = scaleMatch ? scaleMatch[0] : '';

          element.style.transform = `rotate(${newRotation}deg) ${scaleValue}`.trim();
          updateSelectionBox(iframeDoc, element);
          return;
        }

        if (!resizeState.isResizing || !resizeState.element) return;

        const deltaX = e.clientX - resizeState.startX;
        const deltaY = e.clientY - resizeState.startY;
        const element = resizeState.element;
        const handle = resizeState.handle;

        let newLeft = resizeState.origLeft;
        let newTop = resizeState.origTop;
        let newWidth = resizeState.origWidth;
        let newHeight = resizeState.origHeight;

        if (handle === 'radius') {
          const maxRadius = Math.min(resizeState.origWidth, resizeState.origHeight) / 2;
          const newRadius = Math.max(0, Math.min(maxRadius, resizeState.origRadius - deltaX - deltaY));
          element.style.borderRadius = `${newRadius}px`;
          updateSelectionBox(iframeDoc, element);
          return;
        }

        const minSize = 10;

        switch (handle) {
          case 'nw':
            newWidth = Math.max(minSize, resizeState.origWidth - deltaX);
            newHeight = Math.max(minSize, resizeState.origHeight - deltaY);
            newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth);
            newTop = resizeState.origTop + (resizeState.origHeight - newHeight);
            break;
          case 'n':
            newHeight = Math.max(minSize, resizeState.origHeight - deltaY);
            newTop = resizeState.origTop + (resizeState.origHeight - newHeight);
            break;
          case 'ne':
            newWidth = Math.max(minSize, resizeState.origWidth + deltaX);
            newHeight = Math.max(minSize, resizeState.origHeight - deltaY);
            newTop = resizeState.origTop + (resizeState.origHeight - newHeight);
            break;
          case 'e':
            newWidth = Math.max(minSize, resizeState.origWidth + deltaX);
            break;
          case 'se':
            newWidth = Math.max(minSize, resizeState.origWidth + deltaX);
            newHeight = Math.max(minSize, resizeState.origHeight + deltaY);
            break;
          case 's':
            newHeight = Math.max(minSize, resizeState.origHeight + deltaY);
            break;
          case 'sw':
            newWidth = Math.max(minSize, resizeState.origWidth - deltaX);
            newHeight = Math.max(minSize, resizeState.origHeight + deltaY);
            newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth);
            break;
          case 'w':
            newWidth = Math.max(minSize, resizeState.origWidth - deltaX);
            newLeft = resizeState.origLeft + (resizeState.origWidth - newWidth);
            break;
        }

        const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);
        if (computedStyle?.position !== 'absolute' && computedStyle?.position !== 'fixed') {
          element.style.position = 'absolute';
        }

        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;

        updateSelectionBox(iframeDoc, element);
      });

      // リサイズ/回転終了
      iframeDoc.addEventListener('mouseup', () => {
        // 回転終了
        if (resizeState.isRotating && resizeState.element) {
          iframeDoc.body.classList.remove('rotating');
          window.postMessage({
            type: 'SLIDE_CONTENT_CHANGED',
            html: getArtboardContent(iframeDoc),
          }, '*');
          sendElementInfo(resizeState.element);
        }
        // リサイズ終了
        else if (resizeState.isResizing && resizeState.element) {
          window.postMessage({
            type: 'SLIDE_CONTENT_CHANGED',
            html: getArtboardContent(iframeDoc),
          }, '*');
          sendElementInfo(resizeState.element);
        }
        resizeState = {
          isResizing: false,
          isRotating: false,
          element: null,
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
      });

      // 編集可能要素のクリック/ドラッグ
      iframeDoc.querySelectorAll('[data-editable="true"]').forEach((el) => {
        const element = el as HTMLElement;

        element.addEventListener('mousedown', (e) => {
          const bodyClasses = iframeDoc.body.classList;
          if (bodyClasses.contains('draw-mode') || bodyClasses.contains('text-mode') || bodyClasses.contains('comment-mode')) return;
          if (element.getAttribute('contenteditable') === 'true') return;

          e.preventDefault();
          e.stopPropagation();

          iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
          element.classList.add('selected');

          updateSelectionBox(iframeDoc, element);

          let computedLeft = parseFloat(element.style.left) || 0;
          let computedTop = parseFloat(element.style.top) || 0;

          const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);
          if (computedStyle?.position !== 'absolute' && computedStyle?.position !== 'fixed') {
            const rect = element.getBoundingClientRect();
            const parent = element.parentElement;

            if (parent && parent !== iframeDoc.body) {
              const parentStyle = iframeDoc.defaultView?.getComputedStyle(parent);
              if (parentStyle?.position === 'static') {
                parent.style.position = 'relative';
              }
              const parentRect = parent.getBoundingClientRect();
              const parentBorderLeft = parseFloat(parentStyle?.borderLeftWidth || '0') || 0;
              const parentBorderTop = parseFloat(parentStyle?.borderTopWidth || '0') || 0;
              computedLeft = rect.left - (parentRect.left + parentBorderLeft);
              computedTop = rect.top - (parentRect.top + parentBorderTop);
            } else {
              const bodyRect = iframeDoc.body.getBoundingClientRect();
              computedLeft = rect.left - bodyRect.left;
              computedTop = rect.top - bodyRect.top;
            }

            element.style.position = 'absolute';
            element.style.left = `${computedLeft}px`;
            element.style.top = `${computedTop}px`;
            element.style.width = `${rect.width}px`;
            element.style.height = `${rect.height}px`;
            element.style.margin = '0';
          }

          dragState = {
            element,
            startX: e.clientX,
            startY: e.clientY,
            origLeft: computedLeft,
            origTop: computedTop,
            isDragging: true,
            hasMoved: false,
          };

          sendElementInfo(element);
        });
      });

      // ドラッグ中の移動
      iframeDoc.addEventListener('mousemove', (e) => {
        if (!dragState.isDragging || !dragState.element || resizeState.isResizing) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaY = e.clientY - dragState.startY;

        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          dragState.hasMoved = true;
          dragState.element.classList.add('dragging');
        }

        const newLeft = dragState.origLeft + deltaX;
        const newTop = dragState.origTop + deltaY;

        dragState.element.style.left = `${newLeft}px`;
        dragState.element.style.top = `${newTop}px`;

        updateSelectionBox(iframeDoc, dragState.element);
      });

      // ドラッグ終了
      iframeDoc.addEventListener('mouseup', () => {
        if (dragState.isDragging && dragState.element) {
          dragState.element.classList.remove('dragging');

          if (dragState.hasMoved) {
            window.postMessage({
              type: 'SLIDE_CONTENT_CHANGED',
              html: getArtboardContent(iframeDoc),
            }, '*');
          }
          sendElementInfo(dragState.element);
        }

        dragState = {
          element: null,
          startX: 0,
          startY: 0,
          origLeft: 0,
          origTop: 0,
          isDragging: false,
          hasMoved: false,
        };
      });

      // 背景クリックで選択解除
      iframeDoc.body.addEventListener('click', (e) => {
        if (e.target === iframeDoc.body) {
          iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
          removeSelectionBox(iframeDoc);
          window.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
        }
      });

      // <a>タグのナビゲーションを防止（エディタ内ではリンクを開かない）
      iframeDoc.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (anchor) {
          e.preventDefault();
        }
      }, true); // キャプチャフェーズで処理

      // DOMツリーを初期化
      setTimeout(() => {
        window.postMessage({
          type: 'DOM_TREE_UPDATED',
          tree: buildDomTree(iframeDoc),
        }, '*');
      }, 100);

      // 絶対配置への変換（fonts.ready後）
      const initAbsolutePositioning = async () => {
        try {
          if (iframeDoc.fonts && iframeDoc.fonts.ready) {
            await iframeDoc.fonts.ready;
          }
          // 少し追加で待機（レイアウト安定のため）
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // [開いた時に一括で絶対配置へ倒す]
          // 1要素ずつ倒す方式は、倒した瞬間にその要素が流れから抜け、
          // 未選択の兄弟が詰め上がって版面が動く(選択・リサイズで実害が出た)。
          // 編集中に流れの中にいる要素を無くしておけば、以後どう触っても他は動かない。
          // 採寸は offsetLeft/offsetTop で全要素まとめて行うので、変換の前後で見た目は変わらない。
          // 絶対配置へ倒すのはスライド(固定キャンバス)のための最適化。
          // Webページは流し込み(フロー)レイアウトで、可変パディングや flex カラムが
          // そのまま次工程の入力になる。倒すと版面が固定ピクセルに固まり、
          // 別の幅で崩れ、デザインツールへの取り込みで意味を失う。
          if (editorMode !== 'webpage') {
            const count = convertToAbsolutePositioning(iframeDoc);
            debugLog('[Editor] 絶対配置へ変換:', count, '要素');
          }

          // 変更を通知
          window.postMessage({
            type: 'SLIDE_CONTENT_CHANGED',
            html: getArtboardContent(iframeDoc),
          }, '*');
        } catch (err) {
          console.error('[Editor] Error converting to absolute positioning:', err);
        }
      };

      initAbsolutePositioning();
    };

    iframe.addEventListener('load', handleLoad);

    const blob = new Blob([generateEditableHtml(html, editorMode)], { type: 'text/html' });
    iframe.src = URL.createObjectURL(blob);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      if (iframe.src.startsWith('blob:')) {
        URL.revokeObjectURL(iframe.src);
      }
    };
  }, []);

  // Undo/Redo時のiframe同期
  // 注: EditorContext.tsxにも同様の処理があるが、タイミングの問題で両方必要
  // キャンバス構造を保持するため、#artboard.innerHTMLのみを更新
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      const iframeDoc = getIframeDoc();
      if (iframeDoc && html !== iframeHtmlRef.current) {
        // #artboardの中身のみを更新（キャンバス構造は保持）
        const artboard = iframeDoc.getElementById('artboard');
        if (artboard) {
          artboard.innerHTML = html;
        } else {
          // フォールバック
          iframeDoc.body.innerHTML = html;
        }
        iframeHtmlRef.current = html;
        // フォーカスを復元してショートカットが引き続き機能するようにする
        requestAnimationFrame(() => {
          if (iframeDoc.body) {
            iframeDoc.body.focus();
          }
        });
      }
    }
  }, [html, getIframeDoc, isUndoRedoRef, iframeHtmlRef]);

  // モード変更をiframeに直接適用
  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc?.body) {
      iframeDoc.body.classList.remove(
        'move-mode', 'draw-mode', 'text-mode', 'comment-mode',
        'tool-rectangle', 'tool-ellipse', 'tool-line', 'tool-arrow',
        'tool-pen', 'tool-pencil', 'tool-text', 'tool-frame'
      );

      if (activeTool === 'move') {
        iframeDoc.body.classList.add('move-mode');
      } else if (['rectangle', 'ellipse', 'line', 'arrow', 'pen', 'pencil', 'frame'].includes(activeTool)) {
        iframeDoc.body.classList.add('draw-mode', `tool-${activeTool}`);
      } else if (activeTool === 'text') {
        iframeDoc.body.classList.add('text-mode', 'tool-text');
      } else if (activeTool === 'comment') {
        iframeDoc.body.classList.add('comment-mode');
      }
    }
  }, [activeTool, getIframeDoc]);
}
