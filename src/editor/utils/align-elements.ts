/**
 * 選択要素の配置(整列)と等間隔配置。
 *
 * 【なぜ offset* を使うか】
 * アートボードはズームのために CSS transform で拡縮している。getBoundingClientRect() は
 * その拡縮が乗った画面pxを返すので、書き込み先の style.left(素のアートボードpx)と
 * 単位が食い違う。offsetLeft/offsetTop/offsetWidth/offsetHeight は transform の影響を
 * 受けないレイアウト値なので、実測と書き込みの単位が必ず一致する。
 *
 * 【基準の決め方】
 * ・2個以上 … 選択群のバウンディングボックス(PowerPointと同じ「選択したオブジェクトを揃える」)
 * ・1個     … アートボード(1920×1080)
 *
 * 【入れ子の扱い】
 * スライドの要素は「カードの中の見出し」のように入れ子になっていることが多く、
 * offsetLeft は要素ごとに違う親を原点にした値になる。そのまま比べると別々の
 * ものさしで測った数字を並べることになるので、いったん**アートボード座標**へ
 * 直して比較し、書き戻すときにその要素の原点へ戻す。
 *
 * 位置は style.left / style.top へ書き戻すため、動かせるのは絶対配置の要素だけ。
 * 通常フロー(static)や relative の要素は left/top を書いても意図どおりに動かないので触らない。
 */

/** アートボードの設計寸法(スライドは常にこの大きさ) */
const ARTBOARD_W = 1920;
const ARTBOARD_H = 1080;

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';

/** 実測した1要素。位置はアートボード座標、原点はその要素の left/top の起点 */
type Box = {
  el: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** この要素の left/top が測られている原点(アートボード座標) */
  originX: number;
  originY: number;
  /** left/top を書いて動かせるか。動かせない要素も「選択群の広さ」には数える */
  movable: boolean;
};

/** left/top を書いて動かせる要素か(絶対配置のみ) */
function isMovable(el: HTMLElement): boolean {
  const pos = el.ownerDocument.defaultView?.getComputedStyle(el).position;
  return pos === 'absolute' || pos === 'fixed';
}

/** アートボードの左上から見た位置。offsetParent を遡って足し上げる */
function artboardOffset(el: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent || parent.id === 'artboard') break;
    node = parent;
  }
  return { x, y };
}

/**
 * 選択要素をアートボード座標で実測する。
 * 動かせない要素も返すのは、基準になる「選択群の広さ」から外すと、
 * 例えば2つ選んだうちの片方が動かせないときに、残り1つが
 * アートボード基準へ勝手に切り替わってしまうため。
 */
function measure(els: HTMLElement[]): Box[] {
  return els.map((el) => {
    const { x, y } = artboardOffset(el);
    return {
      el,
      x,
      y,
      width: el.offsetWidth,
      height: el.offsetHeight,
      originX: x - el.offsetLeft,
      originY: y - el.offsetTop,
      movable: isMovable(el),
    };
  });
}

/** アートボード座標で指定した位置へ置く(その要素の原点に直してから書く) */
function setX(b: Box, x: number): void {
  b.el.style.left = `${Math.round(x - b.originX)}px`;
}
function setY(b: Box, y: number): void {
  b.el.style.top = `${Math.round(y - b.originY)}px`;
}

/** 整列の基準になる枠(アートボード座標)。複数選択なら選択群、単一ならアートボード全面 */
function referenceRect(boxes: Box[]): { left: number; top: number; right: number; bottom: number } {
  if (boxes.length > 1) {
    return {
      left: Math.min(...boxes.map((b) => b.x)),
      top: Math.min(...boxes.map((b) => b.y)),
      right: Math.max(...boxes.map((b) => b.x + b.width)),
      bottom: Math.max(...boxes.map((b) => b.y + b.height)),
    };
  }
  return { left: 0, top: 0, right: ARTBOARD_W, bottom: ARTBOARD_H };
}

/**
 * 指定した揃え方で要素を動かす。戻り値は実際に動かした要素。
 * 複数選択時は選択群のバウンディングボックス、単一選択時はアートボードが基準。
 */
export function alignElements(els: HTMLElement[], mode: AlignMode): HTMLElement[] {
  const boxes = measure(els);
  const movable = boxes.filter((b) => b.movable);
  if (!movable.length) return [];
  // 基準は選択全体、動かすのは動かせるものだけ
  const ref = referenceRect(boxes);
  const cx = (ref.left + ref.right) / 2;
  const cy = (ref.top + ref.bottom) / 2;

  for (const b of movable) {
    switch (mode) {
      case 'left': setX(b, ref.left); break;
      case 'hcenter': setX(b, cx - b.width / 2); break;
      case 'right': setX(b, ref.right - b.width); break;
      case 'top': setY(b, ref.top); break;
      case 'vcenter': setY(b, cy - b.height / 2); break;
      case 'bottom': setY(b, ref.bottom - b.height); break;
    }
  }
  return movable.map((b) => b.el);
}

/**
 * 等間隔に配置する(3個以上)。両端の要素はそのままで、間の要素の**すき間**が
 * 均等になるように置き直す(PowerPointの「左右に整列」と同じ)。
 * 要素の幅がまちまちでも見た目の間隔が揃うよう、中心間ではなく辺と辺の間で割る。
 */
export function distributeElements(els: HTMLElement[], axis: DistributeAxis): HTMLElement[] {
  // 等間隔は「並べ替える対象」そのものが要るので、動かせる要素だけで組む
  const boxes = measure(els).filter((b) => b.movable);
  if (boxes.length < 3) return [];

  const horizontal = axis === 'h';
  const start = (b: Box) => (horizontal ? b.x : b.y);
  const size = (b: Box) => (horizontal ? b.width : b.height);
  const place = horizontal ? setX : setY;

  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // 両端の内側に残る空きを、間の要素で分け合う
  const span = start(last) - (start(first) + size(first));
  const innerSize = sorted.slice(1, -1).reduce((sum, b) => sum + size(b), 0);
  const gap = (span - innerSize) / (sorted.length - 1);

  let cursor = start(first) + size(first);
  const moved: HTMLElement[] = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    const b = sorted[i];
    cursor += gap;
    place(b, cursor);
    cursor += size(b);
    moved.push(b.el);
  }
  return moved;
}
