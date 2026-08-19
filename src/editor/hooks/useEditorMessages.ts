'use client';

/**
 * エディタのpostMessage通信を管理するHook
 */

import { useEffect } from 'react';
import { useEditorContext } from '../EditorContext';
import { buildDomTree, updateSelectionBox } from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import type { DOMTreeNode } from '../types';

/**
 * postMessageの受信と処理を行うHook
 */
export function useEditorMessages() {
  const {
    pushHistory,
    selectedElement,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
    setActiveTool,
    setDomTree,
    setExpandedNodes,
    iframeHtmlRef,
    getIframeDoc,
  } = useEditorContext();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // コンテンツ変更
      if (event.data?.type === 'SLIDE_CONTENT_CHANGED') {
        const newHtml = event.data.html;
        iframeHtmlRef.current = newHtml;
        // pushHistoryは内部でhtmlの状態も更新するので、setHtmlは不要
        // setHtmlを先に呼ぶと、pushHistoryで「同じHTML」と判定されて履歴に追加されない
        pushHistory(newHtml, selectedElement?.id);
      }

      // 要素選択
      if (event.data?.type === 'ELEMENT_SELECTED') {
        setSelectedElement(event.data.element);
      }

      // 要素選択解除
      if (event.data?.type === 'ELEMENT_DESELECTED') {
        setSelectedElement(null);
      }

      // ツール完了（描画後にselectに戻る）
      if (event.data?.type === 'TOOL_FINISHED') {
        setActiveTool('select');
      }

      // DOMツリー更新
      if (event.data?.type === 'DOM_TREE_UPDATED') {
        console.log('[EditorMessages] DOM_TREE_UPDATED received:', event.data.tree?.length, 'nodes');
        if (event.data.tree && Array.isArray(event.data.tree)) {
          setDomTree(event.data.tree);
          // 初期状態で最初のレベルを展開
          const firstLevelIds = new Set<string>(
            event.data.tree.map((n: DOMTreeNode) => n.id)
          );
          setExpandedNodes(firstLevelIds);
        }
      }

      // DOMツリー再構築リクエスト（undo/redo後など）
      if (event.data?.type === 'REQUEST_DOM_TREE_UPDATE') {
        const iframeDoc = getIframeDoc();
        if (iframeDoc) {
          const tree = buildDomTree(iframeDoc);
          console.log('[EditorMessages] Rebuilt DOM tree:', tree.length, 'nodes');
          setDomTree(tree);
        }
      }

      // パンくずリストからの要素選択は useElementSelection の selectSingle が受ける。
      // ここで独自にDOMを触ると、あちらが持つ選択状態(selectionContextRef)と食い違い、
      // 次の操作で元の要素へ戻ってしまう(親を選べない不具合の原因だった)。
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    pushHistory,
    selectedElement?.id,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
    setActiveTool,
    setDomTree,
    setExpandedNodes,
    iframeHtmlRef,
    getIframeDoc,
  ]);
}

/**
 * postMessageを送信するヘルパー関数
 */
export function postEditorMessage(
  type: string,
  data?: Record<string, unknown>
) {
  window.postMessage({ type, ...data }, '*');
}
