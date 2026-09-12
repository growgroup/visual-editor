import type { ReactNode } from "react";
import type { CSSVariableDefinition } from "./types/css-variables";

/**
 * エディタと「置き場」のあいだの唯一の境界。
 *
 * エディタ本体はHTMLを編集するだけで、それをどこから読みどこへ保存するかを知らない。
 * 利用側（スライドのデッキ / Webページの構成ラフ など）がこの io を渡す。
 *
 * 【capability ベース】
 * すべて任意。渡されていない機能は、エディタ側がUIごと出さない。
 * 例: `exportDeck` が無ければ書き出しボタンを出さない。
 * こうしないと「押すと404で失敗するボタン」が残る（実際に起きた）。
 *
 * 使い方（利用側のアプリ起動時に1回）:
 *
 *   import { setEditorIO } from '@growgroup/visual-editor'
 *   setEditorIO({ loadDeck, commentAction, uploadImage })
 */

/** エディタが扱う1件（スライド1枚 / ページ1枚） */
export type EditorContent = {
  /** 一意なID。並び順は配列の順で決まる */
  id: string;
  /** 元テンプレートのキー。文字列であること（接頭辞を見る処理がある） */
  template: string;
  /** 編集済みか */
  edited: boolean;
  /** 一覧表示用のタイトル */
  title: string;
  /** 一覧・書き出しから除外 */
  hidden?: boolean;
  /** 表示モードでの画面切り替え効果 */
  transition?: "fade" | "push" | "zoom";
  /** レビューコメント */
  comments?: EditorComment[];
};

export type EditorComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
  /** 要素アンカー。無ければ全体へのコメント */
  anchorSrc?: string;
  anchorLabel?: string;
  replies?: { id: string; author: string; text: string; createdAt: string }[];
};

export type EditorDeck = {
  version: number;
  title: string;
  slides: EditorContent[];
};

export type CommentAction =
  | { action: "add"; author: string; text: string; anchorSrc?: string; anchorLabel?: string }
  | { action: "reply"; commentId: string; author: string; text: string }
  | { action: "resolve"; commentId: string; resolved: boolean }
  | { action: "delete"; commentId: string };

export type ExportFormat = "pdf" | "pdf-lite" | "pptx" | "pptx-edit";

export type UploadResult = { url: string; width?: number; height?: number };

/**
 * 部品(パーツ)の定義。利用側では 1 部品 1 ファイル(`parts/<id>.html`)の
 *
 *   <template data-part-def="ContactBand" data-part-v="1"
 *             data-part-name="お問合せ帯" data-part-category="block" data-part-desc="…">
 *     <section …>…<h2 data-slot="heading">…</h2>…</section>
 *   </template>
 *
 * を想定している。`html` は template の中身(ルート要素 1 つ)。
 * 文字列と `<template>` の相互変換は `parsePartTemplate` / `serializePartTemplate`(src/editor/parts.ts)。
 *
 * ページに挿すときは**実体化**する: 定義を複製してルートに `data-part` `data-part-v` を付けた
 * 完全な HTML がページに残る。エディタは `data-slot` の中だけを編集対象にし、
 * 定義を変えたあとの他ページへの反映は利用側(savePart の実装)が行う。
 */
export type EditorPartDef = {
  /** 識別子。`data-part` の値になる(ファイル名にも使うので英数字と - _ だけ) */
  id: string;
  /** 表示名。無ければ id */
  name?: string;
  /** パネルの分類。無ければ "parts" */
  category?: string;
  description?: string;
  /** 定義の版。実体化したインスタンスに `data-part-v` として写る */
  version: number;
  /** ルート要素 1 つの HTML */
  html: string;
};

export type EditorPartCategory = { id: string; name: string; description?: string };

export type EditorPartsLibrary = {
  parts: EditorPartDef[];
  /** 無ければ parts の category から作る */
  categories?: EditorPartCategory[];
};

export type EditorIO = {
  /** 一覧とコメントを取る。無ければ空の一覧として振る舞う */
  loadDeck?: () => Promise<EditorDeck>;

  /** コメントの追加・返信・解決・削除。無ければコメントUIを出さない */
  commentAction?: (page: number, action: CommentAction) => Promise<EditorDeck>;

  /** 並び替え・複製・削除など、一覧を編集する操作。無ければその操作を出さない */
  deckOps?: {
    move?: (from: number, to: number) => Promise<EditorDeck>;
    duplicate?: (page: number) => Promise<EditorDeck>;
    remove?: (page: number) => Promise<EditorDeck>;
    updateMeta?: (
      page: number,
      patch: { hidden?: boolean; transition?: "fade" | "push" | "zoom" | null },
    ) => Promise<EditorDeck>;
    insert?: (template: string, at: number) => Promise<EditorDeck>;
    reset?: (page: number) => Promise<EditorDeck>;
    templates?: () => Promise<{ id: string; title: string }[]>;
  };

  /**
   * 任意のAPI呼び出し。ページ設定・AI機能などが使う。
   * 無ければそれらの機能は「未提供」として静かに既定値へ落ちる。
   */
  apiFetch?: (path: string, init?: RequestInit) => Promise<unknown>;

  /** 画像の保存。無ければ data URL のまま本文に埋め込む */
  uploadImage?: (
    data: File | Blob | string,
    opts?: { fileName?: string; parentId?: string; contentId?: string },
  ) => Promise<UploadResult>;

  /** PDF/PPTXの書き出し。無ければ書き出しUIを出さない */
  exportDeck?: (format: ExportFormat, pages?: number[]) => Promise<void>;

  /** 1件を描く（一覧のサムネイル等）。無ければ描かない */
  renderContent?: (page: number) => ReactNode;

  /** 保存結果の通知。無ければ何もしない */
  notifySave?: (info: { page: number }) => void;

  /**
   * 部品(HTML の template)の一覧。渡すと部品パネルはこれを使い、
   * ブラウザ内(localStorage)の JSON コンポーネントは読まない。
   * 挿入は実体化(完全な HTML をページに残す)になる
   */
  loadParts?: () => Promise<EditorPartsLibrary>;
  /** 部品を作る・更新する(「部品として保存」「部品を更新」)。無ければそれらの操作を出さない */
  savePart?: (part: EditorPartDef) => Promise<EditorPartDef | void>;
  /** 部品を消す。無ければ削除を出さない */
  deletePart?: (id: string) => Promise<void>;

  /** CSS 変数(デザイントークン)の読み込み。無ければブラウザ内(localStorage)に持つ */
  loadVariables?: () => Promise<CSSVariableDefinition[]>;
  /** CSS 変数の保存。無ければブラウザ内(localStorage)に持つ */
  saveVariables?: (variables: CSSVariableDefinition[]) => Promise<void>;
};

let current: EditorIO = {};

/** 利用側が起動時に1回呼ぶ */
export function setEditorIO(io: EditorIO): void {
  current = io ?? {};
}

/** エディタ内部から参照する */
export function io(): EditorIO {
  return current;
}

/** 機能が使えるか。UIの出し分けに使う */
export function can<K extends keyof EditorIO>(key: K): boolean {
  return current[key] != null;
}

/** 未提供の機能が呼ばれたときのエラー。握り潰さず理由を出す */
export function notProvided(what: string): Error {
  return new Error(
    `この機能(${what})は、利用側から io として渡されていないため使えません。` +
      `setEditorIO で ${what} を渡すか、この機能のUIを出さないようにしてください。`,
  );
}

export const EMPTY_DECK: EditorDeck = { version: 0, title: "", slides: [] };
