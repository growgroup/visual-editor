/**
 * paste-processors.ts
 *
 * Content type detection and format-specific processors for rich clipboard paste.
 * Handles: Browser HTML, Excel, Word, SVG, and plain text.
 */

import { generateElementId } from './dom-utils';
import {
  sanitizePastedHtml,
  cleanOfficeMarkup,
  cleanExcelMarkup,
  detectDangerousContent,
} from './paste-sanitizer';
import { isFigmaContent, processFigmaPaste, type FigmaPasteProcessResult } from './figma-paste';

/**
 * Types of content that can be detected in clipboard
 */
export type ClipboardContentType =
  | 'image'
  | 'html-figma'
  | 'html-excel'
  | 'html-word'
  | 'html-browser'
  | 'svg'
  | 'plain-text'
  | 'unknown';

/**
 * Result of a paste processing operation
 */
export interface PasteProcessResult {
  success: boolean;
  elements: HTMLElement[];
  contentType: ClipboardContentType;
  error?: string;
  /** When true, caller should fallback to image paste handling */
  shouldFallbackToImage?: boolean;
  /** Figma file key for fetching images (only for html-figma type) */
  figmaFileKey?: string;
  /** Image hashes that need to be fetched from Figma API */
  figmaImageHashes?: string[];
  /** Node IDs for fallback rendering when hashes can't be extracted */
  figmaImageNodeIds?: string[];
}

/**
 * Detect the type of content in clipboard data.
 *
 * Priority:
 * 1. HTML content from Office apps (Excel, Word) - these also include images, but HTML is preferred
 * 2. Images (screenshots, pure image paste)
 * 3. Other HTML content (Browser, SVG)
 * 4. Plain text
 *
 * @param clipboardData - DataTransfer object from paste event
 * @returns Detected content type
 */
export function detectContentType(clipboardData: DataTransfer): ClipboardContentType {
  const types = Array.from(clipboardData.types);
  const items = Array.from(clipboardData.items);

  // Check for HTML content FIRST
  // Various apps (Figma, Excel, Word) include both HTML and image data,
  // but we want to use the HTML for better fidelity
  if (types.includes('text/html')) {
    const html = clipboardData.getData('text/html');

    // Detect Figma - highest priority (contains kiwi-encoded design data)
    if (isFigmaContent(html)) {
      return 'html-figma';
    }

    // Detect Excel - prioritize over image
    if (isExcelContent(html)) {
      return 'html-excel';
    }

    // Detect Word - prioritize over image
    if (isWordContent(html)) {
      return 'html-word';
    }

    // For non-Office HTML, check if it's a pure image paste
    // (browsers sometimes wrap pasted images in HTML)
    const hasImage = items.some(item => item.type.startsWith('image/'));
    if (hasImage && isPureImageHtml(html)) {
      return 'image';
    }

    // Detect standalone SVG (not SVG embedded in HTML document)
    if (isSvgContent(html)) {
      return 'svg';
    }

    // Generic browser HTML
    return 'html-browser';
  }

  // Check for images (no HTML available)
  const hasImage = items.some(item => item.type.startsWith('image/'));
  if (hasImage) {
    return 'image';
  }

  // Plain text fallback
  if (types.includes('text/plain')) {
    const text = clipboardData.getData('text/plain');
    // Check if plain text is pure SVG code
    if (isPureSvgText(text)) {
      return 'svg';
    }
    return 'plain-text';
  }

  return 'unknown';
}

/**
 * Check if HTML content is from Microsoft Excel
 */
function isExcelContent(html: string): boolean {
  return (
    html.includes('xmlns:x="urn:schemas-microsoft-com:office:excel"') ||
    html.includes('urn:schemas-microsoft-com:office:excel') ||
    html.includes('mso-number-format') ||
    (html.includes('<table') && html.includes('x:num'))
  );
}

/**
 * Check if HTML content is from Microsoft Word
 */
function isWordContent(html: string): boolean {
  return (
    html.includes('xmlns:w="urn:schemas-microsoft-com:office:word"') ||
    html.includes('urn:schemas-microsoft-com:office:word') ||
    html.includes('<o:p>') ||
    html.includes('class="Mso') ||
    html.includes('mso-bidi-font-family') ||
    html.includes('mso-fareast-font-family')
  );
}

/**
 * Check if HTML is just a wrapper for an image (browser's image paste)
 */
function isPureImageHtml(html: string): boolean {
  // Browser wraps pasted images in minimal HTML
  // Check if the HTML contains only an img tag with no other significant content
  const imgMatch = html.match(/<img[^>]*>/gi);
  if (!imgMatch) return false;

  // Remove img tags and check if there's any other meaningful content
  const withoutImg = html
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<\/?meta[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  // If only whitespace remains, it's a pure image paste
  return withoutImg.length < 50; // Allow some minimal wrapper content
}

/**
 * Check if plain text is pure SVG code
 */
function isPureSvgText(text: string): boolean {
  const trimmed = text.trim();
  // Must start with <svg or <?xml followed by <svg
  return (
    trimmed.startsWith('<svg') ||
    (trimmed.startsWith('<?xml') && trimmed.includes('<svg'))
  );
}

/**
 * Check if content is standalone SVG (not SVG embedded in HTML document)
 */
function isSvgContent(html: string): boolean {
  const trimmed = html.trim();

  // Must start with <svg tag directly (standalone SVG)
  if (trimmed.startsWith('<svg')) {
    return true;
  }

  // Or XML declaration followed by SVG
  if (trimmed.startsWith('<?xml') && trimmed.includes('<svg')) {
    // Make sure it's not a full HTML document with embedded SVG
    if (!trimmed.includes('<html') && !trimmed.includes('<body') && !trimmed.includes('<div')) {
      return true;
    }
  }

  // NOT SVG if:
  // - Contains HTML document structure (even without <body>, browsers may add wrapper elements)
  // - Contains multiple top-level elements
  // - Has HTML-like structure around the SVG

  // Check for HTML wrapper patterns that browsers add
  const hasHtmlWrapper =
    trimmed.includes('<html') ||
    trimmed.includes('<!DOCTYPE') ||
    trimmed.includes('<meta') ||
    trimmed.includes('<span') ||
    trimmed.includes('<div') ||
    trimmed.includes('<p>') ||
    trimmed.includes('<body');

  if (hasHtmlWrapper) {
    return false;
  }

  return false;
}

/**
 * Add editor-specific attributes to an element and its children.
 *
 * @param element - Element to process
 * @param prefix - Prefix for element IDs
 */
function addEditorAttributes(element: HTMLElement, prefix: string = 'paste'): void {
  element.setAttribute('data-editable', 'true');
  element.setAttribute('data-element-id', generateElementId(prefix));

  // Process children recursively (for nested elements)
  const children = element.querySelectorAll('*');
  children.forEach((child) => {
    if (child instanceof HTMLElement) {
      // Only add data-editable to direct block-level children
      // to avoid making every span/inline element separately selectable
      const display = window.getComputedStyle(child).display;
      if (display === 'block' || display === 'flex' || display === 'grid' || display === 'table') {
        child.setAttribute('data-editable', 'true');
        child.setAttribute('data-element-id', generateElementId(prefix));
      }
    }
  });
}

/**
 * Process browser HTML content.
 * Preserves inline styles that Chrome automatically adds from computed styles.
 *
 * @param html - HTML string from clipboard
 * @param doc - Document to create elements in (iframe document)
 * @returns Array of processed HTMLElements
 */
export function processBrowserHtml(html: string, doc: Document): HTMLElement[] {
  // Log any dangerous content for debugging
  const dangers = detectDangerousContent(html);
  if (dangers.dangerousPatterns.length > 0) {
    console.warn('[paste-processors] Dangerous content detected:', dangers.dangerousPatterns);
  }

  // Sanitize while preserving styles
  const sanitized = sanitizePastedHtml(html);

  // Parse the sanitized HTML
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(sanitized, 'text/html');

  // Extract elements from body
  const elements: HTMLElement[] = [];
  const bodyChildren = Array.from(parsedDoc.body.children);

  bodyChildren.forEach((child) => {
    if (child instanceof HTMLElement) {
      // Clone to the target document
      const cloned = doc.importNode(child, true) as HTMLElement;
      addEditorAttributes(cloned, 'paste');
      elements.push(cloned);
    }
  });

  // If no block elements found, wrap text content in a div
  if (elements.length === 0 && parsedDoc.body.textContent?.trim()) {
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = sanitized;
    addEditorAttributes(wrapper, 'paste');
    elements.push(wrapper);
  }

  return elements;
}

/**
 * Process Excel content.
 * Preserves table structure and cell styles while removing Excel-specific markup.
 *
 * @param html - HTML string from Excel clipboard
 * @param doc - Document to create elements in
 * @returns Array of processed HTMLElements
 */
export function processExcelContent(html: string, doc: Document): HTMLElement[] {
  // Clean Excel-specific markup
  let cleaned = cleanExcelMarkup(html);

  // Sanitize
  cleaned = sanitizePastedHtml(cleaned);

  // Parse
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(cleaned, 'text/html');

  const elements: HTMLElement[] = [];

  // Find tables (Excel primarily exports as tables)
  const tables = parsedDoc.querySelectorAll('table');

  if (tables.length > 0) {
    tables.forEach((table) => {
      const cloned = doc.importNode(table, true) as HTMLTableElement;

      // Add default styling if no styles present
      if (!cloned.style.borderCollapse) {
        cloned.style.borderCollapse = 'collapse';
      }

      // Add borders to cells if not styled
      const cells = cloned.querySelectorAll('td, th');
      cells.forEach((cell) => {
        const cellEl = cell as HTMLElement;
        if (!cellEl.style.border && !cellEl.style.borderWidth) {
          cellEl.style.border = '1px solid #d1d5db';
          cellEl.style.padding = '8px 12px';
        }
      });

      addEditorAttributes(cloned, 'excel');
      elements.push(cloned);
    });
  } else {
    // Fallback to browser HTML processing if no tables found
    return processBrowserHtml(cleaned, doc);
  }

  return elements;
}

/**
 * Process Word content.
 * Preserves text formatting (bold, italic, colors) while removing Word-specific markup.
 *
 * @param html - HTML string from Word clipboard
 * @param doc - Document to create elements in
 * @returns Array of processed HTMLElements
 */
export function processWordContent(html: string, doc: Document): HTMLElement[] {
  // Clean Word-specific markup
  let cleaned = cleanOfficeMarkup(html);

  // Sanitize
  cleaned = sanitizePastedHtml(cleaned);

  // Parse
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(cleaned, 'text/html');

  const elements: HTMLElement[] = [];
  const bodyChildren = Array.from(parsedDoc.body.children);

  bodyChildren.forEach((child) => {
    if (child instanceof HTMLElement) {
      const cloned = doc.importNode(child, true) as HTMLElement;

      // Clean up empty paragraphs from Word
      if (cloned.tagName === 'P' && !cloned.textContent?.trim() && !cloned.querySelector('img')) {
        return; // Skip empty paragraphs
      }

      addEditorAttributes(cloned, 'word');
      elements.push(cloned);
    }
  });

  // If no elements, fallback to wrapper
  if (elements.length === 0 && parsedDoc.body.textContent?.trim()) {
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = parsedDoc.body.innerHTML;
    addEditorAttributes(wrapper, 'word');
    elements.push(wrapper);
  }

  return elements;
}

/**
 * Process SVG content.
 * Wraps SVG in a div container and ensures proper attributes.
 *
 * @param content - SVG string (from HTML or plain text)
 * @param doc - Document to create elements in
 * @returns Array of processed HTMLElements
 */
export function processSvgContent(content: string, doc: Document): HTMLElement[] {
  // Extract SVG element
  let svgString = content;

  // If it's HTML containing SVG, extract just the SVG
  if (content.includes('<body')) {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(content, 'text/html');
    const svg = parsedDoc.querySelector('svg');
    if (svg) {
      svgString = svg.outerHTML;
    }
  }

  // Sanitize the SVG
  const sanitized = sanitizePastedHtml(svgString);

  // Parse SVG
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(sanitized, 'image/svg+xml');
  const svgElement = svgDoc.querySelector('svg');

  if (!svgElement) {
    console.warn('[paste-processors] Failed to parse SVG content');
    return [];
  }

  // Ensure SVG has viewBox
  if (!svgElement.getAttribute('viewBox')) {
    const width = svgElement.getAttribute('width') || '100';
    const height = svgElement.getAttribute('height') || '100';
    svgElement.setAttribute('viewBox', `0 0 ${parseFloat(width)} ${parseFloat(height)}`);
  }

  // Create wrapper div
  const wrapper = doc.createElement('div');
  wrapper.style.display = 'inline-block';

  // Import SVG into document
  const importedSvg = doc.importNode(svgElement, true);
  wrapper.appendChild(importedSvg);

  addEditorAttributes(wrapper, 'svg');

  return [wrapper];
}

/**
 * Process plain text content.
 * Wraps text in appropriate elements, preserving line breaks.
 *
 * @param text - Plain text string
 * @param doc - Document to create elements in
 * @returns Array of processed HTMLElements
 */
export function processPlainText(text: string, doc: Document): HTMLElement[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  // Split by line breaks and create paragraphs
  const lines = trimmed.split(/\r?\n/);
  const elements: HTMLElement[] = [];

  // Group consecutive lines into paragraphs
  let currentParagraph: string[] = [];

  lines.forEach((line, index) => {
    if (line.trim()) {
      currentParagraph.push(line);
    }

    // Create paragraph when we hit empty line or end
    if ((!line.trim() || index === lines.length - 1) && currentParagraph.length > 0) {
      const p = doc.createElement('p');
      p.innerHTML = currentParagraph.join('<br>');
      p.style.margin = '0 0 1em 0';
      addEditorAttributes(p, 'text');
      elements.push(p);
      currentParagraph = [];
    }
  });

  // If single line, don't wrap in p, use span
  if (elements.length === 1 && !trimmed.includes('\n')) {
    const span = doc.createElement('span');
    span.textContent = trimmed;
    addEditorAttributes(span, 'text');
    return [span];
  }

  return elements;
}

/**
 * Process clipboard content based on detected type.
 *
 * @param clipboardData - DataTransfer from paste event
 * @param doc - Document to create elements in (iframe document)
 * @param contentType - Pre-detected content type (optional, will detect if not provided)
 * @returns Processing result with elements and metadata
 */
export function processClipboardContent(
  clipboardData: DataTransfer,
  doc: Document,
  contentType?: ClipboardContentType
): PasteProcessResult {
  const type = contentType || detectContentType(clipboardData);

  try {
    let elements: HTMLElement[] = [];

    switch (type) {
      case 'image':
        // Images handled separately by existing useImageUpload hook
        return {
          success: false,
          elements: [],
          contentType: type,
          error: 'Images should be handled by useImageUpload',
        };

      case 'html-figma': {
        const html = clipboardData.getData('text/html');
        const figmaResult = processFigmaPaste(html, doc);

        // If Figma decode failed (schema version mismatch), signal to fallback to image
        if (figmaResult.shouldFallbackToImage) {
          return {
            success: false,
            elements: [],
            contentType: type,
            error: 'Figma decode failed, fallback to image',
            shouldFallbackToImage: true,
          };
        }

        // Return with Figma-specific data for image fetching
        return {
          success: figmaResult.elements.length > 0,
          elements: figmaResult.elements,
          contentType: type,
          figmaFileKey: figmaResult.fileKey,
          figmaImageHashes: figmaResult.imageHashes,
          figmaImageNodeIds: figmaResult.imageNodeIds,
        };
      }

      case 'html-excel': {
        const html = clipboardData.getData('text/html');
        elements = processExcelContent(html, doc);
        break;
      }

      case 'html-word': {
        const html = clipboardData.getData('text/html');
        elements = processWordContent(html, doc);
        break;
      }

      case 'html-browser': {
        const html = clipboardData.getData('text/html');
        elements = processBrowserHtml(html, doc);
        break;
      }

      case 'svg': {
        // Try HTML first, then plain text
        let content = clipboardData.getData('text/html');
        if (!content || !content.includes('<svg')) {
          content = clipboardData.getData('text/plain');
        }
        elements = processSvgContent(content, doc);
        break;
      }

      case 'plain-text': {
        const text = clipboardData.getData('text/plain');
        elements = processPlainText(text, doc);
        break;
      }

      case 'unknown':
      default:
        return {
          success: false,
          elements: [],
          contentType: type,
          error: 'Unknown clipboard content type',
        };
    }

    return {
      success: elements.length > 0,
      elements,
      contentType: type,
    };
  } catch (error) {
    console.error('[paste-processors] Error processing clipboard content:', error);
    return {
      success: false,
      elements: [],
      contentType: type,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
