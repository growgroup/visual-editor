/**
 * figma-paste.ts
 *
 * Utilities for parsing and converting Figma clipboard data.
 * Uses fig-kiwi to decode Figma's binary kiwi format.
 */

import { readHTMLMessage } from 'fig-kiwi';
import { generateElementId } from './dom-utils';
import { parseFigmaClipboardToJson, extractNodes, type FigmaNode } from './figma-kiwi-decoder';
import { cacheFigKiwiSchema } from './figma-export';
import { debugLog } from './debug';

// Type definitions for Figma data structures
// Based on fig-kiwi schema-defs

interface GUID {
  sessionID: number;
  localID: number;
}

interface Vector {
  x: number;
  y: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Matrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

interface Paint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  // Image fill properties
  imageHash?: string;
  scaleMode?: string;  // 'FILL' | 'FIT' | 'CROP' | 'TILE'
  imageTransform?: Matrix;
  scalingFactor?: number;
  rotation?: number;
  filterColorAdjust?: {
    contrast?: number;
    exposure?: number;
    highlights?: number;
    saturation?: number;
    shadows?: number;
    temperature?: number;
    tint?: number;
  };
}

interface Effect {
  type?: string;
  visible?: boolean;
  radius?: number;
  color?: Color;
  offset?: Vector;
}

interface FontName {
  family: string;
  style: string;
  postscript: string;
}

interface TextData {
  characters?: string;
}

interface ParentIndex {
  guid?: GUID;
  position?: string;
}

interface UnitValue {
  value: number;
  units: string; // 'PIXELS' | 'PERCENT' | 'AUTO'
}

interface NodeChange {
  guid?: GUID;
  parentIndex?: ParentIndex;
  type?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  size?: Vector;
  transform?: Matrix;

  // Fill & Stroke
  fillPaints?: Paint[];
  strokePaints?: Paint[];
  strokeWeight?: number;
  strokeAlign?: string;         // 'INSIDE' | 'CENTER' | 'OUTSIDE'
  strokeCap?: string;           // 'NONE' | 'ROUND' | 'SQUARE'
  strokeJoin?: string;          // 'MITER' | 'BEVEL' | 'ROUND'
  dashPattern?: number[];

  // Individual border weights
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderStrokeWeightsIndependent?: boolean;

  // Corner radius
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;

  // Effects
  effects?: Effect[];

  // Text properties
  fontSize?: number;
  fontName?: FontName;
  textData?: TextData;
  textAlignHorizontal?: string; // 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: string;   // 'TOP' | 'CENTER' | 'BOTTOM'
  lineHeight?: UnitValue;
  letterSpacing?: UnitValue;
  textCase?: string;            // 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'
  textDecoration?: string;      // 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
  paragraphIndent?: number;
  paragraphSpacing?: number;
  textTruncation?: string;      // 'DISABLED' | 'ENDING'
  maxLines?: number;

  // Auto-layout properties
  stackMode?: string;           // 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  stackSpacing?: number;        // gap between items
  stackPadding?: number;        // uniform padding
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string;   // 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  stackCounterAlignItems?: string;   // 'MIN' | 'CENTER' | 'MAX' | 'BASELINE'
  stackPrimarySizing?: string;       // 'FIXED' | 'HUG' | 'FILL'
  stackCounterSizing?: string;       // 'FIXED' | 'HUG' | 'FILL'
  stackChildPrimaryGrow?: number;    // flex-grow
  stackChildAlignSelf?: string;      // 'AUTO' | 'STRETCH' | 'INHERIT'
  stackPositioning?: string;         // 'AUTO' | 'ABSOLUTE'
  stackReverseZIndex?: boolean;
  stackWrap?: string;                // 'NO_WRAP' | 'WRAP'

  // Constraints
  horizontalConstraint?: string;
  verticalConstraint?: string;

  // Clipping
  clipsContent?: boolean;
  frameMaskDisabled?: boolean;

  // Other
  count?: number;
}

interface Message {
  type?: string;
  nodeChanges?: NodeChange[];
}

/**
 * Figma clipboard metadata
 */
export interface FigmaClipboardMeta {
  fileKey: string;
  pasteID: number;
  dataType: string;
}

/**
 * Result of parsing Figma clipboard data
 */
export interface FigmaPasteResult {
  success: boolean;
  meta?: FigmaClipboardMeta;
  nodes?: NodeChange[];
  svg?: string;
  error?: string;
}

/**
 * Check if HTML content is from Figma clipboard
 */
export function isFigmaContent(html: string): boolean {
  return (
    html.includes('data-metadata="') &&
    html.includes('(figmeta)') &&
    html.includes('data-buffer="') &&
    html.includes('(figma)')
  );
}

/**
 * Extract Figma metadata from clipboard HTML
 */
export function extractFigmaMeta(html: string): FigmaClipboardMeta | null {
  try {
    // Extract base64 encoded metadata
    const metaMatch = html.match(/\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)/);
    if (!metaMatch) return null;

    const metaJson = atob(metaMatch[1]);
    return JSON.parse(metaJson) as FigmaClipboardMeta;
  } catch (e) {
    console.error('[figma-paste] Failed to extract metadata:', e);
    return null;
  }
}

/**
 * Parse Figma clipboard HTML and extract scene data
 *
 * Strategy:
 * 1. Try fig-kiwi first (faster, but may fail with newer Figma versions)
 * 2. Fall back to custom decoder that handles extended types
 */
export function parseFigmaClipboard(html: string): FigmaPasteResult {
  try {
    if (!isFigmaContent(html)) {
      return { success: false, error: 'Not Figma content' };
    }

    const meta = extractFigmaMeta(html);
    if (!meta) {
      return { success: false, error: 'Failed to extract metadata' };
    }

    // Try fig-kiwi first
    let parsed;
    let useCustomDecoder = false;

    try {
      parsed = readHTMLMessage(html);
      // Cache the schema for later use in export
      if (parsed?.schema) {
        cacheFigKiwiSchema(parsed.schema);
        debugLog('[figma-paste] Cached fig-kiwi schema for export');
      }
    } catch (decodeError) {
      console.warn('[figma-paste] fig-kiwi decode failed, trying custom decoder:', decodeError);
      useCustomDecoder = true;
    }

    let nodeChanges: NodeChange[] = [];

    if (useCustomDecoder) {
      // Use custom decoder with extended type support
      try {
        const customResult = parseFigmaClipboardToJson(html);
        debugLog('[figma-paste] Custom decoder result:', customResult.message);
        debugLog('[figma-paste] Schema has', customResult.schema.definitions.length, 'definitions');

        // Extract nodes from custom decoder result
        const customNodes = extractNodes(customResult.message);
        debugLog('[figma-paste] Extracted', customNodes.length, 'nodes from custom decoder');

        // Convert FigmaNode to NodeChange format
        nodeChanges = convertFigmaNodes(customNodes);
      } catch (customError) {
        console.error('[figma-paste] Custom decoder also failed:', customError);
        return {
          success: false,
          error: 'DECODE_FAILED',
          meta,
        };
      }
    } else {
      const message = parsed!.message as Message;

      if (!message || message.type !== 'NODE_CHANGES') {
        return { success: false, error: `Invalid message type: ${message?.type}`, meta };
      }

      nodeChanges = message.nodeChanges || [];
    }

    debugLog('[figma-paste] Parsed nodes:', nodeChanges.length);

    // Convert to SVG
    const svg = convertNodesToSvg(nodeChanges);

    return {
      success: true,
      meta,
      nodes: nodeChanges,
      svg,
    };
  } catch (e) {
    console.error('[figma-paste] Failed to parse Figma clipboard:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Convert FigmaNode from custom decoder to NodeChange format
 * Copies all relevant properties for CSS conversion
 */
function convertFigmaNodes(figmaNodes: FigmaNode[]): NodeChange[] {
  return figmaNodes.map(node => {
    // Copy all properties dynamically to ensure nothing is missed
    const nodeChange: NodeChange = {
      guid: node.guid as GUID | undefined,
      parentIndex: node.parentIndex as ParentIndex | undefined,
      type: node.type as string | undefined,
      name: node.name,
      visible: node.visible,
      locked: node.locked as boolean | undefined,
      opacity: node.opacity as number | undefined,
      blendMode: node.blendMode as string | undefined,
      size: node.size as Vector | undefined,
      transform: node.transform as Matrix | undefined,

      // Fill & Stroke
      fillPaints: node.fillPaints as Paint[] | undefined,
      strokePaints: node.strokePaints as Paint[] | undefined,
      strokeWeight: node.strokeWeight as number | undefined,
      strokeAlign: node.strokeAlign as string | undefined,
      strokeCap: node.strokeCap as string | undefined,
      strokeJoin: node.strokeJoin as string | undefined,
      dashPattern: node.dashPattern as number[] | undefined,

      // Individual border weights
      borderTopWeight: node.borderTopWeight as number | undefined,
      borderRightWeight: node.borderRightWeight as number | undefined,
      borderBottomWeight: node.borderBottomWeight as number | undefined,
      borderLeftWeight: node.borderLeftWeight as number | undefined,
      borderStrokeWeightsIndependent: node.borderStrokeWeightsIndependent as boolean | undefined,

      // Corner radius
      cornerRadius: node.cornerRadius as number | undefined,
      rectangleCornerRadii: node.rectangleCornerRadii as number[] | undefined,
      rectangleTopLeftCornerRadius: node.rectangleTopLeftCornerRadius as number | undefined,
      rectangleTopRightCornerRadius: node.rectangleTopRightCornerRadius as number | undefined,
      rectangleBottomLeftCornerRadius: node.rectangleBottomLeftCornerRadius as number | undefined,
      rectangleBottomRightCornerRadius: node.rectangleBottomRightCornerRadius as number | undefined,

      // Effects
      effects: node.effects as Effect[] | undefined,

      // Text properties
      fontSize: node.fontSize as number | undefined,
      fontName: node.fontName as FontName | undefined,
      textData: node.textData as TextData | undefined,
      textAlignHorizontal: node.textAlignHorizontal as string | undefined,
      textAlignVertical: node.textAlignVertical as string | undefined,
      lineHeight: node.lineHeight as UnitValue | undefined,
      letterSpacing: node.letterSpacing as UnitValue | undefined,
      textCase: node.textCase as string | undefined,
      textDecoration: node.textDecoration as string | undefined,
      paragraphIndent: node.paragraphIndent as number | undefined,
      paragraphSpacing: node.paragraphSpacing as number | undefined,
      textTruncation: node.textTruncation as string | undefined,
      maxLines: node.maxLines as number | undefined,

      // Auto-layout properties
      stackMode: node.stackMode as string | undefined,
      stackSpacing: node.stackSpacing as number | undefined,
      stackPadding: node.stackPadding as number | undefined,
      stackHorizontalPadding: node.stackHorizontalPadding as number | undefined,
      stackVerticalPadding: node.stackVerticalPadding as number | undefined,
      stackPaddingRight: node.stackPaddingRight as number | undefined,
      stackPaddingBottom: node.stackPaddingBottom as number | undefined,
      stackPrimaryAlignItems: node.stackPrimaryAlignItems as string | undefined,
      stackCounterAlignItems: node.stackCounterAlignItems as string | undefined,
      stackPrimarySizing: node.stackPrimarySizing as string | undefined,
      stackCounterSizing: node.stackCounterSizing as string | undefined,
      stackChildPrimaryGrow: node.stackChildPrimaryGrow as number | undefined,
      stackChildAlignSelf: node.stackChildAlignSelf as string | undefined,
      stackPositioning: node.stackPositioning as string | undefined,
      stackReverseZIndex: node.stackReverseZIndex as boolean | undefined,
      stackWrap: node.stackWrap as string | undefined,

      // Constraints
      horizontalConstraint: node.horizontalConstraint as string | undefined,
      verticalConstraint: node.verticalConstraint as string | undefined,

      // Clipping
      clipsContent: node.clipsContent as boolean | undefined,
      frameMaskDisabled: node.frameMaskDisabled as boolean | undefined,

      // Other
      count: node.count as number | undefined,
    };
    return nodeChange;
  });
}

/**
 * Convert Figma color to CSS rgba string
 */
function colorToRgba(color: Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}

/**
 * Get fill color from paints array
 */
function getFillColor(paints: Paint[] | undefined): string | null {
  if (!paints || paints.length === 0) return null;

  // Find first visible solid fill
  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (paint.type === 'SOLID' && paint.color) {
      const opacity = paint.opacity !== undefined ? paint.opacity : 1;
      return colorToRgba({ ...paint.color, a: paint.color.a * opacity });
    }
    // TODO: Support gradients
  }

  return null;
}

/**
 * Build transform matrix string for SVG
 */
function buildTransform(node: NodeChange): string {
  if (!node.transform) return '';

  const m = node.transform;
  return `matrix(${m.m00}, ${m.m10}, ${m.m01}, ${m.m11}, ${m.m02}, ${m.m12})`;
}

/**
 * Create shadow filter for SVG
 */
function createShadowFilter(effect: Effect, filterId: string): string {
  if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') {
    return '';
  }

  const color = effect.color ? colorToRgba(effect.color) : 'rgba(0,0,0,0.25)';
  const offsetX = effect.offset?.x || 0;
  const offsetY = effect.offset?.y || 0;
  const blur = effect.radius || 0;

  return `
    <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="${offsetX}" dy="${offsetY}" stdDeviation="${blur / 2}" flood-color="${color}"/>
    </filter>
  `;
}

/**
 * Convert a single node to SVG element string
 */
function nodeToSvgElement(node: NodeChange, defs: string[]): string {
  const type = node.type;
  const name = node.name || 'element';

  // Skip removed or invisible nodes
  if (node.visible === false) return '';

  // Common attributes
  const fill = getFillColor(node.fillPaints);
  const stroke = getFillColor(node.strokePaints);
  const strokeWeight = node.strokeWeight || 0;
  const transform = buildTransform(node);
  const opacity = node.opacity !== undefined ? node.opacity : 1;

  // Size from node
  const width = node.size?.x || 100;
  const height = node.size?.y || 100;

  // Build common style attributes
  const styleAttrs: string[] = [];
  if (fill) styleAttrs.push(`fill="${fill}"`);
  else styleAttrs.push('fill="none"');
  if (stroke && strokeWeight > 0) {
    styleAttrs.push(`stroke="${stroke}"`);
    styleAttrs.push(`stroke-width="${strokeWeight}"`);
  }
  if (opacity < 1) styleAttrs.push(`opacity="${opacity}"`);

  // Handle effects (shadows)
  if (node.effects && node.effects.length > 0) {
    for (let i = 0; i < node.effects.length; i++) {
      const effect = node.effects[i];
      if (effect.visible !== false && (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW')) {
        const filterId = `shadow-${node.guid?.localID || Math.random().toString(36).slice(2)}`;
        defs.push(createShadowFilter(effect, filterId));
        styleAttrs.push(`filter="url(#${filterId})"`);
        break; // Only apply first shadow for now
      }
    }
  }

  const styleStr = styleAttrs.join(' ');

  // Wrap in group with transform
  const wrapWithTransform = (content: string) => {
    if (transform) {
      return `<g transform="${transform}">${content}</g>`;
    }
    return content;
  };

  switch (type) {
    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE': {
      const cornerRadius = node.rectangleCornerRadii?.[0] || node.cornerRadius || 0;
      return wrapWithTransform(
        `<rect x="0" y="0" width="${width}" height="${height}" rx="${cornerRadius}" ${styleStr} data-name="${escapeXml(name)}"/>`
      );
    }

    case 'ELLIPSE': {
      const cx = width / 2;
      const cy = height / 2;
      const rx = width / 2;
      const ry = height / 2;
      return wrapWithTransform(
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${styleStr} data-name="${escapeXml(name)}"/>`
      );
    }

    case 'LINE': {
      return wrapWithTransform(
        `<line x1="0" y1="0" x2="${width}" y2="${height}" ${styleStr} data-name="${escapeXml(name)}"/>`
      );
    }

    case 'REGULAR_POLYGON':
    case 'STAR': {
      const points = generatePolygonPoints(width, height, type === 'STAR' ? 5 : (node.count || 3), type === 'STAR');
      return wrapWithTransform(
        `<polygon points="${points}" ${styleStr} data-name="${escapeXml(name)}"/>`
      );
    }

    case 'VECTOR': {
      // Vector paths require blob data parsing - use rectangle as placeholder
      return wrapWithTransform(
        `<rect x="0" y="0" width="${width}" height="${height}" ${styleStr} data-name="${escapeXml(name)}" data-type="vector"/>`
      );
    }

    case 'TEXT': {
      const fontSize = node.fontSize || 16;
      const fontFamily = node.fontName?.family || 'sans-serif';
      const textContent = node.textData?.characters || '';
      const textFill = fill || '#000000';

      return wrapWithTransform(
        `<text x="0" y="${fontSize}" font-size="${fontSize}" font-family="${fontFamily}" fill="${textFill}" ${opacity < 1 ? `opacity="${opacity}"` : ''} data-name="${escapeXml(name)}">${escapeXml(textContent)}</text>`
      );
    }

    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE':
    case 'SECTION': {
      // Container nodes - rendered as groups
      // In a full implementation, children would be recursively processed
      return wrapWithTransform(
        `<rect x="0" y="0" width="${width}" height="${height}" ${styleStr} data-name="${escapeXml(name)}" data-type="${type?.toLowerCase()}"/>`
      );
    }

    default:
      // Fallback to rectangle for unknown types
      debugLog(`[figma-paste] Unknown node type: ${type}`);
      return wrapWithTransform(
        `<rect x="0" y="0" width="${width}" height="${height}" ${styleStr} data-name="${escapeXml(name)}" data-type="${type}"/>`
      );
  }
}

/**
 * Generate polygon/star points
 */
function generatePolygonPoints(width: number, height: number, sides: number, isStar: boolean): string {
  const points: string[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const innerRadius = isStar ? radius * 0.4 : radius;

  const totalPoints = isStar ? sides * 2 : sides;
  for (let i = 0; i < totalPoints; i++) {
    const angle = (i * 2 * Math.PI) / totalPoints - Math.PI / 2;
    const r = isStar && i % 2 === 1 ? innerRadius : radius;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return points.join(' ');
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert array of Figma nodes to SVG string
 */
function convertNodesToSvg(nodes: NodeChange[]): string {
  if (!nodes || nodes.length === 0) {
    return '';
  }

  // Calculate bounding box from transforms
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const node of nodes) {
    if (node.visible === false) continue;

    let x = 0, y = 0;
    if (node.transform) {
      x = node.transform.m02;
      y = node.transform.m12;
    }
    const w = node.size?.x || 0;
    const h = node.size?.y || 0;

    if (w > 0 && h > 0) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  }

  // Default bounds if no valid nodes
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  // Build SVG
  const defs: string[] = [];
  const elements: string[] = [];

  for (const node of nodes) {
    const svgElement = nodeToSvgElement(node, defs);
    if (svgElement) {
      elements.push(svgElement);
    }
  }

  const defsStr = defs.length > 0 ? `<defs>${defs.join('\n')}</defs>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
${defsStr}
${elements.join('\n')}
</svg>`;
}

/**
 * Result type for processFigmaPaste
 */
export interface FigmaPasteProcessResult {
  elements: HTMLElement[];
  shouldFallbackToImage: boolean;
  /** Figma file key for fetching images */
  fileKey?: string;
  /** Image hashes that need to be fetched from Figma API */
  imageHashes?: string[];
  /** Node IDs (sessionID:localID) for fallback rendering when hashes can't be extracted */
  imageNodeIds?: string[];
}

/**
 * Convert Figma color to CSS color string
 */
function figmaColorToCss(color: Color, opacity?: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = (color.a ?? 1) * (opacity ?? 1);
  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/**
 * Get CSS background from Figma paints
 */
function getFillCss(paints: Paint[] | undefined): string | null {
  if (!paints || paints.length === 0) return null;

  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (paint.type === 'SOLID' && paint.color) {
      return figmaColorToCss(paint.color, paint.opacity);
    }
    // TODO: Support gradients (LINEAR_GRADIENT, RADIAL_GRADIENT)
  }
  return null;
}

/**
 * Get CSS border from Figma stroke paints
 */
function getStrokeCss(paints: Paint[] | undefined, weight: number | undefined): string | null {
  if (!paints || paints.length === 0 || !weight || weight <= 0) return null;

  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (paint.type === 'SOLID' && paint.color) {
      const color = figmaColorToCss(paint.color, paint.opacity);
      return `${weight}px solid ${color}`;
    }
  }
  return null;
}

/**
 * Get CSS box-shadow from Figma effects
 */
function getBoxShadowCss(effects: Effect[] | undefined): string | null {
  if (!effects || effects.length === 0) return null;

  const shadows: string[] = [];
  for (const effect of effects) {
    if (effect.visible === false) continue;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const color = effect.color ? figmaColorToCss(effect.color) : 'rgba(0,0,0,0.25)';
      const x = effect.offset?.x || 0;
      const y = effect.offset?.y || 0;
      const blur = effect.radius || 0;
      const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
      shadows.push(`${inset}${x}px ${y}px ${blur}px ${color}`);
    }
  }

  return shadows.length > 0 ? shadows.join(', ') : null;
}

/**
 * Get CSS font-weight from Figma font style name
 */
function getFontWeight(fontStyle?: string): string {
  if (!fontStyle) return '400';

  const styleLower = fontStyle.toLowerCase();

  // Common font weight mappings
  if (styleLower.includes('thin') || styleLower.includes('hairline')) return '100';
  if (styleLower.includes('extralight') || styleLower.includes('ultra light')) return '200';
  if (styleLower.includes('light')) return '300';
  if (styleLower.includes('regular') || styleLower.includes('normal') || styleLower.includes('book')) return '400';
  if (styleLower.includes('medium')) return '500';
  if (styleLower.includes('semibold') || styleLower.includes('semi bold') || styleLower.includes('demi')) return '600';
  if (styleLower.includes('extrabold') || styleLower.includes('ultra bold')) return '800';
  if (styleLower.includes('bold')) return '700';
  if (styleLower.includes('black') || styleLower.includes('heavy')) return '900';

  return '400';
}

/**
 * Get CSS border-radius from Figma corner radius
 */
function getBorderRadiusCss(cornerRadius?: number, cornerRadii?: number[]): string | null {
  if (cornerRadii && cornerRadii.length === 4) {
    // [topLeft, topRight, bottomRight, bottomLeft]
    if (cornerRadii.every(r => r === cornerRadii[0])) {
      return cornerRadii[0] > 0 ? `${cornerRadii[0]}px` : null;
    }
    return `${cornerRadii[0]}px ${cornerRadii[1]}px ${cornerRadii[2]}px ${cornerRadii[3]}px`;
  }
  if (cornerRadius && cornerRadius > 0) {
    return `${cornerRadius}px`;
  }
  return null;
}

/**
 * Node with hierarchy information
 */
interface HierarchyNode {
  node: NodeChange;
  children: HierarchyNode[];
  relativeX: number;
  relativeY: number;
}

/**
 * Extended hierarchy node with computed absolute bounds and GUID
 */
interface HierarchyNodeWithBounds extends HierarchyNode {
  width: number;
  height: number;
  guid?: { sessionID: number; localID: number };
  parentGuid?: { sessionID: number; localID: number };
}

/**
 * Helper to compare GUIDs
 */
function guidEquals(a?: { sessionID: number; localID: number }, b?: { sessionID: number; localID: number }): boolean {
  if (!a || !b) return false;
  return a.sessionID === b.sessionID && a.localID === b.localID;
}

/**
 * Build node hierarchy using parentIndex from Figma data
 *
 * Strategy:
 * 1. First, try to use parentIndex field from Figma (most accurate)
 * 2. Fall back to containment-based detection if parentIndex is not available
 *
 * Figma clipboard stores child positions relative to their parent.
 */
function buildNodeHierarchy(nodes: NodeChange[]): HierarchyNode[] {
  if (nodes.length === 0) return [];

  // Check if nodes have parentIndex with valid guid
  const hasParentIndex = nodes.some(n => n.parentIndex?.guid !== undefined);
  debugLog('[figma-paste] Has parentIndex.guid field:', hasParentIndex);

  if (hasParentIndex) {
    return buildHierarchyFromParentIndex(nodes);
  } else {
    return buildHierarchyFromContainment(nodes);
  }
}

/**
 * Build hierarchy using Figma's parentIndex field (accurate method)
 */
function buildHierarchyFromParentIndex(nodes: NodeChange[]): HierarchyNode[] {
  debugLog('[figma-paste] Building hierarchy from parentIndex for', nodes.length, 'nodes');

  // Create hierarchy nodes and map by GUID
  const nodeMap = new Map<string, HierarchyNodeWithBounds>();
  const allNodes: HierarchyNodeWithBounds[] = [];

  // First pass: create all nodes and build the map
  for (const node of nodes) {
    const guid = node.guid;
    // parentIndex has nested structure: { guid: { sessionID, localID }, position: string }
    const parentGuid = node.parentIndex?.guid;
    const x = node.transform?.m02 ?? 0;
    const y = node.transform?.m12 ?? 0;
    const width = node.size?.x ?? 0;
    const height = node.size?.y ?? 0;

    const guidKey = guid ? `${guid.sessionID}:${guid.localID}` : 'no-guid';
    const parentKey = parentGuid ? `${parentGuid.sessionID}:${parentGuid.localID}` : 'no-parent';

    debugLog(`[figma-paste] Node: ${node.type} "${node.name}" guid=${guidKey} parent=${parentKey} pos=(${x.toFixed(0)},${y.toFixed(0)}) size=${width.toFixed(0)}x${height.toFixed(0)}`);

    const hNode: HierarchyNodeWithBounds = {
      node,
      children: [],
      relativeX: x,
      relativeY: y,
      width,
      height,
      guid,
      parentGuid,
    };

    allNodes.push(hNode);

    if (guid) {
      nodeMap.set(guidKey, hNode);
    }
  }

  debugLog('[figma-paste] Node map has', nodeMap.size, 'entries');

  // Second pass: build parent-child relationships
  const roots: HierarchyNodeWithBounds[] = [];
  let childCount = 0;

  for (const hNode of allNodes) {
    const nodeName = `${hNode.node.type} "${hNode.node.name}"`;

    if (hNode.parentGuid) {
      const parentKey = `${hNode.parentGuid.sessionID}:${hNode.parentGuid.localID}`;
      const parent = nodeMap.get(parentKey);

      if (parent) {
        debugLog(`[figma-paste]   ${nodeName} → child of ${parent.node.type} "${parent.node.name}"`);
        parent.children.push(hNode);
        childCount++;
      } else {
        // Parent not found in copied nodes - this is a root
        debugLog(`[figma-paste]   ${nodeName} → ROOT (parent ${parentKey} not in selection)`);
        hNode.relativeX = 0;
        hNode.relativeY = 0;
        roots.push(hNode);
      }
    } else {
      // No parent - this is a root
      debugLog(`[figma-paste]   ${nodeName} → ROOT (no parentIndex)`);
      hNode.relativeX = 0;
      hNode.relativeY = 0;
      roots.push(hNode);
    }
  }

  debugLog(`[figma-paste] Result: ${roots.length} roots, ${childCount} children linked`);

  // Debug: Print tree structure
  printHierarchyTree(roots);

  return roots;
}

/**
 * Build hierarchy using containment-based detection (fallback method)
 */
function buildHierarchyFromContainment(nodes: NodeChange[]): HierarchyNode[] {
  debugLog('[figma-paste] Building hierarchy from containment (fallback)');

  // Sort by area descending - larger containers processed first
  const sorted = [...nodes].sort((a, b) => {
    const areaA = (a.size?.x ?? 0) * (a.size?.y ?? 0);
    const areaB = (b.size?.x ?? 0) * (b.size?.y ?? 0);
    return areaB - areaA;
  });

  // Track all processed nodes for parent-finding
  const allProcessed: HierarchyNodeWithBounds[] = [];
  const roots: HierarchyNodeWithBounds[] = [];

  for (const node of sorted) {
    const x = node.transform?.m02 ?? 0;
    const y = node.transform?.m12 ?? 0;
    const width = node.size?.x ?? 0;
    const height = node.size?.y ?? 0;

    // Create hierarchy node
    const hNode: HierarchyNodeWithBounds = {
      node,
      children: [],
      relativeX: x,
      relativeY: y,
      width,
      height,
      guid: node.guid,
    };

    // Try to find a parent among already-processed nodes
    let bestParent: HierarchyNodeWithBounds | null = null;
    const POSITION_TOLERANCE = 5;

    for (const candidate of allProcessed) {
      const fitsHorizontally = x >= -POSITION_TOLERANCE &&
                               x + width <= candidate.width + POSITION_TOLERANCE;
      const fitsVertically = y >= -POSITION_TOLERANCE &&
                             y + height <= candidate.height + POSITION_TOLERANCE;

      if (fitsHorizontally && fitsVertically) {
        if (!bestParent ||
            (candidate.width * candidate.height) < (bestParent.width * bestParent.height)) {
          bestParent = candidate;
        }
      }
    }

    if (bestParent) {
      bestParent.children.push(hNode);
    } else {
      hNode.relativeX = 0;
      hNode.relativeY = 0;
      roots.push(hNode);
    }

    allProcessed.push(hNode);
  }

  printHierarchyTree(roots);
  return roots;
}

/**
 * Debug helper: Print hierarchy tree
 */
function printHierarchyTree(roots: HierarchyNodeWithBounds[]) {
  debugLog('[figma-paste] ========================================');
  debugLog('[figma-paste] HIERARCHY STRUCTURE:', roots.length, 'root(s)');
  debugLog('[figma-paste] ========================================');

  function countNodes(node: HierarchyNodeWithBounds): number {
    return 1 + node.children.reduce((sum, c) => sum + countNodes(c as HierarchyNodeWithBounds), 0);
  }

  function printTree(node: HierarchyNodeWithBounds, indent: string = '') {
    const hasImage = node.node.fillPaints?.some(p => (p as Record<string, unknown>).type === 'IMAGE');
    const imageMarker = hasImage ? ' 🖼️' : '';
    const sizeStr = node.width > 0 && node.height > 0
      ? `${node.width.toFixed(0)}x${node.height.toFixed(0)}`
      : 'no-size';
    debugLog(`[figma-paste] ${indent}├─ ${node.node.type} "${node.node.name}"${imageMarker} [${sizeStr}] (${node.relativeX.toFixed(0)},${node.relativeY.toFixed(0)})`);
    for (const child of node.children) {
      printTree(child as HierarchyNodeWithBounds, indent + '│  ');
    }
  }

  let totalNodes = 0;
  let nodesWithImages = 0;

  for (const root of roots) {
    totalNodes += countNodes(root);
    printTree(root);
    debugLog('[figma-paste] ----------------------------------------');
  }

  // Count nodes with image fills
  function countImagesInTree(node: HierarchyNodeWithBounds): number {
    const hasImage = node.node.fillPaints?.some(p => (p as Record<string, unknown>).type === 'IMAGE') ? 1 : 0;
    return hasImage + node.children.reduce((sum, c) => sum + countImagesInTree(c as HierarchyNodeWithBounds), 0);
  }

  for (const root of roots) {
    nodesWithImages += countImagesInTree(root);
  }

  debugLog(`[figma-paste] Summary: ${totalNodes} nodes, ${nodesWithImages} with image fills, ${roots.length} root(s)`);
  if (roots.length > 1) {
    console.warn('[figma-paste] ⚠️ Multiple roots detected - elements will stack vertically');
  }
  debugLog('[figma-paste] ========================================');
}

/**
 * Recursively convert hierarchy node to HTML element
 * Comprehensive conversion of all Figma properties to CSS
 *
 * Note: We handle invisible/zero-size nodes here (not in pre-filtering)
 * to ensure hierarchy relationships are maintained.
 */
function hierarchyNodeToElement(
  hNode: HierarchyNode,
  doc: Document
): HTMLElement | null {
  const node = hNode.node;

  // Skip invisible nodes - but still process children in case they're visible
  if (node.visible === false) {
    debugLog(`[figma-paste] Skip invisible node: ${node.type} "${node.name}"`);
    // Still process children - they might be visible even if parent is marked invisible
    const visibleChildren: HTMLElement[] = [];
    for (const child of hNode.children) {
      const childEl = hierarchyNodeToElement(child, doc);
      if (childEl) {
        visibleChildren.push(childEl);
      }
    }
    // If we have visible children but invisible parent, return children directly
    // (They'll be added to the grandparent)
    return visibleChildren.length === 1 ? visibleChildren[0] : null;
  }

  // Skip nodes without valid size (but not containers which may have zero size themselves)
  const isContainer = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(node.type || '');
  if (!isContainer && (!node.size || node.size.x <= 0 || node.size.y <= 0)) {
    debugLog(`[figma-paste] Skip zero-size node: ${node.type} "${node.name}"`);
    return null;
  }

  // Create element
  const el = doc.createElement('div');
  el.setAttribute('data-editable', 'true');
  el.setAttribute('data-element-id', generateElementId('figma'));
  el.setAttribute('data-figma-type', node.type || 'unknown');
  if (node.name) {
    el.setAttribute('data-name', node.name);
  }

  // Use pre-calculated relative position
  const relX = hNode.relativeX;
  const relY = hNode.relativeY;

  // Base styles
  const styles: Record<string, string> = {
    'box-sizing': 'border-box',
    'position': 'absolute',
    'left': `${relX}px`,
    'top': `${relY}px`,
  };

  // Size - add extra width for text to prevent last-character wrapping
  // Figma and browsers differ in text measurement; error scales with font size
  if (node.size) {
    let widthExtra = 0;
    if (node.type === 'TEXT' && node.fontSize) {
      widthExtra = Math.max(1, Math.ceil(node.fontSize * 0.25));
    }
    styles['width'] = `${node.size.x + widthExtra}px`;
    styles['height'] = `${node.size.y}px`;
  }

  // Check for rotation/scale (non-identity transform)
  if (node.transform) {
    const { m00, m01, m10, m11 } = node.transform;
    const isIdentity = Math.abs(m00 - 1) < 0.001 && Math.abs(m11 - 1) < 0.001 &&
                       Math.abs(m01) < 0.001 && Math.abs(m10) < 0.001;
    if (!isIdentity) {
      styles['transform'] = `matrix(${m00}, ${m10}, ${m01}, ${m11}, 0, 0)`;
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    styles['opacity'] = node.opacity.toString();
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
    const blendModeMap: Record<string, string> = {
      'MULTIPLY': 'multiply',
      'SCREEN': 'screen',
      'OVERLAY': 'overlay',
      'DARKEN': 'darken',
      'LIGHTEN': 'lighten',
      'COLOR_DODGE': 'color-dodge',
      'COLOR_BURN': 'color-burn',
      'HARD_LIGHT': 'hard-light',
      'SOFT_LIGHT': 'soft-light',
      'DIFFERENCE': 'difference',
      'EXCLUSION': 'exclusion',
      'HUE': 'hue',
      'SATURATION': 'saturation',
      'COLOR': 'color',
      'LUMINOSITY': 'luminosity',
    };
    if (blendModeMap[node.blendMode]) {
      styles['mix-blend-mode'] = blendModeMap[node.blendMode];
    }
  }

  // Fill (background) - support gradients and images
  const backgroundResult = getBackgroundCss(node.fillPaints);
  if (backgroundResult.background) {
    if (backgroundResult.background.includes('gradient') || backgroundResult.hasImageFill) {
      styles['background'] = backgroundResult.background;
    } else {
      styles['background-color'] = backgroundResult.background;
    }

    // Apply image-specific background properties
    if (backgroundResult.backgroundSize) {
      styles['background-size'] = backgroundResult.backgroundSize;
    }
    if (backgroundResult.backgroundPosition) {
      styles['background-position'] = backgroundResult.backgroundPosition;
    }
    if (backgroundResult.backgroundRepeat) {
      styles['background-repeat'] = backgroundResult.backgroundRepeat;
    }

    // Mark element as having image fill for later replacement
    if (backgroundResult.hasImageFill) {
      el.setAttribute('data-needs-image', 'true');
      if (backgroundResult.imageHash) {
        el.setAttribute('data-figma-image-hash', backgroundResult.imageHash);
      }
      // Store node GUID for fallback rendering via Figma API
      const guid = (hNode as HierarchyNodeWithBounds).guid;
      if (guid) {
        el.setAttribute('data-figma-node-id', `${guid.sessionID}:${guid.localID}`);
      }
    }
  }

  // Stroke (border) - support individual borders and dash patterns
  applyBorderStyles(styles, node);

  // Corner radius - use individual values if available
  const borderRadius = getDetailedBorderRadiusCss(node);
  if (borderRadius) {
    styles['border-radius'] = borderRadius;
  }

  // Effects (shadows, blur)
  applyEffectStyles(styles, node.effects);

  // Type-specific handling
  switch (node.type) {
    case 'ELLIPSE':
      styles['border-radius'] = '50%';
      break;

    case 'TEXT': {
      applyTextStyles(styles, el, node);
      break;
    }

    case 'LINE': {
      styles['height'] = '1px';
      const strokeColor = getFillCss(node.strokePaints);
      if (strokeColor) {
        styles['background-color'] = strokeColor;
      }
      break;
    }

    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE': {
      // Check if this is an image placeholder and add visual indicator
      if (backgroundResult.hasImageFill) {
        // Add image icon indicator
        const imageIcon = doc.createElement('div');
        imageIcon.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          color: #6b7280;
          font-size: 12px;
          font-family: sans-serif;
          pointer-events: none;
        `;
        // SVG image icon
        imageIcon.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style="font-size: 10px; opacity: 0.7;">画像を差し替え</span>
        `;
        el.appendChild(imageIcon);
        styles['position'] = 'relative';
      }
      break;
    }

    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE':
    case 'SECTION': {
      // Clipping
      if (node.clipsContent !== false && node.frameMaskDisabled !== true) {
        styles['overflow'] = 'hidden';
      }

      // Auto-layout (Flexbox)
      applyAutoLayoutStyles(styles, node);

      // For INSTANCE/COMPONENT with image fills, render as a single image instead of
      // trying to reconstruct internal structure. This prevents duplicate image placeholders.
      if ((node.type === 'INSTANCE' || node.type === 'COMPONENT') && backgroundResult.hasImageFill) {
        // Mark as needing instance render (not individual image fills)
        el.setAttribute('data-render-as-instance', 'true');
        // Clear children - we'll render the whole instance as an image
        // This prevents duplicate image placeholders from child elements
      }

      // Check if this is an image placeholder and add visual indicator (for frames with image fills)
      if (backgroundResult.hasImageFill) {
        const imageIcon = doc.createElement('div');
        imageIcon.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          color: #6b7280;
          font-size: 12px;
          font-family: sans-serif;
          pointer-events: none;
          z-index: 1;
        `;
        imageIcon.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style="font-size: 10px; opacity: 0.7;">画像を差し替え</span>
        `;
        el.appendChild(imageIcon);
      }
      break;
    }
  }

  // Apply all styles
  for (const [prop, value] of Object.entries(styles)) {
    el.style.setProperty(prop, value);
  }

  // Recursively add children
  // Exception: For INSTANCE/COMPONENT with image fills, skip children to avoid duplicates
  // (The whole instance will be rendered as a single image from Figma API)
  const shouldSkipChildren = el.hasAttribute('data-render-as-instance');

  if (!shouldSkipChildren) {
    for (const child of hNode.children) {
      const childEl = hierarchyNodeToElement(child, doc);
      if (childEl) {
        el.appendChild(childEl);
      }
    }
  } else {
    debugLog(`[figma-paste] Skipping children for ${node.type} "${node.name}" (will render as instance)`);
  }

  return el;
}

/**
 * Result of background CSS extraction
 */
interface BackgroundCssResult {
  background: string | null;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  hasImageFill?: boolean;
  imageHash?: string;
}

/**
 * Get CSS background including gradient and image support
 */
function getBackgroundCss(paints: Paint[] | undefined): BackgroundCssResult {
  if (!paints || paints.length === 0) return { background: null };

  const backgrounds: string[] = [];
  let backgroundSize: string | undefined;
  let backgroundPosition: string | undefined;
  let backgroundRepeat: string | undefined;
  let hasImageFill = false;
  let imageHash: string | undefined;

  for (const paint of paints) {
    if (paint.visible === false) continue;

    if (paint.type === 'SOLID' && paint.color) {
      const opacity = paint.opacity !== undefined ? paint.opacity : 1;
      backgrounds.push(figmaColorToCss(paint.color, opacity));
    } else if (paint.type === 'GRADIENT_LINEAR' && (paint as GradientPaint).gradientStops) {
      const gradientCss = getLinearGradientCss(paint as GradientPaint);
      if (gradientCss) backgrounds.push(gradientCss);
    } else if (paint.type === 'GRADIENT_RADIAL' && (paint as GradientPaint).gradientStops) {
      const gradientCss = getRadialGradientCss(paint as GradientPaint);
      if (gradientCss) backgrounds.push(gradientCss);
    } else if (paint.type === 'IMAGE') {
      // Image fill - extract hash using deep inspection
      const anyPaint = paint as Record<string, unknown>;
      const detectedHash = extractImageHashFromPaint(anyPaint);

      hasImageFill = true;
      imageHash = detectedHash || undefined;

      // Placeholder gradient pattern to indicate missing image
      const placeholderGradient = 'repeating-linear-gradient(45deg, #e5e7eb 0px, #e5e7eb 10px, #f3f4f6 10px, #f3f4f6 20px)';
      backgrounds.push(placeholderGradient);

      // Map Figma imageScaleMode to CSS background-size
      const scaleMode = (anyPaint.imageScaleMode as string) || paint.scaleMode;
      switch (scaleMode) {
        case 'FILL':
          backgroundSize = 'cover';
          backgroundPosition = 'center';
          break;
        case 'FIT':
          backgroundSize = 'contain';
          backgroundPosition = 'center';
          backgroundRepeat = 'no-repeat';
          break;
        case 'CROP':
          backgroundSize = 'cover';
          backgroundPosition = 'center';
          break;
        case 'TILE':
          backgroundSize = 'auto';
          backgroundRepeat = 'repeat';
          break;
        default:
          backgroundSize = 'cover';
          backgroundPosition = 'center';
      }

      debugLog(`[figma-paste] IMAGE fill detected: hash=${detectedHash?.substring(0, 16) || 'none'} scaleMode=${scaleMode}`);
    }
  }

  if (backgrounds.length === 0) return { background: null };

  return {
    background: backgrounds.length === 1 ? backgrounds[0] : backgrounds.join(', '),
    backgroundSize,
    backgroundPosition,
    backgroundRepeat,
    hasImageFill,
    imageHash,
  };
}

/**
 * Extended Paint interface for gradients
 */
interface GradientPaint extends Paint {
  gradientStops?: Array<{ color: Color; position: number }>;
  gradientTransform?: Matrix;
}

/**
 * Convert linear gradient to CSS
 */
function getLinearGradientCss(paint: GradientPaint): string | null {
  if (!paint.gradientStops || paint.gradientStops.length < 2) return null;

  const stops = paint.gradientStops
    .map(stop => `${figmaColorToCss(stop.color)} ${(stop.position * 100).toFixed(1)}%`)
    .join(', ');

  // Default angle, can be calculated from gradientTransform if needed
  return `linear-gradient(180deg, ${stops})`;
}

/**
 * Convert radial gradient to CSS
 */
function getRadialGradientCss(paint: GradientPaint): string | null {
  if (!paint.gradientStops || paint.gradientStops.length < 2) return null;

  const stops = paint.gradientStops
    .map(stop => `${figmaColorToCss(stop.color)} ${(stop.position * 100).toFixed(1)}%`)
    .join(', ');

  return `radial-gradient(ellipse at center, ${stops})`;
}

/**
 * Apply border styles including individual borders and dash patterns
 */
function applyBorderStyles(styles: Record<string, string>, node: NodeChange): void {
  const strokeColor = getFillCss(node.strokePaints);
  if (!strokeColor) return;

  const weight = node.strokeWeight || 1;

  // Check for dash pattern
  const borderStyle = (node.dashPattern && node.dashPattern.length > 0) ? 'dashed' : 'solid';

  // Check for individual border weights
  if (node.borderStrokeWeightsIndependent) {
    const top = node.borderTopWeight ?? weight;
    const right = node.borderRightWeight ?? weight;
    const bottom = node.borderBottomWeight ?? weight;
    const left = node.borderLeftWeight ?? weight;

    if (top > 0) styles['border-top'] = `${top}px ${borderStyle} ${strokeColor}`;
    if (right > 0) styles['border-right'] = `${right}px ${borderStyle} ${strokeColor}`;
    if (bottom > 0) styles['border-bottom'] = `${bottom}px ${borderStyle} ${strokeColor}`;
    if (left > 0) styles['border-left'] = `${left}px ${borderStyle} ${strokeColor}`;
  } else if (weight > 0) {
    styles['border'] = `${weight}px ${borderStyle} ${strokeColor}`;
  }

  // Stroke alignment - adjust sizing for INSIDE/OUTSIDE
  // Note: CSS borders are always painted inside, so we handle OUTSIDE with box-shadow
  if (node.strokeAlign === 'OUTSIDE' && weight > 0) {
    // Use box-shadow for outside stroke
    const existingShadow = styles['box-shadow'];
    const outsideStroke = `0 0 0 ${weight}px ${strokeColor}`;
    styles['box-shadow'] = existingShadow ? `${existingShadow}, ${outsideStroke}` : outsideStroke;
    delete styles['border'];
    delete styles['border-top'];
    delete styles['border-right'];
    delete styles['border-bottom'];
    delete styles['border-left'];
  }
}

/**
 * Get detailed border radius using individual corner values
 */
function getDetailedBorderRadiusCss(node: NodeChange): string | null {
  // Check individual corner radii first
  const tl = node.rectangleTopLeftCornerRadius ?? node.cornerRadius ?? 0;
  const tr = node.rectangleTopRightCornerRadius ?? node.cornerRadius ?? 0;
  const br = node.rectangleBottomRightCornerRadius ?? node.cornerRadius ?? 0;
  const bl = node.rectangleBottomLeftCornerRadius ?? node.cornerRadius ?? 0;

  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;

  // All same
  if (tl === tr && tr === br && br === bl) {
    return `${tl}px`;
  }

  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

/**
 * Apply effect styles (shadows, blur)
 */
function applyEffectStyles(styles: Record<string, string>, effects: Effect[] | undefined): void {
  if (!effects || effects.length === 0) return;

  const shadows: string[] = [];
  let blur = 0;
  let backdropBlur = 0;

  for (const effect of effects) {
    if (effect.visible === false) continue;

    switch (effect.type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW': {
        const color = effect.color ? figmaColorToCss(effect.color) : 'rgba(0,0,0,0.25)';
        const x = effect.offset?.x || 0;
        const y = effect.offset?.y || 0;
        const blurRadius = effect.radius || 0;
        const spread = (effect as ExtendedEffect).spread || 0;
        const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
        shadows.push(`${inset}${x}px ${y}px ${blurRadius}px ${spread}px ${color}`);
        break;
      }
      case 'LAYER_BLUR':
        blur = Math.max(blur, effect.radius || 0);
        break;
      case 'BACKGROUND_BLUR':
        backdropBlur = Math.max(backdropBlur, effect.radius || 0);
        break;
    }
  }

  if (shadows.length > 0) {
    const existingShadow = styles['box-shadow'];
    styles['box-shadow'] = existingShadow
      ? `${existingShadow}, ${shadows.join(', ')}`
      : shadows.join(', ');
  }

  if (blur > 0) {
    styles['filter'] = `blur(${blur}px)`;
  }

  if (backdropBlur > 0) {
    styles['backdrop-filter'] = `blur(${backdropBlur}px)`;
  }
}

interface ExtendedEffect extends Effect {
  spread?: number;
}

/**
 * Apply text styles
 */
function applyTextStyles(
  styles: Record<string, string>,
  el: HTMLElement,
  node: NodeChange
): void {
  const fontSize = node.fontSize || 16;
  const fontFamily = node.fontName?.family || 'sans-serif';
  const fontWeight = getFontWeight(node.fontName?.style);
  const fontStyle = getFontStyle(node.fontName?.style);
  const textContent = node.textData?.characters || '';

  styles['font-size'] = `${fontSize}px`;
  styles['font-family'] = `"${fontFamily}", sans-serif`;
  if (fontWeight !== '400') {
    styles['font-weight'] = fontWeight;
  }
  if (fontStyle !== 'normal') {
    styles['font-style'] = fontStyle;
  }
  styles['white-space'] = 'pre-wrap';
  styles['word-break'] = 'break-word';

  // Text alignment (horizontal)
  if (node.textAlignHorizontal) {
    const alignMap: Record<string, string> = {
      'LEFT': 'left',
      'CENTER': 'center',
      'RIGHT': 'right',
      'JUSTIFIED': 'justify',
    };
    styles['text-align'] = alignMap[node.textAlignHorizontal] || 'left';
  }

  // Text alignment (vertical) - use flexbox
  if (node.textAlignVertical && node.textAlignVertical !== 'TOP') {
    styles['display'] = 'flex';
    styles['flex-direction'] = 'column';
    styles['justify-content'] = node.textAlignVertical === 'CENTER' ? 'center' : 'flex-end';
  }

  // Line height
  if (node.lineHeight) {
    if (node.lineHeight.units === 'PIXELS') {
      styles['line-height'] = `${node.lineHeight.value}px`;
    } else if (node.lineHeight.units === 'PERCENT') {
      styles['line-height'] = `${node.lineHeight.value / 100}`;
    } else {
      styles['line-height'] = 'normal';
    }
  }

  // Letter spacing
  if (node.letterSpacing) {
    if (node.letterSpacing.units === 'PIXELS') {
      styles['letter-spacing'] = `${node.letterSpacing.value}px`;
    } else if (node.letterSpacing.units === 'PERCENT') {
      styles['letter-spacing'] = `${(node.letterSpacing.value / 100) * fontSize}px`;
    }
  }

  // Text case
  if (node.textCase && node.textCase !== 'ORIGINAL') {
    const caseMap: Record<string, string> = {
      'UPPER': 'uppercase',
      'LOWER': 'lowercase',
      'TITLE': 'capitalize',
      'SMALL_CAPS': 'small-caps',
      'SMALL_CAPS_FORCED': 'small-caps',
    };
    if (caseMap[node.textCase]) {
      if (node.textCase.includes('SMALL_CAPS')) {
        styles['font-variant'] = 'small-caps';
      } else {
        styles['text-transform'] = caseMap[node.textCase];
      }
    }
  }

  // Text decoration
  if (node.textDecoration && node.textDecoration !== 'NONE') {
    const decoMap: Record<string, string> = {
      'UNDERLINE': 'underline',
      'STRIKETHROUGH': 'line-through',
    };
    if (decoMap[node.textDecoration]) {
      styles['text-decoration'] = decoMap[node.textDecoration];
    }
  }

  // Paragraph indent
  if (node.paragraphIndent && node.paragraphIndent > 0) {
    styles['text-indent'] = `${node.paragraphIndent}px`;
  }

  // Text truncation
  if (node.textTruncation === 'ENDING') {
    styles['overflow'] = 'hidden';
    styles['text-overflow'] = 'ellipsis';
    if (node.maxLines && node.maxLines > 0) {
      styles['display'] = '-webkit-box';
      styles['-webkit-line-clamp'] = node.maxLines.toString();
      styles['-webkit-box-orient'] = 'vertical';
    } else {
      styles['white-space'] = 'nowrap';
    }
  }

  // Text color from fill
  const fill = getFillCss(node.fillPaints);
  if (fill) {
    styles['color'] = fill;
    delete styles['background-color'];
    delete styles['background'];
  }

  el.textContent = textContent;
}

/**
 * Get font style (italic) from Figma font style name
 */
function getFontStyle(fontStyle?: string): string {
  if (!fontStyle) return 'normal';
  const styleLower = fontStyle.toLowerCase();
  if (styleLower.includes('italic') || styleLower.includes('oblique')) {
    return 'italic';
  }
  return 'normal';
}

/**
 * Apply auto-layout (flexbox) styles
 */
function applyAutoLayoutStyles(styles: Record<string, string>, node: NodeChange): void {
  if (!node.stackMode || node.stackMode === 'NONE') return;

  styles['display'] = 'flex';
  styles['flex-direction'] = node.stackMode === 'HORIZONTAL' ? 'row' : 'column';

  // Flex wrap
  if (node.stackWrap === 'WRAP') {
    styles['flex-wrap'] = 'wrap';
  }

  // Gap
  if (node.stackSpacing !== undefined && node.stackSpacing > 0) {
    styles['gap'] = `${node.stackSpacing}px`;
  }

  // Padding - check individual paddings first, then uniform
  const paddingTop = node.stackVerticalPadding ?? node.stackPadding ?? 0;
  const paddingRight = node.stackPaddingRight ?? node.stackHorizontalPadding ?? node.stackPadding ?? 0;
  const paddingBottom = node.stackPaddingBottom ?? node.stackVerticalPadding ?? node.stackPadding ?? 0;
  const paddingLeft = node.stackHorizontalPadding ?? node.stackPadding ?? 0;

  if (paddingTop > 0 || paddingRight > 0 || paddingBottom > 0 || paddingLeft > 0) {
    styles['padding'] = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`;
  }

  // Main axis alignment (justify-content)
  if (node.stackPrimaryAlignItems) {
    const justifyMap: Record<string, string> = {
      'MIN': 'flex-start',
      'CENTER': 'center',
      'MAX': 'flex-end',
      'SPACE_BETWEEN': 'space-between',
    };
    styles['justify-content'] = justifyMap[node.stackPrimaryAlignItems] || 'flex-start';
  }

  // Cross axis alignment (align-items)
  if (node.stackCounterAlignItems) {
    const alignMap: Record<string, string> = {
      'MIN': 'flex-start',
      'CENTER': 'center',
      'MAX': 'flex-end',
      'BASELINE': 'baseline',
      'STRETCH': 'stretch',
    };
    styles['align-items'] = alignMap[node.stackCounterAlignItems] || 'stretch';
  }

  // Reverse order
  if (node.stackReverseZIndex) {
    styles['flex-direction'] = node.stackMode === 'HORIZONTAL' ? 'row-reverse' : 'column-reverse';
  }
}

/**
 * Convert array of Figma nodes to HTML elements with hierarchy
 *
 * IMPORTANT: Pass ALL nodes (including ones that might be filtered) to ensure
 * proper parent-child relationships. The hierarchy will be built first, then
 * only valid root elements will be converted.
 */
function convertNodesToDom(nodes: NodeChange[], doc: Document): HTMLElement[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  // Build hierarchy from ALL nodes - this ensures parent-child relationships
  // are properly established even if some parents might seem "invalid"
  const rootNodes = buildNodeHierarchy(nodes);

  if (rootNodes.length === 0) {
    return [];
  }

  // Convert each root to HTML element (children are nested inside)
  const elements: HTMLElement[] = [];

  for (const root of rootNodes) {
    const el = hierarchyNodeToElement(root, doc);
    if (el) {
      // Root element needs position:relative for absolute children to work
      // Children use position:absolute for positioning within root
      el.style.position = 'relative';
      el.style.left = '';  // Remove left positioning for root
      el.style.top = '';   // Remove top positioning for root
      elements.push(el);
    }
  }

  return elements;
}

/**
 * Process Figma paste and return HTML elements
 *
 * @returns Object with elements array and shouldFallbackToImage flag
 */
export function processFigmaPaste(html: string, doc: Document): FigmaPasteProcessResult {
  const result = parseFigmaClipboard(html);

  // If decode failed (schema version mismatch), signal to fallback to image
  if (!result.success) {
    if (result.error === 'DECODE_FAILED') {
      debugLog('[figma-paste] Decode failed, should fallback to image paste');
      return { elements: [], shouldFallbackToImage: true };
    }
    console.warn('[figma-paste] Failed to process Figma paste:', result.error);
    return { elements: [], shouldFallbackToImage: false };
  }

  if (!result.nodes || result.nodes.length === 0) {
    console.warn('[figma-paste] No nodes found in Figma data');
    return { elements: [], shouldFallbackToImage: true };
  }

  // Collect image hashes and node IDs from all nodes
  const imageInfo = collectImageInfo(result.nodes);
  if (imageInfo.hashes.length > 0) {
    debugLog(`[figma-paste] Found ${imageInfo.hashes.length} image hashes:`, imageInfo.hashes);
  }
  if (imageInfo.nodeIds.length > 0) {
    debugLog(`[figma-paste] Found ${imageInfo.nodeIds.length} image node IDs:`, imageInfo.nodeIds);
  }

  // Filter out only document structure nodes - keep everything else for hierarchy building
  // IMPORTANT: We must NOT filter nodes before building hierarchy, or children become orphaned
  const SKIP_NODE_TYPES = ['DOCUMENT', 'CANVAS', 'PAGE'];
  debugLog('[figma-paste] Total nodes from clipboard:', result.nodes.length);

  // Only remove document structure nodes - keep all content nodes including containers
  // The hierarchy builder needs parent nodes to properly nest children
  const allContentNodes = result.nodes.filter(n => {
    if (n.type && SKIP_NODE_TYPES.includes(n.type)) {
      debugLog(`[figma-paste]   SKIP: ${n.type} "${n.name}" (structure node)`);
      return false;
    }
    return true;
  });

  if (allContentNodes.length === 0) {
    console.warn('[figma-paste] No content nodes found');
    return { elements: [], shouldFallbackToImage: true };
  }

  debugLog('[figma-paste] Content nodes for hierarchy:', allContentNodes.length);

  // Convert ALL nodes to DOM elements - hierarchy builder handles parent-child nesting
  // Filtering of invisible/zero-size nodes happens during element conversion, not before
  const elements = convertNodesToDom(allContentNodes, doc);

  if (elements.length === 0) {
    console.warn('[figma-paste] No elements generated from Figma nodes');
    return { elements: [], shouldFallbackToImage: true };
  }

  // Log generated elements
  for (const el of elements) {
    debugLog('[figma-paste] Generated element:',
      el.style.width, 'x', el.style.height,
      'with', el.children.length, 'nested children');
  }

  return {
    elements,
    shouldFallbackToImage: false,
    fileKey: result.meta?.fileKey,
    imageHashes: imageInfo.hashes.length > 0 ? imageInfo.hashes : undefined,
    imageNodeIds: imageInfo.nodeIds.length > 0 ? imageInfo.nodeIds : undefined,
  };
}

/**
 * Convert Uint8Array to hex string (for image hashes stored as bytes)
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Recursively search for a hash value (string or Uint8Array) in nested objects.
 * Figma's kiwi binary format decodes the `image` field as a nested struct,
 * so we need to search deeper than just one level.
 */
function deepExtractHash(value: unknown, maxDepth: number): string | null {
  if (maxDepth <= 0) return null;

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (value instanceof Uint8Array && value.length > 0) {
    return bytesToHex(value);
  }

  if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array)) {
    const obj = value as Record<string, unknown>;
    // Priority keys first
    for (const key of ['hash', 'value', 'ref', 'data', 'bytes', 'imageHash', 'imageRef']) {
      if (obj[key] !== undefined) {
        const result = deepExtractHash(obj[key], maxDepth - 1);
        if (result) {
          debugLog(`[figma-paste] Found hash via key: ${key}`);
          return result;
        }
      }
    }
    // Then all other keys
    for (const [k, v] of Object.entries(obj)) {
      if (['hash', 'value', 'ref', 'data', 'bytes', 'imageHash', 'imageRef'].includes(k)) continue;
      const result = deepExtractHash(v, maxDepth - 1);
      if (result) {
        debugLog(`[figma-paste] Found hash via deep search at key: ${k}`);
        return result;
      }
    }
  }

  return null;
}

/**
 * Extract image hash from Figma paint's `image` field.
 * The kiwi binary decoder produces nested objects for image references.
 * We recursively search for any Uint8Array or string value that could be the hash.
 */
function extractImageHashFromPaint(paint: Record<string, unknown>): string | null {
  // Try known field names with recursive deep search
  for (const key of ['image', 'imageHash', 'imageRef', 'imageThumbnail', 'thumbHash']) {
    const field = paint[key];
    if (!field) continue;

    const hash = deepExtractHash(field, 4); // search up to 4 levels deep
    if (hash) {
      debugLog(`[figma-paste] Extracted hash from paint.${key}: ${hash.substring(0, 20)}...`);
      return hash;
    }
  }

  return null;
}

/**
 * Result of collecting image info from nodes
 */
interface ImageCollectionResult {
  hashes: string[];
  nodeIds: string[];
}

/**
 * Collect all unique imageHashes and node IDs from nodes with image fills.
 *
 * Strategy for INSTANCE/COMPONENT nodes:
 * - These are rendered as a single image (not reconstructed internally)
 * - We collect the INSTANCE/COMPONENT's node ID, not its children's
 * - This prevents duplicate image placeholders
 */
function collectImageInfo(nodes: NodeChange[]): ImageCollectionResult {
  const hashes = new Set<string>();
  const nodeIds = new Set<string>();
  const instanceNodeIds = new Set<string>(); // INSTANCE/COMPONENT nodes that will be rendered as images

  // First pass: identify INSTANCE/COMPONENT nodes with image fills
  for (const node of nodes) {
    if ((node.type === 'INSTANCE' || node.type === 'COMPONENT') && node.fillPaints) {
      const hasImageFill = node.fillPaints.some(p => (p as Record<string, unknown>).type === 'IMAGE');
      if (hasImageFill && node.guid) {
        const nodeId = `${node.guid.sessionID}:${node.guid.localID}`;
        instanceNodeIds.add(nodeId);
        nodeIds.add(nodeId);
        debugLog(`[figma-paste] INSTANCE/COMPONENT "${node.name}" will be rendered as single image: ${nodeId}`);
      }
    }
  }

  // Build set of nodes that are children of image-fill instances
  // These should NOT get separate image placeholders
  const childrenOfInstances = new Set<string>();
  for (const node of nodes) {
    if (node.parentIndex?.guid) {
      const parentId = `${node.parentIndex.guid.sessionID}:${node.parentIndex.guid.localID}`;
      if (instanceNodeIds.has(parentId)) {
        if (node.guid) {
          childrenOfInstances.add(`${node.guid.sessionID}:${node.guid.localID}`);
        }
      }
    }
  }

  // Second pass: collect image info from remaining nodes
  for (const node of nodes) {
    const nodeId = node.guid ? `${node.guid.sessionID}:${node.guid.localID}` : '';

    // Skip children of INSTANCE/COMPONENT nodes (they're rendered as part of the parent)
    if (childrenOfInstances.has(nodeId)) {
      debugLog(`[figma-paste] Skipping child of instance: "${node.name}"`);
      continue;
    }

    // Skip INSTANCE/COMPONENT nodes (already handled above)
    if (instanceNodeIds.has(nodeId)) {
      continue;
    }

    if (node.fillPaints && Array.isArray(node.fillPaints)) {
      for (const paint of node.fillPaints) {
        const anyPaint = paint as Record<string, unknown>;

        if (paint.type === 'IMAGE') {
          // Deep-inspect the `image` field
          const imageField = anyPaint.image;
          debugLog(`[figma-paste] IMAGE paint on "${node.name}": image field type=${typeof imageField}, isUint8Array=${imageField instanceof Uint8Array}`);

          if (imageField && typeof imageField === 'object') {
            if (imageField instanceof Uint8Array) {
              debugLog(`[figma-paste]   image = <Uint8Array(${imageField.length})> hex=${bytesToHex(imageField).substring(0, 40)}...`);
            } else {
              // Log nested object structure for debugging
              const imgObj = imageField as Record<string, unknown>;
              debugLog(`[figma-paste]   image object keys: [${Object.keys(imgObj).join(', ')}]`);
              logObjectDeep(imgObj, 'image', 2);
            }
          }

          // Extract hash using recursive deep search
          const hash = extractImageHashFromPaint(anyPaint);
          if (hash) {
            debugLog(`[figma-paste]   => extracted hash: "${hash.substring(0, 40)}${hash.length > 40 ? '...' : ''}"`);
            hashes.add(hash);
          } else {
            debugLog(`[figma-paste]   => NO hash extracted from paint`);
          }

          // Collect node GUID for fallback rendering
          if (node.guid) {
            nodeIds.add(nodeId);
            debugLog(`[figma-paste]   => node ID for rendering: ${nodeId}`);
          }
        }
      }
    }
  }

  debugLog(`[figma-paste] collectImageInfo: ${hashes.size} hashes, ${nodeIds.size} node IDs (${instanceNodeIds.size} instances)`);
  return {
    hashes: Array.from(hashes),
    nodeIds: Array.from(nodeIds),
  };
}

/**
 * Debug helper: recursively log object structure
 */
function logObjectDeep(obj: Record<string, unknown>, prefix: string, maxDepth: number): void {
  if (maxDepth <= 0) return;
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Uint8Array) {
      debugLog(`[figma-paste]   ${prefix}.${k} = <Uint8Array(${v.length})> hex=${bytesToHex(v).substring(0, 40)}...`);
    } else if (typeof v === 'object' && v !== null) {
      const nested = v as Record<string, unknown>;
      debugLog(`[figma-paste]   ${prefix}.${k} = {${Object.keys(nested).join(', ')}}`);
      logObjectDeep(nested, `${prefix}.${k}`, maxDepth - 1);
    } else {
      debugLog(`[figma-paste]   ${prefix}.${k} = ${JSON.stringify(v)}`.substring(0, 120));
    }
  }
}

/**
 * Fetch images from Figma API and apply to elements.
 * Uses dual strategy:
 * 1. Try image fills API with hash matching (efficient, one API call)
 * 2. Fall back to node rendering API if hash matching fails
 *
 * @param fileKey Figma file key from clipboard metadata
 * @param imageHashes Array of imageHash values to fetch
 * @param rootElement Root element containing elements with data-figma-image-hash
 * @param imageNodeIds Optional node IDs for fallback rendering
 * @returns Number of images successfully applied
 */
export async function fetchAndApplyFigmaImages(
  fileKey: string,
  imageHashes: string[],
  rootElement: HTMLElement | Document,
  imageNodeIds?: string[]
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];

  if (!fileKey) {
    return { applied: 0, errors: ['No fileKey provided'] };
  }

  const hasHashes = imageHashes && imageHashes.length > 0;
  const hasNodeIds = imageNodeIds && imageNodeIds.length > 0;

  if (!hasHashes && !hasNodeIds) {
    return { applied: 0, errors: ['No imageHashes or nodeIds provided'] };
  }

  let appliedCount = 0;

  // Strategy 1: Try image fills API with hash matching
  if (hasHashes) {
    debugLog(`[figma-paste] Strategy 1: Fetching ${imageHashes.length} images by hash...`);
    try {
      const response = await fetch('/api/figma/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, imageHashes }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.images) {
          const imageMap = data.images as Record<string, string>;
          debugLog(`[figma-paste] Strategy 1: Got ${Object.keys(imageMap).length} image URLs`);

          // Also log all available image refs for debugging
          if (data.allImageRefs) {
            debugLog(`[figma-paste] All available image refs in file:`, data.allImageRefs);
          }

          appliedCount += applyImagesByHash(rootElement, imageMap);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        errors.push(`Image fills API error: ${errorData.error || response.status}`);
      }
    } catch (error) {
      errors.push(`Image fills API: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Strategy 2: Fall back to node rendering if hash matching didn't cover all elements
  const remainingElements = Array.from(rootElement.querySelectorAll('[data-needs-image]'));
  if (remainingElements.length > 0 && hasNodeIds) {
    debugLog(`[figma-paste] Strategy 2: Rendering ${remainingElements.length} nodes via API...`);
    try {
      // Collect node IDs from remaining elements
      const nodeIdsToRender: string[] = [];
      for (const el of remainingElements) {
        const nodeId = el.getAttribute('data-figma-node-id');
        if (nodeId) {
          nodeIdsToRender.push(nodeId);
        }
      }

      if (nodeIdsToRender.length > 0) {
        const response = await fetch('/api/figma/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileKey, nodeIds: nodeIdsToRender, format: 'png', scale: 2 }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.images) {
            const nodeImageMap = data.images as Record<string, string>;
            debugLog(`[figma-paste] Strategy 2: Got ${Object.keys(nodeImageMap).length} rendered images`);
            appliedCount += applyImagesByNodeId(rootElement, nodeImageMap);
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          errors.push(`Node rendering API error: ${errorData.error || response.status}`);
        }
      }
    } catch (error) {
      errors.push(`Node rendering API: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  debugLog(`[figma-paste] Total applied: ${appliedCount} images`);
  return { applied: appliedCount, errors };
}

/**
 * Apply images to elements by matching data-figma-image-hash attribute
 */
function applyImagesByHash(rootElement: HTMLElement | Document, imageMap: Record<string, string>): number {
  const elements = Array.from(rootElement.querySelectorAll('[data-figma-image-hash]'));
  let applied = 0;

  for (const el of elements) {
    const hash = el.getAttribute('data-figma-image-hash');
    if (hash && imageMap[hash]) {
      applyImageToElement(el as HTMLElement, imageMap[hash]);
      applied++;
      debugLog(`[figma-paste] Applied image by hash: ${hash.substring(0, 16)}... → ${el.getAttribute('data-name') || 'unnamed'}`);
    }
  }

  return applied;
}

/**
 * Apply images to elements by matching data-figma-node-id attribute
 */
function applyImagesByNodeId(rootElement: HTMLElement | Document, nodeImageMap: Record<string, string>): number {
  const elements = Array.from(rootElement.querySelectorAll('[data-figma-node-id]'));
  let applied = 0;

  for (const el of elements) {
    const nodeId = el.getAttribute('data-figma-node-id');
    if (nodeId && nodeImageMap[nodeId]) {
      applyImageToElement(el as HTMLElement, nodeImageMap[nodeId]);
      applied++;
      debugLog(`[figma-paste] Applied image by node render: ${nodeId} → ${el.getAttribute('data-name') || 'unnamed'}`);
    }
  }

  return applied;
}

/**
 * Apply an image URL to an element, replacing the placeholder
 */
function applyImageToElement(htmlEl: HTMLElement, imageUrl: string): void {
  // Preserve existing background-size/position if set
  const existingSize = htmlEl.style.backgroundSize;
  const existingPos = htmlEl.style.backgroundPosition;
  const existingRepeat = htmlEl.style.backgroundRepeat;

  htmlEl.style.background = `url(${imageUrl})`;
  htmlEl.style.backgroundSize = existingSize || 'cover';
  htmlEl.style.backgroundPosition = existingPos || 'center';
  htmlEl.style.backgroundRepeat = existingRepeat || 'no-repeat';

  // Remove placeholder indicator
  htmlEl.removeAttribute('data-needs-image');
  htmlEl.setAttribute('data-figma-image-applied', 'true');

  // Remove placeholder icon if exists
  const placeholderIcon = htmlEl.querySelector('[style*="pointer-events: none"]');
  if (placeholderIcon) {
    placeholderIcon.remove();
  }
}
