/**
 * ツリーの絶対配置 = 選んだ要素から下の「箱」を、入れ子まで全部絶対配置にする(webpage 専用)。
 *
 * 【器ひとつの変換(free-layout.ts)との違い】
 * enableFreeLayout は器の直下の子だけを倒すので、カードの中の見出しや画像までは動かせない。
 * ここでは選んだ要素から下へ降り、段落・見出し・画像・ボタン・ブロックの箱を全部倒す。
 * 目印は自由配置と同じ(gg-freelayout / gg-freelayout-item / gg-freelayout-rel)なので、
 * ドラッグの範囲・札・右パネルの切替・解除はそのまま効く。
 *
 * 【木ごと 1 回で測り、1 回で書き、1 回で確かめる】
 * 器ごとに enableFreeLayout を再帰で呼ぶと、深いところで 1 つ巻き戻ったときに
 * 「途中まで倒れた木」が残る。全部の箱を先に測り、全部書き、全部確かめ、
 * 1 つでもずれたら木ごと戻す。履歴(⌘Z)も共同編集の送信も 1 回で済む。
 *
 * 【位置は矩形から小数で出す】
 * offsetLeft / offsetTop は整数に丸められる。入れ子の各段で 0.5px 未満ずつずれると、
 * 深い要素ほどずれが積み上がる。そこで getBoundingClientRect(小数)をズーム倍率で割り戻し、
 * 器の padding box 基準の left / top にする。大きさは自由配置と同じく
 * getComputedStyle の値(box-sizing と同じ物差し)をそのまま書く。
 * 測る間だけ、木の中の変形(transform / translate / rotate / scale)と遷移を止める。
 * 回転した箱の矩形は外接矩形になり、左上が本当の位置と合わないため。
 *
 * 【どこまで降りるか】(display は computed で見る。構成ラフのボタンは <a class="inline-flex"> で箱)
 * - 箱として倒すが、中へは降りない(葉)
 *   - 文字の流れを持つ要素: 直下に文字がある / 直下に行内(display:inline)の子や <br> がある
 *     → span・a・strong・br などは段落の中の流れのまま残る
 *   - p / h1〜h6 / a / button / label / figcaption / blockquote / pre / フォーム部品
 *   - 置換要素と svg: img / picture / video / canvas / iframe / svg(中の図形は絶対配置にならない)
 *   - table(tr / td を絶対配置にすると表の組みが壊れる。表ごと 1 つの箱として動かす)
 *   - ul / ol は display が flex / grid(カードの並び)のときだけ降りて li を箱にする。
 *     縦に流れるリスト(マーカーや行間の流れがある)は葉
 *   - 段組み(columns)の器(子が段をまたいで分かれ、矩形 1 つで表せない)
 * - 触らない: display:none、position:fixed、部品(data-part)のスロットの外
 *   (スロットの外の器は変換せずに降り、スロットを新しい起点にする)
 * - 元から absolute の子は倒さない(クラスで決まっている位置は、幅が変わっても追従するので残す)。
 *   ただし基準(包含ブロック)が変わる子だけは、位置を書き直して見た目を保つ(印を付け、解除で戻す)
 */

import { capturePrestyle, getArtboardScale, isNonEditableTag } from './dom-utils';
import { isLockedInsidePart } from '../parts';
import { debugLog } from './debug';
import {
  FREELAYOUT_CLASS,
  FREELAYOUT_HOLD_CLASS,
  FREELAYOUT_ITEM_CLASS,
  FREELAYOUT_REL_CLASS,
  isEditorOverlay,
  layoutChildren,
  rememberFlowValues,
  rememberItemGeometry,
  styleSizeFor,
} from './free-layout';

/** 降りなかった・触らなかった理由(報告とトーストに使う) */
export type FreeLayoutTreeSkip =
  | 'text'
  | 'inline'
  | 'element'
  | 'media'
  | 'svg'
  | 'table'
  | 'list'
  | 'columns'
  | 'locked'
  | 'fixed';

export interface FreeLayoutTreePlan {
  /** 流れから抜いて絶対配置にする箱と、その基準にする器 */
  items: { element: HTMLElement; container: HTMLElement }[];
  /** 流れに残ったまま(または元から absolute のまま)器になるもの。高さを固定する */
  roots: HTMLElement[];
  /** 子を倒す器(items と roots の両方にまたがる) */
  containers: Set<HTMLElement>;
  /** 基準が変わるので位置を書き直す、元から absolute の要素 */
  reanchors: { element: HTMLElement; container: HTMLElement }[];
  skipped: Record<FreeLayoutTreeSkip, number>;
  /** 変換できない理由。あれば何も書かない */
  blocked?: string;
}

export interface FreeLayoutTreeResult {
  /** 絶対配置にした箱の数 */
  items: number;
  /** 子を倒した器の数 */
  containers: number;
  /** 基準が変わったので位置を書き直した、元から absolute の要素の数 */
  reanchored: number;
  skipped: Record<FreeLayoutTreeSkip, number>;
  /** 変換しなかった理由(巻き戻し済み) */
  error?: string;
}

/** 箱として倒すが中へは降りない要素 */
const LEAF_TAGS: Record<string, FreeLayoutTreeSkip> = {
  P: 'element',
  H1: 'element',
  H2: 'element',
  H3: 'element',
  H4: 'element',
  H5: 'element',
  H6: 'element',
  A: 'element',
  BUTTON: 'element',
  LABEL: 'element',
  FIGCAPTION: 'element',
  BLOCKQUOTE: 'element',
  PRE: 'element',
  INPUT: 'element',
  SELECT: 'element',
  TEXTAREA: 'element',
  FIELDSET: 'element',
  DETAILS: 'element',
  IMG: 'media',
  PICTURE: 'media',
  VIDEO: 'media',
  AUDIO: 'media',
  CANVAS: 'media',
  IFRAME: 'media',
  OBJECT: 'media',
  EMBED: 'media',
  MATH: 'media',
  SVG: 'svg',
  TABLE: 'table',
};

/** display:inline でも中身が 1 つの箱として描かれる要素(置換要素とフォーム部品) */
const ATOMIC_INLINE_TAGS = new Set([
  'IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'MATH',
]);

const MEASURE_ATTR = 'data-gg-freelayout-measure';

const tagOf = (el: Element): string => el.tagName.toUpperCase();

/** 文字の流れ(行)に乗っている要素か。これを子に持つ器は、その流れを残すため器にしない */
function isFlowInline(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  if (isNonEditableTag(el)) return true;
  const d = cs.display;
  if (d === 'contents' || d.startsWith('table-') || d.startsWith('ruby')) return true;
  return d === 'inline' && !ATOMIC_INLINE_TAGS.has(tagOf(el));
}

function hasDirectText(el: HTMLElement): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return true;
  }
  return false;
}

/** 中へ降りない理由。null なら子を倒せる */
function leafReason(
  el: HTMLElement,
  cs: CSSStyleDeclaration,
  kids: HTMLElement[],
  win: Window,
): FreeLayoutTreeSkip | null {
  const tag = tagOf(el);
  const byTag = LEAF_TAGS[tag];
  if (byTag) return byTag;
  if ((tag === 'UL' || tag === 'OL') && !/(^|-)(flex|grid)$/.test(cs.display)) return 'list';
  if (isFlowInline(el, cs)) return 'inline';
  if (cs.columnCount !== 'auto' || cs.columnWidth !== 'auto') return 'columns';
  if (hasDirectText(el)) return 'text';
  if (kids.some((k) => isFlowInline(k, win.getComputedStyle(k)))) return 'inline';
  return null;
}

/** 絶対配置の子の基準(包含ブロック)を作る要素か */
function establishesContainingBlock(cs: CSSStyleDeclaration): boolean {
  return (
    cs.position !== 'static' ||
    cs.transform !== 'none' ||
    (cs.translate && cs.translate !== 'none') ||
    (cs.rotate && cs.rotate !== 'none') ||
    (cs.scale && cs.scale !== 'none') ||
    cs.filter !== 'none' ||
    cs.perspective !== 'none' ||
    /paint|layout|strict|content/.test(cs.contain) ||
    /transform|perspective|filter/.test(cs.willChange)
  );
}

const emptySkipped = (): Record<FreeLayoutTreeSkip, number> => ({
  text: 0,
  inline: 0,
  element: 0,
  media: 0,
  svg: 0,
  table: 0,
  list: 0,
  columns: 0,
  locked: 0,
  fixed: 0,
});

/**
 * 何をどう倒すかを決める(DOM は 1 つも書かない)。
 * メニューの出し分け(倒せる箱が 1 つ以上あるか)にも使う。
 */
export function planFreeLayoutTree(root: HTMLElement, iframeDoc: Document): FreeLayoutTreePlan {
  const plan: FreeLayoutTreePlan = {
    items: [],
    roots: [],
    containers: new Set(),
    reanchors: [],
    skipped: emptySkipped(),
  };
  const win = iframeDoc.defaultView;
  if (!win || isLockedInsidePart(root)) return plan;
  const itemSet = new Set<HTMLElement>();

  const rendered = (el: HTMLElement): HTMLElement[] =>
    layoutChildren(el).filter((k) => win.getComputedStyle(k).display !== 'none');

  const visit = (el: HTMLElement, role: 'root' | 'item'): void => {
    const cs = win.getComputedStyle(el);
    const kids = rendered(el);
    // 中身の無い箱(画像の枠・区切り線)。自身が item なら箱として倒れる
    if (kids.length === 0 && !hasDirectText(el)) return;
    const reason = leafReason(el, cs, kids, win);
    if (reason) {
      plan.skipped[reason]++;
      return;
    }
    // 部品のスロットの外。器にせず(高さも position も書かない)に降りて、スロットを起点にする
    if (isLockedInsidePart(el) || kids.some((k) => isLockedInsidePart(k))) {
      plan.skipped.locked++;
      for (const k of kids) {
        if (win.getComputedStyle(k).position === 'fixed') plan.skipped.fixed++;
        else visit(k, 'root');
      }
      return;
    }
    const flow: HTMLElement[] = [];
    const positioned: HTMLElement[] = [];
    for (const k of kids) {
      const pos = win.getComputedStyle(k).position;
      if (pos === 'fixed') plan.skipped.fixed++;
      // 前の変換で倒した子(印あり)は、測り直して書き直す(同じ位置になる)
      else if (pos === 'absolute' && !k.classList.contains(FREELAYOUT_ITEM_CLASS)) positioned.push(k);
      else flow.push(k);
    }
    if (flow.length > 0) {
      plan.containers.add(el);
      if (role === 'root') plan.roots.push(el);
      for (const k of flow) {
        plan.items.push({ element: k, container: el });
        itemSet.add(k);
      }
      for (const k of flow) visit(k, 'item');
    }
    // 元から absolute の子は倒さないが、その中の箱は倒す(その子が器になる)
    for (const k of positioned) visit(k, 'root');
  };
  visit(root, 'root');

  // 基準が変わる、元から absolute の要素を探す。
  // 倒した箱と、流れに残る器(static なら relative にする)が新しく基準を作る
  const future = new Set<HTMLElement>([...itemSet, ...plan.roots]);
  const containingBlock = (el: HTMLElement, after: boolean): Element | null => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (after && future.has(a)) return a;
      if (establishesContainingBlock(win.getComputedStyle(a))) return a;
    }
    return null;
  };
  for (const d of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (itemSet.has(d) || d.namespaceURI !== 'http://www.w3.org/1999/xhtml' || isEditorOverlay(d)) continue;
    if (win.getComputedStyle(d).position !== 'absolute') continue;
    const before = containingBlock(d, false);
    const after = containingBlock(d, true);
    if (before === after || !after) continue;
    if (isLockedInsidePart(d)) {
      plan.blocked = '部品のスロットの外にある絶対配置の要素の基準が変わるため、変換できません';
      break;
    }
    plan.reanchors.push({ element: d, container: after as HTMLElement });
  }

  return plan;
}

/** 倒せる箱が 1 つ以上あるか(メニューの出し分け) */
export function canEnableFreeLayoutTree(root: HTMLElement, iframeDoc: Document): boolean {
  const plan = planFreeLayoutTree(root, iframeDoc);
  return !plan.blocked && plan.items.some(({ element }) => !element.classList.contains(FREELAYOUT_ITEM_CLASS));
}

/**
 * 変換の前に、書体と木の中の画像の読み込みを待つ。
 * 読み込み前に測ると、あとで文字の幅や画像の高さが変わった分だけ固定した寸法とずれる。
 * 遅延読み込みで永遠に来ない画像もあるので、待つのは timeoutMs まで
 */
export async function waitForFreeLayoutTreeReady(
  root: HTMLElement,
  iframeDoc: Document,
  timeoutMs = 1500,
): Promise<void> {
  const fonts = (iframeDoc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
  const images = Array.from(root.querySelectorAll('img'))
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    );
  await Promise.race([
    Promise.all([fonts, ...images]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

interface StyleUndo {
  element: HTMLElement;
  style: string | null;
  className: string | null;
}

const snapshot = (el: HTMLElement): StyleUndo => ({
  element: el,
  style: el.getAttribute('style'),
  className: el.getAttribute('class'),
});

function rollback(undos: StyleUndo[]): void {
  for (const u of undos) {
    if (u.style === null) u.element.removeAttribute('style');
    else u.element.setAttribute('style', u.style);
    if (u.className === null) u.element.removeAttribute('class');
    else u.element.setAttribute('class', u.className);
  }
}

/**
 * 測る間だけ、木の中の変形と遷移を止める。戻り値の関数で元に戻す。
 *
 * style 属性ではなく <head> の一時的な <style> と、選んだ要素の属性で掛ける
 * (書き込みで style 属性を触るので、そこに混ぜると戻すときに区別できない)。
 * 変形を戻す瞬間に遷移が走らないよう、変形 → 遷移 の順に 1 段ずつ外す
 */
function freezeTransforms(iframeDoc: Document, root: HTMLElement): () => void {
  const style = iframeDoc.createElement('style');
  style.setAttribute(MEASURE_ATTR, '');
  const sel = (mode: string) => `[${MEASURE_ATTR}${mode}],[${MEASURE_ATTR}${mode}] *`;
  style.textContent =
    `${sel('')}{transition:none!important}` +
    `${sel('="measure"')}{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}`;
  (iframeDoc.head ?? iframeDoc.documentElement).appendChild(style);
  root.setAttribute(MEASURE_ATTR, 'measure');
  root.getBoundingClientRect();
  return () => {
    root.setAttribute(MEASURE_ATTR, 'hold');
    root.getBoundingClientRect();
    root.removeAttribute(MEASURE_ATTR);
    style.remove();
    root.getBoundingClientRect();
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** 流れの中で次に来る兄弟(余白の相殺で位置が変わっていないかを見る目安) */
function nextFlowSibling(el: HTMLElement, win: Window): HTMLElement | null {
  for (let n = el.nextElementSibling as HTMLElement | null; n; n = n.nextElementSibling as HTMLElement | null) {
    if (isEditorOverlay(n) || typeof n.getBoundingClientRect !== 'function') continue;
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    return n;
  }
  return null;
}

/**
 * 選んだ要素から下の箱を、見た目を変えずに全部絶対配置にする。
 *
 * 選んだ要素自身は流れに残り(高さを固定する)、ページの高さは変わらない。
 * 1 つでも 1px を超えてずれたら、木ごと巻き戻して error を返す。
 * 呼ぶ前に waitForFreeLayoutTreeReady で書体と画像を待つこと。
 */
export function enableFreeLayoutTree(root: HTMLElement, iframeDoc: Document): FreeLayoutTreeResult {
  const plan = planFreeLayoutTree(root, iframeDoc);
  const result: FreeLayoutTreeResult = { items: 0, containers: 0, reanchored: 0, skipped: plan.skipped };
  const win = iframeDoc.defaultView;
  if (!win) return result;
  if (plan.blocked) return { ...result, error: plan.blocked };
  if (plan.items.length === 0) return result;

  const scale = getArtboardScale(iframeDoc);
  const touched = new Set<HTMLElement>([
    ...plan.roots,
    ...plan.items.map((i) => i.element),
    ...plan.reanchors.map((r) => r.element),
  ]);
  const undos = Array.from(touched, snapshot);
  const unfreeze = freezeTransforms(iframeDoc, root);

  try {
    // ① 全部測る(まだ何も書かない)
    const rects = new Map<HTMLElement, DOMRect>();
    const rectOf = (el: HTMLElement): DOMRect => {
      let r = rects.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        rects.set(el, r);
      }
      return r;
    };
    // 器の padding box の左上(ビューポート座標)。スクロールしている器はその分だけ戻す
    const origins = new Map<HTMLElement, { x: number; y: number }>();
    const originOf = (k: HTMLElement): { x: number; y: number } => {
      let o = origins.get(k);
      if (!o) {
        const r = rectOf(k);
        const cs = win.getComputedStyle(k);
        o = {
          x: r.left + ((parseFloat(cs.borderLeftWidth) || 0) - (k.scrollLeft || 0)) * scale,
          y: r.top + ((parseFloat(cs.borderTopWidth) || 0) - (k.scrollTop || 0)) * scale,
        };
        origins.set(k, o);
      }
      return o;
    };
    const place = (list: { element: HTMLElement; container: HTMLElement }[]) =>
      list.map(({ element, container }) => {
        const r = rectOf(element);
        const o = originOf(container);
        return {
          element,
          left: (r.left - o.x) / scale,
          top: (r.top - o.y) / scale,
          size: styleSizeFor(win.getComputedStyle(element), r.width / scale, r.height / scale),
        };
      });
    const itemPlans = place(plan.items);
    const reanchorPlans = place(plan.reanchors);
    const rootPlans = plan.roots.map((element) => {
      const cs = win.getComputedStyle(element);
      const next = nextFlowSibling(element, win);
      const parent = element.parentElement;
      return {
        element,
        isStatic: cs.position === 'static',
        inFlow: cs.position !== 'absolute',
        height: cs.height,
        width: cs.width,
        next,
        nextRect: next ? next.getBoundingClientRect() : null,
        parent,
        parentRect: parent ? parent.getBoundingClientRect() : null,
      };
    });
    for (const el of touched) rectOf(el);

    // ② 全部書く。先に器(流れに残るもの)、次に倒す箱
    for (const rp of rootPlans) {
      const el = rp.element;
      capturePrestyle(el);
      const ours =
        el.classList.contains(FREELAYOUT_CLASS) ||
        el.classList.contains(FREELAYOUT_HOLD_CLASS) ||
        el.classList.contains(FREELAYOUT_ITEM_CLASS);
      if (rp.isStatic) {
        rememberFlowValues(el, ['position']);
        el.style.position = 'relative';
        el.classList.add(FREELAYOUT_REL_CLASS);
      }
      if (!ours) rememberFlowValues(el, ['height']);
      el.style.height = rp.height;
      el.classList.add(FREELAYOUT_CLASS);
    }
    for (const p of [...itemPlans, ...reanchorPlans]) {
      const el = p.element;
      capturePrestyle(el);
      rememberItemGeometry(el);
      el.classList.add(FREELAYOUT_ITEM_CLASS);
      el.style.position = 'absolute';
      el.style.left = `${round2(p.left)}px`;
      el.style.top = `${round2(p.top)}px`;
      el.style.width = p.size.width;
      el.style.height = p.size.height;
      // 絶対配置では margin は位置のずれにしかならない。left / top に一本化する
      el.style.margin = '0';
      // 解除したときに flex:1 が復活して伸びないよう、明示的に止めておく
      el.style.flex = 'none';
      el.style.flexGrow = '0';
      el.style.flexShrink = '0';
      if (plan.containers.has(el)) el.classList.add(FREELAYOUT_CLASS);
    }

    // ③ 流れに残る器の外側の手当て。
    //    - 余白の相殺: 最初/最後の子の margin が器を突き抜けていた場合、子が抜けると器が上下にずれる
    //    - 中身で決まっていた幅: flex の子や inline-block は、子が抜けると幅が縮む
    //    ずれた分だけ margin / width を書き足し、測り直す(相殺は最大値で決まるので 1 回で合わないことがある)
    const px = (v: string): number => parseFloat(v) || 0;
    for (let pass = 0; pass < 6; pass++) {
      let adjusted = false;
      for (const rp of rootPlans) {
        const el = rp.element;
        const before = rectOf(el);
        const now = el.getBoundingClientRect();
        if (Math.abs(before.width - now.width) / scale > 0.5) {
          rememberFlowValues(el, ['width'], true);
          el.style.width = rp.width;
          adjusted = true;
          continue;
        }
        if (!rp.inFlow) continue;
        const dy = (before.top - now.top) / scale;
        if (Math.abs(dy) > 0.5) {
          rememberFlowValues(el, ['margin-top'], true);
          el.style.marginTop = `${round2(px(win.getComputedStyle(el).marginTop) + dy)}px`;
          adjusted = true;
          continue;
        }
        let dBottom = 0;
        if (rp.next && rp.nextRect) dBottom = (rp.nextRect.top - rp.next.getBoundingClientRect().top) / scale;
        else if (rp.parent && rp.parentRect) dBottom = (rp.parentRect.height - rp.parent.getBoundingClientRect().height) / scale;
        if (Math.abs(dBottom) > 0.5) {
          rememberFlowValues(el, ['margin-bottom'], true);
          el.style.marginBottom = `${round2(px(win.getComputedStyle(el).marginBottom) + dBottom)}px`;
          adjusted = true;
        }
      }
      if (!adjusted) break;
    }

    // ④ 全部確かめる。1 つでもずれたら木ごと戻す(崩れた紙面より、変換していない紙面のほうがまし)
    const TOLERANCE = 1;
    const differs = (a: DOMRect, b: DOMRect): boolean =>
      Math.abs(a.left - b.left) / scale > TOLERANCE ||
      Math.abs(a.top - b.top) / scale > TOLERANCE ||
      Math.abs(a.width - b.width) / scale > TOLERANCE ||
      Math.abs(a.height - b.height) / scale > TOLERANCE;
    const moved = Array.from(touched).filter((el) => differs(rectOf(el), el.getBoundingClientRect()));
    const outsideMoved = rootPlans.some(
      (rp) =>
        (rp.next && rp.nextRect && differs(rp.nextRect, rp.next.getBoundingClientRect())) ||
        (!rp.next && rp.parent && rp.parentRect && Math.abs(rp.parentRect.height - rp.parent.getBoundingClientRect().height) / scale > TOLERANCE),
    );
    if (moved.length > 0 || outsideMoved) {
      console.warn('[enableFreeLayoutTree] 変換で位置がずれたため巻き戻します:', moved.length, '要素', outsideMoved ? '(外側も)' : '');
      rollback(undos);
      return {
        ...result,
        error: `${moved.length || 1}個の要素の位置が変わってしまうため、変換を取り消しました`,
      };
    }

    result.items = itemPlans.length;
    result.containers = plan.containers.size;
    result.reanchored = reanchorPlans.length;
    debugLog('[enableFreeLayoutTree] 絶対配置へ:', result);
    return result;
  } catch (err) {
    rollback(undos);
    throw err;
  } finally {
    unfreeze();
  }
}
