/**
 * エディタContext統合エクスポート
 *
 * Phase 1: Context分割によるパフォーマンス最適化
 * - 51個のstateを8つの専門Contextに分割
 * - ファサードパターンで後方互換性を維持
 */

// 個別Context（パフォーマンス最適化用）
export { EditorRefsProvider, useEditorRefs, type EditorRefsContextValue } from './EditorRefsContext';
export { EditorSelectionProvider, useEditorSelection, type EditorSelectionContextValue } from './EditorSelectionContext';
export { EditorToolProvider, useEditorTool, type EditorToolContextValue } from './EditorToolContext';
export { EditorViewProvider, useEditorView, type EditorViewContextValue } from './EditorViewContext';
export { EditorHistoryProvider, useEditorHistory, type EditorHistoryContextValue } from './EditorHistoryContext';
export { EditorDocumentProvider, useEditorDocument, type EditorDocumentContextValue } from './EditorDocumentContext';
export { EditorArtboardProvider, useEditorArtboard, type EditorArtboardContextValue } from './EditorArtboardContext';
export { EditorUIStateProvider, useEditorUIState, type EditorUIStateContextValue } from './EditorUIStateContext';
