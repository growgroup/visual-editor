'use client';

/**
 * EditorUIStateContext
 *
 * エディタのUI状態を管理するContext
 * 変更頻度: 中〜高（DOMツリー、パネル状態、マーキー等）
 *
 * 含まれる状態:
 * - domTree: DOMツリー構造
 * - searchQuery: レイヤー検索クエリ
 * - expandedNodes: 展開されたノードのSet
 * - openSections: プロパティパネルのセクション開閉状態
 * - marqueeState: マーキー選択状態
 * - restoreFocus: フォーカス復元関数
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { DOMTreeNode, PanelSections, MarqueeState } from '../types';
import { DEFAULT_PANEL_SECTIONS } from '../constants';
import { debugLog } from '../utils/debug';

export interface EditorUIStateContextValue {
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

  // マーキー選択
  marqueeState: MarqueeState;
  setMarqueeState: React.Dispatch<React.SetStateAction<MarqueeState>>;

  // フォーカス管理
  restoreFocus: () => void;
}

const EditorUIStateContext = createContext<EditorUIStateContextValue | null>(null);

export function useEditorUIState(): EditorUIStateContextValue {
  const context = useContext(EditorUIStateContext);
  if (!context) {
    throw new Error('useEditorUIState must be used within EditorUIStateProvider');
  }
  return context;
}

interface EditorUIStateProviderProps {
  // フォーカス復元用のgetIframeDoc関数
  getIframeDoc: () => Document | null;
  children: React.ReactNode;
}

export function EditorUIStateProvider({
  getIframeDoc,
  children,
}: EditorUIStateProviderProps) {
  // DOMツリー
  const [domTree, setDomTree] = useState<DOMTreeNode[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // パネル状態
  const [openSections, setOpenSections] = useState<PanelSections>(DEFAULT_PANEL_SECTIONS);

  // マーキー選択状態
  const [marqueeState, setMarqueeState] = useState<MarqueeState>({
    isActive: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // フォーカス復元（ショートカットが効かなくなる問題対策）
  const restoreFocus = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      debugLog('[EditorUIStateContext] restoreFocus: iframe doc not available');
      return;
    }

    // テキスト編集中の要素があればそこにフォーカス
    const editingElement = iframeDoc.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editingElement) {
      editingElement.focus();
      debugLog('[EditorUIStateContext] restoreFocus: focused editing element');
      return;
    }

    // iframeのbodyにフォーカスを設定
    if (iframeDoc.body) {
      iframeDoc.body.focus();
      debugLog('[EditorUIStateContext] restoreFocus: focused iframe body');
    }
  }, [getIframeDoc]);

  const value: EditorUIStateContextValue = {
    domTree,
    setDomTree,
    searchQuery,
    setSearchQuery,
    expandedNodes,
    setExpandedNodes,
    openSections,
    setOpenSections,
    marqueeState,
    setMarqueeState,
    restoreFocus,
  };

  return (
    <EditorUIStateContext.Provider value={value}>
      {children}
    </EditorUIStateContext.Provider>
  );
}
