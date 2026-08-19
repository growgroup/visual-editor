/**
 * CSS単位関連のユーティリティ関数
 */

// サポートする単位の定義
export const CSS_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh'] as const;
export type CSSUnit = (typeof CSS_UNITS)[number];

// サイズ用単位（auto含む）
export const SIZE_UNITS = ['px', '%', 'vw', 'vh', 'auto'] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

// フォントサイズ用単位
export const FONT_SIZE_UNITS = ['px', 'em', 'rem', '%'] as const;
export type FontSizeUnit = (typeof FONT_SIZE_UNITS)[number];

// スペーシング用単位（gap, padding, margin）
export const SPACING_UNITS = ['px', 'em', 'rem', '%'] as const;
export type SpacingUnit = (typeof SPACING_UNITS)[number];

// Border Radius用単位
export const BORDER_RADIUS_UNITS = ['px', '%', 'em'] as const;
export type BorderRadiusUnit = (typeof BORDER_RADIUS_UNITS)[number];

// Line Height用単位 (空文字は unitless を表す)
export const LINE_HEIGHT_UNITS = ['', 'em', 'px', '%'] as const;
export type LineHeightUnit = (typeof LINE_HEIGHT_UNITS)[number];

// Letter Spacing用単位
export const LETTER_SPACING_UNITS = ['em', 'px'] as const;
export type LetterSpacingUnit = (typeof LETTER_SPACING_UNITS)[number];

// Border Width用単位
export const BORDER_WIDTH_UNITS = ['px', 'em'] as const;
export type BorderWidthUnit = (typeof BORDER_WIDTH_UNITS)[number];

// Position用単位 (left, top, right, bottom)
export const POSITION_UNITS = ['px', '%', 'vw', 'vh'] as const;
export type PositionUnit = (typeof POSITION_UNITS)[number];

// 値と単位のパース結果
export interface ParsedValue {
  numericValue: number;
  unit: string;
  isSpecial: boolean; // auto, inherit, var(...) などの特殊値
  originalValue: string;
}

/**
 * CSS値を数値と単位にパースする
 * @param value CSS値文字列 (例: "16px", "1.5em", "100%", "auto", "var(--spacing)")
 * @param defaultUnit デフォルト単位 (パース失敗時に使用)
 * @returns パース結果
 */
export function parseValueWithUnit(
  value: string | number | undefined,
  defaultUnit: string = 'px'
): ParsedValue {
  // undefined または空の場合
  if (value === undefined || value === '') {
    return {
      numericValue: 0,
      unit: defaultUnit,
      isSpecial: false,
      originalValue: '',
    };
  }

  // 数値の場合
  if (typeof value === 'number') {
    return {
      numericValue: value,
      unit: defaultUnit,
      isSpecial: false,
      originalValue: `${value}${defaultUnit}`,
    };
  }

  const trimmedValue = value.trim();

  // 特殊値のチェック (auto, inherit, initial, unset, var(...))
  if (
    trimmedValue === 'auto' ||
    trimmedValue === 'inherit' ||
    trimmedValue === 'initial' ||
    trimmedValue === 'unset' ||
    trimmedValue.startsWith('var(')
  ) {
    return {
      numericValue: 0,
      unit: defaultUnit,
      isSpecial: true,
      originalValue: trimmedValue,
    };
  }

  // 数値+単位のパターンをマッチ
  const match = trimmedValue.match(/^(-?\d*\.?\d+)(px|%|em|rem|vw|vh)?$/);
  if (match) {
    return {
      numericValue: parseFloat(match[1]),
      unit: match[2] || defaultUnit,
      isSpecial: false,
      originalValue: trimmedValue,
    };
  }

  // パース失敗時はデフォルト値を返す
  return {
    numericValue: 0,
    unit: defaultUnit,
    isSpecial: false,
    originalValue: trimmedValue,
  };
}

/**
 * 数値と単位を結合してCSS値を生成
 * @param numericValue 数値
 * @param unit 単位
 * @returns CSS値文字列
 */
export function formatValueWithUnit(numericValue: number, unit: string): string {
  // autoの場合は単位なし
  if (unit === 'auto') {
    return 'auto';
  }
  return `${numericValue}${unit}`;
}

/**
 * px値をパースして数値を返す（後方互換性用）
 * @param value CSS値文字列
 * @returns 数値
 */
export function parsePxValue(value: string | number | undefined): number {
  const parsed = parseValueWithUnit(value, 'px');
  return parsed.numericValue;
}

/**
 * 単位変換のコンテキスト情報
 */
export interface UnitConversionContext {
  /** ビューポート幅 (px) */
  viewportWidth?: number;
  /** ビューポート高さ (px) */
  viewportHeight?: number;
  /** 親要素の幅 (px) */
  parentWidth?: number;
  /** 親要素の高さ (px) */
  parentHeight?: number;
  /** 要素のフォントサイズ (px) */
  fontSize?: number;
  /** ルートフォントサイズ (px) - 通常は16 */
  rootFontSize?: number;
  /** 変換対象のプロパティ (width/height/other) */
  property?: 'width' | 'height' | 'other';
}

/**
 * 値を一度pxに変換する
 */
function toPx(
  value: number,
  fromUnit: string,
  context: UnitConversionContext
): number {
  const {
    viewportWidth = 1920,
    viewportHeight = 1080,
    parentWidth = 1920,
    parentHeight = 1080,
    fontSize = 16,
    rootFontSize = 16,
    property = 'width',
  } = context;

  switch (fromUnit) {
    case 'px':
    case '': // unitless
      return value;
    case 'vw':
      return (value * viewportWidth) / 100;
    case 'vh':
      return (value * viewportHeight) / 100;
    case '%':
      return property === 'height'
        ? (value * parentHeight) / 100
        : (value * parentWidth) / 100;
    case 'em':
      return value * fontSize;
    case 'rem':
      return value * rootFontSize;
    default:
      return value;
  }
}

/**
 * pxから目的の単位に変換する
 */
function fromPx(
  pxValue: number,
  toUnit: string,
  context: UnitConversionContext
): number {
  const {
    viewportWidth = 1920,
    viewportHeight = 1080,
    parentWidth = 1920,
    parentHeight = 1080,
    fontSize = 16,
    rootFontSize = 16,
    property = 'width',
  } = context;

  switch (toUnit) {
    case 'px':
      return Math.round(pxValue * 100) / 100;
    case '': // unitless (line-height等)
      return Math.round((pxValue / fontSize) * 100) / 100;
    case 'vw':
      return Math.round((pxValue / viewportWidth) * 100 * 100) / 100;
    case 'vh':
      return Math.round((pxValue / viewportHeight) * 100 * 100) / 100;
    case '%':
      const parentDim = property === 'height' ? parentHeight : parentWidth;
      return Math.round((pxValue / parentDim) * 100 * 100) / 100;
    case 'em':
      return Math.round((pxValue / fontSize) * 100) / 100;
    case 'rem':
      return Math.round((pxValue / rootFontSize) * 100) / 100;
    default:
      return pxValue;
  }
}

/**
 * 単位を変換する際の値調整
 * @param value 現在の数値
 * @param fromUnit 変換元の単位
 * @param toUnit 変換先の単位
 * @param context 変換コンテキスト（ビューポートサイズ、親要素サイズ等）
 * @returns 変換後の数値
 */
export function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
  context: UnitConversionContext = {}
): number {
  // 同じ単位なら変換不要
  if (fromUnit === toUnit) {
    return value;
  }

  // 一度pxに変換してから目的の単位に変換
  const pxValue = toPx(value, fromUnit, context);
  return fromPx(pxValue, toUnit, context);
}
