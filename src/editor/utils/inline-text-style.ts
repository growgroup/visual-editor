/**
 * テキストの一部を選んだまま文字の大きさ・太さ・色・字間を変えると、選んだ範囲だけに当てる
 * (Figma の文字の部分スタイルに当たる)。
 *
 * 【何が起きていたか】
 * 右パネルの入力欄にフォーカスが移るとテキスト編集は終わる(contenteditable が外れる)が、
 * iframe の選択範囲は残っている。エディタはそれを読まず、選択中の要素(段落)全体に当てていた。
 * 選んだ文字が自分の大きさを持つ行内要素(`<span class="text-sm">`)だと、段落が大きくなり
 * 選んだ所は元のまま = 「選んだ所ではなく、それ以外の文字が大きくなる」。
 *
 * 【方針】
 * - テキスト編集中に範囲を選んだら覚えておく。パネルへフォーカスが移っても忘れない。
 *   紙面を押す・キャレットだけにする・要素の文字を全部選ぶ(編集に入った直後の全選択)と忘れる
 * - 範囲に当てるのは文字の属性(INLINE_TEXT_PROPERTIES)だけ。行間・揃え・余白は要素に当てる(呼び出し側)
 * - 範囲の中の文字をテキストノードごとに見る。行内要素の文字を丸ごと選んでいればその要素に当て
 *   (包みを増やさない)、一部だけならその部分を <span> で包む。包んだ中にある同じ指定は外し、
 *   何の指定も無くなった span はほどく
 */

import { generateElementId } from './dom-utils';
import { applyTailwindStyles, clearInlineStyle, removeConflictingClasses } from './tailwind-utils';

/** 範囲に当てる文字の属性。これ以外(行間・揃え・余白・塗り)は要素に当てる */
export const INLINE_TEXT_PROPERTIES: ReadonlySet<string> = new Set([
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'color',
  'letterSpacing',
  'fontFamily',
]);

/** 範囲の中で値が揃っていないとき */
export const MIXED = '__mixed__';

/** 覚えている範囲の文字の見た目(computed style)。揃っていない属性は MIXED */
export interface InlineTextSummary {
  /** 範囲を含む要素(テキスト編集していた要素)の data-element-id */
  hostId: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  color: string;
  letterSpacing: string;
  fontFamily: string;
}

export interface InlineTextRange {
  doc: Document;
  host: HTMLElement;
  hostId: string;
  range: Range;
}

interface Segment {
  node: Text;
  start: number;
  end: number;
}

const TOOLBAR_SELECTOR = '#gg-inline-format-toolbar';

/** 文字の属性を持てる行内要素。これ以外(ブロック・画像・改行)には当てない */
const PHRASING_TAGS = new Set([
  'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'MARK', 'A', 'CODE', 'SUB', 'SUP',
  'FONT', 'ABBR', 'CITE', 'Q', 'DEL', 'INS', 'KBD', 'VAR', 'SAMP', 'DFN', 'TIME', 'DATA', 'BDI', 'BDO',
]);

/** ほどいてよい span が持っていてよい属性(エディタの印と、空の class / style) */
const EDITOR_ATTRS = new Set(['data-editable', 'data-inline', 'data-element-id', 'contenteditable']);

let remembered: InlineTextRange | null = null;
let summary: InlineTextSummary | null = null;
const listeners = new Set<() => void>();

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function setRemembered(next: InlineTextRange | null): void {
  if (!next && !remembered) return;
  remembered = next;
  summary = next ? summarize(next) : null;
  listeners.forEach((fn) => fn());
}

function isAlive(r: InlineTextRange): boolean {
  return (
    r.host.isConnected &&
    !r.range.collapsed &&
    r.host.contains(r.range.commonAncestorContainer) &&
    !!squash(r.range.toString())
  );
}

export function subscribeInlineTextSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getInlineTextSummary(): InlineTextSummary | null {
  return summary;
}

/** 要素 elementId の中で覚えている範囲がまだ使えるなら返す(使えなくなっていたら忘れる) */
export function getInlineTextRange(doc: Document, elementId: string): InlineTextRange | null {
  const r = remembered;
  if (!r) return null;
  if (!isAlive(r)) {
    setRemembered(null);
    return null;
  }
  return r.doc === doc && r.hostId === elementId ? r : null;
}

/** 範囲にかかるテキストノードと、その中の選ばれている位置。空白だけの部分は数えない */
function segmentsOf(range: Range): Segment[] {
  const out: Segment[] = [];
  const push = (node: Text) => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start < end && node.data.slice(start, end).trim()) out.push({ node, start, end });
  };
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) {
    push(root as Text);
    return out;
  }
  const walker = root.ownerDocument!.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (range.intersectsNode(n)) push(n as Text);
  }
  return out;
}

function isInlineBox(el: Element): el is HTMLElement {
  if (!PHRASING_TAGS.has(el.tagName)) return false;
  const view = el.ownerDocument.defaultView;
  return !!view && view.getComputedStyle(el).display.startsWith('inline');
}

/** 要素の中の文字(空白以外)がすべて「丸ごと選ばれたテキストノード」か */
function fullyCovered(el: Element, full: Set<Text>): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  let any = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data.trim()) continue;
    if (!full.has(t)) return false;
    any = true;
  }
  return any;
}

function isBareSpan(el: Element): boolean {
  if (el.tagName !== 'SPAN') return false;
  return Array.from(el.attributes).every(
    (a) => EDITOR_ATTRS.has(a.name) || ((a.name === 'class' || a.name === 'style') && !a.value.trim()),
  );
}

/** span を外して中身だけ残す(隣のテキストとはつながない。範囲の端に使うノードを消さないため) */
function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

const inDocumentOrder = (a: Node, b: Node) =>
  a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */ ? -1 : 1;

/** 改行と空白だけを挟んで隣り合う、同じ親の包み span を 1 つにまとめる */
function mergeAdjacent(spans: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && prev.parentNode === span.parentNode) {
      const between: Node[] = [];
      let n = prev.nextSibling;
      while (n && n !== span) {
        const gap = (n.nodeType === 3 && !n.textContent!.trim()) || (n.nodeType === 1 && /^(BR|WBR)$/.test((n as Element).tagName));
        if (!gap) break;
        between.push(n);
        n = n.nextSibling;
      }
      if (n === span) {
        between.forEach((b) => prev.appendChild(b));
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.remove();
        continue;
      }
    }
    out.push(span);
  }
  return out;
}

/**
 * 覚えている範囲に文字の属性を当てる。範囲は当てた先の中身に張り直す
 * (パネルで 1 桁ずつ打っても、2 回目以降は同じ要素に当たり、包みが増えない)。
 */
export function applyInlineTextStyle(target: InlineTextRange, styles: Record<string, string>): void {
  const { doc, host, range } = target;
  const segs = segmentsOf(range);
  if (!segs.length) return;

  // 選ばれていない所が空白だけなら、そのテキストノードは丸ごと選ばれている
  const full = new Set(
    segs.filter((s) => !s.node.data.slice(0, s.start).trim() && !s.node.data.slice(s.end).trim()).map((s) => s.node),
  );

  // 1. 丸ごと選ばれている行内要素(いちばん外側)は、その要素に当てる
  const owners: HTMLElement[] = [];
  const partial: Segment[] = [];
  for (const seg of segs) {
    let owner: HTMLElement | null = null;
    if (full.has(seg.node)) {
      for (
        let el = seg.node.parentElement;
        el && el !== host && host.contains(el) && isInlineBox(el) && fullyCovered(el, full);
        el = el.parentElement
      ) {
        owner = el;
      }
    }
    if (owner) {
      if (!owners.includes(owner)) owners.push(owner);
    } else {
      partial.push(seg);
    }
  }

  // 2. 残りの文字は、選ばれている部分だけを span で包む
  const wrapped: HTMLElement[] = [];
  for (const seg of partial) {
    if (owners.some((o) => o.contains(seg.node))) continue;
    let node = seg.node;
    if (seg.end < node.length) node.splitText(seg.end);
    if (seg.start > 0) node = node.splitText(seg.start);
    const span = doc.createElement('span');
    span.setAttribute('data-editable', 'true');
    span.setAttribute('data-inline', 'true');
    span.setAttribute('data-element-id', generateElementId());
    node.parentNode!.insertBefore(span, node);
    span.appendChild(node);
    wrapped.push(span);
  }

  const targets = [...owners, ...mergeAdjacent(wrapped.sort(inDocumentOrder))]
    .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)))
    .sort(inDocumentOrder);
  if (!targets.length) return;

  // 3. 中にある同じ指定を外してから当てる(外側の値が効くように)。指定が無くなった span はほどく
  const props = Object.keys(styles);
  for (const el of targets) {
    el.querySelectorAll<HTMLElement>('*').forEach((d) => {
      for (const p of props) {
        if (d.getAttribute('class')) removeConflictingClasses(d, p);
        clearInlineStyle(d, p);
      }
      if (d.getAttribute('style') === '') d.removeAttribute('style');
    });
    Array.from(el.querySelectorAll<HTMLElement>('span')).filter(isBareSpan).forEach(unwrap);
    applyTailwindStyles(el, styles);
    // 列挙の値(font-bold / font-normal / italic など)は applyTailwindStyles だとクラスだけになり、
    // ページの CSS にそのクラスが無いと効かない(提案書デッキには font-normal が無い)。
    // 文字の一部に当てた値は、任意値のクラスと同じくインラインにも書いて、クラスの有無によらず効かせる
    for (const [prop, value] of Object.entries(styles)) {
      if (value) (el.style as unknown as Record<string, string>)[prop] = value;
    }
  }

  const startRef = targets[0].firstChild ?? targets[0];
  const endRef = targets[targets.length - 1].lastChild ?? targets[targets.length - 1];
  targets.filter(isBareSpan).forEach(unwrap);

  const next = doc.createRange();
  next.setStartBefore(startRef);
  next.setEndAfter(endRef);
  const sel = doc.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(next);
  }
  setRemembered({ doc, host, hostId: target.hostId, range: next.cloneRange() });
}

function summarize(r: InlineTextRange): InlineTextSummary | null {
  const view = r.doc.defaultView;
  const segs = segmentsOf(r.range);
  if (!view || !segs.length) return null;
  const styles = segs.map((s) => view.getComputedStyle(s.node.parentElement!));
  const pick = (read: (cs: CSSStyleDeclaration) => string) => {
    const first = read(styles[0]);
    return styles.every((cs) => read(cs) === first) ? first : MIXED;
  };
  return {
    hostId: r.hostId,
    fontSize: pick((cs) => cs.fontSize),
    fontWeight: pick((cs) => cs.fontWeight),
    fontStyle: pick((cs) => cs.fontStyle),
    textDecoration: pick((cs) => cs.textDecorationLine),
    color: pick((cs) => cs.color),
    letterSpacing: pick((cs) => cs.letterSpacing),
    fontFamily: pick((cs) => cs.fontFamily),
  };
}

/**
 * テキスト編集中の範囲選択を覚える仕組みを iframe に取り付ける。
 * @returns 後片付け関数
 */
export function setupInlineTextSelection(doc: Document): () => void {
  const onSelectionChange = () => {
    const sel = doc.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (range && !range.collapsed) {
      const common = range.commonAncestorContainer;
      const el = common.nodeType === 1 ? (common as Element) : common.parentElement;
      const host = el?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
      const hostId = host?.getAttribute('data-element-id');
      if (host && hostId) {
        const text = squash(range.toString());
        // 文字を全部選んでいる(編集に入った直後の全選択を含む)ときは、要素全体の扱い
        if (text && text !== squash(host.textContent || '')) {
          setRemembered({ doc, host, hostId, range: range.cloneRange() });
        } else {
          setRemembered(null);
        }
        return;
      }
    }
    // パネルへフォーカスが移ったあとの変化(編集の終わり・パネルからの適用)では忘れない
    if (!doc.hasFocus()) {
      if (remembered && !isAlive(remembered)) setRemembered(null);
      return;
    }
    setRemembered(null);
  };
  // 紙面を押したら忘れる(要素の選択やドラッグで選択範囲が変わらない場合があるため)。
  // 書式ツールバーのボタンは選択を保ったまま押すものなので除く
  const onPointerDown = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.closest?.(TOOLBAR_SELECTOR)) return;
    setRemembered(null);
  };
  doc.addEventListener('selectionchange', onSelectionChange);
  doc.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    doc.removeEventListener('selectionchange', onSelectionChange);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    if (remembered?.doc === doc) setRemembered(null);
  };
}
