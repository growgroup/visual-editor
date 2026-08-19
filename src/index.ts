/**
 * @growgroup/visual-editor
 *
 * HTMLをブラウザ上で直接編集するビジュアルエディタ。
 * スライド(16:9固定)とWebページ(可変高さ)の両方に使える。
 *
 * 使い方:
 *
 *   import { setEditorIO, VisualEditor } from '@growgroup/visual-editor'
 *   import '@growgroup/visual-editor/style.css'
 *
 *   setEditorIO({ loadDeck, commentAction, uploadImage })
 *
 *   <VisualEditor html={html} editorMode="webpage" onSave={save} onClose={close} />
 *
 * スタイルは dist/editor.css をビルド済みで同梱している。
 * 利用側の Tailwind のバージョン(v3/v4)に依存しない。
 */

export { FrontendVisualEditor, FrontendVisualEditor as VisualEditor } from "./editor/FrontendVisualEditor";
export type { FrontendVisualEditorProps } from "./editor/FrontendVisualEditor";

export { EditorProvider, useEditorContext } from "./editor/EditorContext";
export type { ContentListItem, EditorMode } from "./editor/EditorContext";

export { WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT, SLIDE_WIDTH, SLIDE_HEIGHT, BREAKPOINT_PRESETS } from "./editor/constants";

export { registerAutoSaveFlush, flushAutoSave } from "./editor/autosave";

/** 置き場との境界。利用側が起動時に1回渡す */
export { setEditorIO, io, can } from "./io";
export type {
  EditorIO,
  EditorDeck,
  EditorContent,
  EditorComment,
  CommentAction,
  ExportFormat,
  UploadResult,
} from "./io";
