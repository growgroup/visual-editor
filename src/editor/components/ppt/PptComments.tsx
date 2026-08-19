"use client";

/**
 * PowerPoint風UIのコメント機能(実機の「モダンコメント」に寄せたフル実装)。
 *
 * - スレッド形式(返信・解決/再開・削除)。deck.json のエントリに永続化
 * - 要素アンカー: 追加時に要素を選択していれば、その要素の刻印(data-gg-src / data-wf-src)に
 *   紐づき、キャンバス上にコメントバブル(マーカー)が出る。クリックでパネルの該当スレッドへ。
 *   投稿する前に「何に対するコメントか」を必ず出す(選択中の要素名 / ページ全体)
 * - マーカーは iframe 内のオーバーレイ層(.gg-comment-layer)に描く。
 *   保存時に丸ごと剥がされるため、上書きHTML・原本TSXには一切混入しない
 * - 名前は localStorage に記憶(ローカルツールなのでアカウントは要求しない)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CornerUpLeft, Loader2, MapPin, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react';
import { readApiJson } from '../../utils/api-json';
import { useEditorContext } from '../../EditorContext';
import { useDeck, refreshDeck } from '../../../components/viewer/useDeck';
import { commentAction, type SlideComment } from '../../../lib/deck';
import { can } from '../../../io';
import { PPT_PALETTES, type PptTheme } from './PptChrome';

const AUTHOR_KEY = 'gg-editor:comment-author';

/**
 * 要素の「出所の刻印」に使う属性。
 *
 * - `data-gg-src` … 提案スライド側。1要素に1つの一意な値
 * - `data-wf-src` … 構成ラフ側。TSXのソース位置(`app/page.tsx:127:9`)で、
 *   map で描かれた要素では**同じ値が複数の要素に付く**
 *
 * そのため保存する値は「刻印 + 同じ刻印の中での順番」にする（`…:127:9#2`）。
 * 順番まで持てば、繰り返しの中の何番目かまで特定できる。
 */
const ANCHOR_ATTRS = ['data-gg-src', 'data-wf-src'] as const;

/** 要素からアンカー値を作る。刻印が無ければ null（＝ページ全体へのコメント） */
export function anchorValueOf(root: HTMLElement, el: HTMLElement): string | null {
  for (const attr of ANCHOR_ATTRS) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    const same = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}="${CSS.escape(raw)}"]`));
    if (same.length <= 1) return raw;
    const index = same.indexOf(el);
    return index <= 0 ? raw : `${raw}#${index}`;
  }
  return null;
}

/**
 * 選択中の要素を人が見て分かる名前にする。
 *
 * `textContent` をそのまま使うと、外側の器を選んだときに子孫の文字が全部
 * つながって意味をなさない（「株式会社三和企業情報企業情報企業情報トップ→…」）。
 * そこで①その要素が直接持っている文字 ②中の見出し ③タグ名 の順に落とす。
 */
export function describeElement(el: HTMLElement): { label: string; kind: 'text' | 'range' | 'tag' } {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const cut = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);

  // ① 直接の文字ノードだけを見る（子要素の文字は含めない）
  const own = clean(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(' '),
  );
  if (own) return { label: cut(own), kind: 'text' };

  // ② 器なら、中の見出しで言い表す
  const inner = el.querySelector<HTMLElement>('h1, h2, h3, h4, th, dt, strong, a, p, li, span');
  const innerText = clean(inner?.textContent);
  if (innerText) return { label: cut(innerText), kind: 'range' };

  // ③ 見出しは無いが文字はある（div の中に直接テキストがぶら下がる形など）
  const anyText = clean(el.textContent);
  if (anyText) return { label: cut(anyText), kind: 'range' };

  // ④ 文字を持たない（画像枠・区切りなど）
  const alt = clean(el.getAttribute('alt') || el.getAttribute('aria-label'));
  if (alt) return { label: cut(alt), kind: 'text' };
  return { label: `<${el.tagName.toLowerCase()}>`, kind: 'tag' };
}

/** アンカー値から要素を引く。`#N` が付いていれば N 番目 */
function findAnchored(root: HTMLElement, value: string): HTMLElement | null {
  const hash = value.lastIndexOf('#');
  const index = hash >= 0 ? Number(value.slice(hash + 1)) : NaN;
  const raw = Number.isFinite(index) ? value.slice(0, hash) : value;
  for (const attr of ANCHOR_ATTRS) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}="${CSS.escape(raw)}"]`));
    if (found.length === 0) continue;
    return found[Number.isFinite(index) ? index : 0] ?? found[0];
  }
  return null;
}

export function loadAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    return '';
  }
}

/** 未解決コメント数(サムネイルのバッジ用) */
export function unresolvedCount(comments?: SlideComment[]): number {
  return (comments ?? []).filter((c) => !c.resolved).length;
}

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 著者アイコン(頭文字の丸)。同じ名前は同じ色になる */
function Avatar({ name }: { name: string }) {
  const colors = ['#0F6CBD', '#7A7574', '#038387', '#C239B3', '#CA5010', '#498205'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: colors[h % colors.length] }}
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
}

/* ============================ キャンバス上のマーカー ============================ */

/**
 * アンカー付きコメントのバブルを iframe 内へ描く。
 * 座標はアートボード座標(要素の offset 系)なので、ズーム・パンに自動追従する。
 */
export function useCommentMarkers({
  page,
  active,
  onOpenThread,
}: {
  page: number;
  active: boolean;
  onOpenThread: (commentId: string) => void;
}) {
  const { getIframeDoc } = useEditorContext();
  const deck = useDeck();
  const comments = deck.slides[page - 1]?.comments ?? [];
  const onOpenRef = useRef(onOpenThread);
  onOpenRef.current = onOpenThread;

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const render = () => {
      if (!alive) return;
      const doc = getIframeDoc();
      const artboard = doc?.getElementById('artboard');
      if (!doc || !artboard) return;
      let layer = artboard.querySelector<HTMLElement>(':scope > .gg-comment-layer');
      if (!layer) {
        layer = doc.createElement('div');
        layer.className = 'gg-comment-layer';
        // 保存時に丸ごと剥がされる前提の表示専用レイヤー
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9000;';
        artboard.appendChild(layer);
      }
      layer.innerHTML = '';
      const anchored = comments.filter((c) => c.anchorSrc && !c.resolved);
      for (const c of anchored) {
        const target = findAnchored(artboard, c.anchorSrc!);
        const bubble = doc.createElement('button');
        bubble.setAttribute('data-comment-id', c.id);
        bubble.title = `${c.author}: ${c.text.slice(0, 60)}`;
        bubble.textContent = (c.author || '?').slice(0, 1);
        const x = target ? target.offsetLeft + target.offsetWidth - 6 : 1860;
        const y = target ? Math.max(0, target.offsetTop - 10) : 20;
        bubble.style.cssText =
          `position:absolute;left:${x}px;top:${y}px;width:34px;height:34px;` +
          'border-radius:50% 50% 50% 4px;background:#0F6CBD;color:#fff;font-size:15px;' +
          'font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);' +
          'cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center;';
        bubble.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        bubble.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenRef.current(c.id);
        });
        layer.appendChild(bubble);
      }
    };

    render();
    // 要素の移動・追加編集にゆるく追従する(コメント数は少ないので軽い)
    const timer = setInterval(render, 900);
    return () => {
      alive = false;
      clearInterval(timer);
      const layer = getIframeDoc()?.querySelector('.gg-comment-layer');
      layer?.remove();
    };
  }, [active, page, getIframeDoc, JSON.stringify(comments.map((c) => [c.id, c.anchorSrc, c.resolved, c.author]))]);
}

/* ============================ 右パネル ============================ */

export function PptCommentsPanel({
  page,
  theme,
  onClose,
  focusSignal,
  activeThreadId,
  onActiveThread,
}: {
  page: number;
  theme: PptTheme;
  onClose: () => void;
  /** 値が変わったら新規コメント入力へフォーカス */
  focusSignal: number;
  activeThreadId: string | null;
  onActiveThread: (id: string | null) => void;
}) {
  const pal = PPT_PALETTES[theme];
  const deck = useDeck();
  const { getIframeDoc, selectedElement } = useEditorContext();
  const comments = deck.slides[page - 1]?.comments ?? [];

  const [author, setAuthor] = useState(loadAuthor);
  const [draft, setDraft] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusSignal > 0) composerRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (activeThreadId) {
      threadRefs.current[activeThreadId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeThreadId]);

  const saveAuthor = (v: string) => {
    setAuthor(v);
    try {
      localStorage.setItem(AUTHOR_KEY, v);
    } catch { /* 記憶できなくても続行 */ }
  };

  /**
   * 「AIで修正」の進行状況(スレッドIDごと)。
   *
   * 共通の run()(busyで全ボタンを止め、失敗をalertで出す)には載せない。
   * このジョブは1〜3分かかるため、走らせている間ほかのコメント操作まで
   * 止まってしまうし、結果はスレッドの中に出したいため。
   */
  const [fixJobs, setFixJobs] = useState<Record<string, { message: string; error?: string }>>({});

  const startFix = useCallback(
    async (commentId: string) => {
      setFixJobs((prev) => ({ ...prev, [commentId]: { message: '開始中…' } }));
      try {
        const res = await fetch('/__comment-fix', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ page, commentId }),
        });
        const { jobId, error } = await readApiJson<{ jobId?: string; error?: string }>(res);
        if (!jobId) throw new Error(error ?? '開始できませんでした');

        const startedAt = Date.now();
        while (Date.now() - startedAt < 8 * 60 * 1000) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await readApiJson<{ state: string; message?: string; error?: string }>(
            await fetch(`/__comment-fix/status/${jobId}`),
          );
          if (st.state === 'running') {
            setFixJobs((prev) => ({ ...prev, [commentId]: { message: st.message || '実行中…' } }));
            continue;
          }
          if (st.state === 'done') {
            // 原本TSXが変わったので、画面ごと読み直す。
            // (このページのモジュールは差分更新されないため、部分再描画では新しい姿にならない)
            setFixJobs((prev) => ({ ...prev, [commentId]: { message: '反映しました。読み込み中…' } }));
            window.location.reload();
            return;
          }
          throw new Error(st.error || '修正に失敗しました');
        }
        throw new Error('時間内に終わりませんでした');
      } catch (e) {
        setFixJobs((prev) => ({
          ...prev,
          [commentId]: { message: '', error: String(e instanceof Error ? e.message : e).slice(0, 200) },
        }));
      }
    },
    [page],
  );

  /** 全スライドの未解決コメントを一括修正。進捗はヘッダー下に出す */
  const [fixAll, setFixAll] = useState<{ running: boolean; message: string; error?: string } | null>(null);
  const deckAll = useDeck();
  const unresolvedTotal = deckAll.slides.reduce((n, sl) => n + unresolvedCount(sl.comments), 0);

  const startFixAll = useCallback(async () => {
    if (fixAll?.running) return;
    if (!window.confirm(
      `未解決のコメント${unresolvedTotal}件を、スライド順にAIが修正します。\n` +
      '1件あたり1〜3分かかります。実行しますか?\n' +
      '(各スレッドには対応内容が返信として残ります)',
    )) return;
    setFixAll({ running: true, message: '開始中…' });
    try {
      const res = await fetch('/__comment-fix', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const { jobId, error } = await readApiJson<{ jobId?: string; error?: string }>(res);
      if (!jobId) throw new Error(error ?? '開始できませんでした');
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await readApiJson<{ state: string; message?: string; error?: string }>(
          await fetch(`/__comment-fix/status/${jobId}`),
        );
        if (st.state === 'running') {
          setFixAll({ running: true, message: st.message || '実行中…' });
          continue;
        }
        if (st.state === 'done') {
          setFixAll({ running: false, message: st.message || '完了しました。読み込み中…' });
          window.location.reload();
          return;
        }
        throw new Error(st.error || '一括修正に失敗しました');
      }
    } catch (e) {
      setFixAll({ running: false, message: '', error: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }, [fixAll?.running, unresolvedTotal]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refreshDeck();
    } catch (e) {
      window.alert(`コメント操作に失敗しました: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  /** 選択中の要素からアンカーを拾う(選択なしならページ全体へのコメント) */
  const currentAnchor = useMemo(() => {
    const doc = getIframeDoc();
    if (!doc || !selectedElement) return null;
    const el = doc.querySelector<HTMLElement>(`[data-element-id="${selectedElement.id}"]`);
    if (!el) return null;
    const src = anchorValueOf(doc.body, el);
    if (!src) return null;
    const { label, kind } = describeElement(el);
    return { src, label, kind, tag: el.tagName.toLowerCase() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, getIframeDoc]);

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    void run(() =>
      commentAction(page, {
        action: 'add',
        author: author.trim() || 'ゲスト',
        text,
        anchorSrc: currentAnchor?.src,
        anchorLabel: currentAnchor?.label,
      }),
    ).then(() => setDraft(''));
  };

  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  /**
   * 1スレッドの見た目。
   *
   * ⚠️ ここをコンポーネント（`const Thread = () => …` を JSX で `<Thread />` と書く形）
   * にしてはいけない。パネルが再描画されるたびに関数の実体が変わり、Reactが
   * 「別のコンポーネント」と見なしてスレッドごと作り直す。
   * その結果、返信欄のテキストエリアが1打鍵ごとに作り直され、
   *   ・キャレットが先頭に戻るため、文字が右から左に入るように見える
   *   ・日本語入力の変換が1文字ずつ確定してしまう
   * という状態になる（実際に起きた）。ただの関数として呼び出す形にしておく。
   */
  const renderThread = (c: SlideComment) => (
    <div
      key={c.id}
      ref={(el) => { threadRefs.current[c.id] = el; }}
      className="rounded-lg border p-2.5"
      style={{
        borderColor: activeThreadId === c.id ? '#0F6CBD' : pal.border,
        backgroundColor: pal.control,
        opacity: c.resolved ? 0.72 : 1,
      }}
      onClick={() => onActiveThread(c.id)}
    >
      <div className="flex items-center gap-2">
        <Avatar name={c.author} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium" style={{ color: pal.text }}>{c.author}</div>
          <div className="text-[10px]" style={{ color: pal.sub }}>{fmtTime(c.createdAt)}</div>
        </div>
        {c.resolved ? (
          <button
            title="スレッドを再開"
            onClick={(e) => { e.stopPropagation(); void run(() => commentAction(page, { action: 'resolve', commentId: c.id, resolved: false })); }}
            className="rounded p-1" style={{ color: pal.sub }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            title="解決済みにする"
            onClick={(e) => { e.stopPropagation(); void run(() => commentAction(page, { action: 'resolve', commentId: c.id, resolved: true })); }}
            className="rounded p-1" style={{ color: pal.sub }}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          title="スレッドを削除"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('このコメントスレッドを削除しますか?')) {
              void run(() => commentAction(page, { action: 'delete', commentId: c.id }));
            }
          }}
          className="rounded p-1" style={{ color: pal.sub }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {c.anchorSrc && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: '#0F6CBD' }}>
          <MapPin className="h-3 w-3" />
          {c.anchorLabel ? `「${c.anchorLabel}」` : '要素に添付'}
        </div>
      )}

      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: pal.text }}>
        {c.text}
      </p>

      {(c.replies ?? []).map((r) => (
        <div key={r.id} className="mt-2 border-l-2 pl-2.5" style={{ borderColor: pal.border }}>
          <div className="flex items-center gap-1.5">
            <Avatar name={r.author} />
            <span className="text-[11px] font-medium" style={{ color: pal.text }}>{r.author}</span>
            <span className="text-[10px]" style={{ color: pal.sub }}>{fmtTime(r.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: pal.text }}>{r.text}</p>
        </div>
      ))}

      {/* AIで修正: 指摘の内容どおりに原本TSXを直す。完了後はリロードして新しい姿を出す */}
      {!c.resolved && (
        <div className="mt-2">
          {fixJobs[c.id] && !fixJobs[c.id].error ? (
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: pal.sub }}>
              <Loader2 className="h-3 w-3 animate-spin" />
              {fixJobs[c.id].message}
            </div>
          ) : (
            can('apiFetch') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void startFix(c.id);
              }}
              title="この指摘のとおりにAIが原本(TSX)を修正します"
              className="flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] transition-colors"
              style={{ borderColor: pal.border, color: '#8B5CF6' }}
            >
              <Sparkles className="h-3 w-3" />
              AIで修正
            </button>
            )
          )}
          {fixJobs[c.id]?.error && (
            <p className="mt-1 text-[11px] leading-snug" style={{ color: '#d13438' }}>
              {fixJobs[c.id].error}
            </p>
          )}
        </div>
      )}

      {replyFor === c.id ? (
        <div className="mt-2 flex items-end gap-1.5">
          <textarea
            autoFocus
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const t = replyDraft.trim();
                if (t) {
                  void run(() => commentAction(page, { action: 'reply', commentId: c.id, author: author.trim() || 'ゲスト', text: t }))
                    .then(() => { setReplyDraft(''); setReplyFor(null); });
                }
              }
            }}
            rows={2}
            placeholder="返信… (⌘+Enterで送信)"
            className="min-h-[40px] flex-1 resize-none rounded border p-1.5 text-[12px] outline-none"
            style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
          />
          <button
            title="返信を送信"
            onClick={() => {
              const t = replyDraft.trim();
              if (t) {
                void run(() => commentAction(page, { action: 'reply', commentId: c.id, author: author.trim() || 'ゲスト', text: t }))
                  .then(() => { setReplyDraft(''); setReplyFor(null); });
              }
            }}
            className="rounded p-1.5" style={{ color: '#0F6CBD' }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        !c.resolved && (
          <button
            onClick={(e) => { e.stopPropagation(); setReplyFor(c.id); setReplyDraft(''); }}
            className="mt-1.5 flex items-center gap-1 text-[11px]"
            style={{ color: '#0F6CBD' }}
          >
            <CornerUpLeft className="h-3 w-3" />
            返信
          </button>
        )
      )}
    </div>
  );

  return (
    <div
      className="flex w-[292px] shrink-0 flex-col border-l"
      style={{ backgroundColor: PPT_PALETTES[theme].rail, borderColor: pal.border }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: pal.border }}>
        <span className="text-[13px] font-medium" style={{ color: pal.text }}>コメント</span>
        <span className="truncate text-[11px]" style={{ color: pal.sub }}>
          {deckAll.slides[page - 1]?.title ?? `ページ ${page}`}
        </span>
        {unresolvedTotal > 0 && !fixAll?.running && can('apiFetch') && (
          <button
            onClick={() => void startFixAll()}
            title="全スライドの未解決コメントをAIが順に修正し、各スレッドへ対応報告を返信します"
            className="ml-2 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
            style={{ borderColor: pal.border, color: pal.text }}
          >
            <Sparkles className="h-3 w-3" />
            すべてAIで修正({unresolvedTotal})
          </button>
        )}
        <button onClick={onClose} className="ml-auto rounded p-1" style={{ color: pal.sub }} title="閉じる">
          <X className="h-4 w-4" />
        </button>
      </div>
      {(fixAll?.running || fixAll?.error) && (
        <div className="border-b px-3 py-1.5 text-[11px]" style={{ borderColor: pal.border, color: fixAll.error ? '#f66' : pal.sub }}>
          {fixAll.error ? `一括修正に失敗: ${fixAll.error}` : `⏳ ${fixAll.message}`}
        </div>
      )}


      {/* 新規コメント */}
      <div className="border-b p-2.5" style={{ borderColor: pal.border }}>
        <div className="flex items-center gap-1.5">
          <Avatar name={author || 'ゲ'} />
          <input
            value={author}
            onChange={(e) => saveAuthor(e.target.value)}
            placeholder="名前(記憶されます)"
            className="h-6 flex-1 rounded border px-1.5 text-[11px] outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
          />
        </div>
        {/* 何に対するコメントかを、投稿する前に必ず見せる */}
        {currentAnchor ? (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[10px]"
            style={{
              color: '#0F6CBD',
              borderColor: '#0F6CBD',
              backgroundColor: 'rgba(15,108,189,.08)',
            }}
            title={currentAnchor.src}
          >
            <MapPin className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0">
              {currentAnchor.kind === 'range' ? (
                <>
                  選択中の<span className="font-bold">{currentAnchor.tag}</span>（「
                  <span className="font-bold">{currentAnchor.label}</span>」を含む範囲）へのコメント
                </>
              ) : (
                <>
                  選択中の<span className="font-bold">{currentAnchor.tag}</span>「
                  <span className="font-bold">{currentAnchor.label}</span>」へのコメント
                </>
              )}
            </span>
          </div>
        ) : (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded border border-dashed px-1.5 py-1 text-[10px]"
            style={{ color: pal.sub, borderColor: pal.border }}
          >
            <MapPin className="mt-px h-3 w-3 shrink-0" />
            <span>
              ページ全体へのコメント（要素を選ぶと、その要素へのコメントになります）
            </span>
          </div>
        )}
        <div className="mt-1.5 flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                post();
              }
            }}
            rows={2}
            placeholder={currentAnchor ? 'コメント… (⌘+Enter)' : 'この内容へのコメント… (⌘+Enter)'}
            className="min-h-[44px] flex-1 resize-none rounded border p-1.5 text-[12px] outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
          />
          <button
            onClick={post}
            disabled={busy || !draft.trim()}
            title="コメントを投稿"
            className="rounded p-1.5 disabled:opacity-40"
            style={{ color: '#0F6CBD' }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* スレッド一覧 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {open.length === 0 && resolved.length === 0 && (
          <p className="px-1 pt-2 text-[12px]" style={{ color: pal.sub }}>
            まだコメントはありません。要素を選択して投稿すると、その要素に吹き出しが付きます。
          </p>
        )}
        {open.map((c) => renderThread(c))}

        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="w-full pt-1 text-left text-[11px]"
            style={{ color: pal.sub }}
          >
            {showResolved ? '▾' : '▸'} 解決済み ({resolved.length})
          </button>
        )}
        {showResolved && resolved.map((c) => renderThread(c))}
      </div>
    </div>
  );
}


/** マーカーだけを常駐させる薄いホスト(パネルが閉じていても吹き出しは見える) */
export function PptCommentMarkers({
  page,
  onOpenThread,
}: {
  page: number;
  onOpenThread: (commentId: string) => void;
}) {
  useCommentMarkers({ page, active: true, onOpenThread });
  return null;
}
