/**
 * 部品(パーツ)= HTML の `<template data-part-def>` と、ページに実体化されたインスタンス。
 *
 * ここは DOM だけを扱う純粋なユーティリティ(React に依存しない)。
 *
 * 【用語】
 * - 定義   … `<template data-part-def="X" data-part-v="N">` の中のルート要素 1 つ
 * - 実体化 … 定義を複製してページに置くこと。ルートに `data-part="X" data-part-v="N"` が付く。
 *            ページには**展開後の完全な HTML** が残る(読むときに何も解決しない)
 * - スロット … `data-slot="名前"`。インスタンスの中で編集してよい範囲。
 *            定義を更新したあとの一括反映(parts:sync)でも中身が保たれる
 *
 * 【ロック】インスタンスの中でスロットの外にある要素は編集対象にしない
 * (useIframeSetup が `data-editable` を付けない)。ルート自身は選択できる
 * (移動・削除・並び替え)。スロットの外を直したいときは「部品から切り離す」。
 */
import type { EditorPartDef } from '../io';
import { findFlowInsertion } from './utils/drop-target';
import { isNonEditableTag } from './utils/dom-utils';

export const PART_ATTR = 'data-part';
export const PART_VERSION_ATTR = 'data-part-v';
export const SLOT_ATTR = 'data-slot';
export const PART_DEF_ATTR = 'data-part-def';
const PART_NAME_ATTR = 'data-part-name';
const PART_CATEGORY_ATTR = 'data-part-category';
const PART_DESC_ATTR = 'data-part-desc';

/** 部品の id に使える形へ丸める(ファイル名・属性値になる) */
export function toPartId(raw: string): string {
  const s = raw.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `part-${Date.now().toString(36)}`;
}

function parseIntSafe(v: string | null | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * `<template data-part-def>` の文字列(ファイル 1 つぶん)を定義に読む。
 * template が無い・中身が空なら null。
 */
export function parsePartTemplate(source: string, doc: Document = document): EditorPartDef | null {
  const parser = new (doc.defaultView?.DOMParser ?? DOMParser)();
  const parsed = parser.parseFromString(source, 'text/html');
  const tpl = parsed.querySelector<HTMLTemplateElement>(`template[${PART_DEF_ATTR}]`);
  if (!tpl) return null;
  const root = tpl.content.firstElementChild;
  if (!root) return null;
  const id = tpl.getAttribute(PART_DEF_ATTR)?.trim();
  if (!id) return null;
  return {
    id,
    name: tpl.getAttribute(PART_NAME_ATTR) ?? undefined,
    category: tpl.getAttribute(PART_CATEGORY_ATTR) ?? undefined,
    description: tpl.getAttribute(PART_DESC_ATTR) ?? undefined,
    version: parseIntSafe(tpl.getAttribute(PART_VERSION_ATTR), 1),
    html: root.outerHTML,
  };
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 定義をファイルに書く形(`<template data-part-def>…</template>`)へ */
export function serializePartTemplate(def: EditorPartDef): string {
  const attrs = [
    `${PART_DEF_ATTR}="${escapeAttr(def.id)}"`,
    `${PART_VERSION_ATTR}="${def.version}"`,
    def.name ? `${PART_NAME_ATTR}="${escapeAttr(def.name)}"` : '',
    def.category ? `${PART_CATEGORY_ATTR}="${escapeAttr(def.category)}"` : '',
    def.description ? `${PART_DESC_ATTR}="${escapeAttr(def.description)}"` : '',
  ].filter(Boolean);
  const body = def.html
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : l))
    .join('\n');
  return `<template ${attrs.join(' ')}>\n${body}\n</template>\n`;
}

/** 定義の HTML(ルート要素 1 つ)を `doc` の要素にする */
export function partRootElement(def: EditorPartDef, doc: Document): HTMLElement | null {
  const tpl = doc.createElement('template');
  tpl.innerHTML = def.html.trim();
  const root = tpl.content.firstElementChild;
  return root ? (doc.importNode(root, true) as HTMLElement) : null;
}

/**
 * 実体化: 定義を複製し、ルートに `data-part` `data-part-v` を付けた要素を返す。
 * ページにはこの要素がそのまま残る。
 */
export function materializePart(def: EditorPartDef, doc: Document): HTMLElement | null {
  const el = partRootElement(def, doc);
  if (!el) return null;
  el.setAttribute(PART_ATTR, def.id);
  el.setAttribute(PART_VERSION_ATTR, String(def.version));
  return el;
}

/** インスタンスのルートか */
export function isPartRoot(el: Element | null | undefined): el is HTMLElement {
  return !!el && el.nodeType === 1 && el.hasAttribute(PART_ATTR);
}

/** 要素を含む最も近いインスタンスのルート(自分自身でもよい) */
export function closestPartRoot(el: Element | null | undefined): HTMLElement | null {
  if (!el || el.nodeType !== 1) return null;
  const root = el.closest(`[${PART_ATTR}]`);
  return root instanceof Element ? (root as HTMLElement) : null;
}

/** ルートの部品情報(無ければ null) */
export function partInfoOf(el: Element | null | undefined): { id: string; version: number } | null {
  if (!isPartRoot(el)) return null;
  return { id: el.getAttribute(PART_ATTR) ?? '', version: parseIntSafe(el.getAttribute(PART_VERSION_ATTR), 1) };
}

/**
 * インスタンスの中でスロットの外にいる(= ロックされている)か。
 * ルート自身はロックしない(選択して動かせる)。スロット要素とその子孫もロックしない。
 */
export function isLockedInsidePart(el: Element): boolean {
  if (el.hasAttribute(PART_ATTR)) return false;
  const root = el.parentElement?.closest(`[${PART_ATTR}]`);
  if (!root) return false;
  const slot = el.closest(`[${SLOT_ATTR}]`);
  return !(slot && root.contains(slot) && slot !== root);
}

/** エディタが作業用に付ける属性・class を落とす(部品の定義や保存 HTML に持ち込まない) */
export function stripEditorAttrs(root: Element): void {
  const attrs = ['contenteditable', 'data-editable', 'data-element-id', 'data-original-content', 'data-shape-type', 'data-inline', 'data-display-name', 'data-locked', 'data-hidden'];
  const classes = ['selected', 'dragging', 'editing', 'rotating', 'panning', 'hover-preview', 'marquee-hover', 'marquee-active', 'text-editable-hover', 'drag-ghost'];
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const a of attrs) el.removeAttribute(a);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-original-') || attr.name.startsWith('data-gg-')) el.removeAttribute(attr.name);
    }
    if (el.classList.length) {
      el.classList.remove(...classes);
      if (!el.getAttribute('class')) el.removeAttribute('class');
    }
  }
}

/** スロットを推定して付ける対象(文字や画像を持ちうる要素) */
const SLOT_TAGS: Record<string, string> = {
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  p: 'body', a: 'link', button: 'button', img: 'image',
  figcaption: 'caption', blockquote: 'quote', label: 'label', span: 'text', time: 'time', small: 'note',
};

/** タグだけの骨格(「同じ形の兄弟」の判定用。文字と属性は見ない) */
const tagSkeleton = (el: Element): string =>
  `${el.tagName.toLowerCase()}${el.children.length ? `(${Array.from(el.children).map(tagSkeleton).join(',')})` : ''}`;

/**
 * スロットの推定。既に `data-slot` があるものはそのまま。祖先が既にスロットなら付けない(入れ子のスロットを作らない)。
 *
 * 1. 繰り返し(ul/ol・dl・table、同じ形の子が 2 つ以上並ぶ器)は**器ごと 1 つのスロット**(list / items)。
 *    カードが 3 枚か 4 枚かはページの内容であって部品の構造ではないので、項目ごとにスロットを切らない
 *    (切ると、定義より多い項目が sync で捨てられる)。ルート自身が繰り返しの器ならルートがスロットになる
 * 2. 残りはタグで(見出し→heading、段落→body、リンク→link …)。span は文字だけを直接持つときだけ。svg の中は見ない
 * 戻り値は付けた数。
 */
export function inferSlots(root: Element): number {
  let count = 0;
  const used = new Map<string, number>();
  const nameFor = (base: string) => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  for (const el of Array.from(root.querySelectorAll('[' + SLOT_ATTR + ']'))) {
    const v = el.getAttribute(SLOT_ATTR) ?? '';
    const base = v.replace(/-\d+$/, '');
    if (base) used.set(base, Math.max(used.get(base) ?? 0, 1));
  }
  const inSlot = (el: Element) => {
    const a = el.parentElement?.closest(`[${SLOT_ATTR}]`);
    return !!(a && root.contains(a));
  };
  const skip = (el: Element) => !!el.closest('svg') || el.hasAttribute(SLOT_ATTR) || inSlot(el);
  const isRepeatContainer = (el: Element) => {
    const kids = Array.from(el.children);
    const tag = el.tagName.toLowerCase();
    if ((tag === 'ul' || tag === 'ol') && kids.some((k) => k.tagName.toLowerCase() === 'li')) return 'list';
    if (tag === 'dl' || tag === 'table') return 'list';
    if (kids.length >= 2 && kids.every((k) => tagSkeleton(k) === tagSkeleton(kids[0]))) return 'items';
    return null;
  };
  // 1. 繰り返しの器(ルート自身も含む。文書順なので外側が先に決まり、中の器は祖先がスロットになって飛ばされる)
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (el !== root && skip(el)) continue;
    if (el === root && el.hasAttribute(SLOT_ATTR)) continue;
    const kind = isRepeatContainer(el);
    if (!kind) continue;
    el.setAttribute(SLOT_ATTR, nameFor(kind));
    count++;
  }
  if (root.hasAttribute(SLOT_ATTR)) return count;
  // 2. 残りはタグで
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (skip(el)) continue;
    const tag = el.tagName.toLowerCase();
    const base = SLOT_TAGS[tag];
    if (!base) continue;
    if (tag === 'span') {
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (!hasText || el.children.length > 0) continue;
    }
    if (tag !== 'img' && !el.textContent?.trim() && el.children.length === 0) continue;
    el.setAttribute(SLOT_ATTR, nameFor(base));
    count++;
  }
  return count;
}

/**
 * 選択要素から部品の定義を作る(「部品として保存」)。
 * 元の要素は変えない(複製に対して整える)。スロットは推定して付ける。
 */
export function partDefFromElement(
  el: HTMLElement,
  meta: { id: string; name?: string; category?: string; description?: string; version?: number },
  options: {
    /**
     * スロットを推定して付けるか。新規作成のときだけ true。
     * 更新(版 +1)で推定すると、定義が意図して固定にしていた要素(ボタンの文言など)が
     * 黙ってスロットになる。更新では既に付いている data-slot だけを尊重する
     */
    inferSlots?: boolean;
  } = {},
): EditorPartDef {
  const clone = el.cloneNode(true) as HTMLElement;
  stripEditorAttrs(clone);
  clone.removeAttribute(PART_ATTR);
  clone.removeAttribute(PART_VERSION_ATTR);
  // 絶対配置の座標は「その場所」の情報なので定義には持ち込まない
  for (const k of ['position', 'left', 'top', 'right', 'bottom']) clone.style.removeProperty(k);
  if (!clone.getAttribute('style')) clone.removeAttribute('style');
  if (options.inferSlots) inferSlots(clone);
  return {
    id: meta.id,
    name: meta.name,
    category: meta.category,
    description: meta.description,
    version: meta.version ?? 1,
    html: clone.outerHTML,
  };
}

/**
 * ページ上の要素を、その場でインスタンスにする(「部品として保存」の直後)。
 * 定義に付けたスロットと同じ位置に `data-slot` を付け、ルートに `data-part` を付ける。
 * DOM の形は定義と同じ(複製元だから)なので、文書順で対応づける。
 */
export function stampAsInstance(el: HTMLElement, def: EditorPartDef, doc: Document): void {
  const ref = partRootElement(def, doc);
  if (!ref) return;
  const refAll = [ref, ...Array.from(ref.querySelectorAll('*'))];
  const liveAll = [el, ...Array.from(el.querySelectorAll('*'))];
  // エディタの作業属性は複製時に落としているので、要素数が一致するはず。ずれたらスロットは付けない
  if (refAll.length === liveAll.length) {
    for (let i = 0; i < refAll.length; i++) {
      const s = refAll[i].getAttribute(SLOT_ATTR);
      if (s) liveAll[i].setAttribute(SLOT_ATTR, s);
    }
  }
  el.setAttribute(PART_ATTR, def.id);
  el.setAttribute(PART_VERSION_ATTR, String(def.version));
}

/** 「部品から切り離す」: 出自の記録だけ外す。中身と data-slot はそのまま(普通の HTML になる) */
export function detachPart(el: HTMLElement): void {
  el.removeAttribute(PART_ATTR);
  el.removeAttribute(PART_VERSION_ATTR);
}

/**
 * フロー(流し込み)への挿入位置を決める。
 * ドロップ位置の要素から、「セクションの器」の直下にある祖先まで上がり、その前後に入れる。
 * 器 = `[data-wf-body]` / `main` / `#artboard` / body。何も当たらなければ器の末尾。
 *
 * 位置の計算そのものは drop-target.ts に置いてある。ドラッグ中に出す印
 * (どこに入るかの横棒)と同じ関数を使わないと、印と実際の挿入位置がずれるため。
 */
export function insertIntoFlow(doc: Document, el: HTMLElement, x: number, y: number): void {
  const { parent, before } = findFlowInsertion(doc, x, y);
  parent.insertBefore(el, before);
}

/**
 * インスタンスの中のロックを今すぐ効かせる(「部品として保存」の直後)。
 * 通常は useIframeSetup が付け直すが、それは子要素の増減でしか走らないので、ここで落とす。
 */
export function applyLockInside(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isLockedInsidePart(el)) continue;
    el.removeAttribute('data-editable');
    el.removeAttribute('data-element-id');
    el.removeAttribute('contenteditable');
    el.classList.remove('selected', 'hover-preview', 'text-editable-hover');
    if (!el.getAttribute('class')) el.removeAttribute('class');
  }
}

/**
 * 「部品から切り離す」の直後に、ロックされていた子孫を編集できるようにする。
 * useIframeSetup と同じ形の id を付ける。
 */
export function unlockPartDescendants(root: HTMLElement): number {
  let i = 0;
  const stamp = Date.now();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.closest('script, style, svg path, svg g')) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (isNonEditableTag(el)) continue;
    if (!el.getAttribute('data-element-id')) {
      el.setAttribute('data-editable', 'true');
      el.setAttribute('data-element-id', `el-${stamp}-u${i++}`);
    } else if (!el.getAttribute('data-editable')) {
      el.setAttribute('data-editable', 'true');
    }
  }
  return i;
}
