/**
 * Override Apply Utilities
 *
 * Functions to apply, reset, and manage overrides on component instances.
 * This module handles the application of overrides to both ComponentElement trees
 * and DOM elements.
 */

import type {
  ComponentElement,
  ComponentOverride,
  OverrideType,
  ComponentInstance,
  OverrideImageValue,
  OverrideInstanceSwapValue,
} from '../../types/editor-components';
import { findElementById, findElementByPath } from './override-detection';
import { debugLog } from './debug';

/**
 * Deep clone a ComponentElement tree
 */
export function cloneComponentElement(element: ComponentElement): ComponentElement {
  return {
    ...element,
    attributes: { ...element.attributes },
    styles: { ...element.styles },
    overridable: { ...element.overridable },
    children: element.children.map(cloneComponentElement),
  };
}

/**
 * Apply a single override to a ComponentElement (mutates the element in place)
 */
export function applyOverride(
  element: ComponentElement,
  override: ComponentOverride
): void {
  // Find the target element
  let targetElement: ComponentElement | null = null;

  if (override.targetElementId) {
    targetElement = findElementById(element, override.targetElementId);
  } else if (override.elementPath) {
    targetElement = findElementByPath(element, override.elementPath);
  }

  if (!targetElement) {
    console.warn(
      `[applyOverride] Target element not found for override:`,
      override.id
    );
    return;
  }

  // Apply the override based on type
  switch (override.type) {
    case 'text':
      if (typeof override.value === 'string') {
        targetElement.textContent = override.value;
      }
      break;

    case 'fill':
      if (typeof override.value === 'string') {
        targetElement.styles.backgroundColor = override.value;
      }
      break;

    case 'stroke':
      if (typeof override.value === 'string') {
        targetElement.styles.border = override.value;
      }
      break;

    case 'visibility':
      if (typeof override.value === 'boolean') {
        targetElement.hidden = !override.value;
      }
      break;

    case 'image':
      if (isOverrideImageValue(override.value)) {
        if (targetElement.tagName === 'img') {
          targetElement.attributes.src = override.value.url;
          if (override.value.alt) {
            targetElement.attributes.alt = override.value.alt;
          }
          if (override.value.objectFit) {
            targetElement.styles.objectFit = override.value.objectFit;
          }
          if (override.value.objectPosition) {
            targetElement.styles.objectPosition = override.value.objectPosition;
          }
        } else {
          // Apply as background image
          targetElement.styles.backgroundImage = `url('${override.value.url}')`;
        }
      }
      break;

    case 'style':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const styleOverrides = override.value as Record<string, string>;
        Object.assign(targetElement.styles, styleOverrides);
      }
      break;

    case 'attribute':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const attrOverrides = override.value as Record<string, string>;
        Object.assign(targetElement.attributes, attrOverrides);
      }
      break;

    case 'children':
      if (Array.isArray(override.value)) {
        targetElement.children = override.value as ComponentElement[];
      }
      break;

    case 'instanceSwap':
      // Instance swap is handled at a higher level (requires loading the swapped component)
      debugLog('[applyOverride] Instance swap override detected:', override.value);
      break;

    default:
      console.warn('[applyOverride] Unknown override type:', override.type);
  }
}

/**
 * Apply all overrides to a ComponentElement tree (returns a new tree)
 */
export function applyOverrides(
  element: ComponentElement,
  overrides: ComponentOverride[]
): ComponentElement {
  // Create a deep clone to avoid mutating the original
  const clonedElement = cloneComponentElement(element);

  // Sort overrides by depth (process deeper elements first to avoid conflicts)
  const sortedOverrides = [...overrides].sort((a, b) => {
    const depthA = (a.elementPath?.split('.').length || 0);
    const depthB = (b.elementPath?.split('.').length || 0);
    return depthB - depthA;
  });

  // Apply each override
  for (const override of sortedOverrides) {
    applyOverride(clonedElement, override);
  }

  return clonedElement;
}

/**
 * Apply a single override to a DOM element
 */
export function applyOverrideToDOM(
  domElement: HTMLElement,
  override: ComponentOverride
): void {
  switch (override.type) {
    case 'text':
      if (typeof override.value === 'string') {
        // Find and update only direct text nodes
        const textNodes = Array.from(domElement.childNodes).filter(
          (node) => node.nodeType === Node.TEXT_NODE
        );

        if (textNodes.length > 0) {
          textNodes[0].textContent = override.value;
        } else {
          // If no text nodes exist, prepend one
          const textNode = domElement.ownerDocument.createTextNode(override.value);
          domElement.insertBefore(textNode, domElement.firstChild);
        }
      }
      break;

    case 'fill':
      if (typeof override.value === 'string') {
        domElement.style.backgroundColor = override.value;
      }
      break;

    case 'stroke':
      if (typeof override.value === 'string') {
        if (override.value === 'none') {
          domElement.style.border = 'none';
        } else {
          domElement.style.border = override.value;
        }
      }
      break;

    case 'visibility':
      if (typeof override.value === 'boolean') {
        domElement.style.display = override.value ? '' : 'none';
        domElement.style.visibility = override.value ? '' : 'hidden';
      }
      break;

    case 'image':
      if (isOverrideImageValue(override.value)) {
        if (domElement.tagName === 'IMG') {
          (domElement as HTMLImageElement).src = override.value.url;
          if (override.value.alt) {
            (domElement as HTMLImageElement).alt = override.value.alt;
          }
          if (override.value.objectFit) {
            domElement.style.objectFit = override.value.objectFit;
          }
          if (override.value.objectPosition) {
            domElement.style.objectPosition = override.value.objectPosition;
          }
        } else {
          domElement.style.backgroundImage = `url('${override.value.url}')`;
        }
      }
      break;

    case 'style':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const styleOverrides = override.value as Record<string, string>;
        for (const [key, value] of Object.entries(styleOverrides)) {
          domElement.style.setProperty(key, value);
        }
      }
      break;

    case 'attribute':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const attrOverrides = override.value as Record<string, string>;
        for (const [key, value] of Object.entries(attrOverrides)) {
          domElement.setAttribute(key, value);
        }
      }
      break;

    case 'children':
      // Children replacement in DOM would require more complex handling
      console.warn('[applyOverrideToDOM] Children override not supported in DOM mode');
      break;

    case 'instanceSwap':
      debugLog('[applyOverrideToDOM] Instance swap requires higher-level handling');
      break;

    default:
      console.warn('[applyOverrideToDOM] Unknown override type:', override.type);
  }

  // Mark element as having an override (for visual indication)
  domElement.setAttribute('data-has-override', 'true');
  domElement.setAttribute(`data-override-${override.type}`, 'true');
}

/**
 * Apply all overrides to DOM elements within a container
 */
export function applyOverridesToDOM(
  container: HTMLElement,
  overrides: ComponentOverride[]
): void {
  for (const override of overrides) {
    let targetElement: HTMLElement | null = null;

    if (override.targetElementId) {
      targetElement = container.querySelector(
        `[data-element-id="${override.targetElementId}"]`
      );
    }

    if (targetElement) {
      applyOverrideToDOM(targetElement, override);
    }
  }
}

/**
 * Reset a specific override on an instance (returns a new instance)
 */
export function resetOverride(
  instance: ComponentInstance,
  overrideId: string
): ComponentInstance {
  return {
    ...instance,
    overrides: instance.overrides.filter((o) => o.id !== overrideId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reset all overrides of a specific type on an instance
 */
export function resetOverridesByType(
  instance: ComponentInstance,
  type: OverrideType
): ComponentInstance {
  return {
    ...instance,
    overrides: instance.overrides.filter((o) => o.type !== type),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reset all overrides for a specific element on an instance
 */
export function resetOverridesForElement(
  instance: ComponentInstance,
  elementId: string
): ComponentInstance {
  return {
    ...instance,
    overrides: instance.overrides.filter(
      (o) =>
        o.targetElementId !== elementId &&
        !o.elementPath?.includes(elementId)
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reset all overrides on an instance
 */
export function resetAllOverrides(
  instance: ComponentInstance
): ComponentInstance {
  return {
    ...instance,
    overrides: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create an override from a property change
 */
export function createOverride(
  targetElementId: string,
  type: OverrideType,
  value: string | boolean | OverrideImageValue | Record<string, string>
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type,
    value,
  };
}

/**
 * Create a new override with a generated ID
 */
export function createOverrideWithId(
  targetElementId: string,
  type: OverrideType,
  value: string | boolean | OverrideImageValue | Record<string, string>
): ComponentOverride {
  return {
    id: `override-${targetElementId}-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    targetElementId,
    type,
    value,
  };
}

/**
 * Add or update an override in an instance
 * If an override for the same element and type exists, it is updated
 * Otherwise, a new override is added
 */
export function upsertOverride(
  instance: ComponentInstance,
  override: Omit<ComponentOverride, 'id'>
): ComponentInstance {
  const existingIndex = instance.overrides.findIndex(
    (o) =>
      o.targetElementId === override.targetElementId &&
      o.type === override.type
  );

  const newOverride: ComponentOverride = {
    ...override,
    id:
      existingIndex >= 0
        ? instance.overrides[existingIndex].id
        : `override-${override.targetElementId}-${override.type}-${Date.now()}`,
  };

  const newOverrides =
    existingIndex >= 0
      ? [
          ...instance.overrides.slice(0, existingIndex),
          newOverride,
          ...instance.overrides.slice(existingIndex + 1),
        ]
      : [...instance.overrides, newOverride];

  return {
    ...instance,
    overrides: newOverrides,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remove override indicators from a DOM element
 */
export function clearOverrideIndicators(domElement: HTMLElement): void {
  domElement.removeAttribute('data-has-override');
  domElement.removeAttribute('data-override-text');
  domElement.removeAttribute('data-override-fill');
  domElement.removeAttribute('data-override-stroke');
  domElement.removeAttribute('data-override-visibility');
  domElement.removeAttribute('data-override-image');
  domElement.removeAttribute('data-override-style');
  domElement.removeAttribute('data-override-attribute');
}

/**
 * Type guard for OverrideImageValue
 */
function isOverrideImageValue(value: unknown): value is OverrideImageValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    typeof (value as OverrideImageValue).url === 'string'
  );
}

/**
 * Type guard for OverrideInstanceSwapValue
 */
function isOverrideInstanceSwapValue(value: unknown): value is OverrideInstanceSwapValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'componentId' in value &&
    typeof (value as OverrideInstanceSwapValue).componentId === 'string'
  );
}

/**
 * Merge overrides from multiple sources (e.g., merging variant overrides with instance overrides)
 * Later overrides in the array take precedence
 */
export function mergeOverrides(
  ...overrideSets: ComponentOverride[][]
): ComponentOverride[] {
  const overrideMap = new Map<string, ComponentOverride>();

  for (const overrides of overrideSets) {
    for (const override of overrides) {
      // Create a key based on target and type
      const key = `${override.targetElementId || override.elementPath}-${override.type}`;
      overrideMap.set(key, override);
    }
  }

  return Array.from(overrideMap.values());
}

/**
 * Check if two overrides are equivalent (same target, type, and value)
 */
export function areOverridesEqual(
  a: ComponentOverride,
  b: ComponentOverride
): boolean {
  if (a.type !== b.type) return false;
  if (a.targetElementId !== b.targetElementId) return false;
  if (a.elementPath !== b.elementPath) return false;

  // Compare values
  if (typeof a.value !== typeof b.value) return false;

  if (typeof a.value === 'object' && a.value !== null) {
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  }

  return a.value === b.value;
}

/**
 * Get the display name for an override type (for UI)
 */
export function getOverrideTypeDisplayName(type: OverrideType): string {
  const displayNames: Record<OverrideType, string> = {
    text: 'テキスト',
    fill: '塗り',
    stroke: '線',
    visibility: '表示',
    image: '画像',
    style: 'スタイル',
    attribute: '属性',
    children: '子要素',
    instanceSwap: 'インスタンス入れ替え',
  };

  return displayNames[type] || type;
}

/**
 * Convert override type to CSS property hint
 */
export function getOverrideTypeCSSProperty(type: OverrideType): string | null {
  const cssProperties: Record<OverrideType, string | null> = {
    text: null, // Not a CSS property
    fill: 'background-color',
    stroke: 'border',
    visibility: 'display',
    image: 'background-image',
    style: null, // Multiple properties
    attribute: null, // Not CSS
    children: null, // Not CSS
    instanceSwap: null, // Not CSS
  };

  return cssProperties[type];
}
