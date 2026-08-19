'use client';

/**
 * EditorViewContext
 *
 * エディタの表示/ズーム状態を管理するContext
 * 変更頻度: 中（ズーム操作、ビューモード切り替え時）
 *
 * 含まれる状態:
 * - zoom/fitZoom: シングルアートボードのズーム
 * - viewportWidth: レスポンシブプレビュー幅
 * - viewMode: シングル/グリッド表示
 * - globalZoom/globalScrollPosition: グリッドビュー時の全体ズーム
 */

import React, { createContext, useContext, useState } from 'react';
import { BREAKPOINT_PRESETS } from '../constants';

/** ビューモード（シングル、グリッド、またはキャンバス表示） */
export type ViewMode = 'single' | 'grid' | 'canvas';

export interface EditorViewContextValue {
  // シングルアートボードのズーム
  zoom: number;
  setZoom: (zoom: number) => void;
  fitZoom: number;
  setFitZoom: (zoom: number) => void;

  // ビューポート幅（webpageモードのレスポンシブプレビュー用）
  viewportWidth: number;
  setViewportWidth: (width: number) => void;

  // ビューモード
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // グローバルキャンバス状態（グリッド表示用）
  globalZoom: number;
  setGlobalZoom: (zoom: number) => void;
  globalScrollPosition: { x: number; y: number };
  setGlobalScrollPosition: (pos: { x: number; y: number }) => void;
}

const EditorViewContext = createContext<EditorViewContextValue | null>(null);

export function useEditorView(): EditorViewContextValue {
  const context = useContext(EditorViewContext);
  if (!context) {
    throw new Error('useEditorView must be used within EditorViewProvider');
  }
  return context;
}

interface EditorViewProviderProps {
  children: React.ReactNode;
  /** 初期の表示幅。省略時はプリセットの先頭 */
  initialViewportWidth?: number;
}

export function EditorViewProvider({
  children,
  initialViewportWidth,
}: EditorViewProviderProps) {
  // シングルアートボードのズーム
  const [zoom, setZoom] = useState(100);
  const [fitZoom, setFitZoom] = useState(100);

  // ビューポート幅。利用側が artboardWidth を渡せばそれが初期値になる
  // （構成ラフのように「この幅で見ると決まっている」用途がある）
  const [viewportWidth, setViewportWidth] = useState<number>(
    initialViewportWidth ?? BREAKPOINT_PRESETS[0].width,
  );

  // ビューモード（デフォルトはgrid = Figma風マルチアートボード表示）
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // グローバルキャンバス状態（グリッド表示用）
  const [globalZoom, setGlobalZoom] = useState(100);
  const [globalScrollPosition, setGlobalScrollPosition] = useState({ x: 0, y: 0 });

  const value: EditorViewContextValue = {
    zoom,
    setZoom,
    fitZoom,
    setFitZoom,
    viewportWidth,
    setViewportWidth,
    viewMode,
    setViewMode,
    globalZoom,
    setGlobalZoom,
    globalScrollPosition,
    setGlobalScrollPosition,
  };

  return (
    <EditorViewContext.Provider value={value}>
      {children}
    </EditorViewContext.Provider>
  );
}
