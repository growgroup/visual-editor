/**
 * ペン・鉛筆・蛍光ペンの「インク」設定。
 *
 * PowerPointの描画タブのペンギャラリー相当で、PPT風UIとFigma風UIの
 * 両方から同じ設定を共有する。描画エンジン(useDrawingMode)は
 * ストローク生成時にこのモジュール変数を参照するだけなので、
 * どちらのUIから切り替えても次のストロークから反映される。
 */

export type InkPreset = {
  id: string;
  label: string;
  color: string;
  width: number;
  opacity: number;
  /** round=ペン/鉛筆, butt=蛍光ペン(マーカーの平筆感) */
  cap: 'round' | 'butt';
  /** エンジン側で使うツール(penはベジェ寄り、pencilはフリーハンド) */
  tool: 'pen' | 'pencil';
};

export const PEN_PRESETS: InkPreset[] = [
  { id: 'pen-black', label: 'ペン(黒)', color: '#1a1a1a', width: 3, opacity: 1, cap: 'round', tool: 'pen' },
  { id: 'pen-red', label: 'ペン(赤)', color: '#E03131', width: 3, opacity: 1, cap: 'round', tool: 'pen' },
  { id: 'pen-blue', label: 'ペン(青)', color: '#1971C2', width: 3, opacity: 1, cap: 'round', tool: 'pen' },
  { id: 'pencil-gray', label: '鉛筆', color: '#495057', width: 2, opacity: 0.9, cap: 'round', tool: 'pencil' },
  { id: 'hl-yellow', label: '蛍光ペン(黄)', color: '#FFD43B', width: 18, opacity: 0.45, cap: 'butt', tool: 'pencil' },
  { id: 'hl-green', label: '蛍光ペン(緑)', color: '#69DB7C', width: 18, opacity: 0.45, cap: 'butt', tool: 'pencil' },
];

export const inkStyle: {
  presetId: string;
  color: string;
  width: number;
  opacity: number;
  cap: 'round' | 'butt';
} = {
  presetId: 'pen-black',
  color: '#1a1a1a',
  width: 3,
  opacity: 1,
  cap: 'round',
};

export function setInkPreset(p: InkPreset): void {
  inkStyle.presetId = p.id;
  inkStyle.color = p.color;
  inkStyle.width = p.width;
  inkStyle.opacity = p.opacity;
  inkStyle.cap = p.cap;
}

/** 任意色だけ差し替える(プリセットの太さは維持) */
export function setInkColor(color: string): void {
  inkStyle.presetId = 'custom';
  inkStyle.color = color;
}
