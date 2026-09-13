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

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { DOMTreeNode } from '../types';

/**
 * ページ切替の通知。戻り値に false(または false に解決する Promise)を返すと
 * 「移れなかった」として扱う(マルチフレームのキャンバスが activatePage の結果に使う)
 */
export type ContentChangeHandler = (contentId: string) => void | boolean | Promise<boolean | void>;

// コンテンツリスト用の軽量型（スライド、ページ、コンポーネント等で共用）
export interface ContentListItem {
  id: string;
  title: string;
  /** 表示順序（スライド番号、ページ番号等） */
  order: number;
  thumbnailHtml?: string;
  /**
   * 親ページの id(サイトマップの階層)。渡すと、マルチフレームのキャンバスが
   * フレームを階層のツリー(親の下に子を並べる)で配置し、左パネルの一覧も段を付ける。
   * 無ければ(全ページ null / undefined)従来どおり行で折り返す
   */
  parentId?: string | null;
  /** 編集しない表示(ページそのもの・ビューア)の URL。渡すとフレーム名と一覧に「別タブで開く」が付く */
  href?: string;
  /**
   * ページ全体を写した画像(PNG / JPEG)の URL。幅は 480px 以上、縦横比はページと同じ。
   * マルチフレームのキャンバスが大きく縮小されている間(倍率 0.5 未満)は、見るだけの紙面を
   * srcdoc の iframe ではなくこの画像で描く(26 枚の iframe をラスタライズし直さずに済む)。
   * 内容が変わったら URL も変える(`&v=…`)。変わると紙面が読み直す。
   * 渡さないページ・画像が読めなかったページは、今までどおり iframe で描く
   */
  thumbnail?: string;
  /**
   * 本文の版。利用側でファイルが外から変わったとき(部品の一括反映・CLI・他の人の編集)に
   * 数を進めると、キャンバスの見るだけの紙面がそのページを読み直す。編集中のページには効かない
   * (編集中の本文は上書きしない)
   */
  revision?: number;
}

/**
 * 文書に付ける属性(`<html>` の属性)。生きているエディタと見るだけの紙面の両方の文書に、
 * 読み直さずに反映する。利用側の CSS が `html[data-…]` で切り替える表示(構成ラフの
 * 注釈カラムの表示・非表示など)に使う。値が null / undefined の属性は外す
 */
export type DocumentAttributes = Record<string, string | null | undefined>;

/** contentList の parentId から各ページの深さ(ルート = 0)を求める。親が一覧に無い・循環しているものはルート扱い */
export function computeContentDepths(list: readonly ContentListItem[]): Map<string, number> {
  const byId = new Map(list.map((c) => [c.id, c] as const));
  const depths = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = depths.get(id);
    if (cached != null) return cached;
    const item = byId.get(id);
    const parent = item?.parentId;
    let d = 0;
    if (parent && parent !== id && byId.has(parent) && !seen.has(parent)) {
      seen.add(id);
      d = depthOf(parent, seen) + 1;
    }
    depths.set(id, d);
    return d;
  };
  list.forEach((c) => depthOf(c.id, new Set()));
  return depths;
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
  onContentChange: ContentChangeHandler | null;
  /** 文書(`<html>`)に付ける属性。エディタと見るだけの紙面の両方に、読み直さずに反映する */
  documentAttributes: DocumentAttributes;

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
  onContentChange?: ContentChangeHandler;
  documentAttributes?: DocumentAttributes;
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
  documentAttributes: documentAttributesProp,
  slides: slidesProp,
  currentSlideId: currentSlideIdProp,
  onSlideChange: onSlideChangeProp,
  children,
}: EditorArtboardProviderProps) {
  // Support deprecated props
  const contentList = contentListProp ?? slidesProp ?? [];
  const currentContentId = currentContentIdProp ?? currentSlideIdProp ?? null;
  const onContentChange = onContentChangeProp ?? onSlideChangeProp ?? null;
  // 属性は中身で比べる(利用側が毎描画で新しいオブジェクトを渡しても、購読側を描き直さない)
  const documentAttributesKey = JSON.stringify(documentAttributesProp ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const documentAttributes = useMemo<DocumentAttributes>(() => ({ ...(documentAttributesProp ?? {}) }), [documentAttributesKey]);

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
    documentAttributes,
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
