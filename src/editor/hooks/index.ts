/**
 * エディタフック群のエクスポート
 */

// 既存のhooks
export { useEditorMessages, postEditorMessage } from './useEditorMessages';
export { useDrawingMode } from './useDrawingMode';
export { useElementActions } from './useElementActions';
export { useCanvasControls, editorZoomApiRef } from './useCanvasControls';
export { useImageUpload } from './useImageUpload';
export { useMediaLibrary, invalidateMediaLibraryCache, toEditorMediaUrl } from './useMediaLibrary';
export type { MediaItem } from './useMediaLibrary';
export { useRichPaste } from './useRichPaste';
export { useEditorColors } from './useEditorColors';
export { useAiReplace } from './useAiReplace';

// EditorCanvas.tsx から分割した新規hooks
export { useTouchGestures } from './useTouchGestures';
export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export { useCoordinateTransform } from './useCoordinateTransform';
export { useElementSelection } from './useElementSelection';
export { useMarqueeSelection } from './useMarqueeSelection';
export { useDragResize } from './useDragResize';
export { useContextMenuHandler } from './useContextMenuHandler';
export { useIframeSetup } from './useIframeSetup';
export { useFocusManagement } from './useFocusManagement';
export { useInlineTextSelection } from './useInlineTextSelection';
export { useResizablePanel } from './useResizablePanel';

// Component system hooks
export { useComponentInstances } from './useComponentInstances';

// FrontendVisualEditorInner から分割した新規hooks
export { useBrowserZoomPrevention } from './useBrowserZoomPrevention';
export { usePageSettingsManager } from './usePageSettingsManager';
export { useComponentEditMode } from './useComponentEditMode';

/** @deprecated Use useEditorColors instead */
export { useEditorColors as useSlideColors } from './useEditorColors';
