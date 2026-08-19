/**
 * エディタコンポーネントのエクスポート
 */

export { EditorHeader } from './EditorHeader';
export { EditorCanvas } from './EditorCanvas';
export { EditorLayerPanel } from './EditorLayerPanel';
export { EditorPropertyPanel } from './EditorPropertyPanel';
export { EditorFooter } from './EditorFooter';
export { BreakpointSelector } from './BreakpointSelector';
export { BreakpointGuides } from './BreakpointGuides';
export { FigmaColorPicker, fillConfigToCss, parseCssToFillConfig } from './FigmaColorPicker';
export type { FillConfig, FillType, GradientStop } from './FigmaColorPicker';
export { EditorContextMenu } from './EditorContextMenu';
export type { ContextMenuPosition, ContextMenuProps } from './EditorContextMenu';
export { AiPromptPopover } from './AiPromptPopover';
export type { AiPromptPopoverProps } from './AiPromptPopover';
export { HtmlEditorDialog } from './HtmlEditorDialog';
export { HtmlImportDialog } from './HtmlImportDialog';
export type { HtmlImportDialogProps, HtmlImportResult } from './HtmlImportDialog';
export { CssEditorDialog } from './CssEditorDialog';
export type { CssEditorDialogProps } from './CssEditorDialog';
export { JsEditorDialog } from './JsEditorDialog';
export type { JsEditorDialogProps } from './JsEditorDialog';
export { PageSettingsDialog } from './PageSettingsDialog';
export type { PageSettingsDialogProps } from './PageSettingsDialog';
export { MediaLibraryDialog } from './MediaLibraryDialog';
export type { MediaLibraryDialogProps, MediaLibraryMode } from './MediaLibraryDialog';
export { VariablesDialog } from './VariablesDialog';
export { VariablePicker, VariableLinkButton } from './VariablePicker';
export { VariablesPanel } from './variables-panel';
export { ComponentPanel } from './component-panel';
export { MasterComponentEditor } from './MasterComponentEditor';
// 旧サイドバー（互換性のため残す）
export { EditorSidebar } from './EditorSidebar';

/** @deprecated Use EditorHeader instead */
export { EditorHeader as SlideEditorHeader } from './EditorHeader';
/** @deprecated Use EditorCanvas instead */
export { EditorCanvas as SlideEditorCanvas } from './EditorCanvas';
/** @deprecated Use EditorLayerPanel instead */
export { EditorLayerPanel as SlideEditorLayerPanel } from './EditorLayerPanel';
/** @deprecated Use EditorPropertyPanel instead */
export { EditorPropertyPanel as SlideEditorPropertyPanel } from './EditorPropertyPanel';
/** @deprecated Use EditorFooter instead */
export { EditorFooter as SlideEditorFooter } from './EditorFooter';
/** @deprecated Use EditorSidebar instead */
export { EditorSidebar as SlideEditorSidebar } from './EditorSidebar';
