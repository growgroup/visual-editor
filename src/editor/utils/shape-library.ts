/**
 * 図形カタログ(PowerPointの「図形」ギャラリー相当)。
 *
 * 図形は div + clip-path / border-radius で表現する。SVGにしないのは、
 *   - 「図形の書式」の塗り・枠線・影・透明度がそのまま効く
 *   - ダブルクリックで中に文字を入れられる(実機と同じ)
 *   - 書き戻しエンジンが普通のDOMとして原本TSXへ運べる
 * ため。線・矢印だけは既存の描画ツール(SVG)に任せる。
 *
 * ギャラリーで図形を選ぶと `pendingShape` に入り、キャンバスを
 * ドラッグすればその大きさで、クリックだけなら既定サイズで作られる。
 */

export type ShapeDef = {
  id: string;
  label: string;
  /** 塗りを切り抜く形。無指定は矩形 */
  clip?: string;
  /** 角丸(border-radius) */
  radius?: string;
  /** 追加のスタイル(円環の枠など) */
  extra?: Record<string, string>;
  /** クリックだけで置いたときの既定サイズ */
  w: number;
  h: number;
};

/** 正多角形(星形)のpolygonを作る */
function starPolygon(points: number, inner = 0.42): string {
  const pts: string[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : inner;
    const a = -Math.PI / 2 + i * step;
    const x = (0.5 + r * Math.cos(a)) * 100;
    const y = (0.5 + r * Math.sin(a)) * 100;
    pts.push(`${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

/** 正多角形(頂点が上) */
function regularPolygon(n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = (0.5 + 0.5 * Math.cos(a)) * 100;
    const y = (0.5 + 0.5 * Math.sin(a)) * 100;
    pts.push(`${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

export const SHAPE_GROUPS: { group: string; shapes: ShapeDef[] }[] = [
  {
    group: '四角形',
    shapes: [
      { id: 'rect', label: '長方形', w: 260, h: 160 },
      { id: 'square', label: '正方形', w: 200, h: 200 },
      { id: 'round-rect', label: '角丸四角形', radius: '20px', w: 260, h: 160 },
      { id: 'round-rect-lg', label: '角丸(大)', radius: '48px', w: 260, h: 160 },
      { id: 'pill', label: '角丸(全周)', radius: '9999px', w: 280, h: 110 },
      { id: 'round-top', label: '上だけ角丸', radius: '28px 28px 0 0', w: 260, h: 160 },
      { id: 'round-diag', label: '対角を角丸', radius: '32px 0 32px 0', w: 260, h: 160 },
      { id: 'round-one', label: '1つだけ角丸', radius: '48px 0 0 0', w: 260, h: 160 },
      { id: 'cut-corner', label: '角を切り取り', clip: 'polygon(0 0, 82% 0, 100% 26%, 100% 100%, 0 100%)', w: 260, h: 170 },
      { id: 'frame', label: '額縁', extra: { backgroundColor: 'transparent', border: '18px solid var(--color-gg-green)' }, w: 260, h: 180 },
    ],
  },
  {
    group: '基本図形',
    shapes: [
      { id: 'ellipse', label: '楕円', radius: '50%', w: 220, h: 220 },
      { id: 'triangle', label: '三角形', clip: 'polygon(50% 0%, 100% 100%, 0% 100%)', w: 220, h: 190 },
      { id: 'right-triangle', label: '直角三角形', clip: 'polygon(0% 0%, 0% 100%, 100% 100%)', w: 220, h: 190 },
      { id: 'parallelogram', label: '平行四辺形', clip: 'polygon(18% 0%, 100% 0%, 82% 100%, 0% 100%)', w: 280, h: 160 },
      { id: 'trapezoid', label: '台形', clip: 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)', w: 260, h: 160 },
      { id: 'diamond', label: 'ひし形', clip: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', w: 220, h: 220 },
      { id: 'pentagon', label: '五角形', clip: regularPolygon(5), w: 220, h: 210 },
      { id: 'hexagon', label: '六角形', clip: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)', w: 240, h: 208 },
      { id: 'heptagon', label: '七角形', clip: regularPolygon(7), w: 220, h: 220 },
      { id: 'octagon', label: '八角形', clip: regularPolygon(8), w: 220, h: 220 },
      { id: 'decagon', label: '十角形', clip: regularPolygon(10), w: 220, h: 220 },
      { id: 'dodecagon', label: '十二角形', clip: regularPolygon(12), w: 220, h: 220 },
      { id: 'cross', label: '十字', clip: 'polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%)', w: 200, h: 200 },
      { id: 'l-shape', label: 'L字', clip: 'polygon(0 0, 38% 0, 38% 62%, 100% 62%, 100% 100%, 0 100%)', w: 220, h: 200 },
      { id: 'chord', label: '半円', clip: 'polygon(0 100%, 0 50%, 3% 34%, 12% 19%, 25% 8%, 40% 1%, 50% 0, 60% 1%, 75% 8%, 88% 19%, 97% 34%, 100% 50%, 100% 100%)', w: 240, h: 130 },
      { id: 'quarter', label: '四分円', clip: 'polygon(0 0, 100% 0, 100% 100%, 92% 66%, 74% 38%, 48% 16%, 0 0)', w: 220, h: 200 },
      { id: 'donut', label: '円環', radius: '50%', extra: { backgroundColor: 'transparent', border: '32px solid var(--color-gg-green)' }, w: 220, h: 220 },
      { id: 'ban', label: '禁止', radius: '50%', extra: { backgroundColor: 'transparent', border: '20px solid var(--color-gg-red)' }, w: 200, h: 200 },
      { id: 'heart', label: 'ハート', clip: 'polygon(50% 100%, 12% 66%, 0 38%, 6% 17%, 24% 6%, 42% 10%, 50% 22%, 58% 10%, 76% 6%, 94% 17%, 100% 38%, 88% 66%)', w: 220, h: 200 },
      { id: 'bolt', label: '稲妻', clip: 'polygon(58% 0, 22% 54%, 46% 54%, 34% 100%, 82% 40%, 54% 40%, 74% 0)', w: 150, h: 220 },
      { id: 'moon', label: '月', clip: 'polygon(62% 0, 40% 8%, 24% 26%, 18% 50%, 24% 74%, 40% 92%, 62% 100%, 44% 84%, 36% 60%, 38% 36%, 48% 14%)', w: 170, h: 220 },
      { id: 'sun', label: '太陽', clip: starPolygon(12, 0.34), w: 220, h: 220 },
      { id: 'cloud', label: '雲', clip: 'polygon(22% 100%, 8% 92%, 2% 76%, 10% 60%, 8% 44%, 22% 32%, 38% 32%, 48% 18%, 66% 14%, 80% 26%, 84% 42%, 96% 52%, 98% 72%, 88% 88%, 72% 100%)', w: 260, h: 180 },
    ],
  },
  {
    group: 'ブロック矢印',
    shapes: [
      { id: 'arrow-right', label: '右矢印', clip: 'polygon(0% 30%, 62% 30%, 62% 6%, 100% 50%, 62% 94%, 62% 70%, 0% 70%)', w: 280, h: 140 },
      { id: 'arrow-left', label: '左矢印', clip: 'polygon(100% 30%, 38% 30%, 38% 6%, 0% 50%, 38% 94%, 38% 70%, 100% 70%)', w: 280, h: 140 },
      { id: 'arrow-up', label: '上矢印', clip: 'polygon(30% 100%, 30% 38%, 6% 38%, 50% 0%, 94% 38%, 70% 38%, 70% 100%)', w: 140, h: 280 },
      { id: 'arrow-down', label: '下矢印', clip: 'polygon(30% 0%, 30% 62%, 6% 62%, 50% 100%, 94% 62%, 70% 62%, 70% 0%)', w: 140, h: 280 },
      { id: 'arrow-lr', label: '左右矢印', clip: 'polygon(0 50%, 20% 12%, 20% 32%, 80% 32%, 80% 12%, 100% 50%, 80% 88%, 80% 68%, 20% 68%, 20% 88%)', w: 300, h: 140 },
      { id: 'arrow-ud', label: '上下矢印', clip: 'polygon(50% 0, 88% 20%, 68% 20%, 68% 80%, 88% 80%, 50% 100%, 12% 80%, 32% 80%, 32% 20%, 12% 20%)', w: 140, h: 300 },
      { id: 'arrow-quad', label: '十字矢印', clip: 'polygon(50% 0, 68% 18%, 58% 18%, 58% 42%, 82% 42%, 82% 32%, 100% 50%, 82% 68%, 82% 58%, 58% 58%, 58% 82%, 68% 82%, 50% 100%, 32% 82%, 42% 82%, 42% 58%, 18% 58%, 18% 68%, 0 50%, 18% 32%, 18% 42%, 42% 42%, 42% 18%, 32% 18%)', w: 220, h: 220 },
      { id: 'chevron', label: 'シェブロン', clip: 'polygon(0% 0%, 78% 0%, 100% 50%, 78% 100%, 0% 100%, 22% 50%)', w: 260, h: 120 },
      { id: 'pentagon-arrow', label: 'ホームプレート', clip: 'polygon(0% 0%, 78% 0%, 100% 50%, 78% 100%, 0% 100%)', w: 260, h: 120 },
      { id: 'bent-arrow', label: '曲がり矢印', clip: 'polygon(0 62%, 0 90%, 62% 90%, 62% 100%, 100% 76%, 62% 52%, 62% 62%)', w: 260, h: 180 },
    ],
  },
  {
    group: 'フローチャート',
    shapes: [
      { id: 'fc-process', label: '処理', w: 260, h: 130 },
      { id: 'fc-alt', label: '代替処理', radius: '18px', w: 260, h: 130 },
      { id: 'fc-decision', label: '判断', clip: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', w: 240, h: 170 },
      { id: 'fc-terminator', label: '端子', radius: '9999px', w: 260, h: 110 },
      { id: 'fc-data', label: 'データ', clip: 'polygon(18% 0%, 100% 0%, 82% 100%, 0% 100%)', w: 280, h: 130 },
      { id: 'fc-prep', label: '準備', clip: 'polygon(18% 0, 82% 0, 100% 50%, 82% 100%, 18% 100%, 0 50%)', w: 280, h: 130 },
      { id: 'fc-doc', label: '書類', clip: 'polygon(0 0, 100% 0, 100% 82%, 74% 96%, 50% 84%, 24% 96%, 0 84%)', w: 260, h: 150 },
      { id: 'fc-manual', label: '手操作入力', clip: 'polygon(0 22%, 100% 0, 100% 100%, 0 100%)', w: 260, h: 140 },
      { id: 'fc-db', label: 'データベース', clip: 'polygon(0 12%, 12% 3%, 50% 0, 88% 3%, 100% 12%, 100% 88%, 88% 97%, 50% 100%, 12% 97%, 0 88%)', w: 220, h: 200 },
    ],
  },
  {
    group: '星とリボン',
    shapes: [
      { id: 'star4', label: '4芒星', clip: starPolygon(4, 0.2), w: 200, h: 200 },
      { id: 'star5', label: '5芒星', clip: starPolygon(5, 0.38), w: 220, h: 210 },
      { id: 'star6', label: '6芒星', clip: starPolygon(6, 0.42), w: 220, h: 220 },
      { id: 'star8', label: '8芒星', clip: starPolygon(8, 0.44), w: 220, h: 220 },
      { id: 'star12', label: '12芒星', clip: starPolygon(12, 0.46), w: 220, h: 220 },
      { id: 'burst', label: '爆発', clip: starPolygon(16, 0.5), w: 240, h: 240 },
      { id: 'ribbon', label: 'リボン', clip: 'polygon(0 0, 100% 0, 100% 74%, 88% 62%, 76% 74%, 76% 100%, 50% 84%, 24% 100%, 24% 74%, 12% 62%, 0 74%)', w: 260, h: 180 },
      { id: 'banner', label: '横断幕', clip: 'polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%, 12% 50%)', w: 300, h: 120 },
    ],
  },
  {
    group: '吹き出し',
    shapes: [
      { id: 'callout-rect', label: '四角の吹き出し', clip: 'polygon(0% 0%, 100% 0%, 100% 74%, 32% 74%, 14% 100%, 17% 74%, 0% 74%)', w: 280, h: 200 },
      { id: 'callout-round', label: '角丸の吹き出し', radius: '24px', clip: 'polygon(0% 0%, 100% 0%, 100% 76%, 34% 76%, 16% 100%, 19% 76%, 0% 76%)', w: 280, h: 200 },
      { id: 'callout-right', label: '右向き吹き出し', clip: 'polygon(0 0, 100% 0, 100% 100%, 22% 100%, 22% 76%, 0 76%)', w: 280, h: 190 },
      { id: 'callout-oval', label: '楕円の吹き出し', radius: '50% 50% 50% 50% / 60% 60% 40% 40%', w: 280, h: 190 },
    ],
  },
];

export const ALL_SHAPES: ShapeDef[] = SHAPE_GROUPS.flatMap((g) => g.shapes);

/**
 * ギャラリーで選ばれた図形。キャンバスのドラッグ/クリックで使われる。
 * 描画エンジン(useDrawingMode)とリボンの両方から読むためモジュール変数にしている。
 */
export let pendingShape: ShapeDef = ALL_SHAPES[0];

export function setPendingShape(def: ShapeDef): void {
  pendingShape = def;
}

/** 図形定義からCSSを組み立てる(サイズは呼び出し側で指定) */
export function shapeStyles(def: ShapeDef): Record<string, string> {
  return {
    backgroundColor: 'var(--color-gg-green)',
    ...(def.clip ? { clipPath: def.clip } : {}),
    ...(def.radius ? { borderRadius: def.radius } : {}),
    ...(def.extra ?? {}),
  };
}
