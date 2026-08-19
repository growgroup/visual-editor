/**
 * ビューポート単位のユーティリティ
 *
 * iframe内でvw/vh/vmin/vmaxを使用する際、ブラウザのビューポートではなく
 * iframeの寸法を基準に計算するためのユーティリティ
 */

// ビューポート単位のパターン
const VIEWPORT_UNIT_REGEX = /^(-?\d*\.?\d+)(vw|vh|vmin|vmax)$/;
const VIEWPORT_UNIT_IN_CALC_REGEX = /([\d.]+)(vw|vh|vmin|vmax)/g;

// ビューポート単位を含むプロパティ
const VIEWPORT_SENSITIVE_PROPERTIES = [
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'left', 'right', 'bottom',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'lineHeight', 'letterSpacing',
  'gap', 'rowGap', 'columnGap',
  'borderWidth', 'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
];

/**
 * 値がビューポート単位を含むかチェック
 */
export function hasViewportUnit(value: string): boolean {
  if (!value) return false;
  return VIEWPORT_UNIT_REGEX.test(value) || VIEWPORT_UNIT_IN_CALC_REGEX.test(value);
}

/**
 * ビューポート単位をpxに変換
 */
export function convertViewportToPx(
  value: string,
  iframeWidth: number,
  iframeHeight: number
): string {
  if (!value || !hasViewportUnit(value)) {
    return value;
  }

  const vmin = Math.min(iframeWidth, iframeHeight);
  const vmax = Math.max(iframeWidth, iframeHeight);

  // 単純なビューポート単位 (e.g., "50vw")
  const simpleMatch = value.match(VIEWPORT_UNIT_REGEX);
  if (simpleMatch) {
    const num = parseFloat(simpleMatch[1]);
    const unit = simpleMatch[2];
    let px: number;

    switch (unit) {
      case 'vw':
        px = (num * iframeWidth) / 100;
        break;
      case 'vh':
        px = (num * iframeHeight) / 100;
        break;
      case 'vmin':
        px = (num * vmin) / 100;
        break;
      case 'vmax':
        px = (num * vmax) / 100;
        break;
      default:
        return value;
    }

    return `${Math.round(px * 100) / 100}px`;
  }

  // calc()内のビューポート単位を変換
  return value.replace(VIEWPORT_UNIT_IN_CALC_REGEX, (match, num, unit) => {
    const numVal = parseFloat(num);
    let px: number;

    switch (unit) {
      case 'vw':
        px = (numVal * iframeWidth) / 100;
        break;
      case 'vh':
        px = (numVal * iframeHeight) / 100;
        break;
      case 'vmin':
        px = (numVal * vmin) / 100;
        break;
      case 'vmax':
        px = (numVal * vmax) / 100;
        break;
      default:
        return match;
    }

    return `${Math.round(px * 100) / 100}px`;
  });
}

/**
 * pxをビューポート単位に変換
 */
export function convertPxToViewport(
  pxValue: number,
  unit: 'vw' | 'vh' | 'vmin' | 'vmax',
  iframeWidth: number,
  iframeHeight: number
): number {
  const vmin = Math.min(iframeWidth, iframeHeight);
  const vmax = Math.max(iframeWidth, iframeHeight);

  switch (unit) {
    case 'vw':
      return Math.round((pxValue / iframeWidth) * 100 * 100) / 100;
    case 'vh':
      return Math.round((pxValue / iframeHeight) * 100 * 100) / 100;
    case 'vmin':
      return Math.round((pxValue / vmin) * 100 * 100) / 100;
    case 'vmax':
      return Math.round((pxValue / vmax) * 100 * 100) / 100;
    default:
      return pxValue;
  }
}

/**
 * data-original-* 属性名を生成
 */
export function getOriginalAttrName(cssProperty: string): string {
  // camelCase to kebab-case
  const kebab = cssProperty.replace(/([A-Z])/g, '-$1').toLowerCase();
  return `data-original-${kebab}`;
}

/**
 * 要素にビューポート単位の値を適用
 * - 元の値をdata属性に保存
 * - 変換したpx値をstyleに適用
 */
export function applyViewportValue(
  element: HTMLElement,
  property: string,
  value: string,
  iframeWidth: number,
  iframeHeight: number
): void {
  if (hasViewportUnit(value)) {
    // 元の値を保存
    const attrName = getOriginalAttrName(property);
    element.setAttribute(attrName, value);

    // pxに変換して適用
    const pxValue = convertViewportToPx(value, iframeWidth, iframeHeight);
    element.style.setProperty(
      property.replace(/([A-Z])/g, '-$1').toLowerCase(),
      pxValue
    );
  } else {
    // ビューポート単位でない場合は元の属性を削除
    const attrName = getOriginalAttrName(property);
    element.removeAttribute(attrName);

    // そのまま適用
    element.style.setProperty(
      property.replace(/([A-Z])/g, '-$1').toLowerCase(),
      value
    );
  }
}

/**
 * 要素から元のビューポート単位値を取得
 */
export function getOriginalViewportValue(
  element: HTMLElement,
  property: string
): string | null {
  const attrName = getOriginalAttrName(property);
  return element.getAttribute(attrName);
}

/**
 * HTML保存前に元のビューポート単位値を復元
 */
export function restoreViewportUnitsForSave(doc: Document): void {
  const elements = doc.querySelectorAll('[data-original-width], [data-original-height], [data-original-top], [data-original-left], [data-original-right], [data-original-bottom], [data-original-margin-top], [data-original-margin-right], [data-original-margin-bottom], [data-original-margin-left], [data-original-padding-top], [data-original-padding-right], [data-original-padding-bottom], [data-original-padding-left], [data-original-font-size], [data-original-gap], [data-original-border-width], [data-original-border-radius], [data-original-min-width], [data-original-min-height], [data-original-max-width], [data-original-max-height]');

  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const attrs = Array.from(htmlEl.attributes);

    attrs.forEach((attr) => {
      if (attr.name.startsWith('data-original-')) {
        const cssProperty = attr.name
          .replace('data-original-', '')
          .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

        // 元の値をstyleに復元
        htmlEl.style.setProperty(
          attr.name.replace('data-original-', ''),
          attr.value
        );

        // data属性を削除（保存するHTMLをクリーンに）
        htmlEl.removeAttribute(attr.name);
      }
    });
  });
}

/**
 * 保存用HTMLを生成（ビューポート単位を復元）
 */
export function prepareHtmlForSave(artboard: HTMLElement): string {
  // クローンを作成して元のDOMを変更しない
  const clone = artboard.cloneNode(true) as HTMLElement;

  // data-original-* 属性から元の値を復元
  const elementsWithOriginal = clone.querySelectorAll('*');
  elementsWithOriginal.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const attrs = Array.from(htmlEl.attributes);

    attrs.forEach((attr) => {
      if (attr.name.startsWith('data-original-')) {
        const cssProperty = attr.name.replace('data-original-', '');

        // 元の値をstyleに復元
        htmlEl.style.setProperty(cssProperty, attr.value);

        // data属性を削除
        htmlEl.removeAttribute(attr.name);
      }
    });
  });

  return clone.innerHTML;
}

/**
 * iframe内の全要素のビューポート単位を再計算
 * （iframeサイズ変更時に呼び出す）
 */
export function recalculateViewportUnits(
  doc: Document,
  iframeWidth: number,
  iframeHeight: number
): void {
  const elements = doc.querySelectorAll('*');

  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const attrs = Array.from(htmlEl.attributes);

    attrs.forEach((attr) => {
      if (attr.name.startsWith('data-original-')) {
        const cssProperty = attr.name.replace('data-original-', '');
        const originalValue = attr.value;

        // px値を再計算して適用
        const pxValue = convertViewportToPx(originalValue, iframeWidth, iframeHeight);
        htmlEl.style.setProperty(cssProperty, pxValue);
      }
    });
  });
}

/**
 * スタイルオブジェクトをビューポート対応形式に変換
 */
export function processStylesForViewport(
  styles: Record<string, string>,
  iframeWidth: number,
  iframeHeight: number
): {
  appliedStyles: Record<string, string>;
  originalValues: Record<string, string>;
} {
  const appliedStyles: Record<string, string> = {};
  const originalValues: Record<string, string> = {};

  Object.entries(styles).forEach(([property, value]) => {
    if (hasViewportUnit(value)) {
      // 元の値を保存
      originalValues[property] = value;
      // pxに変換
      appliedStyles[property] = convertViewportToPx(value, iframeWidth, iframeHeight);
    } else {
      appliedStyles[property] = value;
    }
  });

  return { appliedStyles, originalValues };
}
