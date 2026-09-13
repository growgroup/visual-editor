/**
 * Component Renderer Utilities
 *
 * Functions to render ComponentElement structures to actual DOM elements.
 * Supports rendering master components, variants, and instances with overrides.
 */

import type {
  ComponentElement,
  ComponentInstance,
  ComponentOverride,
  MasterComponent,
  OverrideType,
  OverrideImageValue,
} from '../../types/editor-components';
import { generateElementId } from './dom-utils';
import { debugLog } from './debug';

// ============================================================
// Constants
// ============================================================

/**
 * Data attributes used for component instance tracking
 */
const DATA_ATTRIBUTES = {
  ELEMENT_ID: 'data-element-id',
  COMPONENT_INSTANCE: 'data-component-instance',
  COMPONENT_MASTER: 'data-component-master',
  VARIANT_ID: 'data-variant-id',
  EDITABLE: 'data-editable',
  OVERRIDABLE: 'data-overridable',
} as const;

/**
 * Self-closing HTML tags that should not have children
 */
const SELF_CLOSING_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'area', 'base',
  'col', 'embed', 'param', 'source', 'track', 'wbr',
]);

// ============================================================
// Core Rendering Functions
// ============================================================

/**
 * Create a DOM element from a ComponentElement structure.
 * Recursively creates all child elements.
 *
 * @param element - The ComponentElement to render
 * @param doc - The Document to create elements in (defaults to window.document)
 * @returns The created HTMLElement
 */
export function createDOMElement(
  element: ComponentElement,
  doc: Document = document
): HTMLElement {
  // Debug logging
  debugLog('[createDOMElement] Creating:', {
    tagName: element.tagName,
    className: element.className,
    hasTextContent: !!element.textContent,
    textContentPreview: element.textContent?.substring(0, 50),
    childrenCount: element.children.length,
    stylesCount: Object.keys(element.styles).length,
    attributesCount: Object.keys(element.attributes).length,
  });

  // Create the base element
  // For SVG elements, use createElementNS
  const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'defs', 'use', 'text', 'tspan', 'image', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feBlend', 'feColorMatrix', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode']);
  const isSvgElement = SVG_TAGS.has(element.tagName.toLowerCase());

  const el = isSvgElement
    ? doc.createElementNS('http://www.w3.org/2000/svg', element.tagName) as unknown as HTMLElement
    : doc.createElement(element.tagName);

  // Set element ID
  el.setAttribute(DATA_ATTRIBUTES.ELEMENT_ID, element.id);

  // Apply class names
  if (element.className) {
    // For SVG elements, use setAttribute instead of className property
    if (isSvgElement) {
      el.setAttribute('class', element.className);
    } else {
      el.className = element.className;
    }
  }

  // Apply HTML attributes
  for (const [key, value] of Object.entries(element.attributes)) {
    if (value !== undefined && value !== null) {
      el.setAttribute(key, value);
    }
  }

  // Apply inline styles
  for (const [property, value] of Object.entries(element.styles)) {
    if (value !== undefined && value !== null) {
      // Convert camelCase to kebab-case for CSS property names
      const cssProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
      el.style.setProperty(cssProperty, value);
    }
  }

  // Handle content: innerHTML takes precedence, then textContent (if set), then children
  // Note: textContent being set explicitly (e.g., via override) takes precedence over children
  if (!SELF_CLOSING_TAGS.has(element.tagName.toLowerCase())) {
    if (element.innerHTML !== undefined) {
      // Use innerHTML for mixed content (text + elements)
      el.innerHTML = element.innerHTML;
      debugLog('[createDOMElement] Using innerHTML for mixed content');
    } else if (element.textContent !== undefined) {
      // textContent is explicitly set (possibly via override) - use it
      // This takes precedence over children, which is important for text overrides
      el.textContent = element.textContent;
      if (element.children.length > 0) {
        debugLog('[createDOMElement] textContent override replacing children structure');
      }
    } else {
      // Recursively create and append children
      for (const child of element.children) {
        const childEl = createDOMElement(child, doc);
        el.appendChild(childEl);
      }
    }
  }

  // Set display name as data attribute if provided
  if (element.displayName) {
    el.setAttribute('data-display-name', element.displayName);
  }

  // Set locked/hidden states
  if (element.locked) {
    el.setAttribute('data-locked', 'true');
  }
  if (element.hidden) {
    el.style.display = 'none';
    el.setAttribute('data-hidden', 'true');
  }

  // Mark as editable
  el.setAttribute(DATA_ATTRIBUTES.EDITABLE, 'true');

  // Store overridable properties as data attribute
  if (element.overridable) {
    const overridableTypes = Object.entries(element.overridable)
      .filter(([, enabled]) => enabled)
      .map(([type]) => type)
      .join(',');
    if (overridableTypes) {
      el.setAttribute(DATA_ATTRIBUTES.OVERRIDABLE, overridableTypes);
    }
  }

  debugLog('[createDOMElement] Created element:', el.tagName, 'with innerHTML length:', el.innerHTML.length);

  return el;
}

/**
 * Render a resolved ComponentElement to an HTMLElement.
 * This is the main entry point for rendering a component structure.
 *
 * @param element - The ComponentElement structure to render
 * @param doc - The Document to create elements in (defaults to window.document)
 * @returns The rendered HTMLElement
 */
export function renderComponentElement(
  element: ComponentElement,
  doc: Document = document
): HTMLElement {
  return createDOMElement(element, doc);
}

/**
 * Apply instance tracking data attributes to an element.
 *
 * @param el - The HTMLElement to modify
 * @param instance - The ComponentInstance being rendered
 * @param masterId - The master component ID
 */
function applyInstanceAttributes(
  el: HTMLElement,
  instance: ComponentInstance,
  masterId: string
): void {
  el.setAttribute(DATA_ATTRIBUTES.COMPONENT_INSTANCE, instance.id);
  el.setAttribute(DATA_ATTRIBUTES.COMPONENT_MASTER, masterId);
  el.setAttribute(DATA_ATTRIBUTES.VARIANT_ID, instance.variantId);
}

/**
 * Find an element in a ComponentElement tree by its ID.
 *
 * @param root - The root ComponentElement to search in
 * @param elementId - The ID to search for
 * @returns The found ComponentElement or null
 */
function findElementById(
  root: ComponentElement,
  elementId: string
): ComponentElement | null {
  if (root.id === elementId) {
    return root;
  }

  for (const child of root.children) {
    const found = findElementById(child, elementId);
    if (found) return found;
  }

  return null;
}

/**
 * Find an element in a ComponentElement tree by path.
 *
 * @param root - The root ComponentElement to search in
 * @param path - The path string (e.g., "children.0.children.1" or "root")
 * @returns The found ComponentElement or null
 */
function findElementByPath(
  root: ComponentElement,
  path: string
): ComponentElement | null {
  if (path === 'root') {
    return root;
  }

  const segments = path.split('.');
  let current: ComponentElement | undefined = root;

  for (let i = 0; i < segments.length; i += 2) {
    if (segments[i] !== 'children' || !current) {
      return null;
    }
    const index = parseInt(segments[i + 1], 10);
    if (isNaN(index) || index < 0 || index >= current.children.length) {
      return null;
    }
    current = current.children[index];
  }

  return current || null;
}

/**
 * Deep clone a ComponentElement structure, optionally preserving IDs.
 *
 * @param element - The element to clone
 * @param preserveIds - If true, preserve original IDs (for override resolution). If false, generate new IDs.
 * @param idPrefix - Optional prefix for generated IDs (only used when preserveIds is false)
 * @returns A deep clone of the element
 */
function deepCloneElement(
  element: ComponentElement,
  preserveIds: boolean = false,
  idPrefix: string = 'inst'
): ComponentElement {
  return {
    ...element,
    id: preserveIds ? element.id : generateElementId(idPrefix),
    attributes: { ...element.attributes },
    styles: { ...element.styles },
    overridable: { ...element.overridable },
    children: element.children.map((child) => deepCloneElement(child, preserveIds, idPrefix)),
  };
}

/**
 * Apply a single override to a ComponentElement.
 *
 * @param element - The element to modify (will be mutated)
 * @param override - The override to apply
 */
function applyOverride(
  element: ComponentElement,
  override: ComponentOverride
): void {
  switch (override.type) {
    case 'text':
      if (typeof override.value === 'string') {
        element.textContent = override.value;
      }
      break;

    case 'fill':
      if (typeof override.value === 'string') {
        element.styles.backgroundColor = override.value;
      }
      break;

    case 'stroke':
      if (typeof override.value === 'string') {
        element.styles.borderColor = override.value;
      }
      break;

    case 'visibility':
      if (typeof override.value === 'boolean') {
        element.hidden = !override.value;
      }
      break;

    case 'image':
      if (isImageOverrideValue(override.value)) {
        element.attributes.src = override.value.url;
        if (override.value.alt) {
          element.attributes.alt = override.value.alt;
        }
        if (override.value.objectFit) {
          element.styles.objectFit = override.value.objectFit;
        }
        if (override.value.objectPosition) {
          element.styles.objectPosition = override.value.objectPosition;
        }
      }
      break;

    case 'style':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        Object.assign(element.styles, override.value as Record<string, string>);
      }
      break;

    case 'attribute':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        Object.assign(element.attributes, override.value as Record<string, string>);
      }
      break;

    case 'children':
      if (Array.isArray(override.value)) {
        element.children = override.value as ComponentElement[];
      }
      break;

    case 'instanceSwap':
      // Instance swap is handled at a higher level
      // The value contains componentId and optionally variantId
      break;
  }
}

/**
 * Type guard for OverrideImageValue
 */
function isImageOverrideValue(value: unknown): value is OverrideImageValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    typeof (value as OverrideImageValue).url === 'string'
  );
}

/**
 * Resolve a component instance to a ComponentElement by applying all overrides.
 *
 * @param master - The master component definition
 * @param instance - The component instance with overrides
 * @returns A resolved ComponentElement with all overrides applied
 */
export function resolveInstance(
  master: MasterComponent,
  instance: ComponentInstance
): ComponentElement {
  // Find the variant
  const variant = master.variants.find((v) => v.id === instance.variantId);
  if (!variant) {
    throw new Error(
      `Variant "${instance.variantId}" not found in master component "${master.id}"`
    );
  }

  // Deep clone the variant's root element, preserving IDs for override resolution
  const resolved = deepCloneElement(variant.rootElement, true);

  // Apply overrides
  for (const override of instance.overrides) {
    // Find target element
    let targetElement: ComponentElement | null = null;

    if (override.targetElementId) {
      targetElement = findElementById(resolved, override.targetElementId);
    } else if (override.elementPath) {
      targetElement = findElementByPath(resolved, override.elementPath);
    }

    if (targetElement) {
      applyOverride(targetElement, override);
    } else {
      console.warn(
        `[resolveInstance] Target element not found for override: ${
          override.targetElementId || override.elementPath
        }`
      );
    }
  }

  return resolved;
}

/**
 * Render a component instance to an HTML element.
 *
 * @param master - The master component definition
 * @param instance - The component instance to render
 * @param doc - The Document to create elements in (defaults to window.document)
 * @returns The rendered HTMLElement
 */
export function renderInstance(
  master: MasterComponent,
  instance: ComponentInstance,
  doc: Document = document
): HTMLElement {
  debugLog('[renderInstance] Starting render:', {
    masterId: master.id,
    masterName: master.name,
    instanceId: instance.id,
    variantId: instance.variantId,
    variantsCount: master.variants.length,
  });

  // Log the master component's root element structure
  const defaultVariant = master.variants.find(v => v.id === instance.variantId);
  if (defaultVariant) {
    debugLog('[renderInstance] Variant rootElement:', {
      tagName: defaultVariant.rootElement.tagName,
      className: defaultVariant.rootElement.className,
      hasTextContent: !!defaultVariant.rootElement.textContent,
      childrenCount: defaultVariant.rootElement.children.length,
    });
  } else {
    console.error('[renderInstance] Variant not found:', instance.variantId);
  }

  // Resolve the instance to a ComponentElement
  const resolved = resolveInstance(master, instance);
  debugLog('[renderInstance] Resolved element:', {
    tagName: resolved.tagName,
    className: resolved.className,
    hasTextContent: !!resolved.textContent,
    childrenCount: resolved.children.length,
  });

  // Create the DOM element
  const el = createDOMElement(resolved, doc);

  // Apply instance tracking attributes to the root element
  applyInstanceAttributes(el, instance, master.id);

  // Set the DOM element ID
  el.setAttribute(DATA_ATTRIBUTES.ELEMENT_ID, instance.domElementId);

  // Apply position if specified
  if (instance.position) {
    el.style.position = 'absolute';
    el.style.left = `${instance.position.x}px`;
    el.style.top = `${instance.position.y}px`;
  }

  // Apply size override if specified
  if (instance.size) {
    el.style.width = `${instance.size.width}px`;
    el.style.height = `${instance.size.height}px`;
  }

  return el;
}

// ============================================================
// DOM Update Functions
// ============================================================

/**
 * Update an existing DOM element to reflect instance changes.
 * This is more efficient than re-rendering when only overrides change.
 *
 * @param el - The existing DOM element
 * @param master - The master component definition
 * @param instance - The updated component instance
 */
export function updateInstanceElement(
  el: HTMLElement,
  master: MasterComponent,
  instance: ComponentInstance
): void {
  // Update variant ID attribute
  el.setAttribute(DATA_ATTRIBUTES.VARIANT_ID, instance.variantId);

  // Find the variant
  const variant = master.variants.find((v) => v.id === instance.variantId);
  if (!variant) {
    console.error(
      `[updateInstanceElement] Variant "${instance.variantId}" not found`
    );
    return;
  }

  // Apply each override to the DOM
  for (const override of instance.overrides) {
    const targetId = override.targetElementId;
    if (!targetId) continue;

    // Find the target element in the DOM
    const targetEl = el.querySelector(
      `[${DATA_ATTRIBUTES.ELEMENT_ID}="${targetId}"]`
    ) as HTMLElement | null;

    if (!targetEl) {
      // Check if it's the root element itself
      if (el.getAttribute(DATA_ATTRIBUTES.ELEMENT_ID) === targetId) {
        applyOverrideToDOM(el, override);
      } else {
        console.warn(
          `[updateInstanceElement] Target element not found: ${targetId}`
        );
      }
      continue;
    }

    applyOverrideToDOM(targetEl, override);
  }

  // Update position if changed
  if (instance.position) {
    el.style.position = 'absolute';
    el.style.left = `${instance.position.x}px`;
    el.style.top = `${instance.position.y}px`;
  }

  // Update size if changed
  if (instance.size) {
    el.style.width = `${instance.size.width}px`;
    el.style.height = `${instance.size.height}px`;
  }
}

/**
 * Apply an override directly to a DOM element.
 *
 * @param el - The target DOM element
 * @param override - The override to apply
 */
function applyOverrideToDOM(el: HTMLElement, override: ComponentOverride): void {
  switch (override.type) {
    case 'text':
      if (typeof override.value === 'string') {
        el.textContent = override.value;
      }
      break;

    case 'fill':
      if (typeof override.value === 'string') {
        el.style.backgroundColor = override.value;
      }
      break;

    case 'stroke':
      if (typeof override.value === 'string') {
        el.style.borderColor = override.value;
      }
      break;

    case 'visibility':
      if (typeof override.value === 'boolean') {
        el.style.display = override.value ? '' : 'none';
        if (!override.value) {
          el.setAttribute('data-hidden', 'true');
        } else {
          el.removeAttribute('data-hidden');
        }
      }
      break;

    case 'image':
      if (isImageOverrideValue(override.value)) {
        el.setAttribute('src', override.value.url);
        if (override.value.alt) {
          el.setAttribute('alt', override.value.alt);
        }
        if (override.value.objectFit) {
          el.style.objectFit = override.value.objectFit;
        }
        if (override.value.objectPosition) {
          el.style.objectPosition = override.value.objectPosition;
        }
      }
      break;

    case 'style':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const styles = override.value as Record<string, string>;
        for (const [property, value] of Object.entries(styles)) {
          const cssProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
          el.style.setProperty(cssProperty, value);
        }
      }
      break;

    case 'attribute':
      if (typeof override.value === 'object' && !Array.isArray(override.value)) {
        const attrs = override.value as Record<string, string>;
        for (const [key, value] of Object.entries(attrs)) {
          el.setAttribute(key, value);
        }
      }
      break;

    case 'children':
      // Children replacement requires re-rendering
      console.warn(
        '[applyOverrideToDOM] Children override requires full re-render'
      );
      break;

    case 'instanceSwap':
      // Instance swap requires higher-level handling
      console.warn(
        '[applyOverrideToDOM] Instance swap override requires higher-level handling'
      );
      break;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Extract instance ID from a DOM element.
 *
 * @param el - The DOM element
 * @returns The instance ID or null if not found
 */
export function getInstanceIdFromElement(el: HTMLElement): string | null {
  return el.getAttribute(DATA_ATTRIBUTES.COMPONENT_INSTANCE);
}

/**
 * Extract master component ID from a DOM element.
 *
 * @param el - The DOM element
 * @returns The master component ID or null if not found
 */
export function getMasterIdFromElement(el: HTMLElement): string | null {
  return el.getAttribute(DATA_ATTRIBUTES.COMPONENT_MASTER);
}

/**
 * Extract variant ID from a DOM element.
 *
 * @param el - The DOM element
 * @returns The variant ID or null if not found
 */
export function getVariantIdFromElement(el: HTMLElement): string | null {
  return el.getAttribute(DATA_ATTRIBUTES.VARIANT_ID);
}

/**
 * Check if an element is a component instance.
 *
 * @param el - The DOM element to check
 * @returns True if the element is a component instance
 */
export function isComponentInstance(el: HTMLElement): boolean {
  return el.hasAttribute(DATA_ATTRIBUTES.COMPONENT_INSTANCE);
}

/**
 * Find all component instances in a document.
 *
 * @param doc - The Document to search in
 * @returns An array of elements that are component instances
 */
export function findAllComponentInstances(doc: Document): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll(`[${DATA_ATTRIBUTES.COMPONENT_INSTANCE}]`)
  ) as HTMLElement[];
}

/**
 * Find all instances of a specific master component in a document.
 *
 * @param doc - The Document to search in
 * @param masterId - The master component ID to search for
 * @returns An array of elements that are instances of the specified master
 */
export function findInstancesByMaster(
  doc: Document,
  masterId: string
): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll(
      `[${DATA_ATTRIBUTES.COMPONENT_MASTER}="${masterId}"]`
    )
  ) as HTMLElement[];
}
