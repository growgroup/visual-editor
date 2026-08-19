'use client';

/**
 * EditorDocumentContext
 *
 * エディタのドキュメント/HTML状態を管理するContext
 * 変更頻度: 中（編集操作時）
 *
 * 含まれる状態:
 * - originalHtml: 初期HTML（変更検知用）
 * - hasChanges: 変更があるかどうか
 * - saving: 保存中フラグ
 * - layoutMode: レイアウトモード（absolute/auto）
 * - showLayoutHint: レイアウトヒント表示
 * - autoLayoutHtml: オートレイアウトHTML
 */

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface EditorDocumentContextValue {
  // 基本状態
  originalHtml: string;
  /**
   * iframeを組み立てる「源」。ページ切替(initialHtmlプロップ)でのみ変わる。
   * originalHtml は変更判定の基準として initLayout が上書きするため、
   * これをiframe構築に使うと 変換→基準更新→再構築→変換… の無限ループになる
   */
  sourceHtml: string;
  /**
   * 変更判定の基準を差し替える。エディタは開いた直後に絶対位置変換を行うため、
   * 変換後のHTMLを基準にし直さないと「開いただけで未保存の変更あり」になる
   */
  setOriginalHtml: (html: string) => void;
  hasChanges: boolean;
  saving: boolean;
  setSaving: (saving: boolean) => void;

  // レイアウトモード
  layoutMode: 'absolute' | 'auto';
  setLayoutMode: (mode: 'absolute' | 'auto') => void;
  showLayoutHint: boolean;
  setShowLayoutHint: (show: boolean) => void;
  autoLayoutHtml: string | null;
  setAutoLayoutHtml: (html: string | null) => void;
}

const EditorDocumentContext = createContext<EditorDocumentContextValue | null>(null);

export function useEditorDocument(): EditorDocumentContextValue {
  const context = useContext(EditorDocumentContext);
  if (!context) {
    throw new Error('useEditorDocument must be used within EditorDocumentProvider');
  }
  return context;
}

interface EditorDocumentProviderProps {
  initialHtml: string;
  currentHtml: string; // EditorHistoryContextからのhtml
  initialLayoutMode?: 'absolute' | 'auto';
  children: React.ReactNode;
}

export function EditorDocumentProvider({
  initialHtml,
  currentHtml,
  initialLayoutMode = 'auto',
  children,
}: EditorDocumentProviderProps) {
  // 基本状態
  const [originalHtml, setOriginalHtml] = useState(initialHtml);
  const [saving, setSaving] = useState(false);

  // ページ切替時にoriginalHtmlを更新（hasChanges・resetが正しく動作するように）
  useEffect(() => {
    setOriginalHtml(initialHtml);
  }, [initialHtml]);

  // [モード廃止] レイアウトモードは常に 'absolute'。
  // 「オートレイアウト/絶対配置」という二重モードはFigmaに無い概念で、
  // 同じ操作(ドラッグ・矢印キー)がモードによって別の意味を持つ根本原因になっていた。
  // 位置の扱いはモードではなく **要素自身の position** で判定する。
  // in-flow の要素は最初に動かした時点でその要素だけを絶対配置へ変換する(遅延変換)。
  const [layoutMode, setLayoutMode] = useState<'absolute' | 'auto'>('absolute');
  const [showLayoutHint, setShowLayoutHint] = useState(false);
  const [autoLayoutHtml, setAutoLayoutHtml] = useState<string | null>(null);

  // [モード廃止] 親からの initialLayoutMode は無視する(常に absolute)

  // 変更追跡
  const hasChanges = currentHtml !== originalHtml;

  const value: EditorDocumentContextValue = {
    originalHtml,
    sourceHtml: initialHtml,
    setOriginalHtml,
    hasChanges,
    saving,
    setSaving,
    layoutMode,
    setLayoutMode,
    showLayoutHint,
    setShowLayoutHint,
    autoLayoutHtml,
    setAutoLayoutHtml,
  };

  return (
    <EditorDocumentContext.Provider value={value}>
      {children}
    </EditorDocumentContext.Provider>
  );
}
