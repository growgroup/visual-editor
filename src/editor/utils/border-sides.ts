/**
 * 片側だけの線(`border-l-2` など)を、右パネル・リボンの「線」の欄で扱う。
 *
 * 欄は 1 本の線幅・スタイル・色しか持たない。以前は computed の `border-width` を
 * parseFloat していたので、左だけ 2px の線は「0px」、スタイルは「none none none solid」と読めず、
 * 線幅を変えると `border-[3px]` で四辺の枠になっていた。
 * 線が見えている辺が 1〜3 辺なら、その辺の値を出し、線幅の変更もその辺だけに当てる。
 */

import { isBorderWidthClass, isZeroBorderWidthClass, type SideLetter } from './tailwind-utils';

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
  /**
   * 線が見えている辺が 1〜3 辺のときだけ、その辺(上・右・下・左の順)。四辺とも・線なしは undefined。
   * 線が見えていなくても、要素自身が 1〜3 辺だけに線幅を指定していればその辺(declaredBorderSides)
   */
  sides?: BorderSide[];
}

/**
 * 線が見えていないとき(片側だけの線を線幅 0 にした・スタイルを「なし」にした)の辺を、要素自身の指定から読む。
 * computed では辺が分からず、次に線幅を入れると四辺の枠になっていた(実エディタで確認)。
 * インラインの辺ごとの線幅(border-left-width)と、辺の太さのクラス(border-l-0 / border-x-2)を見る。
 * 四辺まとめての指定(インラインの border-width・border / border-2 クラス)があれば四辺とみなす
 */
export function declaredBorderSides(element: Element): BorderSide[] | undefined {
  const inline = (element as HTMLElement).style;
  const inlineSides = inline ? BORDER_SIDES.filter((side) => inline.getPropertyValue(`border-${side}-width`) !== '') : [];
  if (inlineSides.length === BORDER_SIDES.length) return undefined;
  if (inline?.getPropertyValue('border-width')) return undefined;
  const classes = (element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  // 四辺まとめての太さ(border / border-2。border-0 は除く)があれば、辺ごとの指定があっても四辺とみなす
  if (classes.some((cls) => isBorderWidthClass(cls, '') && !isZeroBorderWidthClass(cls))) return undefined;
  // 太さ 0 のクラス(border-b-0 など)は「線を消す指定」なので、辺を名乗るものとして数えない。
  // 欄で線幅を 0 にしたときは、同時に書くインラインの辺ごとの線幅(上)で辺が分かる
  const has = (letter: SideLetter) =>
    classes.some((cls) => isBorderWidthClass(cls, letter) && !isZeroBorderWidthClass(cls));
  const classSides: BorderSide[] = [];
  // s / e は書字方向の始め・終わり、bs / be はブロック方向。LTR の横書きを既定として当てる
  if (has('t') || has('y') || has('bs')) classSides.push('top');
  if (has('r') || has('x') || has('e')) classSides.push('right');
  if (has('b') || has('y') || has('be')) classSides.push('bottom');
  if (has('l') || has('x') || has('s')) classSides.push('left');
  // その辺を 0 にするクラス(border-x-2 border-l-0 の左)は、辺から外す
  const zero = (letter: SideLetter) =>
    classes.some((cls) => isBorderWidthClass(cls, letter) && isZeroBorderWidthClass(cls));
  const zeroSides = new Set<BorderSide>();
  if (zero('t') || zero('y') || zero('bs')) zeroSides.add('top');
  if (zero('r') || zero('x') || zero('e')) zeroSides.add('right');
  if (zero('b') || zero('y') || zero('be')) zeroSides.add('bottom');
  if (zero('l') || zero('x') || zero('s')) zeroSides.add('left');
  const sides = BORDER_SIDES.filter(
    (side) => inlineSides.includes(side) || (classSides.includes(side) && !zeroSides.has(side)),
  );
  return sides.length > 0 && sides.length < BORDER_SIDES.length ? sides : undefined;
}

/**
 * computed style(`getPropertyValue` を持つもの)から、「線」の欄に出す値。
 * element を渡すと、線が見えていないときに要素自身の指定から辺を読む(declaredBorderSides)
 */
export function summarizeBorder(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
  element?: Element | null,
): BorderSummary {
  const perSide = BORDER_SIDES.map((side) => ({
    side,
    width: parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0,
    style: style.getPropertyValue(`border-${side}-style`),
    color: style.getPropertyValue(`border-${side}-color`),
  }));
  const shown = perSide.filter((s) => s.width > 0 && s.style !== 'none' && s.style !== 'hidden');
  if (shown.length === 0 || shown.length === BORDER_SIDES.length) {
    // 四辺とも・線なしは今までどおり(省略形の値)
    const sides = shown.length === 0 && element ? declaredBorderSides(element) : undefined;
    return {
      width: parseFloat(style.getPropertyValue('border-width')) || 0,
      style: sides ? style.getPropertyValue(`border-${sides[0]}-style`) : style.getPropertyValue('border-style'),
      color: sides ? style.getPropertyValue(`border-${sides[0]}-color`) : style.getPropertyValue('border-color'),
      ...(sides ? { sides } : {}),
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
