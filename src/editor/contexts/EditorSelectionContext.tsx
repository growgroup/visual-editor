'use client';

/**
 * EditorSelectionContext
 *
 * エディタの選択状態を管理するContext
 * 変更頻度: 高（ユーザー操作で頻繁に変更）
 *
 * 含まれる状態:
 * - selectedElement: 選択された要素の詳細情報
 * - selectedElementIds: 選択された要素のID配列（複数選択対応）
 */

import React, { createContext, useContext, useState } from 'react';
import type { SelectedElementInfo } from '../types';

export interface EditorSelectionContextValue {
  selectedElement: SelectedElementInfo | null;
  setSelectedElement: (element: SelectedElementInfo | null) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
}

const EditorSelectionContext = createContext<EditorSelectionContextValue | null>(null);

export function useEditorSelection(): EditorSelectionContextValue {
  const context = useContext(EditorSelectionContext);
  if (!context) {
    throw new Error('useEditorSelection must be used within EditorSelectionProvider');
  }
  return context;
}

interface EditorSelectionProviderProps {
  children: React.ReactNode;
}

export function EditorSelectionProvider({ children }: EditorSelectionProviderProps) {
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);

  const value: EditorSelectionContextValue = {
    selectedElement,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
  };

  return (
    <EditorSelectionContext.Provider value={value}>
      {children}
    </EditorSelectionContext.Provider>
  );
}
