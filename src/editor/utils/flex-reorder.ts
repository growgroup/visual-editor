/**
 * フレックス内ドラッグ = 同一親の中での並べ替え。
 *
 * オートレイアウト(display:flex)の子を掴んだとき、従来は問答無用で絶対配置へ
 * 倒していたため、フレックスの設定が触った瞬間に無意味になっていた。
 * ここでは「親の中での順番を変える」だけを行い、**要素を親の外へ出さない**。
 * 以前あった「ゴースト並べ替え」は任意の親へ再挿入できたため、離した場所に
 * よっては要素が画面の外へ消えた。同一親に限ることでその事故を構造的に防ぐ。
 *
 * 座標はクライアント座標(getBoundingClientRect)のまま扱う。ここで必要なのは
 * 「カーソルが兄弟の前半か後半か」だけで、アートボード座標へ割り戻す必要がない。
 */

import { isAutoLayoutContainer, restoreChildrenToFlow } from './restore-flow';

const INDICATOR_ID = 'gg-reorder-indicator';
const BLUE = '#0d99ff';

/** 並べ替えの対象にしない、エディタが描いている飾り */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-crop-ui,' +
  '.flex-drop-indicator,#gg-measure-layer,#gg-smart-guides,#' + INDICATOR_ID;

/** 並べ替え中の状態。ドラッグ開始時に1回だけ作る */
export interface ReorderSession {
  element: HTMLElement;
  parent: HTMLElement;
  /** 動かしている要素を除いた兄弟(DOM順) */
  siblings: HTMLElement[];
  /** 主軸が縦か */
  isColumn: boolean;
  /** 開始時の位置(取り消し・変化判定用) */
  originalIndex: number;
  /** 直前に描いた挿入位置。同じなら描き直さない */
  lastIndex: number;
}

/** 並べ替えの相手になる子だけを取り出す */
function realChildren(parent: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(parent.children)) {
    // [注意] `node instanceof HTMLElement` は使えない。この関数は親ウィンドウで
    // 動くが要素は iframe の realm に属するため、常に false になる
    const el = node as HTMLElement;
    if (typeof el.matches !== 'function') return out.length ? out : [];
    if (el.matches(OVERLAY_SELECTOR)) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    out.push(el);
  }
  return out;
}

/**
 * この要素を「同一親の並べ替え」で動かすべきか判定する。
 *
 * 【既定は現状維持】computed が flex というだけでは並べ替えにしない。
 * テンプレート由来の flex はスライド中に山ほどあり、それを全部器として扱うと
 * 既定のドラッグ(絶対配置化して自由移動)が勝手に変わってしまう。
 *
 * 条件はすべて満たす必要がある:
 *   - 単一選択(群ドラッグは従来どおり座標移動。順番の概念が無い)
 *   - 親が **明示的にオートレイアウトON** (gg-autolayout クラスを持つ)
 *   - 親が display:flex / inline-flex(gridは対象外。2次元の並びは順番だけでは決まらない)
 *   - 自身がフローの中にいる(ONにした時点で子はフロー化済み。
 *     その後ユーザーが自分で絶対配置にした子は座標移動のまま)
 *   - 並べ替える相手が2つ以上いる
 */
export function shouldReorder(
  element: HTMLElement,
  doc: Document,
  selectedCount: number,
): boolean {
  if (selectedCount > 1) return false;
  const win = doc.defaultView;
  const parent = element.parentElement;
  if (!win || !parent) return false;

  // 明示的にONにした器の中だけが並べ替えの対象
  if (!isAutoLayoutContainer(parent)) return false;

  const display = win.getComputedStyle(parent).display;
  if (display !== 'flex' && display !== 'inline-flex') return false;

  const own = win.getComputedStyle(element).position;
  if (own === 'absolute' || own === 'fixed') return false;

  return realChildren(parent).length >= 2;
}

/** 並べ替えの下ごしらえ(ドラッグが動き出した最初の1回だけ呼ぶ) */
export function startReorder(element: HTMLElement, doc: Document): ReorderSession | null {
  const win = doc.defaultView;
  const parent = element.parentElement;
  if (!win || !parent) return null;

  // 子はONにした時点でフロー化済み。ただし後から追加された子や、
  // 別経路で絶対配置が焼き込まれた子が混じると並びが崩れるので保険で通す
  restoreChildrenToFlow(parent);

  const children = realChildren(parent);
  const originalIndex = children.indexOf(element);
  if (originalIndex < 0) return null;

  const dir = win.getComputedStyle(parent).flexDirection || 'row';

  // 掴んでいる要素は「持ち上がっている」ことを見せる。
  // 既存の .dragging(opacity .7 + grabbing)をそのまま使う。インラインstyleで
  // 当てると保存HTMLに漏れうるが、このクラスは getCleanHtml が必ず剥がす

  element.classList.add('dragging');

  return {
    element,
    parent,
    siblings: children.filter((c) => c !== element),
    isColumn: dir.startsWith('column'),
    originalIndex,
    lastIndex: -1,
  };
}

/**
 * カーソル位置から「兄弟の何番目の前に入るか」を決める
 *
 * 返すのは siblings(動かしている要素を除いた配列)に対する挿入位置。
 * 各兄弟の中点と比べるだけなので、要素が可変幅でも破綻しない。
 * flex-direction:*-reverse は画面上の並びとDOM順が逆なので、最後に反転する。
 */
export function computeInsertIndex(
  session: ReorderSession,
  clientX: number,
  clientY: number,
  doc: Document,
): number {
  const { siblings, isColumn } = session;
  const dir = doc.defaultView?.getComputedStyle(session.parent).flexDirection || 'row';
  const isReverse = dir.endsWith('-reverse');

  let index = siblings.length;
  for (let i = 0; i < siblings.length; i++) {
    const r = siblings[i].getBoundingClientRect();
    const mid = isColumn ? r.top + r.height / 2 : r.left + r.width / 2;
    const cursor = isColumn ? clientY : clientX;
    const before = isReverse ? cursor > mid : cursor < mid;
    if (before) {
      index = i;
      break;
    }
  }
  return index;
}

/**
 * 挿入位置を示す青い線を描く
 *
 * 線は #artboard 直下ではなく **親のすぐ内側** に置きたいが、親に
 * position が無いと座標の基準にできない。親の style を書き換えると版面が動くので、
 * body直下に fixed で置く(画面座標そのまま)。ドラッグ中しか出ないので
 * スクロール追従は不要。
 */
export function drawInsertIndicator(
  session: ReorderSession,
  index: number,
  doc: Document,
): void {
  clearInsertIndicator(doc);

  const { siblings, isColumn, parent } = session;
  const parentRect = parent.getBoundingClientRect();
  const dir = doc.defaultView?.getComputedStyle(parent).flexDirection || 'row';
  const isReverse = dir.endsWith('-reverse');

  // 挿入位置の座標。末尾なら最後の兄弟の後ろ、それ以外は index 番目の手前
  let pos: number;
  if (siblings.length === 0) {
    pos = isColumn ? parentRect.top : parentRect.left;
  } else if (index >= siblings.length) {
    const r = siblings[siblings.length - 1].getBoundingClientRect();
    pos = isColumn ? (isReverse ? r.top : r.bottom) : isReverse ? r.left : r.right;
  } else {
    const r = siblings[index].getBoundingClientRect();
    pos = isColumn ? (isReverse ? r.bottom : r.top) : isReverse ? r.right : r.left;
  }

  const line = doc.createElement('div');
  line.id = INDICATOR_ID;
  const base = 'position:fixed;z-index:10001;pointer-events:none;' +
    `background:${BLUE};border-radius:1.5px;box-shadow:0 0 6px rgba(13,153,255,0.5);`;
  line.style.cssText = isColumn
    ? base + `left:${parentRect.left}px;width:${parentRect.width}px;top:${pos - 1.5}px;height:3px;`
    : base + `top:${parentRect.top}px;height:${parentRect.height}px;left:${pos - 1.5}px;width:3px;`;

  doc.body.appendChild(line);
}

/** 挿入位置の線を消す */
export function clearInsertIndicator(doc: Document): void {
  doc.getElementById(INDICATOR_ID)?.remove();
}

/**
 * 並べ替えを確定する。順番が変わったら true
 *
 * insertBefore しか使わないので、要素は必ず同じ親の中に留まる。
 */
export function commitReorder(
  session: ReorderSession,
  index: number,
  doc: Document,
): boolean {
  const { element, parent, siblings } = session;

  // 見た目の持ち上げを戻してから並べ替える(保存HTMLに opacity を残さない)
  endReorder(session, doc);

  const target = index >= siblings.length ? null : siblings[index];
  // すでにその位置にいるなら DOM を触らない(履歴を無駄に汚さない)
  if (target === element.nextElementSibling) return false;
  if (target === null && element === parent.lastElementChild) return false;

  parent.insertBefore(element, target);
  return true;
}

/** 見た目の持ち上げと線を片付ける(取り消し・中断からも呼ぶ) */
export function endReorder(session: ReorderSession | null, doc: Document): void {
  clearInsertIndicator(doc);
  if (!session) return;
  session.element.classList.remove('dragging');
}
