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
export type { DocumentAttributes } from "./editor/contexts/EditorArtboardContext";
export { computeContentDepths } from "./editor/contexts/EditorArtboardContext";

export { WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT, SLIDE_WIDTH, SLIDE_HEIGHT, BREAKPOINT_PRESETS } from "./editor/constants";

export { registerAutoSaveFlush, flushAutoSave } from "./editor/autosave";

/** パッケージの版。利用側が dev サーバーの束ねたコードと node_modules の食い違い(再起動漏れ)を検出するのに使う */
export { EDITOR_VERSION } from "./version";

/**
 * コメントの一覧(カンバン)。エディタとは別の画面に単独で置ける。
 *
 * - CommentBoardPanel … 配線済み。setEditorIO さえ渡してあれば props なしで動く
 * - CommentBoard      … 純UI。デッキも操作も自分で用意したい場合はこちら
 */
export { CommentBoardPanel } from "./editor/components/comments/CommentBoardPanel";
export type { CommentBoardPanelProps } from "./editor/components/comments/CommentBoardPanel";
export { CommentBoard } from "./editor/components/comments/CommentBoard";
export type { CommentBoardProps } from "./editor/components/comments/CommentBoard";

/** 配色。CommentBoard の theme に渡す(initialPptTheme はOS設定に追従する) */
export { initialPptTheme } from "./editor/components/ppt/PptChrome";
export type { PptTheme } from "./editor/components/ppt/PptChrome";

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
  EditorPartDef,
  EditorPartCategory,
  EditorPartsLibrary,
  EditorCollab,
  EditorCollabUser,
} from "./io";

/**
 * 共同編集の居場所(io.collab を渡したときだけ中身が入る)。
 * 利用側のページ一覧などに「誰がどのページに居るか」を出すのに使う
 */
export { useCollabPresence } from "./editor/collab/store";
export type { CollabPresence, CollabPeer, CollabStatus } from "./editor/collab/store";
/**
 * 部屋名が中継(gg-manager の hocuspocus-server)に保存される形かの検査。
 * 形を外れた部屋は中継はされるが保存されないので、殻・書き戻し役でも繋ぐ前にこれで確かめる
 */
export { checkCollabRoom } from "./editor/collab/room";
export type { CollabRoomCheck } from "./editor/collab/room";
export type { CSSVariableDefinition, CSSVariableCategory } from "./types/css-variables";

/**
 * 部品(HTML の `<template data-part-def>`)のユーティリティ。
 * 利用側が parts/*.html を読み書きする・スクリプトで同期する(parts:sync)ときに使う。
 * DOM だけに依存する(Node では linkedom 等の Document を渡す)。
 */
export {
  PART_ATTR,
  PART_VERSION_ATTR,
  SLOT_ATTR,
  PART_DEF_ATTR,
  parsePartTemplate,
  serializePartTemplate,
  materializePart,
  inferSlots,
  partDefFromElement,
  partInfoOf,
  isPartRoot,
  isLockedInsidePart,
  toPartId,
} from "./editor/parts";
