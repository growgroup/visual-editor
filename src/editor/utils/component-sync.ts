/**
 * Component Sync Utilities
 *
 * Utilities for synchronizing master component changes to instances.
 * Handles propagation of master updates, override validation, and instance reconciliation.
 */

import type {
  ComponentElement,
  ComponentInstance,
  ComponentOverride,
  MasterComponent,
  OverrideType,
} from '../../types/editor-components';
import {
  renderInstance,
  findInstancesByMaster,
  getInstanceIdFromElement,
  resolveInstance,
} from './component-renderer';
import { detectOverrides } from './override-detection';

// ============================================================
// Types
// ============================================================

/**
 * Result of an override validation check.
 */
export interface OverrideValidationResult {
  /** Whether the override is valid */
  isValid: boolean;
  /** Reason for invalidity if not valid */
  reason?: string;
  /** Suggested action to fix the issue */
  suggestion?: 'remove' | 'update' | 'keep';
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /** Number of instances successfully updated */
  updatedCount: number;
  /** Number of instances that failed to update */
  failedCount: number;
  /** Instance IDs that failed to update */
  failedInstanceIds: string[];
  /** Errors encountered during sync */
  errors: Array<{ instanceId: string; error: Error }>;
  /** Instances updated with newly detected overrides (for persistence) */
  updatedInstances: ComponentInstance[];
}

// ============================================================
// Override Validation
// ============================================================

/**
 * Find an element in a ComponentElement tree by ID.
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
 * Check if an override type is allowed for an element based on its overridable properties.
 */
function isOverrideTypeAllowed(
  element: ComponentElement,
  overrideType: OverrideType
): boolean {
  const { overridable } = element;

  switch (overrideType) {
    case 'text':
      return overridable.text;
    case 'fill':
      return overridable.fill;
    case 'stroke':
      return overridable.stroke;
    case 'visibility':
      return overridable.visibility;
    case 'image':
      return overridable.image;
    case 'style':
    case 'attribute':
    case 'children':
    case 'instanceSwap':
      // These override types are generally allowed
      return true;
    default:
      return false;
  }
}

/**
 * Check if a single override is still valid after a master component update.
 *
 * @param override - The override to validate
 * @param master - The updated master component
 * @param variantId - The variant ID the instance is using
 * @returns Validation result with details
 */
export function isOverrideValid(
  override: ComponentOverride,
  master: MasterComponent,
  variantId: string = master.defaultVariantId
): OverrideValidationResult {
  // Find the variant
  const variant = master.variants.find((v) => v.id === variantId);
  if (!variant) {
    return {
      isValid: false,
      reason: `Variant "${variantId}" no longer exists in master`,
      suggestion: 'remove',
    };
  }

  // Find the target element
  let targetElement: ComponentElement | null = null;

  if (override.targetElementId) {
    targetElement = findElementById(variant.rootElement, override.targetElementId);
    if (!targetElement) {
      return {
        isValid: false,
        reason: `Target element "${override.targetElementId}" no longer exists in master`,
        suggestion: 'remove',
      };
    }
  } else if (override.elementPath) {
    targetElement = findElementByPath(variant.rootElement, override.elementPath);
    if (!targetElement) {
      return {
        isValid: false,
        reason: `Target path "${override.elementPath}" no longer valid in master`,
        suggestion: 'remove',
      };
    }
  } else {
    return {
      isValid: false,
      reason: 'Override has no target (neither elementId nor path)',
      suggestion: 'remove',
    };
  }

  // Check if the override type is allowed
  if (!isOverrideTypeAllowed(targetElement, override.type)) {
    return {
      isValid: false,
      reason: `Override type "${override.type}" is no longer allowed on target element`,
      suggestion: 'remove',
    };
  }

  // Validate override value based on type
  switch (override.type) {
    case 'text':
      if (typeof override.value !== 'string') {
        return {
          isValid: false,
          reason: 'Text override value must be a string',
          suggestion: 'update',
        };
      }
      break;

    case 'fill':
    case 'stroke':
      if (typeof override.value !== 'string') {
        return {
          isValid: false,
          reason: 'Color override value must be a string',
          suggestion: 'update',
        };
      }
      break;

    case 'visibility':
      if (typeof override.value !== 'boolean') {
        return {
          isValid: false,
          reason: 'Visibility override value must be a boolean',
          suggestion: 'update',
        };
      }
      break;

    case 'image':
      if (
        typeof override.value !== 'object' ||
        !override.value ||
        !('url' in override.value)
      ) {
        return {
          isValid: false,
          reason: 'Image override value must be an object with url property',
          suggestion: 'update',
        };
      }
      break;

    case 'style':
    case 'attribute':
      if (
        typeof override.value !== 'object' ||
        Array.isArray(override.value) ||
        override.value === null
      ) {
        return {
          isValid: false,
          reason: `${override.type} override value must be a key-value object`,
          suggestion: 'update',
        };
      }
      break;

    case 'children':
      if (!Array.isArray(override.value)) {
        return {
          isValid: false,
          reason: 'Children override value must be an array',
          suggestion: 'update',
        };
      }
      break;

    case 'instanceSwap':
      if (
        typeof override.value !== 'object' ||
        !override.value ||
        !('componentId' in override.value)
      ) {
        return {
          isValid: false,
          reason: 'Instance swap override value must have componentId',
          suggestion: 'update',
        };
      }
      break;
  }

  return { isValid: true };
}

/**
 * Filter overrides to only those compatible with the new master component.
 *
 * @param overrides - The overrides to filter
 * @param master - The updated master component
 * @param variantId - The variant ID to validate against
 * @returns Array of valid overrides
 */
export function filterCompatibleOverrides(
  overrides: ComponentOverride[],
  master: MasterComponent,
  variantId: string = master.defaultVariantId
): ComponentOverride[] {
  return overrides.filter((override) => {
    const result = isOverrideValid(override, master, variantId);
    if (!result.isValid) {
      console.warn(
        `[filterCompatibleOverrides] Removing invalid override: ${result.reason}`,
        override
      );
    }
    return result.isValid;
  });
}

/**
 * Validate all overrides on an instance and return detailed results.
 *
 * @param instance - The component instance
 * @param master - The master component
 * @returns Array of validation results for each override
 */
export function validateInstanceOverrides(
  instance: ComponentInstance,
  master: MasterComponent
): Array<{ override: ComponentOverride; result: OverrideValidationResult }> {
  return instance.overrides.map((override) => ({
    override,
    result: isOverrideValid(override, master, instance.variantId),
  }));
}

// ============================================================
// Master Change Propagation
// ============================================================

/**
 * Propagate changes from a master component to all linked instances in a document.
 *
 * This function:
 * 1. Finds all DOM elements that are instances of the master
 * 2. Re-renders each instance with the updated master
 * 3. Preserves valid overrides while removing incompatible ones
 *
 * @param master - The updated master component
 * @param instances - Array of component instances to update
 * @param iframeDoc - The iframe document containing the instances
 * @returns Sync result with statistics
 */
export function propagateMasterChanges(
  master: MasterComponent,
  instances: ComponentInstance[],
  iframeDoc: Document
): SyncResult {
  const result: SyncResult = {
    updatedCount: 0,
    failedCount: 0,
    failedInstanceIds: [],
    errors: [],
    updatedInstances: [],
  };

  // Find all DOM elements for this master
  const domElements = findInstancesByMaster(iframeDoc, master.id);

  console.log('[propagateMasterChanges] Found DOM elements for master:', {
    masterId: master.id,
    domElementsCount: domElements.length,
  });

  // Create a map for quick lookup
  const domElementMap = new Map<string, HTMLElement>();
  for (const el of domElements) {
    const instanceId = getInstanceIdFromElement(el);
    console.log('[propagateMasterChanges] DOM element instanceId:', instanceId);
    if (instanceId) {
      domElementMap.set(instanceId, el);
    }
  }

  console.log('[propagateMasterChanges] Processing instances:', {
    totalInstances: instances.length,
    instanceIds: instances.map(i => i.id),
    domMapKeys: Array.from(domElementMap.keys()),
  });

  // Process each instance
  for (const instance of instances) {
    // Skip detached instances
    if (instance.isDetached) {
      console.log('[propagateMasterChanges] Skipping detached instance:', instance.id);
      continue;
    }

    // Skip instances for other masters
    if (instance.masterComponentId !== master.id) {
      console.log('[propagateMasterChanges] Skipping instance for other master:', instance.id);
      continue;
    }

    try {
      // Find the DOM element
      const domEl = domElementMap.get(instance.id);
      if (!domEl) {
        // Instance not in DOM, skip
        console.log('[propagateMasterChanges] DOM element not found for instance:', instance.id);
        continue;
      }

      console.log('[propagateMasterChanges] Found DOM element for instance:', instance.id);

      // Validate variant still exists
      let variantId = instance.variantId;
      const variant = master.variants.find((v) => v.id === variantId);
      if (!variant) {
        // Variant was removed, fall back to default
        console.warn(
          `[propagateMasterChanges] Variant "${instance.variantId}" removed, using default`
        );
        variantId = master.defaultVariantId;
      }

      // CRITICAL: Detect DOM-level overrides BEFORE re-rendering
      // This captures any user edits that haven't been saved as overrides yet
      const effectiveVariant = master.variants.find((v) => v.id === variantId);
      let detectedOverrides: ComponentOverride[] = [];
      if (effectiveVariant) {
        // Debug: Log what we're comparing
        console.log('[propagateMasterChanges] === Override Detection Debug ===');
        console.log('[propagateMasterChanges] DOM element:', {
          tagName: domEl.tagName,
          elementId: domEl.getAttribute('data-element-id'),
          textContent: domEl.textContent?.substring(0, 100),
          innerHTML: domEl.innerHTML?.substring(0, 200),
          childrenCount: domEl.children.length,
        });
        console.log('[propagateMasterChanges] Master rootElement:', {
          tagName: effectiveVariant.rootElement.tagName,
          id: effectiveVariant.rootElement.id,
          textContent: effectiveVariant.rootElement.textContent?.substring(0, 100),
          innerHTML: effectiveVariant.rootElement.innerHTML?.substring(0, 200),
          childrenCount: effectiveVariant.rootElement.children.length,
          hasChildren: effectiveVariant.rootElement.children.length > 0,
        });

        try {
          detectedOverrides = detectOverrides(domEl, effectiveVariant.rootElement);
          console.log('[propagateMasterChanges] Detected DOM overrides:', {
            instanceId: instance.id,
            count: detectedOverrides.length,
            overrides: detectedOverrides.map(o => ({
              type: o.type,
              targetElementId: o.targetElementId,
              value: typeof o.value === 'string' ? o.value.substring(0, 50) : o.value,
            })),
          });
        } catch (e) {
          console.warn('[propagateMasterChanges] Failed to detect DOM overrides:', e);
        }
      }

      // Merge: existing stored overrides + newly detected DOM overrides
      // Detected overrides take precedence (they are the current state)
      const existingOverrides = filterCompatibleOverrides(
        instance.overrides,
        master,
        variantId
      );

      // Create a map of existing overrides by target+type for merging
      const overrideMap = new Map<string, ComponentOverride>();
      for (const override of existingOverrides) {
        const key = `${override.targetElementId || override.elementPath}-${override.type}`;
        overrideMap.set(key, override);
      }
      // Detected overrides take precedence
      for (const override of detectedOverrides) {
        const key = `${override.targetElementId || override.elementPath}-${override.type}`;
        overrideMap.set(key, override);
      }
      const mergedOverrides = Array.from(overrideMap.values());

      console.log('[propagateMasterChanges] Merged overrides:', {
        instanceId: instance.id,
        existing: existingOverrides.length,
        detected: detectedOverrides.length,
        merged: mergedOverrides.length,
      });

      // Create a temporary instance with merged overrides for rendering
      const updatedInstance: ComponentInstance = {
        ...instance,
        variantId,
        overrides: mergedOverrides,
      };

      // Collect unique ID mappings from old element before replacing
      // (for duplicated instances that have data-master-element-id attributes)
      const idMappings = new Map<string, string>();
      const collectIdMappings = (el: HTMLElement) => {
        const masterRefId = el.getAttribute('data-master-element-id');
        const uniqueId = el.getAttribute('data-element-id');
        if (masterRefId && uniqueId) {
          idMappings.set(masterRefId, uniqueId);
        }
        // Recursively collect from children
        el.querySelectorAll('[data-master-element-id]').forEach((child) => {
          const childMasterRefId = child.getAttribute('data-master-element-id');
          const childUniqueId = child.getAttribute('data-element-id');
          if (childMasterRefId && childUniqueId) {
            idMappings.set(childMasterRefId, childUniqueId);
          }
        });
      };
      collectIdMappings(domEl);

      // Re-render the instance
      const newEl = renderInstance(master, updatedInstance, iframeDoc);

      // Apply unique ID mappings to the new element
      // This preserves unique IDs for duplicated instances
      if (idMappings.size > 0) {
        const applyIdMappings = (el: HTMLElement) => {
          const currentId = el.getAttribute('data-element-id');
          if (currentId && idMappings.has(currentId)) {
            const uniqueId = idMappings.get(currentId)!;
            el.setAttribute('data-master-element-id', currentId);
            el.setAttribute('data-element-id', uniqueId);
          }
          // Recursively apply to children
          el.querySelectorAll('[data-element-id]').forEach((child) => {
            const childEl = child as HTMLElement;
            const childCurrentId = childEl.getAttribute('data-element-id');
            if (childCurrentId && idMappings.has(childCurrentId)) {
              const childUniqueId = idMappings.get(childCurrentId)!;
              childEl.setAttribute('data-master-element-id', childCurrentId);
              childEl.setAttribute('data-element-id', childUniqueId);
            }
          });
        };
        applyIdMappings(newEl);
        console.log('[propagateMasterChanges] Applied ID mappings for duplicated instance:', {
          instanceId: instance.id,
          mappingsCount: idMappings.size,
        });
      }

      // Preserve position from existing DOM element
      // The DOM element may have position styles that aren't in the instance data
      // (e.g., user moved the element but didn't save)
      const existingStyle = domEl.getAttribute('style');
      if (existingStyle) {
        // Extract position-related styles from existing element
        const positionProps = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height'];
        const styleObj: Record<string, string> = {};

        existingStyle.split(';').forEach(pair => {
          const [prop, value] = pair.split(':').map(s => s.trim());
          if (prop && value && positionProps.includes(prop)) {
            styleObj[prop] = value;
          }
        });

        // Apply preserved position styles to new element
        for (const [prop, value] of Object.entries(styleObj)) {
          newEl.style.setProperty(prop, value);
        }

        console.log('[propagateMasterChanges] Preserved position styles:', {
          instanceId: instance.id,
          preservedStyles: styleObj,
        });
      }

      // Replace the old element with the new one
      domEl.parentNode?.replaceChild(newEl, domEl);

      // Store the updated instance for persistence (with merged overrides)
      result.updatedInstances.push(updatedInstance);
      result.updatedCount++;
    } catch (error) {
      result.failedCount++;
      result.failedInstanceIds.push(instance.id);
      result.errors.push({
        instanceId: instance.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  console.log(
    `[propagateMasterChanges] Updated ${result.updatedCount} instances, failed ${result.failedCount}`
  );

  return result;
}

/**
 * Reconcile instances after a master component update.
 * Returns updated instances with filtered overrides.
 *
 * @param master - The updated master component
 * @param instances - Array of instances to reconcile
 * @returns Array of reconciled instances with valid overrides
 */
export function reconcileInstances(
  master: MasterComponent,
  instances: ComponentInstance[]
): ComponentInstance[] {
  return instances.map((instance) => {
    // Skip detached instances
    if (instance.isDetached) {
      return instance;
    }

    // Skip instances for other masters
    if (instance.masterComponentId !== master.id) {
      return instance;
    }

    // Check if variant still exists
    let variantId = instance.variantId;
    const variant = master.variants.find((v) => v.id === variantId);
    if (!variant) {
      // Fall back to default variant
      variantId = master.defaultVariantId;
    }

    // Filter overrides
    const validOverrides = filterCompatibleOverrides(
      instance.overrides,
      master,
      variantId
    );

    // Return updated instance if changes were made
    if (
      variantId !== instance.variantId ||
      validOverrides.length !== instance.overrides.length
    ) {
      return {
        ...instance,
        variantId,
        overrides: validOverrides,
        updatedAt: new Date().toISOString(),
      };
    }

    return instance;
  });
}

// ============================================================
// Instance Comparison
// ============================================================

/**
 * Check if an instance has diverged from its master (has overrides).
 *
 * @param instance - The instance to check
 * @returns True if the instance has any overrides
 */
export function hasOverrides(instance: ComponentInstance): boolean {
  return instance.overrides.length > 0;
}

/**
 * Get the effective property values for an instance,
 * combining master defaults with instance overrides.
 *
 * @param instance - The component instance
 * @param master - The master component
 * @returns Combined property values
 */
export function getEffectivePropertyValues(
  instance: ComponentInstance,
  master: MasterComponent
): Record<string, string | number | boolean> {
  // Start with master defaults
  const defaults: Record<string, string | number | boolean> = {};
  for (const prop of master.exposedProperties) {
    defaults[prop.id] = prop.defaultValue;
  }

  // Merge with instance values
  return {
    ...defaults,
    ...instance.propertyValues,
  };
}

// ============================================================
// Batch Operations
// ============================================================

/**
 * Update multiple instances in a document at once.
 * More efficient than updating one at a time.
 *
 * @param master - The master component
 * @param instances - Array of instances to update
 * @param iframeDoc - The iframe document
 * @param updateFn - Function to apply updates to each instance
 * @returns Sync result
 */
export function batchUpdateInstances(
  master: MasterComponent,
  instances: ComponentInstance[],
  iframeDoc: Document,
  updateFn: (instance: ComponentInstance) => ComponentInstance
): SyncResult {
  // Apply updates to all instances first
  const updatedInstances = instances.map(updateFn);

  // Then propagate to DOM
  return propagateMasterChanges(master, updatedInstances, iframeDoc);
}

/**
 * Find all instances that would be affected by a master change.
 *
 * @param masterId - The master component ID
 * @param instances - All instances to search
 * @returns Array of affected instances
 */
export function findAffectedInstances(
  masterId: string,
  instances: ComponentInstance[]
): ComponentInstance[] {
  return instances.filter(
    (instance) =>
      instance.masterComponentId === masterId && !instance.isDetached
  );
}

// ============================================================
// Override Creation Helpers
// ============================================================

/**
 * Create a text override for an element.
 *
 * @param targetElementId - The target element ID
 * @param text - The new text content
 * @returns A ComponentOverride object (without id)
 */
export function createTextOverride(
  targetElementId: string,
  text: string
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'text',
    value: text,
  };
}

/**
 * Create a fill (background) override for an element.
 *
 * @param targetElementId - The target element ID
 * @param color - The new background color
 * @returns A ComponentOverride object (without id)
 */
export function createFillOverride(
  targetElementId: string,
  color: string
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'fill',
    value: color,
  };
}

/**
 * Create a stroke (border) override for an element.
 *
 * @param targetElementId - The target element ID
 * @param color - The new border color
 * @returns A ComponentOverride object (without id)
 */
export function createStrokeOverride(
  targetElementId: string,
  color: string
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'stroke',
    value: color,
  };
}

/**
 * Create a visibility override for an element.
 *
 * @param targetElementId - The target element ID
 * @param visible - Whether the element should be visible
 * @returns A ComponentOverride object (without id)
 */
export function createVisibilityOverride(
  targetElementId: string,
  visible: boolean
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'visibility',
    value: visible,
  };
}

/**
 * Create an image override for an element.
 *
 * @param targetElementId - The target element ID
 * @param url - The new image URL
 * @param alt - Optional alt text
 * @returns A ComponentOverride object (without id)
 */
export function createImageOverride(
  targetElementId: string,
  url: string,
  alt?: string
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'image',
    value: { url, alt },
  };
}

/**
 * Create a style override for an element.
 *
 * @param targetElementId - The target element ID
 * @param styles - The style properties to override
 * @returns A ComponentOverride object (without id)
 */
export function createStyleOverride(
  targetElementId: string,
  styles: Record<string, string>
): Omit<ComponentOverride, 'id'> {
  return {
    targetElementId,
    type: 'style',
    value: styles,
  };
}
