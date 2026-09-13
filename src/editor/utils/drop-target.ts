/**
 * 部品をキャンバスへドラッグしているときの「どこに入るか」の判定と、その印。
 *
 * 【なぜ別ファイルか】
 * 挿入位置の計算(parts.ts の insertIntoFlow)と、ドラッグ中に見せる印は
 * 必ず同じ答えでなければならない。別々に書くと「印の場所と違うところに入る」
 * という一番たちの悪いズレ方をするので、計算は 1 つにして両方から呼ぶ。
 */

/** ドラッグ中の印につけるクラス(この名前で探して消す) */
export const PART_DROP_INDICATOR_CLASS = 'gg-part-drop-indicator';

/**
 * 印に付けるクラス。
 * `selection-box` を併記しているのは、保存時のサニタイズ(html-utils の
 * getCleanHtml)と履歴の除外(EditorHistoryContext の EDITOR_CHROME_SELECTOR)が
 * どちらも `.selection-box` を見ているため。既存の除外機構にそのまま乗せることで、
 * 印が保存 HTML や Undo 履歴に混ざるのを防ぐ。
 * (同じ手は dom-utils の群バウンディングボックスでも使っている)
 */
const INDICATOR_CLASS = `selection-box ${PART_DROP_INDICATOR_CLASS}`;

/** 紙面の中身ではなく、エディタが差し込んでいる表示専用のノード */
const EDITOR_CHROME =
  '.selection-box,.marquee-selection-box,.gg-comment-layer,.gg-crop-ui,' +
  '#gg-measure-layer,#gg-smart-guides,.flex-drop-indicator,.nesting-drop-indicator,' +
  '.auto-layout-drop-indicator,.drag-ghost';

/** 挿入先。before が null なら parent の末尾 */
export interface FlowInsertion {
  parent: Element;
  before: Element | null;
}

/**
 * 「セクションの器」か。この直下に部品を並べる。
 * 器 = body / #artboard / [data-wf-body] / main
 */
function isContainer(doc: Document, node: Element | null): node is Element {
  return (
    !!node &&
    (node === doc.body ||
      node.id === 'artboard' ||
      node.hasAttribute('data-wf-body') ||
      node.tagName === 'MAIN')
  );
}

/** 器が見つからないときの落とし先 */
function fallbackContainer(doc: Document): Element {
  return (
    doc.querySelector('main') ??
    doc.querySelector('[data-wf-body]') ??
    doc.getElementById('artboard') ??
    doc.body
  );
}

/** 部品を並べる相手になる子要素(表示専用のノードと高さ 0 のものは外す) */
function placeableChildren(parent: Element): Element[] {
  return Array.from(parent.children).filter((el) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return false;
    if (el.matches(EDITOR_CHROME)) return false;
    return el.getBoundingClientRect().height > 0;
  });
}

/**
 * iframe 内の座標 (x, y) に部品を落としたとき、どこに入るかを返す。
 *
 * 【なぜ elementsFromPoint で一番深い器を探すか】
 * 以前は「当たった要素から器の直下の祖先まで上る」方式だった。これだと
 * セクションとセクションの隙間(= main の地の部分)に落としたとき、上る先が
 * main ではなく main を包む div になり、部品がページの先頭か末尾に飛んでいた
 * (実測: キャンバス表示で紙面の中ほどに落として先頭に入った)。
 * 重なり順を全部見て「一番内側の器」を親に決めれば、隙間に落としても
 * そのセクションの列に入る。
 */
export function findFlowInsertion(doc: Document, x: number, y: number): FlowInsertion {
  const stack = (doc.elementsFromPoint(x, y) as Element[]) ?? [];
  const parent = stack.find((el) => isContainer(doc, el)) ?? fallbackContainer(doc);

  // 親の子を上から見て、ドロップ位置より下に中心がある最初の子の前に入れる。
  // 中心で区切るので「つかんでいる位置のすぐ上か、すぐ下か」が見立てと合う
  const kids = placeableChildren(parent);
  const before = kids.find((el) => {
    const r = el.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return { parent, before: before ?? null };
}

/** 既にある印を消す */
export function clearPartDropIndicator(doc: Document | null | undefined): void {
  if (!doc) return;
  doc.querySelectorAll(`.${PART_DROP_INDICATOR_CLASS}`).forEach((el) => el.remove());
}

/**
 * 挿入位置に横棒を出す。
 * 紙面(iframe)の中に置くので、キャンバス表示で外側の transform に
 * 縮められていても紙面と一緒に縮み、位置がずれない。
 */
export function showPartDropIndicator(doc: Document, x: number, y: number): FlowInsertion {
  // 前回の印を先に消す。残したまま座標判定をすると印そのものに当たる
  clearPartDropIndicator(doc);

  const target = findFlowInsertion(doc, x, y);
  const kids = placeableChildren(target.parent);
  // before があればその上辺、無ければ最後の子の下辺。子が無ければ親の内側の上辺
  const ref = target.before ?? kids[kids.length - 1] ?? target.parent;
  const atTop = !!target.before || ref === target.parent;
  const rect = ref.getBoundingClientRect();

  const view = doc.defaultView;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;

  const bar = doc.createElement('div');
  bar.className = INDICATOR_CLASS;
  // .selection-box が position:absolute / pointer-events:none / z-index:10000 を
  // 既に持っているので、ここでは見た目と位置だけ足す
  bar.style.cssText = [
    `left: ${rect.left + scrollX}px`,
    `top: ${(atTop ? rect.top : rect.bottom) + scrollY - 2}px`,
    `width: ${Math.max(rect.width, 24)}px`,
    'height: 4px',
    'background: #0d99ff',
    'border-radius: 2px',
    'box-shadow: 0 0 0 1px rgba(255,255,255,0.9), 0 0 8px rgba(13,153,255,0.6)',
  ].join(';');

  doc.body.appendChild(bar);
  return target;
}
