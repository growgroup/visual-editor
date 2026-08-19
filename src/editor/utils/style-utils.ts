/**
 * スタイル関連のユーティリティ関数
 */

import type { SelectedElementInfo, ImageFillMode } from '../types';
import { getArtboardScale } from './dom-utils';
import { extractValueFromTailwindClass } from './tailwind-utils';

/**
 * RGB/RGBA色をHEXに変換
 */
export function rgbToHex(rgb: string): string {
  if (!rgb || rgb === 'transparent' || rgb === 'none') return '#000000';
  if (rgb.startsWith('#')) return rgb;

  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#000000';
}

/**
 * ボックスシャドウをパース
 */
export function parseBoxShadow(boxShadow: string): {
  hasShadow: boolean;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowSpread: number;
  shadowColor: string;
} {
  if (!boxShadow || boxShadow === 'none') {
    return {
      hasShadow: false,
      shadowX: 0,
      shadowY: 0,
      shadowBlur: 0,
      shadowSpread: 0,
      shadowColor: 'rgba(0,0,0,0.25)',
    };
  }

  let shadowX = 0, shadowY = 0, shadowBlur = 0, shadowSpread = 0;
  let shadowColor = 'rgba(0,0,0,0.25)';

  const match = boxShadow.match(/rgba?\([^)]+\)\s*([-\d.]+)px\s*([-\d.]+)px\s*([-\d.]+)px\s*([-\d.]+)?px?/);
  if (match) {
    shadowX = parseFloat(match[1]) || 0;
    shadowY = parseFloat(match[2]) || 0;
    shadowBlur = parseFloat(match[3]) || 0;
    shadowSpread = parseFloat(match[4]) || 0;
  }

  const colorMatch = boxShadow.match(/rgba?\([^)]+\)/);
  if (colorMatch) {
    shadowColor = colorMatch[0];
  }

  return {
    hasShadow: true,
    shadowX,
    shadowY,
    shadowBlur,
    shadowSpread,
    shadowColor,
  };
}

/**
 * 画像フィルモードをパース
 */
export function parseImageFillMode(
  backgroundSize: string,
  backgroundRepeat: string
): ImageFillMode {
  if (backgroundRepeat === 'repeat') return 'tile';
  if (backgroundSize === 'contain') return 'fit';
  if (backgroundSize === 'cover') return 'crop';
  if (backgroundSize === '100% 100%') return 'fill';
  return 'crop';
}

/**
 * 背景位置のX座標をパース
 */
export function parseBackgroundPositionX(backgroundPosition: string): number {
  if (!backgroundPosition || backgroundPosition === 'center') return 50;
  const parts = backgroundPosition.split(' ');
  const xPart = parts[0];
  if (xPart.endsWith('%')) return parseFloat(xPart) || 50;
  if (xPart === 'left') return 0;
  if (xPart === 'right') return 100;
  if (xPart === 'center') return 50;
  return 50;
}

/**
 * 背景位置のY座標をパース
 */
export function parseBackgroundPositionY(backgroundPosition: string): number {
  if (!backgroundPosition || backgroundPosition === 'center') return 50;
  const parts = backgroundPosition.split(' ');
  const yPart = parts[1] || parts[0];
  if (yPart.endsWith('%')) return parseFloat(yPart) || 50;
  if (yPart === 'top') return 0;
  if (yPart === 'bottom') return 100;
  if (yPart === 'center') return 50;
  return 50;
}

/**
 * 背景スケールをパース
 */
export function parseBackgroundScale(backgroundSize: string): number {
  if (!backgroundSize || backgroundSize === 'cover' || backgroundSize === 'contain') return 100;
  if (backgroundSize === '100% 100%') return 100;
  const match = backgroundSize.match(/(\d+)%/);
  if (match) return parseFloat(match[1]) || 100;
  return 100;
}

/**
 * filterプロパティから各フィルターの値を抽出
 */
export function parseFilter(filter: string): {
  blur: number;
  brightness: number;
  contrast: number;
  grayscale: number;
  saturate: number;
  sepia: number;
  hueRotate: number;
  invert: number;
} {
  const result = {
    blur: 0,
    brightness: 100,
    contrast: 100,
    grayscale: 0,
    saturate: 100,
    sepia: 0,
    hueRotate: 0,
    invert: 0,
  };

  if (!filter || filter === 'none') return result;

  const safeParse = (str: string, defaultValue: number) => {
    const val = parseFloat(str);
    return isNaN(val) ? defaultValue : val;
  };

  // blur(Xpx)
  const blurMatch = filter.match(/blur\((\d+(?:\.\d+)?)px\)/);
  if (blurMatch) result.blur = safeParse(blurMatch[1], 0);

  // brightness(X) or brightness(X%)
  const brightnessMatch = filter.match(/brightness\((\d+(?:\.\d+)?)(%?)\)/);
  if (brightnessMatch) {
    const val = safeParse(brightnessMatch[1], 100);
    result.brightness = brightnessMatch[2] === '%' ? val : val * 100;
  }

  // contrast(X) or contrast(X%)
  const contrastMatch = filter.match(/contrast\((\d+(?:\.\d+)?)(%?)\)/);
  if (contrastMatch) {
    const val = safeParse(contrastMatch[1], 100);
    result.contrast = contrastMatch[2] === '%' ? val : val * 100;
  }

  // grayscale(X) or grayscale(X%)
  const grayscaleMatch = filter.match(/grayscale\((\d+(?:\.\d+)?)(%?)\)/);
  if (grayscaleMatch) {
    const val = safeParse(grayscaleMatch[1], 0);
    result.grayscale = grayscaleMatch[2] === '%' ? val : val * 100;
  }

  // saturate(X) or saturate(X%)
  const saturateMatch = filter.match(/saturate\((\d+(?:\.\d+)?)(%?)\)/);
  if (saturateMatch) {
    const val = safeParse(saturateMatch[1], 100);
    result.saturate = saturateMatch[2] === '%' ? val : val * 100;
  }

  // sepia(X) or sepia(X%)
  const sepiaMatch = filter.match(/sepia\((\d+(?:\.\d+)?)(%?)\)/);
  if (sepiaMatch) {
    const val = safeParse(sepiaMatch[1], 0);
    result.sepia = sepiaMatch[2] === '%' ? val : val * 100;
  }

  // hue-rotate(Xdeg)
  const hueRotateMatch = filter.match(/hue-rotate\((\d+(?:\.\d+)?)deg\)/);
  if (hueRotateMatch) result.hueRotate = safeParse(hueRotateMatch[1], 0);

  // invert(X) or invert(X%)
  const invertMatch = filter.match(/invert\((\d+(?:\.\d+)?)(%?)\)/);
  if (invertMatch) {
    const val = safeParse(invertMatch[1], 0);
    result.invert = invertMatch[2] === '%' ? val : val * 100;
  }

  return result;
}

/**
 * backdrop-filterプロパティからblur値を抽出
 */
export function parseBackdropFilter(backdropFilter: string): {
  blur: number;
} {
  const result = { blur: 0 };
  if (!backdropFilter || backdropFilter === 'none') return result;

  const blurMatch = backdropFilter.match(/blur\((\d+(?:\.\d+)?)px\)/);
  if (blurMatch) result.blur = parseFloat(blurMatch[1]) || 0;

  return result;
}

/**
 * transformプロパティから回転とスケールを抽出
 * ブラウザがmatrix形式で返す場合も対応
 */
export function parseTransform(transform: string): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const result = { rotation: 0, scaleX: 1, scaleY: 1 };
  if (!transform || transform === 'none') return result;

  // scale(X, Y) - まとめて指定（matrixより先にチェック）
  const scaleMatch = transform.match(/scale\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (scaleMatch) {
    result.scaleX = parseFloat(scaleMatch[1]);
    result.scaleY = parseFloat(scaleMatch[2]);
  }

  // rotate(Xdeg)
  const rotateMatch = transform.match(/rotate\(([-\d.]+)deg\)/);
  if (rotateMatch) result.rotation = parseFloat(rotateMatch[1]) || 0;

  // scaleX(X) - 単独
  const scaleXMatch = transform.match(/scaleX\(([-\d.]+)\)/);
  if (scaleXMatch) result.scaleX = parseFloat(scaleXMatch[1]);

  // scaleY(X) - 単独
  const scaleYMatch = transform.match(/scaleY\(([-\d.]+)\)/);
  if (scaleYMatch) result.scaleY = parseFloat(scaleYMatch[1]);

  // 上記でマッチしなかった場合のみmatrix形式をパース
  if (!scaleMatch && !scaleXMatch && !scaleYMatch && !rotateMatch) {
    // matrix(a, b, c, d, tx, ty) 形式をパース
    const matrixMatch = transform.match(/matrix\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)/);
    if (matrixMatch) {
      const a = parseFloat(matrixMatch[1]);
      const b = parseFloat(matrixMatch[2]);
      const c = parseFloat(matrixMatch[3]);
      const d = parseFloat(matrixMatch[4]);
      
      // 反転のみのケース（回転なし）: b === 0 && c === 0
      if (Math.abs(b) < 0.001 && Math.abs(c) < 0.001) {
        result.scaleX = a < 0 ? -1 : 1;
        result.scaleY = d < 0 ? -1 : 1;
        result.rotation = 0;
      } else {
        // 回転がある場合
        const angle = Math.atan2(b, a);
        result.rotation = Math.round(angle * (180 / Math.PI));
        
        // スケールを計算
        const det = a * d - b * c;
        result.scaleX = det < 0 ? -1 : 1;
        result.scaleY = 1;
      }
    }
  }

  return result;
}

/**
 * paddingをパース（個別の値を抽出）
 */
export function parsePadding(style: CSSStyleDeclaration): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

/**
 * transformプロパティ文字列を生成
 * scaleは明示的に1に戻す場合も含めて常に出力
 */
export function buildTransformString(options: {
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}): string {
  const parts: string[] = [];
  const scaleX = options.scaleX ?? 1;
  const scaleY = options.scaleY ?? 1;

  // 回転を先に適用
  if (options.rotation !== undefined && options.rotation !== 0) {
    parts.push(`rotate(${options.rotation}deg)`);
  }

  // スケールを常に適用（1に戻す場合も明示的に）
  // これにより反転の解除が確実に動作する
  parts.push(`scale(${scaleX}, ${scaleY})`);

  return parts.join(' ');
}

/**
 * フィルター値からfilterプロパティ文字列を生成
 */
export function buildFilterString(filters: {
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: number;
  saturate?: number;
  sepia?: number;
  hueRotate?: number;
  invert?: number;
}): string {
  const parts: string[] = [];
  
  if (filters.blur && filters.blur > 0) parts.push(`blur(${filters.blur}px)`);
  if (filters.brightness !== undefined && filters.brightness !== 100) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== undefined && filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.grayscale && filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale}%)`);
  if (filters.saturate !== undefined && filters.saturate !== 100) parts.push(`saturate(${filters.saturate}%)`);
  if (filters.sepia && filters.sepia > 0) parts.push(`sepia(${filters.sepia}%)`);
  if (filters.hueRotate && filters.hueRotate !== 0) parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  if (filters.invert && filters.invert > 0) parts.push(`invert(${filters.invert}%)`);
  
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * 要素から選択要素情報を抽出
 */
export function extractElementInfo(
  element: HTMLElement,
  iframeDoc: Document
): SelectedElementInfo | null {
  const style = iframeDoc.defaultView?.getComputedStyle(element);
  if (!style) return null;

  const rect = element.getBoundingClientRect();
  // ズームスケールを取得（getBoundingClientRect()はスケール適用後の値を返すため）
  const scale = getArtboardScale(iframeDoc);
  const boxShadow = style.boxShadow;
  const shadowInfo = parseBoxShadow(boxShadow);
  
  // フィルターの抽出
  const filterInfo = parseFilter(style.filter);
  const backdropFilterInfo = parseBackdropFilter(style.backdropFilter);
  
  // transformの抽出（インラインスタイルを優先、なければ計算済みスタイル）
  // ブラウザはscale(1,1)をnoneに正規化することがあるため、インラインスタイルを先にチェック
  const inlineTransform = element.style.transform;
  const transformInfo = parseTransform(inlineTransform || style.transform);
  
  // paddingの抽出
  const paddingInfo = parsePadding(style);
  const paddingLinked = paddingInfo.top === paddingInfo.right && 
                        paddingInfo.right === paddingInfo.bottom && 
                        paddingInfo.bottom === paddingInfo.left;
  
  // width/heightがautoかどうかを判定（Tailwindクラスとインラインスタイルをチェック）
  const inlineWidth = element.style.width;
  const inlineHeight = element.style.height;
  const tailwindWidth = extractValueFromTailwindClass(element.className, 'width');
  const tailwindHeight = extractValueFromTailwindClass(element.className, 'height');
  // Tailwindクラスまたはインラインスタイルで明示的に値が設定されていればautoではない
  const widthAuto = !tailwindWidth && (inlineWidth === 'auto' || inlineWidth === '');
  const heightAuto = !tailwindHeight && (inlineHeight === 'auto' || inlineHeight === '');

  // 親要素情報の取得
  let parentDisplay = 'block';
  let parentFlexDirection = 'row';
  if (element.parentElement) {
    const parentStyle = iframeDoc.defaultView?.getComputedStyle(element.parentElement);
    if (parentStyle) {
      parentDisplay = parentStyle.display;
      parentFlexDirection = parentStyle.flexDirection;
    }
  }

  // リンク情報の取得（要素自体または最も近い<a>祖先）
  let linkElement: HTMLAnchorElement | null = null;
  if (element.tagName === 'A') {
    linkElement = element as HTMLAnchorElement;
  } else {
    linkElement = element.closest('a');
  }
  const isLink = linkElement !== null;
  const linkHref = linkElement?.getAttribute('href') || '';
  const linkTarget = linkElement?.getAttribute('target') || '_self';
  const linkTitle = linkElement?.getAttribute('title') || '';

  // CSS変数参照の抽出（インラインスタイルからvar()参照を取得）
  // getComputedStyleは変数を解決してしまうため、element.styleから直接取得する必要がある
  const extractVarReference = (styleValue: string | undefined): string | undefined => {
    if (styleValue && styleValue.includes('var(')) {
      return styleValue;
    }
    return undefined;
  };

  // インラインスタイルの生値を抽出（単位付きの値を保持）
  // getComputedStyleはpxに変換してしまうため、element.styleから直接取得する
  // viewport単位はdata-original-*属性に保存されているため、そちらを優先する
  const extractRawStyleValue = (styleValue: string | undefined, property?: string): string | undefined => {
    // viewport単位が保存されている場合はそちらを優先
    if (property) {
      const kebabProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
      const dataAttr = `data-original-${kebabProperty}`;
      const originalValue = element.getAttribute(dataAttr);
      if (originalValue) {
        return originalValue;
      }
    }

    if (!styleValue || styleValue === '') {
      return undefined;
    }
    // var(), %, em, rem, vw, vh などの特殊な単位を含む場合は生値を返す
    if (styleValue.includes('var(') ||
        styleValue.includes('%') ||
        styleValue.includes('em') ||
        styleValue.includes('rem') ||
        styleValue.includes('vw') ||
        styleValue.includes('vh') ||
        styleValue === 'auto') {
      return styleValue;
    }
    // pxの場合も生値を返す（一貫性のため）
    return styleValue;
  };

  const rawWidth = extractRawStyleValue(element.style.width, 'width');
  const rawHeight = extractRawStyleValue(element.style.height, 'height');
  const rawPaddingTop = extractRawStyleValue(element.style.paddingTop, 'paddingTop');
  const rawPaddingRight = extractRawStyleValue(element.style.paddingRight, 'paddingRight');
  const rawPaddingBottom = extractRawStyleValue(element.style.paddingBottom, 'paddingBottom');
  const rawPaddingLeft = extractRawStyleValue(element.style.paddingLeft, 'paddingLeft');
  const rawMarginTop = extractRawStyleValue(element.style.marginTop, 'marginTop');
  const rawMarginRight = extractRawStyleValue(element.style.marginRight, 'marginRight');
  const rawMarginBottom = extractRawStyleValue(element.style.marginBottom, 'marginBottom');
  const rawMarginLeft = extractRawStyleValue(element.style.marginLeft, 'marginLeft');
  /**
   * Tailwindクラス経由でテーマトークンが当たっている場合も「変数に束縛されている」として扱う。
   * このテンプレートの色はほぼ bg-gg-green / text-ink-70 のようなクラスで塗られており、
   * インラインの var() だけを見るとバインド表示がほとんど機能しない。
   * クラス名 bg-<token> → --color-<token> が実在するときだけ var() として返す
   * (text-[17px] や text-xs のような非トークンは実在チェックで自然に落ちる)。
   */
  const rootStyle = iframeDoc.documentElement
    ? iframeDoc.defaultView?.getComputedStyle(iframeDoc.documentElement)
    : null;
  const themeVarFromClass = (prefix: string): string | undefined => {
    if (!rootStyle) return undefined;
    const classes = typeof element.className === 'string' ? element.className.split(/\s+/) : [];
    for (const cls of classes) {
      if (!cls.startsWith(prefix) || cls.includes(':') || cls.includes('[')) continue;
      const token = cls.slice(prefix.length);
      if (!token) continue;
      const varName = `--color-${token}`;
      if (rootStyle.getPropertyValue(varName).trim()) return `var(${varName})`;
    }
    return undefined;
  };

  const rawBackgroundColor =
    extractVarReference(element.style.backgroundColor) ?? themeVarFromClass('bg-');
  const rawColor = extractVarReference(element.style.color) ?? themeVarFromClass('text-');
  const rawBorderColor =
    extractVarReference(element.style.borderColor) ?? themeVarFromClass('border-');
  // Additional raw values for unit-aware inputs
  const rawBorderRadius = extractRawStyleValue(element.style.borderRadius, 'borderRadius');
  const rawBorderTopLeftRadius = extractRawStyleValue(element.style.borderTopLeftRadius, 'borderTopLeftRadius');
  const rawBorderTopRightRadius = extractRawStyleValue(element.style.borderTopRightRadius, 'borderTopRightRadius');
  const rawBorderBottomLeftRadius = extractRawStyleValue(element.style.borderBottomLeftRadius, 'borderBottomLeftRadius');
  const rawBorderBottomRightRadius = extractRawStyleValue(element.style.borderBottomRightRadius, 'borderBottomRightRadius');
  const rawOpacity = extractVarReference(element.style.opacity);
  const rawFontSize = extractRawStyleValue(element.style.fontSize, 'fontSize');
  const rawLineHeight = extractRawStyleValue(element.style.lineHeight, 'lineHeight');
  const rawLetterSpacing = extractRawStyleValue(element.style.letterSpacing, 'letterSpacing');
  const rawBorderWidth = extractRawStyleValue(element.style.borderWidth, 'borderWidth');
  const rawGap = extractRawStyleValue(element.style.gap, 'gap');
  // Position values (left/top)
  const rawLeft = extractRawStyleValue(element.style.left, 'left');
  const rawTop = extractRawStyleValue(element.style.top, 'top');

  return {
    id: element.getAttribute('data-element-id') || '',
    tagName: element.tagName,
    text: element.textContent?.trim().substring(0, 50) || '',
    fontSize: parseFloat(style.fontSize) || 16,
    fontFamily: style.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textDecoration: style.textDecoration,
    fontStyle: style.fontStyle,
    color: style.color,
    x: parseInt(style.left) || 0,
    y: parseInt(style.top) || 0,
    width: rect.width / scale,
    height: rect.height / scale,
    widthAuto,
    heightAuto,
    rotation: transformInfo.rotation,
    scaleX: transformInfo.scaleX,
    scaleY: transformInfo.scaleY,
    paddingTop: paddingInfo.top,
    paddingRight: paddingInfo.right,
    paddingBottom: paddingInfo.bottom,
    paddingLeft: paddingInfo.left,
    paddingLinked,
    marginTop: parseFloat(style.marginTop) || 0,
    marginRight: parseFloat(style.marginRight) || 0,
    marginBottom: parseFloat(style.marginBottom) || 0,
    marginLeft: parseFloat(style.marginLeft) || 0,
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundPosition: style.backgroundPosition,
    backgroundRepeat: style.backgroundRepeat,
    opacity: parseFloat(style.opacity) || 1,
    hasBackgroundImage: style.backgroundImage !== 'none' && style.backgroundImage !== '',
    imageFillMode: parseImageFillMode(style.backgroundSize, style.backgroundRepeat),
    imagePositionX: parseBackgroundPositionX(style.backgroundPosition),
    imagePositionY: parseBackgroundPositionY(style.backgroundPosition),
    imageScale: parseBackgroundScale(style.backgroundSize),
    borderWidth: parseFloat(style.borderWidth) || 0,
    borderColor: style.borderColor,
    borderStyle: style.borderStyle,
    borderRadius: parseFloat(style.borderRadius) || 0,
    borderRadiusTopLeft: parseFloat(style.borderTopLeftRadius) || 0,
    borderRadiusTopRight: parseFloat(style.borderTopRightRadius) || 0,
    borderRadiusBottomRight: parseFloat(style.borderBottomRightRadius) || 0,
    borderRadiusBottomLeft: parseFloat(style.borderBottomLeftRadius) || 0,
    boxShadow,
    ...shadowInfo,
    // Filter effects
    filter: style.filter,
    mixBlendMode: style.mixBlendMode || 'normal',
    filterBlur: filterInfo.blur,
    filterBrightness: filterInfo.brightness,
    filterContrast: filterInfo.contrast,
    filterGrayscale: filterInfo.grayscale,
    filterSaturate: filterInfo.saturate,
    filterSepia: filterInfo.sepia,
    filterHueRotate: filterInfo.hueRotate,
    filterInvert: filterInfo.invert,
    // Backdrop filter
    backdropFilter: style.backdropFilter,
    backdropBlur: backdropFilterInfo.blur,
    // Overflow
    overflow: style.overflow || 'visible',
    transformOrigin: style.transformOrigin,
    // Auto Layout (Flexbox)
    display: style.display || 'block',
    flexDirection: style.flexDirection || 'row',
    flexWrap: style.flexWrap || 'nowrap',
    justifyContent: style.justifyContent || 'flex-start',
    alignItems: style.alignItems || 'stretch',
    gap: parseFloat(style.gap) || 0,
    // Child flex properties
    flexGrow: parseFloat(style.flexGrow) || 0,
    flexShrink: parseFloat(style.flexShrink) || 1,
    flexBasis: style.flexBasis || 'auto',
    alignSelf: style.alignSelf || 'auto',
    // CSS Grid properties
    gridTemplateColumns: style.gridTemplateColumns || 'none',
    gridTemplateRows: style.gridTemplateRows || 'none',
    gridGap: parseFloat(style.gap) || 0,
    gridRowGap: parseFloat(style.rowGap) || 0,
    gridColumnGap: parseFloat(style.columnGap) || 0,
    gridAutoFlow: style.gridAutoFlow || 'row',
    gridAutoRows: style.gridAutoRows || 'auto',
    gridAutoColumns: style.gridAutoColumns || 'auto',
    justifyItems: style.justifyItems || 'stretch',
    alignContent: style.alignContent || 'stretch',
    // Child grid properties
    gridColumn: style.gridColumn || 'auto',
    gridRow: style.gridRow || 'auto',
    gridColumnStart: parseInt(style.gridColumnStart) || 0,
    gridColumnEnd: parseInt(style.gridColumnEnd) || 0,
    gridRowStart: parseInt(style.gridRowStart) || 0,
    gridRowEnd: parseInt(style.gridRowEnd) || 0,
    justifySelf: style.justifySelf || 'auto',
    // Parent context
    parentDisplay,
    parentFlexDirection,
    // Link properties
    isLink,
    imageSrc: element.tagName === 'IMG' ? (element as HTMLImageElement).getAttribute('src') || '' : undefined,
    linkHref,
    linkTarget,
    linkTitle,
    // CSS Variable references (raw inline style values if they contain var())
    rawWidth,
    rawHeight,
    rawPaddingTop,
    rawPaddingRight,
    rawPaddingBottom,
    rawPaddingLeft,
    rawMarginTop,
    rawMarginRight,
    rawMarginBottom,
    rawMarginLeft,
    rawBackgroundColor,
    rawColor,
    rawBorderColor,
    // Additional raw values
    rawBorderRadius,
    rawBorderTopLeftRadius,
    rawBorderTopRightRadius,
    rawBorderBottomLeftRadius,
    rawBorderBottomRightRadius,
    rawOpacity,
    rawFontSize,
    rawLineHeight,
    rawLetterSpacing,
    rawBorderWidth,
    rawGap,
    rawLeft,
    rawTop,
  };
}

/**
 * フィルモードからbackgroundSizeを生成
 */
export function getBackgroundSizeFromFillMode(fillMode: ImageFillMode): string {
  switch (fillMode) {
    case 'fill': return '100% 100%';
    case 'fit': return 'contain';
    case 'tile': return 'auto';
    case 'crop':
    default: return 'cover';
  }
}

/**
 * フィルモードからbackgroundRepeatを生成
 */
export function getBackgroundRepeatFromFillMode(fillMode: ImageFillMode): string {
  return fillMode === 'tile' ? 'repeat' : 'no-repeat';
}

/**
 * シャドウスタイル文字列を生成
 */
export function buildBoxShadow(
  color: string,
  x: number,
  y: number,
  blur: number,
  spread: number
): string {
  return `${color} ${x}px ${y}px ${blur}px ${spread}px`;
}
