"use client";

/**
 * コメントボード(カンバン形式の一覧)の見た目。
 *
 * 右パネル(PptComments)が「いま開いているページのスレッド」を見るのに対し、
 * こちらは「デッキ全体のコメント」を俯瞰する。列＝ページ・カード＝1スレッド。
 * どのページに指摘が何件残っているかを一望し、ページを行き来せずに
 * 解決・返信・削除まで済ませられる。クライアント指摘の管理画面として使う。
 *
 * ここは純粋な表示。取得も保存もせず、必要なものはすべて props で受け取る。
 * パッケージ内の io に配線済みの版が欲しいときは CommentBoardPanel を使うこと。
 *
 * 操作UIは「渡された分だけ」出す(io の capability と同じ考え方)。
 * onReply を渡さなければ返信欄は出ないし、onDelete が無ければゴミ箱も出ない。
 * 押しても何も起きないボタンを残さないための決まり。
 *
 * 高さは親から与えること —— 列ごとの縦スクロールが `h-full` に依存している。
 *
 *   <div className="h-screen"><CommentBoard deck={deck} author="" /></div>
 */

import { useState } from 'react';
import { Check, CornerUpLeft, ExternalLink, MapPin, MessageSquare, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { Deck, SlideComment } from '../../../lib/deck';
import { PPT_PALETTES, type PptTheme } from '../ppt/PptChrome';
import { fmtTime, unresolvedCount } from '../ppt/PptComments';

/**
 * アンカー・返信のリンク色。
 *
 * 明るい配色では右パネルと同じ青。暗い配色では明るい青に振る。
 * ボードは一度に何十枚も読む面で、暗い背景 + 解決済の減光(opacity .72)が重なると
 * 右パネルの青(#0F6CBD)では沈んで読めなくなるため。
 */
const accentOf = (theme: PptTheme) => (theme === 'dark' ? '#4CA5E8' : '#0F6CBD');
/** 未解決の橙(Avatarの配色から。解決済はパレットのグレーに落とす) */
const OPEN_COLOR = '#CA5010';

type Filter = 'all' | 'open' | 'resolved';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'open', label: '未解決' },
  { value: 'resolved', label: '解決済' },
];

const excerpt = (text: string, max = 28) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * 操作の戻り値。
 * `false` を返したときだけ「失敗」とみなし、書きかけの返信を残す。
 * 何も返さなければ成功扱い(利用側に boolean を強制しない)。
 */
type ActionResult = Promise<boolean | void> | boolean | void;

export type CommentBoardProps = {
  /** 表示するデッキ。`slides` の並びがそのまま列の並びになる */
  deck: Deck;
  /** 取得中。列の代わりに読み込み中の表示を出す */
  loading?: boolean;
  /** 操作中。ボタンを止める */
  busy?: boolean;

  /** 投稿者名。返信に使う */
  author: string;
  /** 渡すと名前の入力欄を出す */
  onAuthorChange?: (value: string) => void;

  /** 解決状態の切り替え。渡さなければトグルを出さない */
  onResolve?: (page: number, commentId: string, resolved: boolean) => ActionResult;
  /** 返信の追加。渡さなければ返信欄を出さない */
  onReply?: (page: number, commentId: string, text: string) => ActionResult;
  /** スレッドの削除。渡さなければゴミ箱を出さない(確認はこの中で取る) */
  onDelete?: (page: number, commentId: string) => ActionResult;
  /** 列ヘッダーの「このページを開く」。渡さなければボタンを出さない */
  onOpenPage?: (page: number) => void;

  /**
   * 配色。既定は light。
   * initialPptTheme() を既定にしない —— localStorage/matchMedia を見るため、
   * 利用側がサーバー描画するとハイドレーションがずれる。
   * OS追従にしたい利用側は initialPptTheme() の結果を渡すこと。
   */
  theme?: PptTheme;
  /** 外枠に足すclass。高さは親が持つ前提 */
  className?: string;
};

export function CommentBoard({
  deck,
  loading = false,
  busy = false,
  author,
  onAuthorChange,
  onResolve,
  onReply,
  onDelete,
  onOpenPage,
  theme = 'light',
  className,
}: CommentBoardProps) {
  const pal = PPT_PALETTES[theme];
  const accent = accentOf(theme);

  const [filter, setFilter] = useState<Filter>('all');
  const [showEmpty, setShowEmpty] = useState(false);

  const columns = deck.slides.map((slide, i) => {
    const comments = slide.comments ?? [];
    return {
      page: i + 1,
      title: slide.title || `ページ ${i + 1}`,
      comments,
      open: unresolvedCount(comments),
    };
  });

  const total = columns.reduce((n, c) => n + c.comments.length, 0);
  const openTotal = columns.reduce((n, c) => n + c.open, 0);

  /**
   * 絞り込み後の列。既定では中身のある列だけを出す。
   * サマリの数字は絞り込みに連動させない(全体像を見失うため)。
   */
  const shown = columns
    .map((col) => ({
      ...col,
      visible: col.comments.filter((c) =>
        filter === 'all' ? true : filter === 'open' ? !c.resolved : !!c.resolved,
      ),
    }))
    .filter((col) => showEmpty || col.visible.length > 0);

  const tab = (active: boolean) => ({
    backgroundColor: active ? pal.activeBg : 'transparent',
    color: active ? pal.text : pal.sub,
    borderColor: pal.border,
  });

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${className ?? ''}`}
      style={{ backgroundColor: pal.canvas }}
    >
      {/* 上部バー: サマリ・絞り込み・名前 */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2"
        style={{ backgroundColor: pal.chrome, borderColor: pal.border }}
      >
        <span className="text-[13px] font-medium" style={{ color: pal.text }}>
          コメントボード
        </span>
        <span className="text-[11px]" style={{ color: pal.sub }}>
          総数 {total}
          <span className="px-1">/</span>
          未解決 <span style={{ color: openTotal > 0 ? OPEN_COLOR : pal.sub }}>{openTotal}</span>
          <span className="px-1">/</span>
          解決済 {total - openTotal}
        </span>

        <div className="flex overflow-hidden rounded border" style={{ borderColor: pal.border }}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className="px-2 py-0.5 text-[11px] transition-colors"
              style={tab(filter === f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowEmpty((v) => !v)}
          title="コメントの無いページも列として出す"
          className="rounded border px-2 py-0.5 text-[11px] transition-colors"
          style={tab(showEmpty)}
        >
          すべてのページ
        </button>

        {onAuthorChange && (
          <input
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            placeholder="名前(記憶されます)"
            className="ml-auto h-6 w-[160px] rounded border px-1.5 text-[11px] outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
          />
        )}
      </div>

      {loading ? (
        <p className="p-4 text-[12px]" style={{ color: pal.sub }}>
          読み込んでいます…
        </p>
      ) : shown.length === 0 ? (
        <p className="p-4 text-[12px]" style={{ color: pal.sub }}>
          {total === 0
            ? 'まだコメントはありません。エディタでページを開き、要素を選んで投稿すると、ここに並びます。'
            : 'この絞り込みに該当するコメントはありません。'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex h-full gap-3 p-3">
            {shown.map((col) => (
              <BoardColumn
                key={col.page}
                pal={pal}
                accent={accent}
                page={col.page}
                title={col.title}
                comments={col.visible}
                openCount={col.open}
                totalCount={col.comments.length}
                busy={busy}
                onResolve={onResolve}
                onReply={onReply}
                onDelete={onDelete}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Palette = (typeof PPT_PALETTES)[PptTheme];

type CardCommon = {
  pal: Palette;
  accent: string;
  page: number;
  busy: boolean;
  onResolve?: CommentBoardProps['onResolve'];
  onReply?: CommentBoardProps['onReply'];
  onDelete?: CommentBoardProps['onDelete'];
};

/** 1ページ分の列 */
function BoardColumn({
  pal,
  page,
  title,
  comments,
  openCount,
  totalCount,
  onOpenPage,
  ...common
}: CardCommon & {
  title: string;
  comments: SlideComment[];
  openCount: number;
  totalCount: number;
  onOpenPage?: (page: number) => void;
}) {
  return (
    <section
      className="flex h-full w-[300px] shrink-0 flex-col rounded-lg border"
      style={{ borderColor: pal.border, backgroundColor: pal.rail }}
    >
      <div className="shrink-0 border-b px-2.5 py-2" style={{ borderColor: pal.border }}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] tabular-nums" style={{ color: pal.sub }}>
            {String(page).padStart(2, '0')}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12.5px] font-medium"
            style={{ color: pal.text }}
            title={title}
          >
            {title}
          </span>
          {onOpenPage && (
            <button
              onClick={() => onOpenPage(page)}
              title="このページを開く"
              className="rounded p-1"
              style={{ color: pal.sub }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[10px]" style={{ color: pal.sub }}>
          <span style={{ color: openCount > 0 ? OPEN_COLOR : pal.sub }}>未解決 {openCount}</span>
          <span className="px-1">/</span>全 {totalCount}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {comments.length === 0 ? (
          <p className="px-1 pt-1 text-[11px]" style={{ color: pal.sub }}>
            コメントなし
          </p>
        ) : (
          comments.map((c) => <BoardCard key={c.id} comment={c} {...common} pal={pal} page={page} />)
        )}
      </div>
    </section>
  );
}

/**
 * 1スレッドのカード。
 *
 * モジュールの直下に置くこと。親の中で定義すると再描画のたびに
 * 別のコンポーネント扱いになり、返信欄が作り直されて日本語入力が壊れる
 * (PptComments の renderThread に同じ経緯の注意書きがある)。
 */
function BoardCard({
  comment,
  pal,
  accent,
  page,
  busy,
  onResolve,
  onReply,
  onDelete,
}: CardCommon & { comment: SlideComment }) {
  const [expanded, setExpanded] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');

  const replies = comment.replies ?? [];
  const last = replies[replies.length - 1];
  const open = !comment.resolved;

  const sendReply = async () => {
    const text = replyDraft.trim();
    if (!text || !onReply) return;
    // 失敗(false)のときは書いたものを残す。消えると戻せない
    const ok = await onReply(page, comment.id, text);
    if (ok !== false) setReplyDraft('');
  };

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{
        borderColor: open ? OPEN_COLOR : pal.border,
        backgroundColor: pal.control,
        opacity: comment.resolved ? 0.72 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={
            open
              ? { backgroundColor: OPEN_COLOR, color: '#ffffff' }
              : { backgroundColor: pal.activeBg, color: pal.sub }
          }
        >
          {open ? '未解決' : '解決済'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: pal.sub }}>
          {comment.author}
        </span>
        <span className="shrink-0 text-[10px]" style={{ color: pal.sub }}>
          {fmtTime(comment.createdAt)}
        </span>
      </div>

      {/* 何に対する指摘か。要素に紐づいていなければページ全体 */}
      <div
        className="mt-1.5 flex items-center gap-1 text-[10px]"
        style={{ color: comment.anchorSrc ? accent : pal.sub }}
        title={comment.anchorSrc}
      >
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {comment.anchorSrc ? (comment.anchorLabel ? `「${comment.anchorLabel}」` : '要素に添付') : 'ページ全体'}
        </span>
      </div>

      {/* 本文。長いものは3行で畳み、クリックで全文と返信を出す */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1.5 block w-full text-left"
      >
        {/*
          畳むときに `block` を併記しない。line-clamp は display:-webkit-box で効くので、
          同じ display 系の block を一緒に当てると打ち消されて3行に収まらない(実際に起きた)。
        */}
        <span
          className={`whitespace-pre-wrap text-[12.5px] leading-relaxed ${expanded ? 'block' : 'line-clamp-3'}`}
          style={{ color: pal.text }}
        >
          {comment.text}
        </span>
      </button>

      {!expanded && replies.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: pal.sub }}>
          <MessageSquare className="h-3 w-3 shrink-0" />
          <span className="truncate">
            返信{replies.length}件・{last.author}「{excerpt(last.text)}」
          </span>
        </p>
      )}

      {expanded && (
        <div className="mt-2">
          {replies.map((r) => (
            <div key={r.id} className="mt-2 border-l-2 pl-2.5" style={{ borderColor: pal.border }}>
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[11px] font-medium" style={{ color: pal.text }}>
                  {r.author}
                </span>
                <span className="shrink-0 text-[10px]" style={{ color: pal.sub }}>
                  {fmtTime(r.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: pal.text }}>
                {r.text}
              </p>
            </div>
          ))}

          {onReply && (
            <div className="mt-2 flex items-end gap-1.5">
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                rows={2}
                placeholder="返信… (⌘+Enterで送信)"
                className="min-h-[40px] flex-1 resize-none rounded border p-1.5 text-[12px] outline-none"
                style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
              />
              <button
                onClick={() => void sendReply()}
                disabled={busy || !replyDraft.trim()}
                title="返信を送信"
                className="rounded p-1.5 disabled:opacity-40"
                style={{ color: accent }}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {(onResolve || onReply || onDelete) && (
        <div className="mt-2 flex items-center gap-1 border-t pt-1.5" style={{ borderColor: pal.border }}>
          {onResolve && (
            <button
              onClick={() => void onResolve(page, comment.id, open)}
              disabled={busy}
              title={open ? '解決済みにする' : 'スレッドを再開'}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] disabled:opacity-40"
              style={{ color: pal.sub }}
            >
              {open ? <Check className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {open ? '解決' : '再開'}
            </button>
          )}

          {onReply && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px]"
              style={{ color: accent }}
            >
              <CornerUpLeft className="h-3 w-3" />
              返信
            </button>
          )}

          {onDelete && (
            <button
              onClick={() => void onDelete(page, comment.id)}
              disabled={busy}
              title="スレッドを削除"
              className="ml-auto rounded p-1 disabled:opacity-40"
              style={{ color: pal.sub }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
