/**
 * コンテキストメニュー処理フック
 * - 右クリックイベントの処理
 * - 座標変換（iframe → 親ウィンドウ）
 * - 要素の自動選択
 */

import { useCallback, useRef, useEffect, MutableRefObject } from 'react';
import { useEditorContext } from '../EditorContext';
import { updateSelectionBox } from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';

interface UseContextMenuHandlerOptions {
  /** 編集可能要素を取得する関数 */
  getEditableElement: (target: EventTarget | null, iframeDoc: Document) => HTMLElement | null;
  /** コンテンツ高さのref */
  contentHeightRef: MutableRefObject<number>;
}

interface UseContextMenuHandlerReturn {
  /**
   * iframe ドキュメントにコンテキストメニューリスナーをセットアップ
   * @returns クリーンアップ関数
   */
  setupContextMenuListener: (iframeDoc: Document) => () => void;
}

/**
 * コンテキストメニュー処理フック
 */
export function useContextMenuHandler(
  options: UseContextMenuHandlerOptions
): UseContextMenuHandlerReturn {
  const {
    iframeRef,
    editorMode,
    selectedElementIds,
    setSelectedElementIds,
  } = useEditorContext();

  const { getEditableElement, contentHeightRef } = options;

  // クロージャ問題回避のためのref
  const editorModeRef = useRef(editorMode);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const setSelectedElementIdsRef = useRef(setSelectedElementIds);

  // refを最新値に同期
  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
    setSelectedElementIdsRef.current = setSelectedElementIds;
  }, [selectedElementIds, setSelectedElementIds]);

  /**
   * 要素情報を親ウィンドウに送信
   */
  const sendElementInfo = useCallback((element: HTMLElement, iframeDoc: Document) => {
    const info = extractElementInfo(element, iframeDoc);
    if (info) {
      window.postMessage({ type: 'ELEMENT_SELECTED', element: info }, '*');
    }
  }, []);

  const setupContextMenuListener = useCallback(
    (iframeDoc: Document) => {
      const iframe = iframeRef.current;

      /**
       * コンテキストメニューイベントハンドラ
       */
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();

        // iframe内のクリック位置を親ウィンドウの座標系に変換
        const iframeRect = iframe?.getBoundingClientRect();
        if (!iframeRect) return;

        // iframe の座標 → 親の座標。iframe 要素が外側の transform で縮んでいる
        // (マルチフレームのキャンバス)ときは実測の矩形と内寸の比で掛ける。単独表示では 1
        const outerScale = iframeRect.width / (iframe!.clientWidth || iframeRect.width) || 1;
        const x = iframeRect.left + e.clientX * outerScale;
        const y = iframeRect.top + e.clientY * outerScale;

        // 要素がクリックされた場合は選択
        const element = getEditableElement(e.target, iframeDoc);
        if (element) {
          const elementId = element.getAttribute('data-element-id') || '';
          const currentIds = selectedElementIdsRef.current;

          // Check if clicked element is inside any currently selected element
          // If so, keep the current selection (don't change to child element)
          const clickedTarget = e.target as HTMLElement;
          const isInsideSelectedElement = currentIds.some((selectedId) => {
            const selectedElement = iframeDoc.querySelector(
              `[data-element-id="${selectedId}"]`
            );
            return selectedElement?.contains(clickedTarget);
          });

          // まだ選択されていない場合かつ選択要素の内部でない場合のみ選択
          if (
            !isInsideSelectedElement &&
            !currentIds.includes(elementId) &&
            !element.classList.contains('selected')
          ) {
            iframeDoc
              .querySelectorAll('.selected')
              .forEach((sel) => sel.classList.remove('selected'));
            iframeDoc
              .querySelectorAll('.selection-box')
              .forEach((box) => box.remove());
            element.classList.add('selected');
            updateSelectionBox(iframeDoc, element);
            setSelectedElementIdsRef.current([elementId]);
            sendElementInfo(element, iframeDoc);
          }
        }

        // 親ウィンドウにコンテキストメニューイベントを送信
        window.postMessage(
          {
            type: 'IFRAME_CONTEXT_MENU',
            clientX: x,
            clientY: y,
          },
          '*'
        );
      };

      // イベントリスナーを登録
      iframeDoc.addEventListener('contextmenu', handleContextMenu);

      // クリーンアップ関数を返す
      return () => {
        iframeDoc.removeEventListener('contextmenu', handleContextMenu);
      };
    },
    [iframeRef, getEditableElement, contentHeightRef, sendElementInfo]
  );

  return {
    setupContextMenuListener,
  };
}
