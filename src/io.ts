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

/**
 * 範囲アンカー。紙面(`#artboard`)の左上を原点にした px。
 * `ref` は投稿したときの紙面の大きさ。紙面の幅が変わったら(ノート欄の有無など)
 * 横方向だけ幅の比で補正する。縦は内容が増減すると動くので補正しない。
 * width / height が 0 のときは「点」(クリックで置いたピン)。
 */
export type CommentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  ref?: { width: number; height: number };
};

export type EditorComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
  /**
   * ページ内の通し番号(投稿順)。削除しても振り直さないので、返信で「#3 の件」と
   * 書いても指す先が変わらない。ホストが採番する(無いホストでは付かない)
   */
  seq?: number;
  /** 要素アンカー。無ければ全体へのコメント */
  anchorSrc?: string;
  anchorLabel?: string;
  /** 範囲アンカー(紙面の px)。要素アンカーより優先して表示する */
  anchorRect?: CommentRect;
  replies?: { id: string; author: string; text: string; createdAt: string }[];
};

export type EditorDeck = {
  version: number;
  title: string;
  slides: EditorContent[];
};

export type CommentAction =
  | { action: "add"; author: string; text: string; anchorSrc?: string; anchorLabel?: string; anchorRect?: CommentRect }
  | { action: "reply"; commentId: string; author: string; text: string }
  | { action: "resolve"; commentId: string; resolved: boolean }
  | { action: "delete"; commentId: string };

/**
 * コメントに利用側が足す操作(0.10.0)。コメントパネルの各スレッドと、パネル上部(いま開いているページ)に
 * ボタンを出す。何をするか(返信を足す・外部に依頼する・別画面を開く など)はエディタの関心事ではない。
 *
 * エディタが受け持つのは、ボタンを出す・押している間の表示(二重押しの防止)・失敗の表示・
 * 戻り値の deck の反映だけ。`run` が投げたエラーは押した場所の下にそのまま出す。
 */
export type EditorCommentActionResult = {
  /** 一覧とコメントの最新。渡せばパネルに反映する(返信を足した操作など) */
  deck?: EditorDeck;
  /** 押した場所の下に出す短い知らせ(「依頼しました」など)。無ければ何も出さない */
  message?: string;
};

export type EditorCommentThreadAction = {
  /** 識別子。コメントパネルの中で一意にする(`data-comment-action` 属性にも出る) */
  id: string;
  label: string;
  /** ツールチップ */
  title?: string;
  /** ラベルの前に出すアイコン */
  icon?: ReactNode;
  /** 出す条件。無ければ未解決のスレッドにだけ出す。`page` はいま開いているページの番号 */
  when?: (comment: EditorComment, ctx: { page: number }) => boolean;
  run: (ctx: { page: number; comment: EditorComment }) => Promise<EditorCommentActionResult | void>;
};

export type EditorCommentPanelAction = {
  /** 識別子。コメントパネルの中で一意にする(`data-comment-panel-action` 属性にも出る) */
  id: string;
  label: string;
  /** ツールチップ */
  title?: string;
  /** ラベルの前に出すアイコン */
  icon?: ReactNode;
  /** 出す条件。無ければ、いまのページに未解決のコメントが 1 件以上あるときだけ出す */
  when?: (ctx: { page: number; comments: EditorComment[] }) => boolean;
  /** `comments` はいまのページのコメント全部(解決済みも含む。絞るのは利用側) */
  run: (ctx: { page: number; comments: EditorComment[] }) => Promise<EditorCommentActionResult | void>;
};

export type EditorCommentActions = {
  /** 各スレッドに出す操作 */
  thread?: EditorCommentThreadAction[];
  /** パネル上部に出す、いまのページ全体への操作 */
  panel?: EditorCommentPanelAction[];
};

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

/**
 * 台帳から挿入(「台帳から挿入」パネル)。
 *
 * 【役割分担】
 * - 利用側 … 何が挿せるかの目録(loadInserts)と、1 件の HTML(fetchInsert)を作る。
 *            HTML は断片(`<section class="wf-ds" data-ds="…" data-ds-v="…">…</section>` の形で
 *            利用側が包んでおく)。エディタは包み直さない
 * - エディタ … 紙面のどこに入れるかを決め、編集の印を付け、履歴に 1 段で載せる
 *
 * 目録・HTML の中身(何が台帳にあるか・どう整形するか)はエディタの関心事ではない。
 * `loadInserts` を渡さなければ「台帳から挿入」の入口ごと出さない。
 */
export type EditorInsertLevel =
  /** セクション(紙面に 1 段として入る) */
  | 'SEC'
  /** パーツ(セクションより小さい部品) */
  | 'MOL'
  /** ページの雛形(挿入ではなく「新しいページを作る」) */
  | 'TPL'
  /** ページ(同上) */
  | 'PAG'
  // 利用側が独自の階層を足せるように文字列も受ける(補完は上の 4 つが出る)
  | (string & {});

export type EditorInsertItem = {
  /** 一意な識別子。`fetchInsert` / `createContent` にそのまま渡す */
  id: string;
  /** 表示名 */
  name: string;
  /** 系統(絞り込みの単位。ヘッダー・ヒーロー・フォーム など) */
  family?: string;
  description?: string;
  /**
   * 階層。`TPL` / `PAG` は紙面に挿さず「ページを作る」に回る。
   * 省略時は挿入(セクション扱い)
   */
  level?: EditorInsertLevel;
  /** 見本の URL(あればカードと右の大きいプレビューに iframe で出す) */
  previewUrl?: string;
  /** 出どころ。表示の区別だけに使う */
  source?: 'ledger' | 'local';
};

export type EditorInsertGroup = { id: string; label: string; items: EditorInsertItem[] };

export type EditorInsertCatalog = { groups: EditorInsertGroup[] };

export type EditorIO = {
  /** 一覧とコメントを取る。無ければ空の一覧として振る舞う */
  loadDeck?: () => Promise<EditorDeck>;

  /** コメントの追加・返信・解決・削除。無ければコメントUIを出さない */
  commentAction?: (page: number, action: CommentAction) => Promise<EditorDeck>;

  /**
   * コメントに足す操作(スレッドごと・パネル上部)。無ければ何も足さない(0.10.0)。
   * コメントパネルは commentAction がある場合だけ出るので、これだけ渡しても出ない
   */
  commentActions?: EditorCommentActions;

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
   * 1件の本文(HTML)を取る。マルチフレームのキャンバス(enableMultiPageCanvas)で、
   * 隣のページへ移るとき・見えてきたページを描くときに呼ばれる。
   * id は contentList の id。無ければ contentList[].thumbnailHtml を使い、
   * それも無ければ(parentId がある利用側では)API から取る
   */
  loadContent?: (id: string) => Promise<string>;

  /**
   * 見るだけの紙面(マルチフレームのキャンバスで、編集していないページ)に足すスタイル。
   * 紙面は script を動かさない(sandbox)ので、本文が Tailwind のブラウザ版 JIT に
   * 頼っている利用側は、コンパイル済み CSS の URL か CSS 文字列をここで渡す
   * (提案書のテンプレートは自分のページの stylesheet を渡す)。
   * 本文に CSS が入っている利用側(構成ラフ)は不要
   */
  previewStyles?: () => PreviewStyle[] | Promise<PreviewStyle[]>;

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

  /**
   * 台帳の目録(利用側が束ねる)。無ければ「台帳から挿入」は出さない。
   * パネルを開くたびに呼ぶ(利用側で束ねたものを返すだけでよい)
   */
  loadInserts?: () => Promise<EditorInsertCatalog>;
  /**
   * 1 件の HTML(断片)。`dummy` は見出し・リード文を赤字ダミーにする利用側の整形で、
   * パネルのチェック(既定 ON)がそのまま渡る。整形しない利用側は無視してよい。
   * `name` はいまのエディタでは使っていない(目録の name を出している)。
   * 目録と実体が食い違いうる利用側のために受け口だけ空けてある
   */
  fetchInsert?: (id: string, opts: { dummy: boolean }) => Promise<{ html: string; name?: string }>;
  /**
   * 新しいページを作る(TPL / PAG の挿入)。戻り値の id で利用側が `contentList` を
   * 読み直し、エディタはその id が一覧に現れたらそのページを編集中にする。
   * 無ければページの雛形は挿入できない(グループを出しても「ページを作る」は押せない)
   */
  createContent?: (input: {
    title: string;
    path: string;
    templateId?: string;
    parentId?: string;
  }) => Promise<{ id: string }>;

  /** CSS 変数(デザイントークン)の読み込み。無ければブラウザ内(localStorage)に持つ */
  loadVariables?: () => Promise<CSSVariableDefinition[]>;
  /** CSS 変数の保存。無ければブラウザ内(localStorage)に持つ */
  saveVariables?: (variables: CSSVariableDefinition[]) => Promise<void>;

  /**
   * リアルタイム共同編集(Figma 風)。Hocuspocus の部屋に本文と居場所を載せる。
   * 無ければ今までどおり(共同編集の UI も出さず、接続もしない)。
   * あるページの部屋に入っている間は onSave の自動保存を呼ばない(ファイルに書くのは書き戻し役)
   */
  collab?: EditorCollab;
};

/** 共同編集の参加者。color が無ければ id から決める */
export type EditorCollabUser = { id: string; name: string; color?: string };

export type EditorCollab = {
  /** Hocuspocus の URL(wss://…) */
  url: string;
  /** contentId → ページの部屋名。null ならそのページは共同編集しない */
  roomFor: (contentId: string) => string | null;
  /** 案件の部屋名(居場所・pages) */
  projectRoom: string;
  /** contentId → route(案件の部屋の awareness と pages のキー) */
  routeFor: (contentId: string) => string | null;
  user: EditorCollabUser;
  token?: () => Promise<string | undefined>;
  /** getCleanHtml の結果 → 共有する本文。無ければそのまま */
  encode?: (cleanHtml: string) => string;
  /** 共有する本文 → エディタに渡す HTML。無ければそのまま */
  decode?: (shared: string, contentId: string) => string;
  /** true: 書き戻し役が居ないとき「変更は保存されません」を出し続ける(静的なエディタ) */
  requireBridge?: boolean;
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

/** 見るだけの紙面(マルチフレームのキャンバス)に足すスタイル(URL か CSS 文字列)。io.previewStyles が返す */
export type PreviewStyle = { href: string } | { css: string };
