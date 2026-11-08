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

import { getActiveCanvasGuides } from './canvas-guides';
import { getOverlayRect } from './dom-utils';

const LAYER_ID = 'gg-smart-guides';
const RED = '#f24822'; // Figmaの計測色(measure-distance.ts と揃える)
/** 等間隔の表示色(Figma の等間隔ガイドのピンク。記憶にもとづく近似色) */
const PINK = '#ff3ebf';

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
  /** 兄弟の矩形(等間隔の判定に使う)。アートボード座標 */
  rects?: MovingRect[];
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
  /** 等間隔に吸着したときの間隔の表示(軸ごと)。吸着していない軸は入らない */
  spacing?: SpacingMark[];
}

/**
 * 等間隔の表示 1 本。axis='x' なら from〜to は x 座標で、at(y)の高さに横向きの線を引く
 */
export interface SpacingMark {
  axis: 'x' | 'y';
  from: number;
  to: number;
  at: number;
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
  // 定規から引いたガイド(キャンバス表示・編集中のページのもの)も吸着の相手
  const ruled = getActiveCanvasGuides();
  xs.push(...ruled.xs);
  ys.push(...ruled.ys);

  const movingSet = new Set<HTMLElement>(moving);
  const seen = new Set<HTMLElement>();
  const rects: MovingRect[] = [];

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
      rects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
  }

  return { xs: normalize(xs), ys: normalize(ys), rects };
}

/** 軸に沿って見た矩形。s〜e が軸方向、cs〜ce が直交方向 */
interface AxisSpan {
  s: number;
  e: number;
  cs: number;
  ce: number;
}

function toAxis(r: MovingRect, axis: 'x' | 'y'): AxisSpan {
  return axis === 'x'
    ? { s: r.left, e: r.left + r.width, cs: r.top, ce: r.top + r.height }
    : { s: r.top, e: r.top + r.height, cs: r.left, ce: r.left + r.width };
}

/** 2つの矩形の直交方向の重なりの中央(間隔の線を引く高さ) */
function crossMid(a: AxisSpan, b: AxisSpan): number {
  const lo = Math.max(a.cs, b.cs);
  const hi = Math.min(a.ce, b.ce);
  return lo <= hi ? (lo + hi) / 2 : (a.cs + a.ce) / 2;
}

/**
 * 等間隔への吸着(Figma の等間隔ガイド)。
 *
 * 動かしている矩形と直交方向に重なる兄弟だけを「同じ列」とみなし、次の 3 通りを試す。
 * 1. 前と後ろの兄弟のちょうど中間(両側の隙間が同じ)
 * 2. 前の 2 つと同じ間隔で後ろに続ける(3 枚目のカードを並べるとき)
 * 3. 後ろの 2 つと同じ間隔で前に置く
 * いちばん近いものが threshold 以内なら、その補正量と表示する線を返す。
 */
function snapToSpacing(
  rects: MovingRect[],
  rect: MovingRect,
  axis: 'x' | 'y',
  threshold: number,
): { diff: number; marks: SpacingMark[] } | null {
  const m = toAxis(rect, axis);
  const size = m.e - m.s;
  const mid = (m.s + m.e) / 2;
  const row = rects.map((r) => toAxis(r, axis)).filter((o) => o.cs < m.ce && o.ce > m.cs);
  // 前 = 終わりが自分の中央より手前、後ろ = 始まりが自分の中央より先。重なっているものは数えない
  const before = row.filter((o) => o.e <= mid && o.s < m.s).sort((a, b) => b.e - a.e);
  const after = row.filter((o) => o.s >= mid && o.e > m.e).sort((a, b) => a.s - b.s);
  const prev = before[0];
  const next = after[0];

  type Option = { target: number; marks: SpacingMark[] };
  const options: Option[] = [];
  const mark = (from: number, to: number, at: number): SpacingMark => ({ axis, from, to, at });

  if (prev && next) {
    const gap = (next.s - prev.e - size) / 2;
    if (gap >= 0) {
      const t = prev.e + gap;
      const at = (crossMid(prev, m) + crossMid(next, m)) / 2;
      options.push({ target: t, marks: [mark(prev.e, t, at), mark(t + size, next.s, at)] });
    }
  }
  if (prev) {
    // prev の手前にある、prev と同じ列の兄弟
    const prev2 = row
      .filter((o) => o !== prev && o.e <= prev.s + 0.5 && o.cs < prev.ce && o.ce > prev.cs)
      .sort((a, b) => b.e - a.e)[0];
    if (prev2) {
      const gap = prev.s - prev2.e;
      const t = prev.e + gap;
      options.push({
        target: t,
        marks: [mark(prev2.e, prev.s, crossMid(prev2, prev)), mark(prev.e, t, crossMid(prev, m))],
      });
    }
  }
  if (next) {
    const next2 = row
      .filter((o) => o !== next && o.s >= next.e - 0.5 && o.cs < next.ce && o.ce > next.cs)
      .sort((a, b) => a.s - b.s)[0];
    if (next2) {
      const gap = next2.s - next.e;
      const t = next.s - gap - size;
      options.push({
        target: t,
        marks: [mark(t + size, next.s, crossMid(next, m)), mark(next.e, next2.s, crossMid(next, next2))],
      });
    }
  }

  let best: Option | null = null;
  for (const o of options) {
    const d = Math.abs(o.target - m.s);
    if (d <= threshold && (!best || d < Math.abs(best.target - m.s))) best = o;
  }
  return best ? { diff: best.target - m.s, marks: best.marks } : null;
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

  // 等間隔。端・中央の吸着より近ければ、その軸は等間隔を優先する
  if (candidates.rects?.length) {
    const spacing: SpacingMark[] = [];
    // 同じ位置で端の整列とも揃うなら(中央に置いた矢印など)、両方の線を出す
    const SAME = 0.5;
    const sx = snapToSpacing(candidates.rects, rect, 'x', threshold);
    if (sx && (result.guideX === null || Math.abs(sx.diff) <= Math.abs(result.dx) + SAME)) {
      if (result.guideX !== null && Math.abs(sx.diff - result.dx) > SAME) result.guideX = null;
      result.dx = sx.diff;
      spacing.push(...sx.marks);
    }
    const sy = snapToSpacing(candidates.rects, rect, 'y', threshold);
    if (sy && (result.guideY === null || Math.abs(sy.diff) <= Math.abs(result.dy) + SAME)) {
      if (result.guideY !== null && Math.abs(sy.diff - result.dy) > SAME) result.guideY = null;
      result.dy = sy.diff;
      spacing.push(...sy.marks);
    }
    if (spacing.length) {
      // 等間隔の線は吸着後の位置で引く(x の線の高さは y の補正の影響を受けない近似で十分)
      result.spacing = spacing;
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
  spacing: SpacingMark[] = [],
): void {
  clearSmartGuides(doc);
  if (guideX === null && guideY === null && spacing.length === 0) return;

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

  // 等間隔: 隙間ごとにピンクの線と間隔の数値(Figma の等間隔ガイド)
  for (const sp of spacing) {
    const len = sp.to - sp.from;
    if (len <= 0) continue;
    const seg = doc.createElement('div');
    seg.dataset.guide = 'spacing';
    seg.style.cssText =
      sp.axis === 'x'
        ? `position:absolute;left:${sp.from}px;width:${len}px;top:${sp.at}px;height:${w};margin-top:calc(${half} * -1);background:${PINK};`
        : `position:absolute;top:${sp.from}px;height:${len}px;left:${sp.at}px;width:${w};margin-left:calc(${half} * -1);background:${PINK};`;
    const label = doc.createElement('div');
    label.textContent = String(Math.round(len));
    label.style.cssText =
      `position:absolute;${sp.axis === 'x' ? 'left:50%;top:0' : 'top:50%;left:0'};transform:translate(-50%,-50%);` +
      `padding:calc(1px * var(--overlay-scale, 1)) calc(4px * var(--overlay-scale, 1));` +
      `border-radius:calc(2px * var(--overlay-scale, 1));background:${PINK};color:#fff;` +
      `font:600 calc(11px * var(--overlay-scale, 1))/1.2 system-ui,sans-serif;white-space:nowrap;`;
    seg.appendChild(label);
    layer.appendChild(seg);
  }

  artboard.appendChild(layer);
}

/** リサイズの吸着の結果。dx/dy は「マウスの移動量(アートボード px)に足す補正量」 */
export interface ResizeSnapResult {
  dx: number;
  dy: number;
  guideX: number | null;
  guideY: number | null;
}

/**
 * リサイズ中の吸着(Figma と同じく、動いている辺だけが相手の端・中央・定規のガイドに吸い付く)
 *
 * rect は生の移動量で計算したリサイズ後の矩形(アートボード座標)。
 * 掴んだ辺は、左右・上下どちらのハンドルでも移動量と同じだけ同じ向きに動く
 * (Alt の中心固定でも同じ。そのとき対辺は逆向きに同じだけ動く)。
 * なので「辺の位置の差」がそのまま移動量の補正になり、対辺で揃えるときだけ符号を反転する。
 *
 * axes で吸着させる軸を選ぶ。Shift(縦横比固定)のときは呼び出し側が主に動いている軸だけを渡し、
 * もう片方は比から出す。
 */
export function snapResizeEdges(
  candidates: GuideCandidates,
  rect: MovingRect,
  dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 },
  opts: { alt: boolean; axes: { x: boolean; y: boolean } },
  threshold: number,
): ResizeSnapResult {
  const result: ResizeSnapResult = { dx: 0, dy: 0, guideX: null, guideY: null };

  const pick = (
    list: number[],
    start: number,
    end: number,
    d: -1 | 1,
  ): { delta: number; guide: number } | null => {
    // 掴んだ辺(+1)。Alt なら対辺も動くので候補に入れる(-1)
    const edges: Array<[number, 1 | -1]> = [[d > 0 ? end : start, 1]];
    if (opts.alt) edges.push([d > 0 ? start : end, -1]);
    let best: { delta: number; guide: number } | null = null;
    let bestDist = threshold;
    for (const [edge, sign] of edges) {
      const target = nearest(list, edge);
      if (target === null) continue;
      const diff = target - edge;
      if (Math.abs(diff) <= bestDist) {
        bestDist = Math.abs(diff);
        best = { delta: diff * sign, guide: target };
      }
    }
    return best;
  };

  if (opts.axes.x && dir.x !== 0) {
    const s = pick(candidates.xs, rect.left, rect.left + rect.width, dir.x);
    if (s) {
      result.dx = s.delta;
      result.guideX = s.guide;
    }
  }
  if (opts.axes.y && dir.y !== 0) {
    const s = pick(candidates.ys, rect.top, rect.top + rect.height, dir.y);
    if (s) {
      result.dy = s.delta;
      result.guideY = s.guide;
    }
  }
  return result;
}
