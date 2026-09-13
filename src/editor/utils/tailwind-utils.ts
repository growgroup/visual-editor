/**
 * Tailwind CSS 変換ユーティリティ
 *
 * CSSプロパティ値をTailwindクラスに変換し、要素に適用する
 */

import { twMerge } from 'tailwind-merge';
import { debugLog } from './debug';
import {
  TAILWIND_CONFLICT_GROUPS,
  ENUM_MAPPINGS,
  NUMERIC_PREFIXES,
  COLOR_PREFIXES,
  STYLE_ONLY_PROPERTIES,
  SPECIAL_VALUES,
} from './tailwind-mappings';

/**
 * 要素のクラス名を安全に取得（SVG要素対応）
 * SVG要素のclassNameはSVGAnimatedStringオブジェクトなので、
 * getAttribute('class')を使用して文字列として取得する
 */
function getElementClassName(element: Element): string {
  return element.getAttribute('class') || '';
}

/**
 * 要素のクラス名を安全に設定（SVG要素対応）
 */
function setElementClassName(element: Element, className: string): void {
  if (className) {
    element.setAttribute('class', className);
  } else {
    element.removeAttribute('class');
  }
}

/**
 * 変換結果の型
 */
export interface ConversionResult {
  /** 追加するTailwindクラス（nullの場合はstyle属性を使用） */
  className: string | null;
  /** style属性に適用する値（nullの場合はTailwindクラスを使用） */
  styleValue: string | null;
}

/**
 * CSSプロパティ値をTailwindクラスに変換
 *
 * @param property CSSプロパティ名（camelCase）
 * @param value CSSプロパティ値
 * @returns 変換結果（className または styleValue のいずれか）
 */
export function cssToTailwindClass(
  property: string,
  value: string
): ConversionResult {
  // 空値の場合はスキップ
  if (!value || value === '') {
    return { className: null, styleValue: null };
  }

  // CSS変数参照はstyle属性に直接設定
  if (value.startsWith('var(')) {
    // DEBUG: var() を検出した時のログ
    debugLog('[DEBUG tailwind-utils] cssToTailwindClass detected var():', {
      property,
      value,
      result: { className: null, styleValue: value },
    });
    return { className: null, styleValue: value };
  }

  // style属性のみのプロパティはフォールバック
  if (STYLE_ONLY_PROPERTIES.includes(property)) {
    return { className: null, styleValue: value };
  }

  // 1. 特殊値マッピングをチェック（auto, 100%, 50%など）
  const specialMap = SPECIAL_VALUES[property];
  if (specialMap && specialMap[value]) {
    return { className: specialMap[value], styleValue: null };
  }

  // 2. 列挙型マッピングをチェック
  const enumMap = ENUM_MAPPINGS[property];
  if (enumMap && enumMap[value]) {
    return { className: enumMap[value], styleValue: null };
  }

  // 3. 色プロパティの処理
  const colorPrefix = COLOR_PREFIXES[property];
  if (colorPrefix) {
    return convertColorValue(colorPrefix, value);
  }

  // 4. 数値プレフィックスの処理
  const numericPrefix = NUMERIC_PREFIXES[property];
  if (numericPrefix) {
    return convertNumericValue(numericPrefix, value);
  }

  // 5. 特殊なプロパティの処理
  switch (property) {
    case 'fontFamily':
      return convertFontFamily(value);

    case 'flexGrow':
      return {
        className: value === '1' || value === '1' ? 'grow' : 'grow-0',
        styleValue: null,
      };

    case 'flexShrink':
      return {
        className: value === '1' || value === '1' ? 'shrink' : 'shrink-0',
        styleValue: null,
      };

    case 'gridTemplateColumns':
      return convertGridTemplate('grid-cols', value);

    case 'gridTemplateRows':
      return convertGridTemplate('grid-rows', value);

    default:
      // マッピングなし - style属性にフォールバック
      return { className: null, styleValue: value };
  }
}

/**
 * 色値をTailwindクラスに変換
 */
function convertColorValue(prefix: string, value: string): ConversionResult {
  // transparent
  if (value === 'transparent') {
    return { className: `${prefix}-transparent`, styleValue: null };
  }

  // currentColor
  if (value === 'currentColor' || value === 'currentcolor') {
    return { className: `${prefix}-current`, styleValue: null };
  }

  // inherit
  if (value === 'inherit') {
    return { className: `${prefix}-inherit`, styleValue: null };
  }

  // HEX色はそのまま任意値として使用
  if (value.startsWith('#')) {
    return { className: `${prefix}-[${value}]`, styleValue: null };
  }

  // RGB/RGBA/HSL/HSLA
  if (
    value.startsWith('rgb') ||
    value.startsWith('hsl') ||
    value.startsWith('oklch') ||
    value.startsWith('oklab')
  ) {
    // スペースをアンダースコアに置換してTailwindクラスとして使用
    const sanitized = value.replace(/\s+/g, '_').replace(/,/g, '_');
    return { className: `${prefix}-[${sanitized}]`, styleValue: null };
  }

  // 名前付きカラー（CSS named colors）はstyle属性にフォールバック
  // Tailwindの標準色と一致しない可能性があるため
  return { className: null, styleValue: value };
}

/**
 * 数値値をTailwindクラスに変換
 */
function convertNumericValue(prefix: string, value: string): ConversionResult {
  // 0は特別扱い
  if (value === '0' || value === '0px') {
    return { className: `${prefix}-0`, styleValue: null };
  }

  // 負の値
  const isNegative = value.startsWith('-');
  const absValue = isNegative ? value.slice(1) : value;

  // px値、rem値、%値、vh/vw値などはそのまま任意値として使用
  const classValue = isNegative ? `-${prefix}-[${absValue}]` : `${prefix}-[${value}]`;
  return { className: classValue, styleValue: null };
}

/**
 * font-familyをTailwindクラスに変換
 */
function convertFontFamily(value: string): ConversionResult {
  // クォートを除去し、スペースをアンダースコアに置換
  const sanitized = value
    .replace(/["']/g, '')
    .replace(/,\s*/g, ',')
    .replace(/\s+/g, '_');

  return { className: `font-[${sanitized}]`, styleValue: null };
}

/**
 * grid-template-columns/rowsをTailwindクラスに変換
 */
function convertGridTemplate(
  prefix: string,
  value: string
): ConversionResult {
  // repeat(n, 1fr) パターン
  const repeatMatch = value.match(/^repeat\((\d+),\s*1fr\)$/);
  if (repeatMatch) {
    return { className: `${prefix}-${repeatMatch[1]}`, styleValue: null };
  }

  // none
  if (value === 'none') {
    return { className: `${prefix}-none`, styleValue: null };
  }

  // subgrid
  if (value === 'subgrid') {
    return { className: `${prefix}-subgrid`, styleValue: null };
  }

  // その他は任意値
  const sanitized = value.replace(/\s+/g, '_');
  return { className: `${prefix}-[${sanitized}]`, styleValue: null };
}

/**
 * テキストクラスがフォントサイズクラスかどうかを判定
 * text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-[12px] など
 */
function isTextSizeClass(cls: string): boolean {
  if (!cls.startsWith('text-')) return false;

  // Tailwind標準のフォントサイズクラス
  const sizeKeywords = [
    'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
    'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl',
    'text-7xl', 'text-8xl', 'text-9xl',
  ];
  if (sizeKeywords.includes(cls)) return true;

  // 任意値のサイズクラス: text-[12px], text-[1.5rem], text-[2em] など
  const arbitraryMatch = cls.match(/^text-\[([^\]]+)\]$/);
  if (arbitraryMatch) {
    const value = arbitraryMatch[1];
    // 数値で始まり、単位(px, rem, em, pt, vw, vh, %)で終わるか、純粋な数値
    return /^-?\d/.test(value) && /(?:px|rem|em|pt|vw|vh|%|ch|ex|cap|ic|lh|rlh|vi|vb|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax)?$/.test(value);
  }

  return false;
}

/**
 * テキストクラスがテキストカラークラスかどうかを判定
 * text-red-500, text-[#ff0000], text-inherit, text-transparent など
 */
function isTextColorClass(cls: string): boolean {
  if (!cls.startsWith('text-')) return false;

  // サイズクラスではない text- クラスはカラークラスとみなす
  if (isTextSizeClass(cls)) return false;

  // 明示的なカラーキーワード
  if (cls === 'text-inherit' || cls === 'text-current' || cls === 'text-transparent') return true;

  // 任意値のカラークラス: text-[#ff0000], text-[rgb(...)], text-[hsl(...)] など
  const arbitraryMatch = cls.match(/^text-\[([^\]]+)\]$/);
  if (arbitraryMatch) {
    const value = arbitraryMatch[1];
    // #で始まる(HEX)、rgb/hsl/oklch等で始まる、または var(--) で始まる
    return value.startsWith('#') ||
           value.startsWith('rgb') ||
           value.startsWith('hsl') ||
           value.startsWith('oklch') ||
           value.startsWith('oklab') ||
           value.startsWith('var(');
  }

  // Tailwindの標準カラークラス（text-red-500, text-blue-700など）
  // これらは text-{color}-{shade} のパターンに一致
  const colorMatch = cls.match(/^text-([a-z]+)-(\d+)$/);
  if (colorMatch) return true;

  // text-white, text-black などの単純なカラー名
  const simpleColors = ['text-white', 'text-black', 'text-slate', 'text-gray', 'text-zinc', 'text-neutral', 'text-stone', 'text-red', 'text-orange', 'text-amber', 'text-yellow', 'text-lime', 'text-green', 'text-emerald', 'text-teal', 'text-cyan', 'text-sky', 'text-blue', 'text-indigo', 'text-violet', 'text-purple', 'text-fuchsia', 'text-pink', 'text-rose'];
  if (simpleColors.includes(cls)) return true;

  return false;
}

/**
 * 競合するクラスを要素から削除
 *
 * @param element 対象要素
 * @param property 更新するCSSプロパティ名
 */
export function removeConflictingClasses(
  element: HTMLElement,
  property: string
): void {
  const conflictPrefixes = TAILWIND_CONFLICT_GROUPS[property];

  // fontSize と color は特別処理（twMergeに任せるため空配列だが、
  // 同種のクラスのみ削除する特別なロジックを適用）
  if (property === 'fontSize') {
    const currentClasses = getElementClassName(element).split(/\s+/).filter(Boolean);
    const filteredClasses = currentClasses.filter(cls => !isTextSizeClass(cls));
    setElementClassName(element, filteredClasses.join(' '));
    return;
  }

  if (property === 'color') {
    const currentClasses = getElementClassName(element).split(/\s+/).filter(Boolean);
    const filteredClasses = currentClasses.filter(cls => !isTextColorClass(cls));
    setElementClassName(element, filteredClasses.join(' '));
    return;
  }

  if (!conflictPrefixes || conflictPrefixes.length === 0) return;

  const currentClasses = getElementClassName(element).split(/\s+/).filter(Boolean);
  const filteredClasses = currentClasses.filter((cls) => {
    // 各競合プレフィックスに対してチェック
    return !conflictPrefixes.some((prefix) => {
      // 完全一致（position: static, relativeなど）
      if (cls === prefix) return true;
      // プレフィックス一致（w-, h-, bg-など）
      if (prefix.endsWith('-') && cls.startsWith(prefix)) return true;
      // 負の値のプレフィックス一致（-top-[10px]など）
      if (prefix.endsWith('-') && cls.startsWith(`-${prefix}`)) return true;
      // font-[ で始まるパターン（font-family用）
      if (prefix === 'font-[' && cls.startsWith('font-[')) return true;
      return false;
    });
  });

  setElementClassName(element, filteredClasses.join(' '));
}

/**
 * 指定されたCSSプロパティのstyle属性をクリア
 *
 * @param element 対象要素
 * @param property CSSプロパティ名
 */
export function clearInlineStyle(
  element: HTMLElement,
  property: string
): void {
  // style属性から該当プロパティを削除
  element.style.removeProperty(
    property.replace(/([A-Z])/g, '-$1').toLowerCase()
  );
}

/**
 * 任意値クラス（arbitrary value）かどうかを判定
 * 例: w-[100px], text-[185px], bg-[#ff0000]
 */
function isArbitraryValueClass(className: string): boolean {
  return className.includes('[') && className.includes(']');
}

/**
 * レイアウト関連のプロパティかどうかを判定
 * これらのプロパティは、Tailwind Browserのコンパイル遅延や
 * 既存CSSルールとの競合を避けるため、インラインスタイルも併用する
 */
const LAYOUT_CRITICAL_PROPERTIES = new Set([
  'display',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignContent',
  'gap',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridAutoFlow',
  'justifyItems',
]);

/**
 * Tailwindスタイルを要素に適用
 *
 * 1. 競合するTailwindクラスを削除
 * 2. 新しいTailwindクラスを追加
 * 3. style属性が必要な場合は適用
 * 4. 任意値クラスの場合は、インラインスタイルもフォールバックとして設定
 *    （Tailwind Browser v4のJITコンパイルが遅れる場合の対策）
 *
 * @param element 対象要素
 * @param styles 適用するスタイル（CSSプロパティ名: 値）
 */
/**
 * エディタが選択・ドラッグ等の状態管理に付けるクラス。
 * デザインのクラスではないので、Tailwindの重複解決(twMerge)に混ぜてはいけない。
 */
const EDITOR_MANAGED_CLASSES = new Set([
  'selected',
  'dragging',
  'editing',
  'rotating',
  'panning',
  'hover-preview',
  'marquee-hover',
  'marquee-active',
  'text-editable-hover',
  'drag-ghost',
]);

export function applyTailwindStyles(
  element: HTMLElement,
  styles: Record<string, string>
): void {
  // DEBUG: applyTailwindStyles 開始時のログ
  debugLog('[DEBUG tailwind-utils] applyTailwindStyles called:', {
    elementId: element.id,
    elementTagName: element.tagName,
    inputStyles: styles,
    currentClassName: element.getAttribute('class'),
    currentInlineStyle: element.getAttribute('style'),
  });

  const classesToAdd: string[] = [];
  const stylesToApply: Record<string, string> = {};
  const propertiesToClear: string[] = [];
  // 任意値クラス用のフォールバックスタイル
  const arbitraryFallbackStyles: Record<string, string> = {};

  Object.entries(styles).forEach(([property, value]) => {
    // 競合クラスを削除
    removeConflictingClasses(element, property);

    // 変換
    const { className, styleValue } = cssToTailwindClass(property, value);

    if (className) {
      classesToAdd.push(className);

      // 以下の場合はインラインスタイルもフォールバックとして設定：
      // 1. 任意値クラス（Tailwind Browser v4が動的クラスをコンパイルするまでの間）
      // 2. レイアウト関連プロパティ（既存CSSルールとの競合を避けるため）
      if (isArbitraryValueClass(className) || LAYOUT_CRITICAL_PROPERTIES.has(property)) {
        arbitraryFallbackStyles[property] = value;
      } else {
        // 通常のTailwindクラスの場合のみ、インラインスタイルをクリア
        propertiesToClear.push(property);
      }
    }

    if (styleValue) {
      stylesToApply[property] = styleValue;
    }
  });

  // 既存のstyle属性をクリア（通常のTailwindクラスで管理するプロパティのみ）
  propertiesToClear.forEach((prop) => {
    clearInlineStyle(element, prop);
  });

  // クラスを適用（tailwind-mergeで重複解決）
  if (classesToAdd.length > 0) {
    // エディタが状態管理に付けるクラスは twMerge に見せない。
    // tailwind-merge は `text-editable-hover` を文字色クラス(text-{color})と解釈し、
    // 既存の text-white/85 などを「同グループの古い指定」として削除してしまう
    // (実害: テキストをドラッグしただけで文字色クラスが消えて色が変わった)。
    // 退避してからマージし、最後に付け直す。
    const parts = getElementClassName(element).split(/\s+/).filter(Boolean);
    const editorClasses = parts.filter((c) => EDITOR_MANAGED_CLASSES.has(c));
    const designClasses = parts.filter((c) => !EDITOR_MANAGED_CLASSES.has(c));
    const merged = twMerge(designClasses.join(' '), ...classesToAdd);
    setElementClassName(element, [merged, ...editorClasses].join(' ').trim());
  }

  // style属性を適用（STYLE_ONLY_PROPERTIESからの値）
  Object.entries(stylesToApply).forEach(([prop, val]) => {
    (element.style as any)[prop] = val;
  });

  // 任意値クラス用のフォールバックスタイルを適用
  // これにより、Tailwind Browserがコンパイルする前でもスタイルが表示される
  Object.entries(arbitraryFallbackStyles).forEach(([prop, val]) => {
    (element.style as any)[prop] = val;
  });

  // DEBUG: applyTailwindStyles 最終適用結果のログ
  debugLog('[DEBUG tailwind-utils] applyTailwindStyles completed:', {
    elementId: element.id,
    classesToAdd,
    stylesToApply,
    arbitraryFallbackStyles,
    propertiesToClear,
    finalClassName: element.getAttribute('class'),
    finalInlineStyle: element.getAttribute('style'),
  });

  // Tailwind Browserに再コンパイルをリクエスト（利用可能な場合）
  triggerTailwindRecompile(element);
}

/**
 * Tailwind Browserに再コンパイルをトリガー
 * iframe内のTailwind Browserインスタンスに変更を通知
 */
function triggerTailwindRecompile(element: HTMLElement): void {
  try {
    const doc = element.ownerDocument;
    const win = doc?.defaultView as Window & {
      tailwindcss?: { refresh?: () => void };
      __twind?: { observe?: (el: Element) => void };
    };

    if (win?.tailwindcss?.refresh) {
      // Tailwind CSS Browser v4の場合
      win.tailwindcss.refresh();
    } else if (win?.__twind?.observe) {
      // Twindの場合（互換性のため）
      win.__twind.observe(element);
    }
  } catch (e) {
    // 再コンパイルに失敗しても、フォールバックスタイルが適用されているので問題なし
  }
}

/**
 * Tailwindクラスから値を抽出（PropertyPanel用）
 *
 * @param className 要素のclassName
 * @param property CSSプロパティ名
 * @returns 抽出された値（見つからない場合はnull）
 */
export function extractValueFromTailwindClass(
  className: unknown,
  property: string
): string | null {
  if (!className) return null;

  // classNameの型に応じて文字列を取得
  // - string: そのまま使用
  // - SVGAnimatedString: baseValプロパティ
  // - DOMTokenList: valueプロパティ
  // - その他: String()で変換
  let classNameStr: string;
  if (typeof className === 'string') {
    classNameStr = className;
  } else if (typeof className === 'object' && className !== null) {
    // SVGAnimatedString (baseVal) または DOMTokenList (value) をチェック
    const obj = className as { baseVal?: string; value?: string };
    classNameStr = obj.baseVal ?? obj.value ?? String(className);
  } else {
    classNameStr = String(className);
  }

  if (!classNameStr || classNameStr === '[object Object]') return null;

  const classes = classNameStr.split(/\s+/);

  // 1. 特殊値マッピングから逆引き
  const specialMap = SPECIAL_VALUES[property];
  if (specialMap) {
    for (const [value, tailwindClass] of Object.entries(specialMap)) {
      if (classes.includes(tailwindClass)) {
        return value;
      }
    }
  }

  // 2. 列挙型マッピングから逆引き
  const enumMap = ENUM_MAPPINGS[property];
  if (enumMap) {
    for (const [value, tailwindClass] of Object.entries(enumMap)) {
      if (classes.includes(tailwindClass)) {
        return value;
      }
    }
  }

  // 3. 色プレフィックスの場合
  const colorPrefix = COLOR_PREFIXES[property];
  if (colorPrefix) {
    const colorClass = classes.find((cls) => {
      return (
        cls.startsWith(`${colorPrefix}-[`) ||
        cls === `${colorPrefix}-transparent` ||
        cls === `${colorPrefix}-current` ||
        cls === `${colorPrefix}-inherit`
      );
    });

    if (colorClass) {
      if (colorClass === `${colorPrefix}-transparent`) return 'transparent';
      if (colorClass === `${colorPrefix}-current`) return 'currentColor';
      if (colorClass === `${colorPrefix}-inherit`) return 'inherit';

      // 任意値から抽出
      const match = colorClass.match(/\[([^\]]+)\]/);
      if (match) {
        // アンダースコアをスペースに戻す
        return match[1].replace(/_/g, ' ');
      }
    }
    return null;
  }

  // 4. 数値プレフィックスの場合
  const numericPrefix = NUMERIC_PREFIXES[property];
  if (numericPrefix) {
    // 負の値も含めて検索
    const numericClass = classes.find((cls) => {
      return (
        cls.startsWith(`${numericPrefix}-`) ||
        cls.startsWith(`-${numericPrefix}-`)
      );
    });

    if (numericClass) {
      // 特殊値（auto, full, 1/2など）のチェック
      if (numericClass.endsWith('-auto')) return 'auto';
      if (numericClass.endsWith('-full')) return '100%';
      if (numericClass.includes('-1/2')) return '50%';
      if (numericClass.includes('-1/3')) return '33.333333%';
      if (numericClass.includes('-2/3')) return '66.666667%';
      if (numericClass.includes('-1/4')) return '25%';
      if (numericClass.includes('-3/4')) return '75%';
      if (numericClass.endsWith('-fit')) return 'fit-content';
      if (numericClass.endsWith('-min')) return 'min-content';
      if (numericClass.endsWith('-max')) return 'max-content';
      if (numericClass.endsWith('-screen')) {
        if (property === 'width') return '100vw';
        if (property === 'height') return '100vh';
      }
      if (numericClass.endsWith('-dvh')) return '100dvh';

      // 0
      if (numericClass === `${numericPrefix}-0`) return '0';

      // 任意値から抽出
      const match = numericClass.match(/\[([^\]]+)\]/);
      if (match) {
        // 負の値の場合はマイナス記号を付ける
        const isNegative = numericClass.startsWith('-');
        return isNegative ? `-${match[1]}` : match[1];
      }
    }
    return null;
  }

  // 5. 特殊なプロパティ
  switch (property) {
    case 'fontFamily': {
      const fontClass = classes.find((cls) => cls.startsWith('font-['));
      if (fontClass) {
        const match = fontClass.match(/font-\[([^\]]+)\]/);
        if (match) {
          // アンダースコアをスペースに戻す
          return match[1].replace(/_/g, ' ');
        }
      }
      return null;
    }

    case 'flexGrow': {
      if (classes.includes('grow')) return '1';
      if (classes.includes('grow-0')) return '0';
      return null;
    }

    case 'flexShrink': {
      if (classes.includes('shrink')) return '1';
      if (classes.includes('shrink-0')) return '0';
      return null;
    }

    case 'gridTemplateColumns': {
      const colClass = classes.find((cls) => cls.startsWith('grid-cols-'));
      if (colClass) {
        if (colClass === 'grid-cols-none') return 'none';
        if (colClass === 'grid-cols-subgrid') return 'subgrid';
        const match = colClass.match(/grid-cols-(\d+)/);
        if (match) return `repeat(${match[1]}, 1fr)`;
        const arbitraryMatch = colClass.match(/grid-cols-\[([^\]]+)\]/);
        if (arbitraryMatch) return arbitraryMatch[1].replace(/_/g, ' ');
      }
      return null;
    }

    case 'gridTemplateRows': {
      const rowClass = classes.find((cls) => cls.startsWith('grid-rows-'));
      if (rowClass) {
        if (rowClass === 'grid-rows-none') return 'none';
        if (rowClass === 'grid-rows-subgrid') return 'subgrid';
        const match = rowClass.match(/grid-rows-(\d+)/);
        if (match) return `repeat(${match[1]}, 1fr)`;
        const arbitraryMatch = rowClass.match(/grid-rows-\[([^\]]+)\]/);
        if (arbitraryMatch) return arbitraryMatch[1].replace(/_/g, ' ');
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * 要素のインラインスタイルをTailwindクラスに変換
 *
 * ドラッグやリサイズ中はパフォーマンスのためインラインスタイルを使用し、
 * 操作終了時にこの関数を呼び出してTailwindクラスに変換する
 *
 * @param element 対象要素
 * @param properties 変換するCSSプロパティ名の配列（指定しない場合は主要プロパティ全て）
 */
export function convertInlineStylesToTailwind(
  element: HTMLElement,
  properties?: string[]
): void {
  // 変換対象のプロパティ（デフォルト）
  const targetProperties = properties || [
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'top',
    'right',
    'bottom',
    'left',
    'padding',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'margin',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'gap',
    'borderRadius',
    'borderWidth',
  ];

  const stylesToConvert: Record<string, string> = {};

  // インラインスタイルから値を抽出
  targetProperties.forEach((prop) => {
    // camelCaseからkebab-caseに変換
    const kebabProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    const value = element.style.getPropertyValue(kebabProp);

    if (value && value !== '') {
      stylesToConvert[prop] = value;
    }
  });

  // Tailwindクラスに変換して適用
  if (Object.keys(stylesToConvert).length > 0) {
    applyTailwindStyles(element, stylesToConvert);
  }
}

/**
 * 要素のスタイル情報を取得（Tailwindクラス + computedStyle）
 *
 * @param element 対象要素
 * @param property CSSプロパティ名
 * @returns スタイル値（Tailwindクラスから抽出を優先、なければcomputedStyle）
 */
export function getElementStyleValue(
  element: HTMLElement,
  property: string
): string {
  // 1. Tailwindクラスから抽出を試みる
  const tailwindValue = extractValueFromTailwindClass(
    getElementClassName(element),
    property
  );
  if (tailwindValue !== null) {
    return tailwindValue;
  }

  // 2. inline styleから取得
   
  const inlineValue = (element.style as any)[property];
  if (inlineValue) {
    return inlineValue;
  }

  // 3. computedStyleから取得
  const computed = window.getComputedStyle(element);
  return computed.getPropertyValue(
    property.replace(/([A-Z])/g, '-$1').toLowerCase()
  );
}
