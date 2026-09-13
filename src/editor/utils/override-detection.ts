/**
 * Override Detection Utilities
 *
 * Functions to detect changes between component instances and their master components.
 * This module provides tools for comparing DOM elements with ComponentElement structures
 * and identifying which properties have been overridden.
 */

import type {
  ComponentElement,
  ComponentOverride,
  OverrideType,
  MasterComponent,
  ComponentInstance,
  OverridableProperties,
} from '../../types/editor-components';
import { debugLog } from './debug';

/**
 * Find an element within the ComponentElement tree by ID
 */
export function findElementById(
  element: ComponentElement,
  targetId: string
): ComponentElement | null {
  if (element.id === targetId) {
    return element;
  }

  for (const child of element.children) {
    const found = findElementById(child, targetId);
    if (found) return found;
  }

  return null;
}

/**
 * Find an element within the ComponentElement tree by path
 * Path format: "children.0.children.1" or "root"
 */
export function findElementByPath(
  element: ComponentElement,
  path: string
): ComponentElement | null {
  if (path === 'root' || path === '') {
    return element;
  }

  const parts = path.split('.');
  let current: ComponentElement | undefined = element;

  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] !== 'children' || !current) {
      return null;
    }

    const index = parseInt(parts[i + 1], 10);
    if (isNaN(index) || index < 0 || index >= current.children.length) {
      return null;
    }

    current = current.children[index];
  }

  return current || null;
}

/**
 * Extract text content from an HTMLElement (direct text only, excluding child elements)
 */
function getDirectTextContent(element: HTMLElement): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  return text.trim();
}

/**
 * Extract background color from computed styles
 */
function extractFillColor(computedStyle: CSSStyleDeclaration): string {
  return computedStyle.backgroundColor || 'transparent';
}

/**
 * Extract stroke/border information from computed styles
 */
function extractStrokeInfo(computedStyle: CSSStyleDeclaration): string {
  const borderWidth = computedStyle.borderWidth || '0px';
  const borderStyle = computedStyle.borderStyle || 'none';
  const borderColor = computedStyle.borderColor || 'transparent';

  if (borderStyle === 'none' || borderWidth === '0px') {
    return 'none';
  }

  return `${borderWidth} ${borderStyle} ${borderColor}`;
}

/**
 * Check if an element is visible
 */
function isElementVisible(element: HTMLElement, computedStyle: CSSStyleDeclaration): boolean {
  return (
    computedStyle.display !== 'none' &&
    computedStyle.visibility !== 'hidden' &&
    computedStyle.opacity !== '0'
  );
}

/**
 * Extract image source from an HTMLElement
 */
function extractImageSrc(element: HTMLElement): string | null {
  if (element.tagName === 'IMG') {
    return (element as HTMLImageElement).src;
  }

  // Check for background-image
  const bgImage = element.style.backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (urlMatch) {
      return urlMatch[1];
    }
  }

  return null;
}

/**
 * Compare a single property between instance DOM and master ComponentElement
 */
function detectSinglePropertyOverride(
  instanceElement: HTMLElement,
  masterElement: ComponentElement,
  type: OverrideType,
  computedStyle: CSSStyleDeclaration
): ComponentOverride | null {
  // CRITICAL: Use the MASTER's element ID for the override target, not the instance's DOM element ID
  // The override will be applied to the master's ComponentElement tree during resolveInstance,
  // so the targetElementId must match an ID in the master's structure
  const elementId = masterElement.id;

  switch (type) {
    case 'text': {
      // Debug: Log text comparison attempt
      debugLog('[detectOverrides] Text comparison for element:', {
        elementId,
        masterHasInnerHTML: masterElement.innerHTML !== undefined,
        masterChildrenCount: masterElement.children.length,
        masterTextContent: masterElement.textContent?.substring(0, 50),
        instanceTextContent: instanceElement.textContent?.substring(0, 50),
        domChildrenCount: instanceElement.children.length,
      });

      // Skip text comparison for elements that use innerHTML (mixed content)
      // because the text is embedded in the HTML structure
      if (masterElement.innerHTML !== undefined) {
        debugLog('[detectOverrides] Skipping: element uses innerHTML');
        return null;
      }

      // Get text content for comparison
      const instanceText = instanceElement.textContent?.trim() || '';

      // For leaf elements (no children), compare textContent directly
      if (masterElement.children.length === 0) {
        const masterText = masterElement.textContent || '';

        debugLog('[detectOverrides] Comparing text (leaf element):', {
          elementId,
          instanceText,
          masterText,
          areEqual: instanceText === masterText,
        });

        if (instanceText !== masterText) {
          debugLog('[detectOverrides] Text override detected:', {
            elementId,
            instanceText: instanceText.substring(0, 50),
            masterText: masterText.substring(0, 50),
          });
          return {
            id: `override-${elementId}-text-${Date.now()}`,
            targetElementId: elementId,
            type: 'text',
            value: instanceText,
          };
        }
      } else {
        // Element has children - DO NOT create text override at parent level
        // Text overrides should only be created at leaf elements (no children)
        // Creating a parent-level text override would destroy the child structure
        // when the override is applied (textContent replaces all children)
        debugLog('[detectOverrides] Skipping text override for element with children:', {
          elementId,
          childrenCount: masterElement.children.length,
          reason: 'Text overrides at parent level would destroy child structure',
        });
        // The recursive processing will handle text overrides at child level
      }
      break;
    }

    case 'fill': {
      const instanceFill = extractFillColor(computedStyle);
      const masterFill = masterElement.styles.backgroundColor || 'transparent';

      // Normalize transparent values for comparison
      // Both 'transparent', 'rgba(0, 0, 0, 0)', and undefined represent no background
      const isTransparent = (color: string): boolean => {
        if (!color || color === 'transparent') return true;
        // Match rgba(0, 0, 0, 0) or rgba(0,0,0,0)
        if (/^rgba?\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(color)) return true;
        return false;
      };

      // Don't create fill override if both are transparent
      if (isTransparent(instanceFill) && isTransparent(masterFill)) {
        break;
      }

      if (instanceFill !== masterFill) {
        return {
          id: `override-${elementId}-fill-${Date.now()}`,
          targetElementId: elementId,
          type: 'fill',
          value: instanceFill,
        };
      }
      break;
    }

    case 'stroke': {
      const instanceStroke = extractStrokeInfo(computedStyle);
      const masterStroke = masterElement.styles.border || 'none';

      if (instanceStroke !== masterStroke) {
        return {
          id: `override-${elementId}-stroke-${Date.now()}`,
          targetElementId: elementId,
          type: 'stroke',
          value: instanceStroke,
        };
      }
      break;
    }

    case 'visibility': {
      const instanceVisible = isElementVisible(instanceElement, computedStyle);
      const masterVisible = !masterElement.hidden;

      if (instanceVisible !== masterVisible) {
        return {
          id: `override-${elementId}-visibility-${Date.now()}`,
          targetElementId: elementId,
          type: 'visibility',
          value: instanceVisible,
        };
      }
      break;
    }

    case 'image': {
      const instanceSrc = extractImageSrc(instanceElement);
      const masterSrc = masterElement.tagName === 'img'
        ? masterElement.attributes.src
        : null;

      if (instanceSrc && instanceSrc !== masterSrc) {
        return {
          id: `override-${elementId}-image-${Date.now()}`,
          targetElementId: elementId,
          type: 'image',
          value: {
            url: instanceSrc,
            alt: instanceElement.getAttribute('alt') || undefined,
          },
        };
      }
      break;
    }
  }

  return null;
}

/**
 * Detect overrides by comparing instance DOM with master ComponentElement
 * Recursively traverses the tree and compares each overridable property
 */
export function detectOverrides(
  instanceElement: HTMLElement,
  masterElement: ComponentElement
): ComponentOverride[] {
  const overrides: ComponentOverride[] = [];
  const iframeDoc = instanceElement.ownerDocument;
  const defaultView = iframeDoc.defaultView;

  if (!defaultView) {
    console.warn('[detectOverrides] No defaultView available');
    return overrides;
  }

  const processElement = (
    domElement: HTMLElement,
    componentElement: ComponentElement
  ): void => {
    const computedStyle = defaultView.getComputedStyle(domElement);
    const overridable = componentElement.overridable;

    // Check each overridable property type
    const propertyTypes: Array<{ type: OverrideType; allowed: boolean }> = [
      { type: 'text', allowed: overridable.text },
      { type: 'fill', allowed: overridable.fill },
      { type: 'stroke', allowed: overridable.stroke },
      { type: 'visibility', allowed: overridable.visibility },
      { type: 'image', allowed: overridable.image },
    ];

    for (const { type, allowed } of propertyTypes) {
      if (allowed) {
        const override = detectSinglePropertyOverride(
          domElement,
          componentElement,
          type,
          computedStyle
        );
        if (override) {
          overrides.push(override);
        }
      }
    }

    // Process children recursively
    // Note: Use nodeType check instead of instanceof HTMLElement because
    // in iframe context, the HTMLElement constructor is from the parent window
    const domChildren = Array.from(domElement.children).filter(
      (child): child is HTMLElement => {
        if (child.nodeType !== Node.ELEMENT_NODE) return false;
        const el = child as HTMLElement;
        if (el.classList?.contains('selection-box')) return false;
        if (el.classList?.contains('resize-handle')) return false;
        return true;
      }
    );

    // Debug: Log child matching
    if (componentElement.children.length > 0 || domChildren.length > 0) {
      debugLog('[detectOverrides] Child matching:', {
        parentId: componentElement.id,
        domChildrenCount: domChildren.length,
        domChildrenIds: domChildren.map(dc => dc.getAttribute('data-element-id')),
        domChildrenMasterIds: domChildren.map(dc => dc.getAttribute('data-master-element-id')),
        componentChildrenCount: componentElement.children.length,
        componentChildrenIds: componentElement.children.map(c => c.id),
      });
    }

    for (const componentChild of componentElement.children) {
      // Match by data-element-id first, then fall back to data-master-element-id
      // (duplicated instances have regenerated data-element-id but preserve the original in data-master-element-id)
      const matchingDomChild = domChildren.find(
        (dc) => {
          const domId = dc.getAttribute('data-element-id');
          const masterRefId = dc.getAttribute('data-master-element-id');
          return domId === componentChild.id || masterRefId === componentChild.id;
        }
      );

      if (matchingDomChild) {
        processElement(matchingDomChild, componentChild);
      } else {
        debugLog('[detectOverrides] No matching DOM child for component child:', {
          componentChildId: componentChild.id,
          componentChildTagName: componentChild.tagName,
          availableDomIds: domChildren.map(dc => dc.getAttribute('data-element-id')),
          availableMasterIds: domChildren.map(dc => dc.getAttribute('data-master-element-id')),
        });
      }
    }
  };

  processElement(instanceElement, masterElement);

  debugLog('[detectOverrides] ========== FINAL RESULT ==========');
  debugLog('[detectOverrides] Total overrides detected:', overrides.length);
  if (overrides.length > 0) {
    debugLog('[detectOverrides] Detected overrides:', overrides.map(o => ({
      type: o.type,
      targetElementId: o.targetElementId,
      value: typeof o.value === 'string' ? o.value.substring(0, 50) : o.value,
    })));
  }

  return overrides;
}

/**
 * Check if a specific property is overridden in an instance
 */
export function isPropertyOverridden(
  instance: ComponentInstance,
  elementId: string,
  overrideType: OverrideType
): boolean {
  return instance.overrides.some(
    (override) =>
      (override.targetElementId === elementId || override.elementPath?.includes(elementId)) &&
      override.type === overrideType
  );
}

/**
 * Get the override value for a specific property
 * Returns null if the property is not overridden
 */
export function getOverrideValue(
  instance: ComponentInstance,
  elementId: string,
  overrideType: OverrideType
): string | boolean | null {
  const override = instance.overrides.find(
    (o) =>
      (o.targetElementId === elementId || o.elementPath?.includes(elementId)) &&
      o.type === overrideType
  );

  if (!override) {
    return null;
  }

  // Handle different value types
  if (typeof override.value === 'string' || typeof override.value === 'boolean') {
    return override.value;
  }

  // For complex values, return string representation
  if (typeof override.value === 'object' && 'url' in override.value) {
    return (override.value as { url: string }).url;
  }

  return null;
}

/**
 * Get all overrides for a specific element
 */
export function getOverridesForElement(
  instance: ComponentInstance,
  elementId: string
): ComponentOverride[] {
  return instance.overrides.filter(
    (override) =>
      override.targetElementId === elementId ||
      override.elementPath?.includes(elementId)
  );
}

/**
 * Compare two ComponentElements to find differences
 * This is useful for comparing a modified element back to its original state
 */
export function compareElements(
  original: ComponentElement,
  modified: ComponentElement
): ComponentOverride[] {
  const overrides: ComponentOverride[] = [];
  const timestamp = Date.now();

  // Compare text content
  if (original.textContent !== modified.textContent && original.overridable.text) {
    overrides.push({
      id: `override-${original.id}-text-${timestamp}`,
      targetElementId: original.id,
      type: 'text',
      value: modified.textContent || '',
    });
  }

  // Compare styles
  const fillChanged =
    original.styles.backgroundColor !== modified.styles.backgroundColor;
  if (fillChanged && original.overridable.fill) {
    overrides.push({
      id: `override-${original.id}-fill-${timestamp}`,
      targetElementId: original.id,
      type: 'fill',
      value: modified.styles.backgroundColor || 'transparent',
    });
  }

  // Compare border/stroke
  const strokeChanged = original.styles.border !== modified.styles.border;
  if (strokeChanged && original.overridable.stroke) {
    overrides.push({
      id: `override-${original.id}-stroke-${timestamp}`,
      targetElementId: original.id,
      type: 'stroke',
      value: modified.styles.border || 'none',
    });
  }

  // Compare visibility
  if (original.hidden !== modified.hidden && original.overridable.visibility) {
    overrides.push({
      id: `override-${original.id}-visibility-${timestamp}`,
      targetElementId: original.id,
      type: 'visibility',
      value: !modified.hidden,
    });
  }

  // Compare image source (for img elements)
  if (original.tagName === 'img' && original.overridable.image) {
    const originalSrc = original.attributes.src;
    const modifiedSrc = modified.attributes.src;

    if (originalSrc !== modifiedSrc) {
      overrides.push({
        id: `override-${original.id}-image-${timestamp}`,
        targetElementId: original.id,
        type: 'image',
        value: {
          url: modifiedSrc || '',
          alt: modified.attributes.alt,
        },
      });
    }
  }

  // Recursively compare children
  for (let i = 0; i < original.children.length; i++) {
    const origChild = original.children[i];
    const modChild = modified.children.find((c) => c.id === origChild.id);

    if (modChild) {
      const childOverrides = compareElements(origChild, modChild);
      overrides.push(...childOverrides);
    }
  }

  return overrides;
}

/**
 * Get a summary of overrides for display purposes
 */
export function getOverrideSummary(
  instance: ComponentInstance
): Array<{
  elementId: string;
  types: OverrideType[];
  count: number;
}> {
  const summaryMap = new Map<string, Set<OverrideType>>();

  for (const override of instance.overrides) {
    const elementId = override.targetElementId || override.elementPath || 'unknown';
    // elementPath is always a string in our type definition
    const key = elementId;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, new Set());
    }
    summaryMap.get(key)!.add(override.type);
  }

  return Array.from(summaryMap.entries()).map(([elementId, types]) => ({
    elementId,
    types: Array.from(types),
    count: types.size,
  }));
}

/**
 * Check if a specific element has any overrides
 * This is a more specific check than the generic hasOverrides in component-sync.ts
 */
export function elementHasOverrides(
  instance: ComponentInstance,
  elementId: string
): boolean {
  return instance.overrides.some(
    (o) => o.targetElementId === elementId || o.elementPath?.includes(elementId)
  );
}

/**
 * Get the count of overrides for an instance
 */
export function getOverrideCount(instance: ComponentInstance): number {
  return instance.overrides.length;
}

/**
 * Check which properties of an element are overridable based on the master component
 */
export function getOverridableProperties(
  master: MasterComponent,
  elementId: string
): OverridableProperties | null {
  // Get the current variant's root element
  const variant = master.variants.find((v) => v.id === master.defaultVariantId);
  if (!variant) return null;

  const element = findElementById(variant.rootElement, elementId);
  return element?.overridable || null;
}
