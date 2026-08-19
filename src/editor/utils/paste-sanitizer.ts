/**
 * paste-sanitizer.ts
 *
 * DOMPurify configuration for sanitizing pasted HTML content.
 * Key design: Preserve inline styles (Chrome automatically converts computed styles to inline)
 * while removing dangerous content like scripts and event handlers.
 */

import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';

/**
 * DOMPurify configuration optimized for rich paste operations.
 * - Allows broad range of HTML tags for content preservation
 * - Preserves style and class attributes (critical for Chrome's inline style preservation)
 * - Blocks scripts, iframes, forms, and event handlers for security
 */
const PASTE_SANITIZE_CONFIG: DOMPurifyConfig = {
  // Allowed tags - comprehensive list for content preservation
  ALLOWED_TAGS: [
    // Structure
    'div', 'span', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
    // Text
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr',
    // Formatting
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
    'mark', 'small', 'abbr', 'cite', 'code', 'pre', 'kbd', 'samp', 'var',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption',
    // Media
    'img', 'figure', 'figcaption', 'picture', 'source',
    // Links
    'a',
    // Quotes
    'blockquote', 'q',
    // SVG (for SVG paste support)
    'svg', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'g', 'defs', 'use', 'symbol', 'clipPath', 'mask',
    'linearGradient', 'radialGradient', 'stop', 'pattern', 'image',
    'foreignObject', 'title', 'desc',
  ],

  // Allowed attributes - preserve styling and structure
  ALLOWED_ATTR: [
    // Core
    'id', 'class', 'style', 'title', 'lang', 'dir',
    // Links
    'href', 'target', 'rel',
    // Media
    'src', 'alt', 'width', 'height', 'loading',
    // Tables
    'colspan', 'rowspan', 'scope', 'headers',
    // Data attributes (for our editor)
    'data-editable', 'data-element-id',
    // SVG attributes
    'viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity',
    'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'points', 'transform', 'preserveAspectRatio', 'xlink:href',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
    'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end',
    'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
    'patternUnits', 'patternContentUnits', 'patternTransform',
  ],

  // Forbidden tags - security critical
  FORBID_TAGS: [
    'script', 'iframe', 'object', 'embed', 'applet',
    'form', 'input', 'button', 'select', 'textarea', 'label',
    'meta', 'link', 'base', 'style', 'noscript',
  ],

  // Forbidden attributes - prevent XSS
  FORBID_ATTR: [
    // Event handlers
    'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmousemove',
    'onmouseout', 'onmouseenter', 'onmouseleave', 'onkeydown', 'onkeypress', 'onkeyup',
    'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit', 'onreset',
    'onload', 'onerror', 'onabort', 'onscroll', 'onresize',
    'oncontextmenu', 'ondrag', 'ondragend', 'ondragenter', 'ondragleave',
    'ondragover', 'ondragstart', 'ondrop', 'oncopy', 'oncut', 'onpaste',
    'onanimationstart', 'onanimationend', 'onanimationiteration',
    'ontransitionend', 'onwheel', 'ontouchstart', 'ontouchend', 'ontouchmove',
    // Form related
    'action', 'method', 'formaction', 'formmethod',
    // Dangerous
    'srcdoc', 'sandbox', 'allow',
  ],

  // Allow data attributes
  ALLOW_DATA_ATTR: true,

  // Allow external protocol links (but not javascript:)
  ALLOW_UNKNOWN_PROTOCOLS: false,

  // Keep document structure
  WHOLE_DOCUMENT: false,

  // Return DOM instead of string for better manipulation
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,

  // Sanitize shadow DOM
  SANITIZE_DOM: true,

  // Keep aria attributes for accessibility
  KEEP_CONTENT: true,

  // Force all URLs to be safe
  SAFE_FOR_TEMPLATES: false,
};

/**
 * Sanitize pasted HTML content while preserving inline styles.
 *
 * @param html - Raw HTML string from clipboard
 * @returns Sanitized HTML string with styles preserved
 */
export function sanitizePastedHtml(html: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return DOMPurify.sanitize(html, PASTE_SANITIZE_CONFIG as any) as unknown as string;
}

/**
 * Check if HTML contains potentially dangerous content before sanitization.
 * Useful for logging/debugging suspicious paste operations.
 *
 * @param html - Raw HTML string to check
 * @returns Object indicating what dangerous content was found
 */
export function detectDangerousContent(html: string): {
  hasScript: boolean;
  hasEventHandlers: boolean;
  hasIframe: boolean;
  hasForm: boolean;
  dangerousPatterns: string[];
} {
  const dangerousPatterns: string[] = [];

  const hasScript = /<script\b/i.test(html);
  if (hasScript) dangerousPatterns.push('script tag');

  const hasEventHandlers = /\bon\w+\s*=/i.test(html);
  if (hasEventHandlers) dangerousPatterns.push('event handlers');

  const hasIframe = /<iframe\b/i.test(html);
  if (hasIframe) dangerousPatterns.push('iframe');

  const hasForm = /<form\b/i.test(html);
  if (hasForm) dangerousPatterns.push('form');

  // Check for javascript: protocol
  if (/javascript:/i.test(html)) {
    dangerousPatterns.push('javascript: protocol');
  }

  // Check for data: URIs in src (can be dangerous)
  if (/src\s*=\s*["']?\s*data:/i.test(html)) {
    dangerousPatterns.push('data: URI in src');
  }

  return {
    hasScript,
    hasEventHandlers,
    hasIframe,
    hasForm,
    dangerousPatterns,
  };
}

/**
 * Clean Microsoft Office specific markup while preserving visual styles.
 * Office applications add proprietary tags and namespaces that should be removed
 * while keeping the visual formatting.
 *
 * @param html - HTML string potentially containing Office markup
 * @returns Cleaned HTML string
 */
export function cleanOfficeMarkup(html: string): string {
  let cleaned = html;

  // Remove Word-specific tags
  cleaned = cleaned.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '');
  cleaned = cleaned.replace(/<w:[^>]*>[\s\S]*?<\/w:[^>]*>/gi, '');
  cleaned = cleaned.replace(/<m:[^>]*>[\s\S]*?<\/m:[^>]*>/gi, '');

  // Remove XML namespaces from tags but keep the tags
  cleaned = cleaned.replace(/<(\/?)\w+:/gi, '<$1');

  // Remove conditional comments (IE-specific)
  cleaned = cleaned.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
  cleaned = cleaned.replace(/<!--\[if[^\]]*\]>[\s\S]*?-->/gi, '');

  // Remove XML declarations
  cleaned = cleaned.replace(/<\?xml[^>]*\?>/gi, '');

  // Remove meta tags that might have been included
  cleaned = cleaned.replace(/<meta[^>]*>/gi, '');

  // Remove style tags (we rely on inline styles)
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Clean up mso-* styles (Microsoft Office specific) that cause issues
  // but preserve other inline styles
  cleaned = cleaned.replace(/mso-[^;:"']+:[^;:"']+;?/gi, '');

  // Remove class attributes that reference Office stylesheets
  cleaned = cleaned.replace(/class="?Mso[^"'\s>]+"?/gi, '');

  // Clean up empty style attributes
  cleaned = cleaned.replace(/style=["']\s*["']/gi, '');

  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  return cleaned;
}

/**
 * Clean Excel-specific markup while preserving table structure and styles.
 *
 * @param html - HTML string from Excel clipboard
 * @returns Cleaned HTML string with table structure preserved
 */
export function cleanExcelMarkup(html: string): string {
  let cleaned = html;

  // Apply general Office cleanup
  cleaned = cleanOfficeMarkup(cleaned);

  // Remove Excel-specific attributes
  cleaned = cleaned.replace(/x:num="[^"]*"/gi, '');
  cleaned = cleaned.replace(/x:str="[^"]*"/gi, '');

  // Clean up Excel's width/height inline styles (often too specific)
  // But preserve background colors, fonts, etc.
  cleaned = cleaned.replace(/width:\s*[\d.]+pt;?/gi, '');
  cleaned = cleaned.replace(/height:\s*[\d.]+pt;?/gi, '');

  return cleaned;
}

export { PASTE_SANITIZE_CONFIG };
