'use client';

/**
 * EditorRefsContext
 *
 * エディタのRef関連を管理するContext
 * 変更頻度: 極低（初期化後は変更なし）
 *
 * 含まれる状態:
 * - iframeRef: iframeのRef
 * - containerRef: コンテナのRef
 * - clipboardRef: クリップボードデータのRef
 * - styleClipboardRef: スタイルクリップボードのRef
 * - iframeHtmlRef: iframeのHTML状態のRef
 * - isUndoRedoRef: Undo/Redo実行中フラグ
 * - drawingStateRef: 描画状態のRef
 * - getIframeDoc: iframeドキュメント取得ヘルパー
 */

import React, { createContext, useContext, useRef, useCallback, useState, MutableRefObject } from 'react';
import type { ClipboardData, DrawingState, StyleClipboard } from '../types';

// スタイルクリップボードをモジュールレベルで保持（スライド間で共有するため）
let globalStyleClipboard: StyleClipboard | null = null;

// グローバルスタイルクリップボードへのRef-likeアクセサ
export const globalStyleClipboardRef = {
  get current() {
    return globalStyleClipboard;
  },
  set current(value: StyleClipboard | null) {
    globalStyleClipboard = value;
  },
};

/**
 * 最後に使用したスタイル（Figmaスタイル継承用）
 * 要素タイプごとにスタイルを保持
 */
export interface LastUsedStyles {
  // 図形（rectangle, ellipse, frame）用
  shape: {
    backgroundColor: string;
    borderRadius: string;
    borderColor: string;
    borderWidth: string;
    borderStyle: string;
    opacity: string;
  };
  // テキスト用
  text: {
    color: string;
    fontSize: string;
    fontFamily: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    textAlign: string;
  };
  // 線・矢印用
  line: {
    stroke: string;
    strokeWidth: string;
  };
}

// デフォルトのスタイル
const defaultLastUsedStyles: LastUsedStyles = {
  shape: {
    backgroundColor: '#3B82F6',
    borderRadius: '4px',
    borderColor: 'transparent',
    borderWidth: '0',
    borderStyle: 'solid',
    opacity: '1',
  },
  text: {
    color: '#1F2937',
    fontSize: '16px',
    fontFamily: 'inherit',
    fontWeight: '400',
    lineHeight: '1.5',
    letterSpacing: '0',
    textAlign: 'left',
  },
  line: {
    stroke: '#1F2937',
    strokeWidth: '2',
  },
};

// 最後に使用したスタイルをモジュールレベルで保持
let globalLastUsedStyles: LastUsedStyles = { ...defaultLastUsedStyles };

// グローバル最後使用スタイルへのRef-likeアクセサ
export const globalLastUsedStylesRef = {
  get current() {
    return globalLastUsedStyles;
  },
  set current(value: LastUsedStyles) {
    globalLastUsedStyles = value;
  },
  // 部分更新用ヘルパー
  updateShape(styles: Partial<LastUsedStyles['shape']>) {
    globalLastUsedStyles = {
      ...globalLastUsedStyles,
      shape: { ...globalLastUsedStyles.shape, ...styles },
    };
  },
  updateText(styles: Partial<LastUsedStyles['text']>) {
    globalLastUsedStyles = {
      ...globalLastUsedStyles,
      text: { ...globalLastUsedStyles.text, ...styles },
    };
  },
  updateLine(styles: Partial<LastUsedStyles['line']>) {
    globalLastUsedStyles = {
      ...globalLastUsedStyles,
      line: { ...globalLastUsedStyles.line, ...styles },
    };
  },
};

export interface EditorRefsContextValue {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  clipboardRef: MutableRefObject<ClipboardData | null>;
  styleClipboardRef: typeof globalStyleClipboardRef;
  lastUsedStylesRef: typeof globalLastUsedStylesRef;
  iframeHtmlRef: MutableRefObject<string>;
  isUndoRedoRef: MutableRefObject<boolean>;
  drawingStateRef: MutableRefObject<DrawingState>;
  getIframeDoc: () => Document | null;
  /** iframeが読み込み完了したかどうか */
  iframeReady: boolean;
  /** iframeの読み込み完了状態をセット */
  setIframeReady: (ready: boolean) => void;
}

const EditorRefsContext = createContext<EditorRefsContextValue | null>(null);

export function useEditorRefs(): EditorRefsContextValue {
  const context = useContext(EditorRefsContext);
  if (!context) {
    throw new Error('useEditorRefs must be used within EditorRefsProvider');
  }
  return context;
}

interface EditorRefsProviderProps {
  initialHtml: string;
  children: React.ReactNode;
}

export function EditorRefsProvider({
  initialHtml,
  children,
}: EditorRefsProviderProps) {
  // Refs
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<ClipboardData | null>(null);
  const styleClipboardRef = globalStyleClipboardRef;
  const iframeHtmlRef = useRef<string>(initialHtml);
  const isUndoRedoRef = useRef<boolean>(false);
  const drawingStateRef = useRef<DrawingState>({
    isDrawing: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    previewElement: null,
    points: [],
  });

  // iframeの読み込み完了状態
  const [iframeReady, setIframeReady] = useState(false);

  // iframeドキュメント取得
  const getIframeDoc = useCallback(() => {
    const iframe = iframeRef.current;
    return iframe?.contentDocument || iframe?.contentWindow?.document || null;
  }, []);

  const value: EditorRefsContextValue = {
    iframeRef,
    containerRef,
    clipboardRef,
    styleClipboardRef,
    lastUsedStylesRef: globalLastUsedStylesRef,
    iframeHtmlRef,
    isUndoRedoRef,
    drawingStateRef,
    getIframeDoc,
    iframeReady,
    setIframeReady,
  };

  return (
    <EditorRefsContext.Provider value={value}>
      {children}
    </EditorRefsContext.Provider>
  );
}
