/**
 * 片側だけの線(`border-l-2` など)を、右パネル・リボンの「線」の欄で扱う。
 *
 * 欄は 1 本の線幅・スタイル・色しか持たない。以前は computed の `border-width` を
 * parseFloat していたので、左だけ 2px の線は「0px」、スタイルは「none none none solid」と読めず、
 * 線幅を変えると `border-[3px]` で四辺の枠になっていた。
 * 線が見えている辺が 1〜3 辺なら、その辺の値を出し、線幅の変更もその辺だけに当てる。
 */

export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

export const BORDER_SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left'];

const SIDE_WIDTH_PROPERTY: Record<BorderSide, string> = {
  top: 'borderTopWidth',
  right: 'borderRightWidth',
  bottom: 'borderBottomWidth',
  left: 'borderLeftWidth',
};

export interface BorderSummary {
  width: number;
  style: string;
  color: string;
  /** 線が見えている辺が 1〜3 辺のときだけ、その辺(上・右・下・左の順)。四辺とも・線なしは undefined */
  sides?: BorderSide[];
}

/** computed style(`getPropertyValue` を持つもの)から、「線」の欄に出す値 */
export function summarizeBorder(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): BorderSummary {
  const perSide = BORDER_SIDES.map((side) => ({
    side,
    width: parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0,
    style: style.getPropertyValue(`border-${side}-style`),
    color: style.getPropertyValue(`border-${side}-color`),
  }));
  const shown = perSide.filter((s) => s.width > 0 && s.style !== 'none' && s.style !== 'hidden');
  if (shown.length === 0 || shown.length === BORDER_SIDES.length) {
    // 四辺とも・線なしは今までどおり(省略形の値)
    return {
      width: parseFloat(style.getPropertyValue('border-width')) || 0,
      style: style.getPropertyValue('border-style'),
      color: style.getPropertyValue('border-color'),
    };
  }
  const first = shown[0];
  return { width: first.width, style: first.style, color: first.color, sides: shown.map((s) => s.side) };
}

/** 線幅の変更。片側だけの線なら、その辺の線幅(borderLeftWidth など)にする */
export function borderWidthStyles(value: string, sides?: readonly BorderSide[]): Record<string, string> {
  if (!sides || sides.length === 0 || sides.length === BORDER_SIDES.length) return { borderWidth: value };
  const out: Record<string, string> = {};
  for (const side of sides) out[SIDE_WIDTH_PROPERTY[side]] = value;
  return out;
}

/** その辺の線幅の CSS プロパティ名(kebab)。インラインの生値を読むときに使う */
export function borderSideWidthCss(side: BorderSide): string {
  return `border-${side}-width`;
}
