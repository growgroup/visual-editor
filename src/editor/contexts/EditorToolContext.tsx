'use client';

/**
 * EditorToolContext
 *
 * エディタのツール状態を管理するContext
 * 変更頻度: 低（ツール切り替え時のみ）
 *
 * 含まれる状態:
 * - activeTool: 現在選択されているツール
 * - editorMode: エディタモード（slide/webpage）
 */

import React, { createContext, useContext, useState } from 'react';
import type { EditorTool } from '../types';

/** エディタモード: スライド（16:9固定）またはWebページ（可変高さ） */
export type EditorMode = 'slide' | 'webpage';

export interface EditorToolContextValue {
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  editorMode: EditorMode;
}

const EditorToolContext = createContext<EditorToolContextValue | null>(null);

export function useEditorTool(): EditorToolContextValue {
  const context = useContext(EditorToolContext);
  if (!context) {
    throw new Error('useEditorTool must be used within EditorToolProvider');
  }
  return context;
}

interface EditorToolProviderProps {
  editorMode?: EditorMode;
  children: React.ReactNode;
}

export function EditorToolProvider({
  editorMode = 'slide',
  children,
}: EditorToolProviderProps) {
  const [activeTool, setActiveTool] = useState<EditorTool>('select');

  const value: EditorToolContextValue = {
    activeTool,
    setActiveTool,
    editorMode,
  };

  return (
    <EditorToolContext.Provider value={value}>
      {children}
    </EditorToolContext.Provider>
  );
}
