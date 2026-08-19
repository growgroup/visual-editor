/**
 * Alt(Option)ホバーの距離メジャー(Figmaの赤い計測線)。
 *
 * 要素を選択した状態でAltを押しながら別の要素にカーソルを載せると、
 * 選択要素とホバー要素の間の距離を赤い線とバッジで示す。
 *
 * 座標はすべてアートボード座標(1920×1080の素のpx)で計算し、レイヤーを
 * アートボード直下に置く。ズームはアートボードごと transform されるので
 * 線もバッジも自動で追従する。レイヤーは表示専用(pointer-events:none)で、
 * 保存対象にもならない(getCleanHtml が #gg-measure-layer を除去する)。
 */

const LAYER_ID = 'gg-measure-layer';
const RED = '#f24822'; // Figmaの計測色

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** クライアント座標の矩形をアートボード座標へ */
function toArtboardRect(el: HTMLElement, artboard: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const a = artboard.getBoundingClientRect();
  const scale = a.width / artboard.offsetWidth || 1;
  const left = (r.left - a.left) / scale;
  const top = (r.top - a.top) / scale;
  return { left, top, right: left + r.width / scale, bottom: top + r.height / scale, width: r.width / scale, height: r.height / scale };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** 2矩形間の計測線。軸ごとに「離れていれば近い辺の間」「重なっていれば辺のずれ」 */
function computeSegs(a: Rect, b: Rect): Seg[] {
  const out: Seg[] = [];

  // 垂直方向の重なり範囲の中心(無ければAの中心)。水平線のy位置に使う
  const oy1 = Math.max(a.top, b.top);
  const oy2 = Math.min(a.bottom, b.bottom);
  const cy = oy1 < oy2 ? (oy1 + oy2) / 2 : a.top + a.height / 2;
  // 水平方向の重なり範囲の中心。垂直線のx位置に使う
  const ox1 = Math.max(a.left, b.left);
  const ox2 = Math.min(a.right, b.right);
  const cx = ox1 < ox2 ? (ox1 + ox2) / 2 : a.left + a.width / 2;

  // ── X軸 ──
  if (a.right <= b.left) {
    out.push({ x1: a.right, y1: cy, x2: b.left, y2: cy });
  } else if (b.right <= a.left) {
    out.push({ x1: b.right, y1: cy, x2: a.left, y2: cy });
  } else {
    // 重なっている(内包・交差): 左辺どうし・右辺どうしのずれを出す
    if (Math.abs(a.left - b.left) >= 0.5)
      out.push({ x1: Math.min(a.left, b.left), y1: cy, x2: Math.max(a.left, b.left), y2: cy });
    if (Math.abs(a.right - b.right) >= 0.5)
      out.push({ x1: Math.min(a.right, b.right), y1: cy, x2: Math.max(a.right, b.right), y2: cy });
  }

  // ── Y軸 ──
  if (a.bottom <= b.top) {
    out.push({ x1: cx, y1: a.bottom, x2: cx, y2: b.top });
  } else if (b.bottom <= a.top) {
    out.push({ x1: cx, y1: b.bottom, x2: cx, y2: a.top });
  } else {
    if (Math.abs(a.top - b.top) >= 0.5)
      out.push({ x1: cx, y1: Math.min(a.top, b.top), x2: cx, y2: Math.max(a.top, b.top) });
    if (Math.abs(a.bottom - b.bottom) >= 0.5)
      out.push({ x1: cx, y1: Math.min(a.bottom, b.bottom), x2: cx, y2: Math.max(a.bottom, b.bottom) });
  }

  return out;
}

export function clearMeasure(doc: Document): void {
  doc.getElementById(LAYER_ID)?.remove();
}

/** 選択要素(sel)とホバー要素(target)の距離を描く */
export function drawMeasure(doc: Document, sel: HTMLElement, target: HTMLElement): void {
  const artboard = doc.getElementById('artboard');
  if (!artboard) return;

  clearMeasure(doc);
  const layer = doc.createElement('div');
  layer.id = LAYER_ID;
  layer.style.cssText = 'position:absolute;inset:0;z-index:9400;pointer-events:none;';

  const a = toArtboardRect(sel, artboard);
  const b = toArtboardRect(target, artboard);

  // ホバー先を薄い赤枠で示す(どこと測っているかが分かるように)
  const outline = doc.createElement('div');
  outline.style.cssText =
    `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;` +
    `outline:1px dashed ${RED};outline-offset:-1px;`;
  layer.appendChild(outline);

  for (const s of computeSegs(a, b)) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len < 0.5) continue;
    const horizontal = Math.abs(s.y2 - s.y1) < Math.abs(s.x2 - s.x1);

    const line = doc.createElement('div');
    line.style.cssText = horizontal
      ? `position:absolute;left:${Math.min(s.x1, s.x2)}px;top:${s.y1 - 0.75}px;width:${len}px;height:1.5px;background:${RED};`
      : `position:absolute;left:${s.x1 - 0.75}px;top:${Math.min(s.y1, s.y2)}px;width:1.5px;height:${len}px;background:${RED};`;
    layer.appendChild(line);

    const badge = doc.createElement('div');
    badge.textContent = String(Math.round(len));
    badge.style.cssText =
      `position:absolute;left:${(s.x1 + s.x2) / 2}px;top:${(s.y1 + s.y2) / 2}px;` +
      `transform:translate(-50%,-50%);background:${RED};color:#fff;` +
      'font:600 12px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;' +
      'padding:0 5px;border-radius:3px;white-space:nowrap;';
    // 横線のバッジは線の少し下、縦線のバッジは線の少し右に逃がす(線と重ねない)
    if (horizontal) badge.style.marginTop = '12px';
    else badge.style.marginLeft = '18px';
    layer.appendChild(badge);
  }

  artboard.appendChild(layer);
}
