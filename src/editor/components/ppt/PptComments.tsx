"use client";

/**
 * PowerPoint風UIのコメント機能(実機の「モダンコメント」に寄せたフル実装)。
 *
 * - スレッド形式(返信・解決/再開・削除)。deck.json のエントリに永続化
 * - 要素アンカー: 追加時に要素を選択していれば、その要素の刻印(data-gg-src / data-wf-src)に
 *   紐づき、キャンバス上にコメントバブル(マーカー)が出る。クリックでパネルの該当スレッドへ。
 *   刻印の無い HTML(構成ラフの HTML 正本)では、紙面からの CSS パス(`css:…`)を刻印の代わりにする
 * - 範囲アンカー: コメントツール(C)で紙面をドラッグすると、その矩形(紙面の px)に紐づく。
 *   クリックだけなら点。gg-manager のフィードバックシートの「指摘」と同じ考え方
 *   投稿する前に「何に対するコメントか」を必ず出す(指定した範囲 / 選択中の要素名 / ページ全体)
 * - マーカーは iframe 内のオーバーレイ層(.gg-comment-layer)に描く。
 *   保存時に丸ごと剥がされるため、上書きHTML・原本TSXには一切混入しない
 * - 名前は localStorage に記憶(ローカルツールなのでアカウントは要求しない)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CornerUpLeft, Crosshair, Loader2, MapPin, RotateCcw, Send, MessageSquare, Sparkles, Trash2, X } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { useCanvasViewStateOptional } from '../../contexts/MultiPageCanvasContext';
import { useDeck, applyDeck } from '../../../components/viewer/useDeck';
import { commentAction, type SlideComment } from '../../../lib/deck';
import { can, io, type CommentRect, type EditorDeck } from '../../../io';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ConfirmDialog } from '../shell/ConfirmDialog';
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

/**
 * 要素からアンカー値を作る。
 * 刻印があればそれ、無ければ紙面(`#artboard`)からの CSS パス(`css:#artboard>main>section:nth-of-type(2)>h2`)。
 * どちらも作れなければ null（＝ページ全体へのコメント）
 */
export function anchorValueOf(root: HTMLElement, el: HTMLElement): string | null {
  for (const attr of ANCHOR_ATTRS) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    const same = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}="${CSS.escape(raw)}"]`));
    if (same.length <= 1) return raw;
    const index = same.indexOf(el);
    return index <= 0 ? raw : `${raw}#${index}`;
  }
  return cssPathOf(el);
}

const CSS_ANCHOR = 'css:';

/**
 * 刻印の無い HTML 向けの要素アンカー。紙面(`#artboard`)から要素までを
 * `tag:nth-of-type(n)` で辿る短いパス。途中に一意な id があればそこから始める。
 * エディタが付ける data-element-id は読み込みのたびに変わるので使えない。
 */
function cssPathOf(el: HTMLElement): string | null {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return null;
    const id = cur.id;
    if (id && /^[A-Za-z][\w-]*$/.test(id) && doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
      parts.unshift(`#${id}`);
      return CSS_ANCHOR + parts.join('>');
    }
    const parent: HTMLElement | null = cur.parentElement;
    if (!parent) return null;
    const same = Array.from(parent.children).filter((sibling) => sibling.tagName === cur!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
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

/**
 * アンカー値から要素を引く。刻印なら `#N` が N 番目。
 * `css:` パスは見つからなければ、辿れる所まで戻ってその下から同じタグ・同じラベルの要素を
 * 1 つだけ探す(構造が少し変わっても付いてくる。ページ全体を文字だけで探すことはしない)
 */
export function findAnchored(root: HTMLElement, value: string, label?: string): HTMLElement | null {
  if (value.startsWith(CSS_ANCHOR)) {
    const path = value.slice(CSS_ANCHOR.length);
    const doc = root.ownerDocument;
    const q = (sel: string) => { try { return doc.querySelector<HTMLElement>(sel); } catch { return null; } };
    const exact = q(path);
    if (exact) return exact;
    const segments = path.split('>');
    const tag = (segments[segments.length - 1] ?? '').replace(/:nth-of-type\(\d+\)$/, '');
    if (!label || !tag || tag.startsWith('#')) return null;
    for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
      const scope = q(segments.slice(0, depth).join('>'));
      if (!scope) continue;
      const hits = Array.from(scope.querySelectorAll<HTMLElement>(tag)).filter((el) => describeElement(el).label === label);
      return hits.length === 1 ? hits[0] : null;
    }
    return null;
  }
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

/** 名前を記憶する。右パネルとコメントボードで同じ置き場を使う */
export function storeAuthor(value: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, value);
  } catch { /* 記憶できなくても続行 */ }
}

/** 未解決コメント数(サムネイルのバッジ用) */
export function unresolvedCount(comments?: SlideComment[]): number {
  return (comments ?? []).filter((c) => !c.resolved).length;
}

export const fmtTime = (iso: string) => {
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
      style={{ backgroundColor: colors[h % colors.length], color: "#ffffff" }}
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
}

/* ============================ キャンバス上のマーカー ============================ */

/** マーカーを描く表示専用の層。保存時に丸ごと剥がされる(html-utils が除く) */
export function ensureCommentLayer(doc: Document, artboard: HTMLElement): HTMLElement {
  let layer = artboard.querySelector<HTMLElement>(':scope > .gg-comment-layer');
  if (!layer) {
    layer = doc.createElement('div');
    layer.className = 'gg-comment-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9000;';
    artboard.appendChild(layer);
  }
  return layer;
}

/** 紙面の倍率(iframe 内の transform × 外側のキャンバス倍率)。ピンや枠線を画面上で同じ太さに保つ */
function artboardScale(artboard: HTMLElement, outerZoom: number) {
  const rootRect = artboard.getBoundingClientRect();
  const innerScale = rootRect.width / artboard.offsetWidth || 1;
  return { rootRect, innerScale, scale: innerScale * outerZoom || 1 };
}

/** 点(クリックで置いたピン)か */
export function isPointRect(r: CommentRect): boolean {
  return r.width < 1 && r.height < 1;
}

/** 保存した矩形を今の紙面に合わせる。幅が変わっていたら横方向だけ比で補正する */
export function fitRect(rect: CommentRect, artboard: HTMLElement): CommentRect {
  const sx = rect.ref?.width ? artboard.offsetWidth / rect.ref.width : 1;
  return { x: rect.x * sx, y: rect.y, width: rect.width * sx, height: rect.height };
}

/** 矩形を人が読む形に(「範囲 (120, 840) 600×240」「点 (120, 840)」) */
export function describeRect(r: CommentRect): string {
  const n = (v: number) => String(Math.round(v));
  return isPointRect(r) ? `点 (${n(r.x)}, ${n(r.y)})` : `範囲 (${n(r.x)}, ${n(r.y)}) ${n(r.width)}×${n(r.height)}`;
}

/** ピンの文字。通し番号があれば番号、無ければ投稿者の頭文字 */
function pinText(c: SlideComment): string {
  return c.seq != null ? String(c.seq) : (c.author || '?').slice(0, 1);
}

/** 同じ値の再代入で MutationObserver を起こさない(フォーカス中の DOM も保つ) */
function applyStyles(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  const style = el.style as unknown as Record<string, string>;
  for (const [key, value] of Object.entries(styles)) {
    if (style[key] !== value) style[key] = value as string;
  }
}

/**
 * アンカー付きコメントのマーカーを iframe 内へ描く。
 * 座標はアートボード座標(要素の offset 系)なので、ズーム・パンに自動追従する。
 *
 * - 要素アンカー: 要素の右上に丸いピン(同じ要素に複数あれば縦に積む)
 * - 範囲アンカー: 矩形の枠 + 左上にピン。点なら ピンだけ
 * - 下書き(まだ投稿していない範囲): 破線の枠
 * パネルで開いているスレッドのマーカーは太く出す
 */
export function useCommentMarkers({
  page,
  active,
  onOpenThread,
  activeThreadId = null,
  draftRect = null,
}: {
  page: number;
  active: boolean;
  onOpenThread: (commentId: string) => void;
  activeThreadId?: string | null;
  draftRect?: CommentRect | null;
}) {
  const { getIframeDoc } = useEditorContext();
  const deck = useDeck();
  const comments = deck.slides[page - 1]?.comments ?? [];
  const onOpenRef = useRef(onOpenThread);
  onOpenRef.current = onOpenThread;
  // マルチフレームのキャンバスでは iframe の外側にも倍率が掛かる。ピンは画面上で同じ大きさに保つ
  const outerZoom = useCanvasViewStateOptional()?.canvasZoom ?? 1;

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const render = () => {
      if (!alive) return;
      const doc = getIframeDoc();
      const artboard = doc?.getElementById('artboard');
      if (!doc || !artboard) return;
      const layer = ensureCommentLayer(doc, artboard);
      const shown = comments.filter((c) => (c.anchorRect || c.anchorSrc) && !c.resolved);
      const wanted = new Set(shown.map((c) => c.id));
      layer.querySelectorAll<HTMLElement>('[data-comment-id]').forEach((el) => {
        if (!wanted.has(el.dataset.commentId!)) el.remove();
      });
      const { rootRect, innerScale, scale } = artboardScale(artboard, outerZoom);
      const size = 32 / scale;
      const maxX = Math.max(0, artboard.offsetWidth - size);
      const stacks = new Map<string, number>();

      const ensure = <T extends HTMLElement>(c: SlideComment, role: 'pin' | 'rect'): T => {
        const sel = `[data-comment-id="${CSS.escape(c.id)}"][data-comment-${role}]`;
        let el = layer.querySelector<T>(sel);
        if (!el) {
          el = doc.createElement(role === 'pin' ? 'button' : 'div') as unknown as T;
          if (role === 'pin') (el as unknown as HTMLButtonElement).type = 'button';
          el.setAttribute('data-comment-id', c.id);
          el.setAttribute(`data-comment-${role}`, '');
          el.addEventListener('mousedown', (e) => { e.stopPropagation(); });
          el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
          el.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); onOpenRef.current(c.id);
          });
          if (role === 'pin') {
            el.addEventListener('focus', () => { el!.style.outline = '3px solid #2459c4'; });
            el.addEventListener('blur', () => { el!.style.outline = ''; });
          }
          layer.appendChild(el);
        }
        return el;
      };

      for (const c of shown) {
        const isActive = c.id === activeThreadId;
        let x = 0;
        let y = 0;
        if (c.anchorRect) {
          const r = fitRect(c.anchorRect, artboard);
          if (isPointRect(r)) {
            layer.querySelector(`[data-comment-id="${CSS.escape(c.id)}"][data-comment-rect]`)?.remove();
            x = r.x - size / 2;
            y = r.y - size / 2;
          } else {
            const box = ensure<HTMLDivElement>(c, 'rect');
            box.title = `${c.author}のコメント：${c.text.slice(0, 80)}`;
            applyStyles(box, {
              position: 'absolute', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`,
              boxSizing: 'border-box', border: `${(isActive ? 3 : 2) / scale}px solid #2459c4`,
              borderRadius: `${3 / scale}px`, background: isActive ? 'rgba(36,89,196,.16)' : 'rgba(36,89,196,.07)',
              pointerEvents: 'auto', cursor: 'pointer',
            });
            // ピンは矩形の左上の角に掛ける
            x = r.x - size / 2;
            y = r.y - size / 2;
          }
        } else {
          const target = findAnchored(artboard, c.anchorSrc!, c.anchorLabel);
          // 要素が削除されたコメントは一覧から参照できる。別の場所に誤って付けない。
          if (!target) {
            layer.querySelectorAll(`[data-comment-id="${CSS.escape(c.id)}"]`).forEach((el) => el.remove());
            continue;
          }
          const rect = target.getBoundingClientRect();
          const stack = stacks.get(c.anchorSrc!) ?? 0;
          stacks.set(c.anchorSrc!, stack + 1);
          x = (rect.right - rootRect.left) / innerScale - size / 2;
          y = (rect.top - rootRect.top) / innerScale - size / 2 + stack * (size + 4 / scale);
        }
        const pin = ensure<HTMLButtonElement>(c, 'pin');
        const label = `${c.seq != null ? `#${c.seq} ` : ''}${c.author}のコメント：${c.text.slice(0, 80)}`;
        pin.title = label;
        pin.setAttribute('aria-label', label);
        const text = pinText(c);
        if (pin.textContent !== text) pin.textContent = text;
        applyStyles(pin, {
          position: 'absolute', left: `${Math.max(0, Math.min(maxX, x))}px`, top: `${Math.max(0, y)}px`,
          width: `${size}px`, height: `${size}px`,
          borderRadius: '50% 50% 50% 4px', background: '#2459c4', color: '#fff',
          fontSize: `${(text.length > 1 ? 12 : 13) / scale}px`,
          fontFamily: 'system-ui, sans-serif', fontWeight: '700', border: `${2 / scale}px solid #fff`,
          boxShadow: isActive ? `0 0 0 ${3 / scale}px rgba(36,89,196,.35), 0 2px 8px #0003` : '0 2px 8px #0003',
          cursor: 'pointer', pointerEvents: 'auto', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '0px', lineHeight: '1',
        });
      }

      // 下書き(投稿前の範囲)。破線で出し、投稿・解除で消える
      let draft = layer.querySelector<HTMLElement>('[data-comment-draft]');
      if (draftRect) {
        if (!draft) {
          draft = doc.createElement('div');
          draft.setAttribute('data-comment-draft', '');
          layer.appendChild(draft);
        }
        const r = fitRect(draftRect, artboard);
        const point = isPointRect(r);
        const d = 14 / scale;
        applyStyles(draft, {
          position: 'absolute',
          left: `${point ? r.x - d / 2 : r.x}px`, top: `${point ? r.y - d / 2 : r.y}px`,
          width: `${point ? d : r.width}px`, height: `${point ? d : r.height}px`,
          boxSizing: 'border-box', border: `${2 / scale}px dashed #2459c4`,
          borderRadius: point ? '50%' : `${3 / scale}px`, background: 'rgba(36,89,196,.10)',
          pointerEvents: 'none',
        });
      } else {
        draft?.remove();
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
  }, [
    active, page, getIframeDoc, outerZoom, activeThreadId,
    JSON.stringify(draftRect),
    JSON.stringify(comments.map((c) => [c.id, c.anchorSrc, c.anchorRect, c.seq, c.resolved, c.author, c.text])),
  ]);
}

/**
 * コメントツール(C)。紙面をドラッグして範囲を決める。クリックだけなら点。
 * iframe の document でポインタを捕まえ(要素は comment-mode で反応しない)、
 * 紙面の外へ出ても離した位置まで追う(setPointerCapture)。
 * 決まった矩形は onRegion に渡す(投稿はパネル側)。
 */
export function useCommentRegionTool({
  active,
  onRegion,
}: {
  active: boolean;
  onRegion: (rect: CommentRect) => void;
}) {
  const { getIframeDoc, iframeReady } = useEditorContext();
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;
  const outerZoom = useCanvasViewStateOptional()?.canvasZoom ?? 1;

  useEffect(() => {
    if (!active) return;
    const doc = getIframeDoc();
    const artboard = doc?.getElementById('artboard');
    if (!doc || !artboard) return;

    let start: { x: number; y: number } | null = null;
    let box: HTMLElement | null = null;

    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const toArtboard = (e: PointerEvent) => {
      const r = artboard.getBoundingClientRect();
      const s = r.width / artboard.offsetWidth || 1;
      return {
        x: clamp((e.clientX - r.left) / s, artboard.offsetWidth),
        y: clamp((e.clientY - r.top) / s, artboard.offsetHeight),
      };
    };
    const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
    });

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 既にあるピンのクリックは「スレッドを開く」。矩形の上からは新しい範囲を描ける(comment-mode で矩形は反応しない)
      if ((e.target as HTMLElement | null)?.closest?.('[data-comment-pin]')) return;
      e.preventDefault();
      e.stopPropagation();
      start = toArtboard(e);
      try { artboard.setPointerCapture(e.pointerId); } catch { /* 捕まえられなくても続行 */ }
      const { scale } = artboardScale(artboard, outerZoom);
      box = doc.createElement('div');
      box.setAttribute('data-comment-drafting', '');
      box.style.cssText = `position:absolute;left:${start.x}px;top:${start.y}px;width:0;height:0;box-sizing:border-box;` +
        `border:${2 / scale}px dashed #2459c4;background:rgba(36,89,196,.10);pointer-events:none;`;
      ensureCommentLayer(doc, artboard).appendChild(box);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || !box) return;
      e.preventDefault();
      const r = rectOf(start, toArtboard(e));
      box.style.left = `${r.x}px`;
      box.style.top = `${r.y}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (!start) return;
      const from = start;
      const r = rectOf(from, toArtboard(e));
      start = null;
      try { artboard.releasePointerCapture(e.pointerId); } catch { /* 捕まえていない */ }
      box?.remove();
      box = null;
      if (cancelled) return;
      e.preventDefault();
      e.stopPropagation();
      // 4px 未満の動きはクリック＝点
      const point = r.width < 4 && r.height < 4;
      const round = (v: number) => Math.round(v);
      onRegionRef.current({
        x: round(point ? from.x : r.x),
        y: round(point ? from.y : r.y),
        width: point ? 0 : round(r.width),
        height: point ? 0 : round(r.height),
        ref: { width: artboard.offsetWidth, height: artboard.offsetHeight },
      });
    };
    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
      box?.remove();
    };
  }, [active, iframeReady, getIframeDoc, outerZoom]);
}

/* ============================ 右パネル ============================ */

export function PptCommentsPanel({
  page,
  theme,
  onClose,
  focusSignal,
  activeThreadId,
  onActiveThread,
  pendingRect = null,
  onClearPendingRect,
  onPickRegion,
}: {
  page: number;
  theme: PptTheme;
  onClose: () => void;
  /** 値が変わったら新規コメント入力へフォーカス */
  focusSignal: number;
  activeThreadId: string | null;
  onActiveThread: (id: string | null) => void;
  /** コメントツールで指定した範囲(投稿前)。投稿か解除で消える */
  pendingRect?: CommentRect | null;
  onClearPendingRect?: () => void;
  /** 「範囲を指定」= コメントツールに切り替える */
  onPickRegion?: () => void;
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
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { width, isDragging, resizeHandleProps } = useResizablePanel({ initialWidth: 336, minWidth: 304, maxWidth: 480, direction: 'left', storageKey: 'gg-editor:comments-width' });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusSignal > 0) composerRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (activeThreadId) {
      threadRefs.current[activeThreadId]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [activeThreadId]);

  const saveAuthor = (v: string) => {
    setAuthor(v);
    storeAuthor(v);
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
        const data = await io().apiFetch!('/__comment-fix', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ page, commentId }),
        });
        const { jobId, error } = data as { jobId?: string; error?: string };
        if (!jobId) throw new Error(error ?? '開始できませんでした');

        const startedAt = Date.now();
        while (Date.now() - startedAt < 8 * 60 * 1000) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await io().apiFetch!(`/__comment-fix/status/${jobId}`) as { state: string; message?: string; error?: string };
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
      const data = await io().apiFetch!('/__comment-fix', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const { jobId, error } = data as { jobId?: string; error?: string };
      if (!jobId) throw new Error(error ?? '開始できませんでした');
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await io().apiFetch!(`/__comment-fix/status/${jobId}`) as { state: string; message?: string; error?: string };
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

  const run = useCallback(async (fn: () => Promise<EditorDeck>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      applyDeck(await fn());
      return true;
    } catch (e) {
      setError(`操作できませんでした。${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

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
    // 範囲を指定していればそれが対象(要素の選択より優先)
    void run(() =>
      commentAction(page, {
        action: 'add',
        author: author.trim() || 'ゲスト',
        text,
        anchorSrc: pendingRect ? undefined : currentAnchor?.src,
        anchorLabel: pendingRect ? describeRect(pendingRect) : currentAnchor?.label,
        anchorRect: pendingRect ?? undefined,
      }),
    ).then((ok) => { if (ok) { setDraft(''); onClearPendingRect?.(); } });
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
      className="ed-comment-thread rounded-lg border p-4"
      data-comment-thread={c.id}
      aria-label={`${c.author}のコメント`}
      style={{
        borderColor: activeThreadId === c.id ? 'var(--ed-accent)' : pal.border,
        backgroundColor: pal.control,

      }}
      onClick={() => onActiveThread(c.id)}
    >
      <div className="flex items-center gap-2">
        <Avatar name={c.author} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium" style={{ color: pal.text }}>
            {c.seq != null && <span className="mr-1 tabular-nums" style={{ color: 'var(--ed-accent)' }}>#{c.seq}</span>}
            {c.author}
          </div>
          <div className="text-[10px]" style={{ color: pal.sub }}>{fmtTime(c.createdAt)}</div>
        </div>
        {c.resolved ? (
          <button
            disabled={busy} aria-label="スレッドを再開" title="スレッドを再開"
            onClick={(e) => { e.stopPropagation(); void run(() => commentAction(page, { action: 'resolve', commentId: c.id, resolved: false })); }}
            className="rounded p-1" style={{ color: pal.sub }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            disabled={busy} aria-label="解決済みにする" title="解決済みにする"
            onClick={(e) => { e.stopPropagation(); void run(() => commentAction(page, { action: 'resolve', commentId: c.id, resolved: true })); }}
            className="rounded p-1" style={{ color: pal.sub }}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          disabled={busy} aria-label="スレッドを削除" title="スレッドを削除"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteId(c.id);
          }}
          className="rounded p-1" style={{ color: pal.sub }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {c.anchorRect ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: 'var(--ed-accent)' }} data-comment-rect-label>
          <Crosshair className="h-3 w-3" />
          {describeRect(c.anchorRect)}
        </div>
      ) : c.anchorSrc && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: 'var(--ed-accent)' }}>
          <MapPin className="h-3 w-3" />
          {c.anchorLabel ? `「${c.anchorLabel}」` : '要素に添付'}
        </div>
      )}

      {c.resolved && <p className="mt-2 text-xs text-gray-400">解決済み</p>}
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
              style={{ borderColor: pal.border, color: 'var(--ed-accent)' }}
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
            aria-label="返信内容"
            disabled={busy}
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const t = replyDraft.trim();
                if (t) {
                  void run(() => commentAction(page, { action: 'reply', commentId: c.id, author: author.trim() || 'ゲスト', text: t }))
                    .then((ok) => { if (ok) { setReplyDraft(''); setReplyFor(null); } });
                }
              }
            }}
            rows={2}
            placeholder="返信… (⌘+Enterで送信)"
            className="min-h-[40px] flex-1 resize-none rounded border p-1.5 text-[12px] outline-none"
            style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
          />
          <button
            disabled={busy || !replyDraft.trim()} aria-label="返信を送信" title="返信を送信"
            onClick={() => {
              const t = replyDraft.trim();
              if (t) {
                void run(() => commentAction(page, { action: 'reply', commentId: c.id, author: author.trim() || 'ゲスト', text: t }))
                  .then((ok) => { if (ok) { setReplyDraft(''); setReplyFor(null); } });
              }
            }}
            className="rounded p-1.5" style={{ color: 'var(--ed-accent)' }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        !c.resolved && (
          <button
            onClick={(e) => { e.stopPropagation(); setReplyFor(c.id); setReplyDraft(''); }}
            className="mt-1.5 flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--ed-accent)' }}
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
      className="relative flex shrink-0 flex-col border-l ed-comments-panel"
      aria-label="コメント"
      data-comments-panel
      style={{ width, backgroundColor: "var(--ed-surface)", borderColor: pal.border }}
    >
      <div {...resizeHandleProps} />
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <div className="ed-panel-heading" style={{ borderColor: pal.border }}>
        <MessageSquare className="h-4 w-4" /><span style={{ color: pal.text }}>コメント</span>
        <span className="text-xs font-normal text-gray-400">未解決 {comments.filter((c) => !c.resolved).length}</span>

        <button onClick={onClose} className="ed-icon-button ml-auto" style={{ color: pal.sub }} title="コメントを閉じる" aria-label="コメントを閉じる">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4">
        {unresolvedTotal > 0 && !fixAll?.running && can('apiFetch') && (
          <button
            onClick={() => void startFixAll()}
            title="全スライドの未解決コメントをAIが順に修正し、各スレッドへ対応報告を返信します"
            className="my-2 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
            style={{ borderColor: pal.border, color: pal.text }}
          >
            <Sparkles className="h-3 w-3" />
            すべてAIで修正({unresolvedTotal})
          </button>
        )}
      </div>
      {(fixAll?.running || fixAll?.error) && (
        <div className="border-b px-3 py-1.5 text-[11px]" style={{ borderColor: pal.border, color: fixAll.error ? '#f66' : pal.sub }}>
          {fixAll.error ? `一括修正に失敗: ${fixAll.error}` : `⏳ ${fixAll.message}`}
        </div>
      )}


      {error && <p role="alert" className="px-4 py-3 text-xs" style={{ color: "var(--ed-danger)" }}>{error} 入力内容は残っています。</p>}
      <p className="border-b px-4 py-2 text-xs text-gray-400">{deck.slides[page - 1]?.title ?? `ページ ${page}`}</p>
      {/* 新規コメント */}
      <div className="border-b p-4" style={{ borderColor: pal.border }}>
        <div className="flex items-center gap-1.5">
          <Avatar name={author || 'ゲ'} />
          <input
            aria-label="投稿者の名前"
            value={author}
            onChange={(e) => saveAuthor(e.target.value)}
            placeholder="名前(記憶されます)"
            className="h-8 flex-1 rounded border px-2 text-[11px] outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
          />
        </div>
        {/* 何に対するコメントかを、投稿する前に必ず見せる(範囲 > 要素 > ページ全体) */}
        {pendingRect ? (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[10px]"
            data-comment-pending-rect
            style={{
              color: 'var(--ed-accent)',
              borderColor: 'var(--ed-accent)',
              backgroundColor: 'rgba(15,108,189,.08)',
            }}
          >
            <Crosshair className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1">
              指定した<span className="font-bold">{describeRect(pendingRect)}</span>へのコメント
            </span>
            {onClearPendingRect && (
              <button
                type="button"
                onClick={onClearPendingRect}
                aria-label="範囲の指定を解除"
                title="範囲の指定を解除"
                className="shrink-0 rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : currentAnchor ? (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[10px]"
            data-comment-anchor="element"
            style={{
              color: 'var(--ed-accent)',
              borderColor: 'var(--ed-accent)',
              backgroundColor: 'rgba(15,108,189,.08)',
            }}
          >
            <MapPin className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0">
              {currentAnchor.kind === 'range' ? (
                <>
                  「
                  <span className="font-bold">{currentAnchor.label}</span>」を含む範囲）へのコメント
                </>
              ) : (
                <>
                  選択中の「
                  <span className="font-bold">{currentAnchor.label}</span>」へのコメント
                </>
              )}
            </span>
          </div>
        ) : (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded border border-dashed px-1.5 py-1 text-[10px]"
            data-comment-anchor="page"
            style={{ color: pal.sub, borderColor: pal.border }}
          >
            <MapPin className="mt-px h-3 w-3 shrink-0" />
            <span>
              ページ全体へのコメント（要素を選ぶとその要素へ、「範囲を指定」で紙面の場所へ）
            </span>
          </div>
        )}
        {onPickRegion && !pendingRect && (
          <button
            type="button"
            onClick={onPickRegion}
            data-comment-pick-region
            title="紙面をドラッグして、コメントする範囲を指定します (C)"
            className="mt-1.5 flex items-center gap-1 rounded border px-1.5 py-1 text-[11px]"
            style={{ borderColor: pal.border, color: 'var(--ed-accent)' }}
          >
            <Crosshair className="h-3 w-3" />
            範囲を指定 <span style={{ color: pal.sub }}>C</span>
          </button>
        )}
        <div className="mt-1.5 flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            aria-label="コメント内容"
            disabled={busy}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey)) {
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
            className="ed-button ed-button-primary"
          >
            <Send className="h-4 w-4" />
            {busy ? "送信中" : "送信"}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">⌘ / Ctrl＋Enter で送信</p>
      </div>

      {/* スレッド一覧 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {open.length === 0 && resolved.length === 0 && (
          <p className="px-1 pt-2 text-[12px]" style={{ color: pal.sub }}>
            まだコメントはありません。要素を選ぶか「範囲を指定」で場所を決めて投稿すると、紙面にピンが付きます。
          </p>
        )}
        {open.length === 0 && resolved.length > 0 && <p className="py-2 text-xs text-gray-400">未解決のコメントはありません。</p>}
        {open.map((c) => renderThread(c))}

        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            aria-expanded={showResolved}
            className="w-full rounded py-2 text-left text-xs"
            style={{ color: pal.sub }}
          >
            {showResolved ? '▾' : '▸'} 解決済み ({resolved.length})
          </button>
        )}
        {showResolved && resolved.map((c) => renderThread(c))}
      </div>
      <ConfirmDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="コメントを削除しますか？" description="このスレッドと返信を削除します。この操作は取り消せません。"
        onConfirm={() => { if (deleteId) void run(() => commentAction(page, { action: 'delete', commentId: deleteId })); }} />
    </div>
  );
}


/**
 * マーカーだけを常駐させる薄いホスト(パネルが閉じていても吹き出しは見える)。
 * コメントツールの範囲指定もここで動かす(パネルは開くまでマウントされないため)
 */
export function PptCommentMarkers({
  page,
  onOpenThread,
  activeThreadId = null,
  draftRect = null,
  regionActive = false,
  onRegion,
}: {
  page: number;
  onOpenThread: (commentId: string) => void;
  activeThreadId?: string | null;
  draftRect?: CommentRect | null;
  regionActive?: boolean;
  onRegion?: (rect: CommentRect) => void;
}) {
  useCommentMarkers({ page, active: true, onOpenThread, activeThreadId, draftRect });
  useCommentRegionTool({ active: regionActive && !!onRegion, onRegion: (rect) => onRegion?.(rect) });
  return null;
}
