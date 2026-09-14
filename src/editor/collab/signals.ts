/**
 * EditorCanvas と共同編集の間の合図(依存なし)。
 * EditorCanvas は初期化(initLayout)を終えた文書をこのイベントで知らせる(io.collab があるときだけ)。
 */

/** 「この文書は読み込みと初期化を終えた」。detail は CollabDocumentReadyDetail */
export const COLLAB_DOCUMENT_READY_EVENT = 'gg:editor-document-ready';
/** 初期化を終えた文書の <html> に付く印。値はそのときのページ(イベントを聞き逃したときの確認用) */
export const COLLAB_DOCUMENT_READY_ATTR = 'data-gg-ready';

export type CollabDocumentReadyDetail = { doc: Document; contentId: string | null };
