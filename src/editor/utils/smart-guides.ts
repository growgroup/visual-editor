/**
 * スマートガイド(整列ガイド)とスナップ。
 *
 * ドラッグ中の要素が、他の要素やアートボードの「端・中央」と揃う瞬間に
 * 赤いガイド線を出し、そこへ吸着させる(Figma/PowerPointと同じ挙動)。
 *
 * 座標はすべてアートボード座標(1920×1080の素のpx)。measure-distance.ts と同じく
 * 描画レイヤーは #artboard 直下に置くので、ズームはアートボードごと transform
 * されて線も自動で追従する。レイヤーは表示専用(pointer-events:none)で、
 * 保存対象にもならない(getCleanHtml が #gg-smart-guides を除去する)。
 *
 * 【性能の約束】候補座標の収集はドラッグ開始時の1回だけ。毎フレームやるのは
 * ソート済み配列への二分探索3本(x)と3本(y)だけで、要素数が数百でも一定時間で終わる。
 */

import { getOverlayRect } from './dom-utils';

const LAYER_ID = 'gg-smart-guides';
const RED = '#f24822'; // Figmaの計測色(measure-distance.ts と揃える)

/** 吸着する距離。画面上のpxで定義し、使う側でズーム倍率を割り戻す */
export const SNAP_THRESHOLD_SCREEN_PX = 4;

/** ガイドの候補にしないオーバーレイ類(エディタが描いている飾り) */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-collab-layer,.gg-crop-ui,' +
  '#gg-measure-layer,#gg-smart-guides,[data-drag-ghost],[data-flex-drop-indicator]';

/** 整列の候補座標。x/y ともに昇順ソート済み */
export interface GuideCandidates {
  xs: number[];
  ys: number[];
}

/** アートボード座標の矩形 */
export interface MovingRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** スナップの結果。dx/dy は「今の位置に足す補正量」 */
export interface SnapResult {
  dx: number;
  dy: number;
  /** 揃った縦線のx座標(揃っていなければ null) */
  guideX: number | null;
  /** 揃った横線のy座標 */
  guideY: number | null;
}

/** 昇順ソート + 近い値の重複除去(0.5px以内は同じ線とみなす) */
function normalize(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 0.5) out.push(v);
  }
  return out;
}

/** ソート済み配列から value に最も近い値を二分探索で返す */
function nearest(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  // lo は value 以上の最初の位置。その1つ手前と比べて近いほうを採る
  const a = sorted[lo];
  const b = lo > 0 ? sorted[lo - 1] : a;
  return Math.abs(a - value) <= Math.abs(b - value) ? a : b;
}

/**
 * 整列の候補座標を集める(ドラッグ開始時に1回だけ呼ぶ)
 *
 * 候補は「動かしている要素と同じ親を持つ兄弟」と「アートボードの端・中央」。
 * 動かしている要素自身は除く(自分の辺に吸着してしまうため)。
 */
export function collectGuideCandidates(
  doc: Document,
  moving: HTMLElement[],
): GuideCandidates | null {
  const artboard = doc.getElementById('artboard');
  if (!artboard) return null;

  const width = artboard.offsetWidth || 1920;
  const height = artboard.offsetHeight || 1080;

  // アートボードの端と中央(スライドの版面に対する整列)
  const xs: number[] = [0, width / 2, width];
  const ys: number[] = [0, height / 2, height];

  const movingSet = new Set<HTMLElement>(moving);
  const seen = new Set<HTMLElement>();

  for (const el of moving) {
    const parent = el.parentElement;
    if (!parent) continue;
    for (const node of Array.from(parent.children)) {
      // [注意] `node instanceof HTMLElement` は使えない。
      // ここは親ウィンドウで動くが、要素は iframe の realm に属するので
      // 親の HTMLElement とは別のコンストラクタになり、常に false になる
      // (これで兄弟が1つも候補に入らず、スナップが版面の端だけに効いていた)。
      const child = node as HTMLElement;
      if (typeof child.matches !== 'function') continue;
      if (movingSet.has(child) || seen.has(child)) continue;
      if (child.matches(OVERLAY_SELECTOR)) continue;
      seen.add(child);

      const r = getOverlayRect(doc, child);
      // 描画されていない要素(display:none 等)は整列の相手にならない
      if (r.width <= 0 && r.height <= 0) continue;

      xs.push(r.left, r.left + r.width / 2, r.left + r.width);
      ys.push(r.top, r.top + r.height / 2, r.top + r.height);
    }
  }

  return { xs: normalize(xs), ys: normalize(ys) };
}

/**
 * 吸着量を求める
 *
 * 動かしている矩形の「左辺・中央・右辺」(y は上辺・中央・下辺)のうち、
 * 候補にいちばん近いものを1本だけ選ぶ。同時に2本吸わせると、
 * 幅の違う要素が引き伸ばされたように見えるため軸ごとに1本に絞る。
 */
export function snapToGuides(
  candidates: GuideCandidates,
  rect: MovingRect,
  threshold: number,
): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guideX: null, guideY: null };

  const xEdges = [rect.left, rect.left + rect.width / 2, rect.left + rect.width];
  let bestX = threshold;
  for (const edge of xEdges) {
    const target = nearest(candidates.xs, edge);
    if (target === null) break;
    const diff = target - edge;
    if (Math.abs(diff) <= bestX) {
      bestX = Math.abs(diff);
      result.dx = diff;
      result.guideX = target;
    }
  }

  const yEdges = [rect.top, rect.top + rect.height / 2, rect.top + rect.height];
  let bestY = threshold;
  for (const edge of yEdges) {
    const target = nearest(candidates.ys, edge);
    if (target === null) break;
    const diff = target - edge;
    if (Math.abs(diff) <= bestY) {
      bestY = Math.abs(diff);
      result.dy = diff;
      result.guideY = target;
    }
  }

  return result;
}

/** ガイド線を消す */
export function clearSmartGuides(doc: Document): void {
  doc.getElementById(LAYER_ID)?.remove();
}

/**
 * ガイド線を描く。揃っている軸だけ、アートボードを端から端まで貫く線を出す
 * (どの座標で揃ったのかが一目で分かる。PowerPointの整列ガイドと同じ見せ方)
 */
export function drawSmartGuides(
  doc: Document,
  guideX: number | null,
  guideY: number | null,
): void {
  clearSmartGuides(doc);
  if (guideX === null && guideY === null) return;

  const artboard = doc.getElementById('artboard');
  if (!artboard) return;

  const layer = doc.createElement('div');
  layer.id = LAYER_ID;
  layer.style.cssText = 'position:absolute;inset:0;z-index:9500;pointer-events:none;';

  // 線の太さは画面上で常に1pxに見えるよう --overlay-scale(=1/zoom)を掛ける
  const w = 'calc(1px * var(--overlay-scale, 1))';
  const half = 'calc(0.5px * var(--overlay-scale, 1))';

  if (guideX !== null) {
    const line = doc.createElement('div');
    line.dataset.guide = 'x';
    line.style.cssText =
      `position:absolute;top:0;bottom:0;left:${guideX}px;` +
      `width:${w};margin-left:calc(${half} * -1);background:${RED};`;
    layer.appendChild(line);
  }
  if (guideY !== null) {
    const line = doc.createElement('div');
    line.dataset.guide = 'y';
    line.style.cssText =
      `position:absolute;left:0;right:0;top:${guideY}px;` +
      `height:${w};margin-top:calc(${half} * -1);background:${RED};`;
    layer.appendChild(line);
  }

  artboard.appendChild(layer);
}
