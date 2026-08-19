'use client';

/**
 * EditorArtboardContext
 *
 * エディタのアートボード管理を行うContext
 * 変更頻度: 低（アートボード切り替え時）
 *
 * 含まれる状態:
 * - artboardStates: アートボードごとの状態Map
 * - activeArtboardId: アクティブなアートボードID
 * - setActiveArtboard: アートボード切り替え（状態保存・復元付き）
 * - getArtboardState/updateArtboardState: 状態取得・更新
 * - contentList: コンテンツリスト（スライド、ページ等）
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { DOMTreeNode } from '../types';

// コンテンツリスト用の軽量型（スライド、ページ、コンポーネント等で共用）
export interface ContentListItem {
  id: string;
  title: string;
  /** 表示順序（スライド番号、ページ番号等） */
  order: number;
  thumbnailHtml?: string;
}

// アートボード（スライド/ページ）ごとの状態
export interface ArtboardState {
  id: string;
  zoom: number;
  scrollPosition: { x: number; y: number };
  selectedElementIds: string[];
  domTree: DOMTreeNode[];
  expandedNodes: Set<string>;
  html: string;
}

export interface EditorArtboardContextValue {
  // アートボード状態管理
  artboardStates: Map<string, ArtboardState>;
  activeArtboardId: string | null;
  setActiveArtboard: (id: string) => void;
  getArtboardState: (id: string) => ArtboardState | undefined;
  updateArtboardState: (id: string, updates: Partial<ArtboardState>) => void;

  // コンテンツリスト
  contentList: ContentListItem[];
  currentContentId: string | null;
  onContentChange: ((contentId: string) => void) | null;

  // Deprecated aliases
  /** @deprecated Use contentList instead */
  slides: ContentListItem[];
  /** @deprecated Use currentContentId instead */
  currentSlideId: string | null;
  /** @deprecated Use onContentChange instead */
  onSlideChange: ((slideId: string) => void) | null;
}

const EditorArtboardContext = createContext<EditorArtboardContextValue | null>(null);

export function useEditorArtboard(): EditorArtboardContextValue {
  const context = useContext(EditorArtboardContext);
  if (!context) {
    throw new Error('useEditorArtboard must be used within EditorArtboardProvider');
  }
  return context;
}

interface EditorArtboardProviderProps {
  contentList?: ContentListItem[];
  currentContentId?: string;
  onContentChange?: (contentId: string) => void;
  // 状態同期用のコールバック（ファサードで設定）
  onArtboardSwitch?: (
    newId: string,
    currentState: {
      zoom: number;
      selectedElementIds: string[];
      domTree: DOMTreeNode[];
      expandedNodes: Set<string>;
      html: string;
    }
  ) => {
    zoom: number;
    selectedElementIds: string[];
    domTree: DOMTreeNode[];
    expandedNodes: Set<string>;
    html: string;
  } | null;
  // Deprecated props
  /** @deprecated Use contentList instead */
  slides?: ContentListItem[];
  /** @deprecated Use currentContentId instead */
  currentSlideId?: string;
  /** @deprecated Use onContentChange instead */
  onSlideChange?: (slideId: string) => void;
  children: React.ReactNode;
}

export function EditorArtboardProvider({
  contentList: contentListProp,
  currentContentId: currentContentIdProp,
  onContentChange: onContentChangeProp,
  slides: slidesProp,
  currentSlideId: currentSlideIdProp,
  onSlideChange: onSlideChangeProp,
  children,
}: EditorArtboardProviderProps) {
  // Support deprecated props
  const contentList = contentListProp ?? slidesProp ?? [];
  const currentContentId = currentContentIdProp ?? currentSlideIdProp ?? null;
  const onContentChange = onContentChangeProp ?? onSlideChangeProp ?? null;

  // Deprecated aliases
  const slides = contentList;
  const currentSlideId = currentContentId;
  const onSlideChange = onContentChange;

  // アートボード状態管理（contentListから初期状態を同期的に生成）
  const [artboardStates, setArtboardStates] = useState<Map<string, ArtboardState>>(() => {
    const initialStates = new Map<string, ArtboardState>();
    contentList.forEach(content => {
      initialStates.set(content.id, {
        id: content.id,
        zoom: 100,
        scrollPosition: { x: 0, y: 0 },
        selectedElementIds: [],
        domTree: [],
        expandedNodes: new Set(),
        html: content.thumbnailHtml || '',
      });
    });
    return initialStates;
  });
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(currentContentId);

  // アートボード状態取得
  const getArtboardState = useCallback((id: string): ArtboardState | undefined => {
    return artboardStates.get(id);
  }, [artboardStates]);

  // アートボード状態更新
  const updateArtboardState = useCallback((id: string, updates: Partial<ArtboardState>) => {
    setArtboardStates(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(id);
      if (existing) {
        newMap.set(id, { ...existing, ...updates });
      } else {
        newMap.set(id, {
          id,
          zoom: 100,
          scrollPosition: { x: 0, y: 0 },
          selectedElementIds: [],
          domTree: [],
          expandedNodes: new Set(),
          html: '',
          ...updates,
        });
      }
      return newMap;
    });
  }, []);

  // アクティブアートボード切り替え
  // 注: 状態保存・復元はファサード（EditorProvider）で行う
  const setActiveArtboard = useCallback((id: string) => {
    setActiveArtboardId(id);

    // コンテンツ変更コールバックを呼び出し
    if (onContentChange && id !== currentContentId) {
      onContentChange(id);
    }
  }, [onContentChange, currentContentId]);

  // コンテンツリストが変わったときにアートボード状態を初期化
  useEffect(() => {
    const newStates = new Map<string, ArtboardState>();
    contentList.forEach(content => {
      const existing = artboardStates.get(content.id);
      if (existing) {
        newStates.set(content.id, existing);
      } else {
        newStates.set(content.id, {
          id: content.id,
          zoom: 100,
          scrollPosition: { x: 0, y: 0 },
          selectedElementIds: [],
          domTree: [],
          expandedNodes: new Set(),
          html: content.thumbnailHtml || '',
        });
      }
    });
    setArtboardStates(newStates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentList]); // artboardStatesは意図的に依存配列から除外（無限ループ防止）

  // currentContentIdが変わったときにactiveArtboardIdを同期
  useEffect(() => {
    if (currentContentId && currentContentId !== activeArtboardId) {
      setActiveArtboardId(currentContentId);
    }
  }, [currentContentId, activeArtboardId]);

  const value: EditorArtboardContextValue = {
    artboardStates,
    activeArtboardId,
    setActiveArtboard,
    getArtboardState,
    updateArtboardState,
    contentList,
    currentContentId,
    onContentChange,
    // Deprecated
    slides,
    currentSlideId,
    onSlideChange,
  };

  return (
    <EditorArtboardContext.Provider value={value}>
      {children}
    </EditorArtboardContext.Provider>
  );
}
