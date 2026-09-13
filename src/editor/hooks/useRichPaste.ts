'use client';

/**
 * useRichPaste.ts
 *
 * Hook for handling rich clipboard paste operations (Excel, Word, Browser HTML, SVG).
 * Integrates with the editor's element system for proper insertion and selection.
 */

import { useCallback } from 'react';
import { useEditorContext } from '../EditorContext';
import { getIframeElement, updateSelectionBox } from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import {
  detectContentType,
  processClipboardContent,
  ClipboardContentType,
  PasteProcessResult,
} from '../utils/paste-processors';
import { fetchAndApplyFigmaImages } from '../utils/figma-paste';
import { debugLog } from '../utils/debug';

/**
 * Result of a rich paste operation
 */
export interface RichPasteResult {
  success: boolean;
  elementIds: string[];
  contentType: ClipboardContentType;
  error?: string;
  /** When true, caller should fallback to image paste handling */
  shouldFallbackToImage?: boolean;
  /** Number of Figma images successfully fetched and applied */
  figmaImagesApplied?: number;
  /** Errors from Figma image fetching */
  figmaImageErrors?: string[];
}

/**
 * Hook for handling rich clipboard paste operations.
 *
 * Features:
 * - Detects clipboard content type (Excel, Word, Browser HTML, SVG, plain text)
 * - Processes and sanitizes content while preserving styles
 * - Inserts elements at the correct position (after selected element or at end)
 * - Updates selection to newly pasted elements
 *
 * @returns Object containing paste utilities and handlers
 */
export function useRichPaste() {
  const {
    selectedElement,
    setSelectedElement,
    setSelectedElementIds,
    notifyIframeChange,
    getIframeDoc,
  } = useEditorContext();

  /**
   * Check if clipboard contains rich content that we can handle.
   * Images are excluded as they're handled by useImageUpload.
   */
  const canHandleRichPaste = useCallback((clipboardData: DataTransfer): boolean => {
    const contentType = detectContentType(clipboardData);
    // We handle everything except images (handled by useImageUpload) and unknown
    return contentType !== 'image' && contentType !== 'unknown';
  }, []);

  /**
   * Get the content type without processing
   */
  const getContentType = useCallback((clipboardData: DataTransfer): ClipboardContentType => {
    return detectContentType(clipboardData);
  }, []);

  /**
   * Paste rich content from clipboard into the editor.
   *
   * @param clipboardData - DataTransfer from paste event
   * @param forceContentType - Optional content type to force (overrides detection)
   * @returns Result of the paste operation
   */
  const pasteRichContent = useCallback(async (
    clipboardData: DataTransfer,
    forceContentType?: ClipboardContentType
  ): Promise<RichPasteResult> => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      return {
        success: false,
        elementIds: [],
        contentType: 'unknown',
        error: 'No iframe document available',
      };
    }

    // Detect content type (or use forced type)
    const contentType = forceContentType || detectContentType(clipboardData);
    debugLog('[useRichPaste] Detected content type:', contentType, forceContentType ? '(forced)' : '');

    // Skip images (handled by useImageUpload)
    if (contentType === 'image') {
      return {
        success: false,
        elementIds: [],
        contentType,
        error: 'Images should be handled by useImageUpload',
      };
    }

    // Process clipboard content
    const result: PasteProcessResult = processClipboardContent(clipboardData, iframeDoc, contentType);

    if (!result.success || result.elements.length === 0) {
      console.warn('[useRichPaste] Failed to process content:', result.error);
      return {
        success: false,
        elementIds: [],
        contentType: result.contentType,
        error: result.error || 'Failed to process clipboard content',
        shouldFallbackToImage: result.shouldFallbackToImage,
      };
    }

    // Clear existing selection boxes
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
    iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    // Determine insertion point
    let insertAfterElement: HTMLElement | null = null;
    if (selectedElement) {
      insertAfterElement = getIframeElement(iframeDoc, selectedElement.id);
    }

    // Insert elements
    const pastedIds: string[] = [];
    const pastedElements: HTMLElement[] = [];

    result.elements.forEach((el) => {
      const elementId = el.getAttribute('data-element-id');
      if (!elementId) {
        console.warn('[useRichPaste] Element missing data-element-id, skipping');
        return;
      }

      // Insert at appropriate position
      if (insertAfterElement && insertAfterElement.parentNode) {
        insertAfterElement.parentNode.insertBefore(el, insertAfterElement.nextSibling);
        insertAfterElement = el; // Update for next element
      } else {
        // Find artboard or use body
        const artboard = iframeDoc.querySelector('[data-element-id="artboard"]') || iframeDoc.body;
        artboard.appendChild(el);
      }

      pastedIds.push(elementId);
      pastedElements.push(el);
    });

    // Notify change
    notifyIframeChange();

    // Update selection to pasted elements
    if (pastedIds.length > 0) {
      setSelectedElementIds(pastedIds);
      pastedElements.forEach((el) => {
        el.classList.add('selected');
        updateSelectionBox(iframeDoc, el, true);
      });

      // Set primary selected element
      if (pastedElements.length > 0) {
        const info = extractElementInfo(pastedElements[0], iframeDoc);
        if (info) {
          setSelectedElement(info);
        }
      }
    }

    debugLog('[useRichPaste] Successfully pasted', pastedIds.length, 'elements');

    // For Figma content, fetch and apply images asynchronously
    let figmaImagesApplied: number | undefined;
    let figmaImageErrors: string[] | undefined;

    const hasImageHashes = result.figmaImageHashes && result.figmaImageHashes.length > 0;
    const hasImageNodeIds = result.figmaImageNodeIds && result.figmaImageNodeIds.length > 0;

    if (
      result.contentType === 'html-figma' &&
      result.figmaFileKey &&
      (hasImageHashes || hasImageNodeIds)
    ) {
      debugLog('[useRichPaste] Fetching Figma images...',
        hasImageHashes ? `${result.figmaImageHashes!.length} hashes` : 'no hashes',
        hasImageNodeIds ? `${result.figmaImageNodeIds!.length} nodeIds` : 'no nodeIds',
      );

      // Find the root element to search within
      const rootElement = pastedElements[0]?.parentElement || iframeDoc.body;

      const imageResult = await fetchAndApplyFigmaImages(
        result.figmaFileKey,
        result.figmaImageHashes || [],
        rootElement,
        result.figmaImageNodeIds
      );

      figmaImagesApplied = imageResult.applied;
      figmaImageErrors = imageResult.errors.length > 0 ? imageResult.errors : undefined;

      if (imageResult.applied > 0) {
        // Notify change again since images were applied
        notifyIframeChange();
        debugLog(`[useRichPaste] Applied ${imageResult.applied} Figma images`);
      }
    }

    return {
      success: true,
      elementIds: pastedIds,
      contentType: result.contentType,
      figmaImagesApplied,
      figmaImageErrors,
    };
  }, [getIframeDoc, selectedElement, setSelectedElement, setSelectedElementIds, notifyIframeChange]);

  /**
   * Debug helper: Log clipboard contents
   */
  const debugClipboard = useCallback((clipboardData: DataTransfer): void => {
    debugLog('[useRichPaste] === Clipboard Debug ===');
    debugLog('Available types:', Array.from(clipboardData.types));

    clipboardData.types.forEach((type) => {
      const data = clipboardData.getData(type);
      debugLog(`[${type}]:`, data.substring(0, 500) + (data.length > 500 ? '...' : ''));
    });

    debugLog('Items:', Array.from(clipboardData.items).map(item => ({
      kind: item.kind,
      type: item.type,
    })));

    debugLog('Detected type:', detectContentType(clipboardData));
    debugLog('[useRichPaste] === End Debug ===');
  }, []);

  return {
    canHandleRichPaste,
    getContentType,
    pasteRichContent,
    debugClipboard,
    detectContentType,
  };
}
