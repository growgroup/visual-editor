/**
 * figma-export.ts
 *
 * Converts HTML elements to Figma clipboard format for pasting into Figma.
 * Uses fig-kiwi's writeHTMLMessage for proper encoding with cached schema.
 */

import { readHTMLMessage, writeHTMLMessage } from 'fig-kiwi';
import type { Schema } from 'kiwi-schema';

/**
 * Cached schema from Figma paste (proper kiwi-schema Schema type)
 */
let cachedFigKiwiSchema: Schema | null = null;

/**
 * Cache the schema from a readHTMLMessage call
 */
export function cacheFigKiwiSchema(schema: Schema): void {
  cachedFigKiwiSchema = schema;
  console.log('[figma-export] Cached fig-kiwi schema with', schema.definitions.length, 'definitions');
}

/**
 * Get the cached fig-kiwi schema
 */
export function getCachedFigKiwiSchema(): Schema | null {
  return cachedFigKiwiSchema;
}

/**
 * GUID generator
 */
let guidCounter = 0;
const sessionID = Math.floor(Math.random() * 1000000000);

interface GUID {
  sessionID: number;
  localID: number;
}

function generateGuid(): GUID {
  return {
    sessionID,
    localID: ++guidCounter,
  };
}

/**
 * Reset GUID counter (call before each export operation)
 */
function resetGuidCounter(): void {
  guidCounter = 0;
}

/**
 * Color type for Figma
 */
interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Convert oklch to RGB
 */
function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const hRad = h * Math.PI / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let bVal = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  bVal = Math.max(0, Math.min(1, bVal));

  return { r, g, b: bVal };
}

/**
 * Parse CSS color to Figma Color (0-1 range)
 */
function parseCssColor(cssColor: string): Color | null {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'none') {
    return null;
  }

  // Handle oklch
  const oklchMatch = cssColor.match(/oklch\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (oklchMatch) {
    const l = parseFloat(oklchMatch[1]);
    const c = parseFloat(oklchMatch[2]);
    const h = parseFloat(oklchMatch[3]);
    const alpha = oklchMatch[4] !== undefined ? parseFloat(oklchMatch[4]) : 1;
    const rgb = oklchToRgb(l, c, h);
    return { ...rgb, a: alpha };
  }

  // Handle rgb/rgba
  const rgbaMatch = cssColor.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]) / 255,
      g: parseInt(rgbaMatch[2]) / 255,
      b: parseInt(rgbaMatch[3]) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Handle hex colors
  const hexMatch = cssColor.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
      };
    } else if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // Named colors
  const namedColors: Record<string, Color> = {
    'white': { r: 1, g: 1, b: 1, a: 1 },
    'black': { r: 0, g: 0, b: 0, a: 1 },
    'red': { r: 1, g: 0, b: 0, a: 1 },
    'green': { r: 0, g: 0.502, b: 0, a: 1 },
    'blue': { r: 0, g: 0, b: 1, a: 1 },
    'gray': { r: 0.502, g: 0.502, b: 0.502, a: 1 },
    'grey': { r: 0.502, g: 0.502, b: 0.502, a: 1 },
  };

  const lowerColor = cssColor.toLowerCase();
  if (namedColors[lowerColor]) {
    return namedColors[lowerColor];
  }

  console.warn('[figma-export] Could not parse color:', cssColor);
  return null;
}

function parseCssNumeric(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

function detectFigmaType(el: HTMLElement): string {
  const tagName = el.tagName.toLowerCase();
  const figmaType = el.getAttribute('data-figma-type');

  if (figmaType) return figmaType;

  if (tagName === 'span' || tagName === 'p' || tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
    return 'TEXT';
  }

  if (el.children.length > 0) return 'FRAME';

  const style = getComputedStyle(el);
  if (style.borderRadius === '50%' || style.borderRadius === '9999px') {
    return 'ELLIPSE';
  }

  return 'RECTANGLE';
}

function getFillPaints(el: HTMLElement): Record<string, unknown>[] | undefined {
  const style = getComputedStyle(el);
  const paints: Record<string, unknown>[] = [];

  const bgColor = style.backgroundColor;
  if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
    const color = parseCssColor(bgColor);
    if (color) {
      paints.push({
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color,
      });
    }
  }

  return paints.length > 0 ? paints : undefined;
}

function getStrokePaints(el: HTMLElement): { paints?: Record<string, unknown>[]; weight?: number } {
  const style = getComputedStyle(el);
  const borderColor = style.borderColor || style.borderTopColor;
  const borderWidth = parseCssNumeric(style.borderWidth || style.borderTopWidth);

  if (borderWidth > 0 && borderColor && borderColor !== 'transparent') {
    const color = parseCssColor(borderColor);
    if (color) {
      return {
        paints: [{
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color,
        }],
        weight: borderWidth,
      };
    }
  }

  return {};
}

function getCornerRadius(el: HTMLElement): Record<string, number> {
  const style = getComputedStyle(el);

  const tl = parseCssNumeric(style.borderTopLeftRadius);
  const tr = parseCssNumeric(style.borderTopRightRadius);
  const br = parseCssNumeric(style.borderBottomRightRadius);
  const bl = parseCssNumeric(style.borderBottomLeftRadius);

  if (tl === tr && tr === br && br === bl) {
    return tl > 0 ? { cornerRadius: tl } : {};
  }

  return {
    rectangleTopLeftCornerRadius: tl,
    rectangleTopRightCornerRadius: tr,
    rectangleBottomRightCornerRadius: br,
    rectangleBottomLeftCornerRadius: bl,
  };
}

function getEffects(el: HTMLElement): Record<string, unknown>[] | undefined {
  const style = getComputedStyle(el);
  const boxShadow = style.boxShadow;

  if (!boxShadow || boxShadow === 'none') return undefined;

  const effects: Record<string, unknown>[] = [];

  const shadowMatch = boxShadow.match(/(rgba?\([^)]+\)|#[0-9a-f]+)\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px/i);
  if (shadowMatch) {
    const color = parseCssColor(shadowMatch[1]);
    if (color) {
      effects.push({
        type: 'DROP_SHADOW',
        visible: true,
        radius: parseCssNumeric(shadowMatch[4]),
        color,
        offset: {
          x: parseCssNumeric(shadowMatch[2]),
          y: parseCssNumeric(shadowMatch[3]),
        },
      });
    }
  }

  return effects.length > 0 ? effects : undefined;
}

function getTextProperties(el: HTMLElement): Record<string, unknown> {
  const style = getComputedStyle(el);
  const text = el.textContent || '';

  if (!text.trim()) return {};

  const fontSize = parseCssNumeric(style.fontSize);
  const fontFamily = style.fontFamily.replace(/["']/g, '').split(',')[0].trim();
  const fontWeight = style.fontWeight;

  let fontStyle = 'Regular';
  if (fontWeight === '700' || fontWeight === 'bold') fontStyle = 'Bold';
  else if (fontWeight === '500' || fontWeight === '600') fontStyle = 'Medium';
  else if (fontWeight === '300') fontStyle = 'Light';

  let textAlignHorizontal: string | undefined;
  switch (style.textAlign) {
    case 'center': textAlignHorizontal = 'CENTER'; break;
    case 'right': textAlignHorizontal = 'RIGHT'; break;
    case 'justify': textAlignHorizontal = 'JUSTIFIED'; break;
    default: textAlignHorizontal = 'LEFT';
  }

  return {
    fontSize,
    fontName: {
      family: fontFamily,
      style: fontStyle,
      postscript: `${fontFamily}-${fontStyle}`,
    },
    textData: { characters: text },
    textAlignHorizontal,
  };
}

function getAutoLayoutProperties(el: HTMLElement): Record<string, unknown> {
  const style = getComputedStyle(el);

  if (style.display !== 'flex') return {};

  const props: Record<string, unknown> = {};

  props.stackMode = style.flexDirection === 'column' || style.flexDirection === 'column-reverse'
    ? 'VERTICAL'
    : 'HORIZONTAL';

  const gap = parseCssNumeric(style.gap);
  if (gap > 0) props.stackSpacing = gap;

  const paddingTop = parseCssNumeric(style.paddingTop);
  const paddingRight = parseCssNumeric(style.paddingRight);
  const paddingBottom = parseCssNumeric(style.paddingBottom);
  const paddingLeft = parseCssNumeric(style.paddingLeft);

  if (paddingTop === paddingRight && paddingRight === paddingBottom && paddingBottom === paddingLeft) {
    if (paddingTop > 0) props.stackPadding = paddingTop;
  } else {
    if (paddingTop > 0 || paddingBottom > 0) props.stackVerticalPadding = paddingTop;
    if (paddingLeft > 0 || paddingRight > 0) props.stackHorizontalPadding = paddingLeft;
  }

  switch (style.justifyContent) {
    case 'center': props.stackJustify = 'CENTER'; break;
    case 'flex-end': props.stackJustify = 'MAX'; break;
    case 'space-between': props.stackJustify = 'SPACE_EVENLY'; break;
    default: props.stackJustify = 'MIN';
  }

  switch (style.alignItems) {
    case 'center': props.stackCounterAlign = 'CENTER'; break;
    case 'flex-end': props.stackCounterAlign = 'MAX'; break;
    case 'stretch': props.stackCounterAlign = 'STRETCH'; break;
    default: props.stackCounterAlign = 'MIN';
  }

  return props;
}

function elementToNodeChange(
  el: HTMLElement,
  parentGuid?: GUID,
  index: number = 0
): Record<string, unknown> {
  const guid = generateGuid();
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  let x = 0;
  let y = 0;

  if (el.parentElement) {
    const parentRect = el.parentElement.getBoundingClientRect();
    x = rect.left - parentRect.left;
    y = rect.top - parentRect.top;
  }

  const type = detectFigmaType(el);

  const nodeChange: Record<string, unknown> = {
    guid,
    phase: 'CREATED',
    type,
    name: el.getAttribute('data-name') || el.getAttribute('data-element-id') || type.toLowerCase(),
    visible: style.display !== 'none' && style.visibility !== 'hidden',
    size: {
      x: rect.width,
      y: rect.height,
    },
    transform: {
      m00: 1,
      m01: 0,
      m02: x,
      m10: 0,
      m11: 1,
      m12: y,
    },
  };

  if (parentGuid) {
    nodeChange.parentIndex = {
      guid: parentGuid,
      position: index.toString(),
    };
  }

  const opacity = parseFloat(style.opacity);
  if (opacity < 1) nodeChange.opacity = opacity;

  const fills = getFillPaints(el);
  if (fills) {
    nodeChange.fillPaints = fills;
  } else if (type === 'FRAME' || type === 'RECTANGLE') {
    nodeChange.fillPaints = [{
      type: 'SOLID',
      visible: true,
      opacity: 1,
      color: { r: 1, g: 1, b: 1, a: 1 },
    }];
  }

  const strokes = getStrokePaints(el);
  if (strokes.paints) {
    nodeChange.strokePaints = strokes.paints;
    nodeChange.strokeWeight = strokes.weight;
  }

  Object.assign(nodeChange, getCornerRadius(el));

  const effects = getEffects(el);
  if (effects) nodeChange.effects = effects;

  if (type === 'TEXT') {
    Object.assign(nodeChange, getTextProperties(el));
    const textColor = parseCssColor(style.color);
    if (textColor) {
      nodeChange.fillPaints = [{
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: textColor,
      }];
    }
  }

  if (type === 'FRAME') {
    Object.assign(nodeChange, getAutoLayoutProperties(el));
  }

  return nodeChange;
}

function elementTreeToNodeChanges(
  el: HTMLElement,
  parentGuid?: GUID,
  index: number = 0
): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];

  const nodeChange = elementToNodeChange(el, parentGuid, index);
  nodes.push(nodeChange);

  const children = Array.from(el.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );

  for (let i = 0; i < children.length; i++) {
    const childNodes = elementTreeToNodeChanges(children[i], nodeChange.guid as GUID, i);
    nodes.push(...childNodes);
  }

  return nodes;
}

/**
 * Export HTML elements to Figma clipboard format
 */
export async function copyElementsToFigma(elements: HTMLElement[]): Promise<{
  success: boolean;
  error?: string;
  nodeCount?: number;
}> {
  try {
    // Check if schema is available
    if (!cachedFigKiwiSchema) {
      return {
        success: false,
        error: 'スキーマがキャッシュされていません。先にFigmaからペーストしてスキーマを取得してください。',
      };
    }

    resetGuidCounter();

    // Convert all elements to NodeChanges
    const allNodes: Record<string, unknown>[] = [];

    for (let i = 0; i < elements.length; i++) {
      const nodes = elementTreeToNodeChanges(elements[i], undefined, i);
      allNodes.push(...nodes);
    }

    console.log('[figma-export] Converted', allNodes.length, 'nodes');
    console.log('[figma-export] First node:', JSON.stringify(allNodes[0], null, 2));

    // Create message using fig-kiwi's expected format
    const message = {
      type: 'NODE_CHANGES',
      sessionID: sessionID,
      pasteID: Math.floor(Math.random() * 1000000000),
      nodeChanges: allNodes,
    };

    // Use fig-kiwi's writeHTMLMessage with the cached schema
    const clipboardHtml = writeHTMLMessage({
      meta: {
        fileKey: 'web-export',
        pasteID: message.pasteID,
        dataType: 'scene',
      },
      schema: cachedFigKiwiSchema,
      message: message as any, // Type assertion needed due to fig-kiwi's strict types
    });

    console.log('[figma-export] Generated clipboard HTML length:', clipboardHtml.length);

    // Copy to clipboard
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([clipboardHtml], { type: 'text/html' }),
        'text/plain': new Blob([clipboardHtml], { type: 'text/plain' }),
      }),
    ]);

    console.log('[figma-export] Copied to clipboard successfully');

    return {
      success: true,
      nodeCount: allNodes.length,
    };
  } catch (error) {
    console.error('[figma-export] Failed to export:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Figma export is available (schema must be cached)
 */
export function isFigmaExportAvailable(): boolean {
  return cachedFigKiwiSchema !== null;
}
