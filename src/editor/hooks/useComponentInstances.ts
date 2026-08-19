'use client';

/**
 * useComponentInstances Hook
 *
 * Manages component instances on a page, including loading from Firestore,
 * creating/updating/deleting instances, and syncing with the DOM.
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import type {
  ComponentInstance,
  ComponentOverride,
  MasterComponent,
} from '../../types/editor-components';
import {
  getPageComponentInstances,
  saveComponentInstance,
  updateComponentInstance,
  deleteComponentInstance,
  getMasterComponent,
} from '../../lib/firebase/editor-components';
import {
  renderInstance,
  updateInstanceElement,
  getInstanceIdFromElement,
  getMasterIdFromElement,
} from '../utils/component-renderer';
import { generateElementId } from '../utils/dom-utils';

// ============================================================
// Types
// ============================================================

export interface UseComponentInstancesOptions {
  /** Auto-load instances on mount */
  autoLoad?: boolean;
  /** Callback when instances change */
  onInstancesChange?: (instances: ComponentInstance[]) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseComponentInstancesReturn {
  /** Array of component instances on the page */
  instances: ComponentInstance[];
  /** Whether instances are currently loading */
  isLoading: boolean;
  /** Error if any occurred during operations */
  error: Error | null;
  /** Create a new component instance */
  createInstance: (
    masterComponentId: string,
    position: { x: number; y: number },
    variantId?: string
  ) => Promise<ComponentInstance>;
  /** Delete a component instance */
  deleteInstance: (instanceId: string) => Promise<void>;
  /** Update a component instance */
  updateInstance: (
    instanceId: string,
    updates: Partial<ComponentInstance>
  ) => Promise<void>;
  /** Render an instance to the DOM */
  renderInstanceToDOM: (
    instance: ComponentInstance,
    container: HTMLElement
  ) => Promise<HTMLElement | null>;
  /** Refresh instances from Firestore */
  refreshInstances: () => Promise<void>;
  /** Get an instance by ID */
  getInstance: (instanceId: string) => ComponentInstance | undefined;
  /** Get an instance by DOM element ID */
  getInstanceByDomId: (domElementId: string) => ComponentInstance | undefined;
  /** Add an override to an instance */
  addOverride: (
    instanceId: string,
    override: Omit<ComponentOverride, 'id'>
  ) => Promise<void>;
  /** Remove an override from an instance */
  removeOverride: (instanceId: string, overrideId: string) => Promise<void>;
  /** Reset all overrides on an instance */
  resetAllOverrides: (instanceId: string) => Promise<void>;
  /** Change the variant of an instance */
  changeVariant: (instanceId: string, variantId: string) => Promise<void>;
  /** Detach an instance from its master (makes it independent) */
  detachInstance: (instanceId: string) => Promise<void>;
}

// ============================================================
// Hook Implementation
// ============================================================

/**
 * Hook for managing component instances on a page.
 *
 * @param websiteId - The website ID
 * @param pageId - The page ID
 * @param options - Optional configuration
 * @returns Instance management functions and state
 */
export function useComponentInstances(
  websiteId: string,
  pageId: string,
  options: UseComponentInstancesOptions = {}
): UseComponentInstancesReturn {
  const { autoLoad = true, onInstancesChange, onError } = options;

  // State
  const [instances, setInstances] = useState<ComponentInstance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Cache for master components
  const masterComponentsCache = useRef<Map<string, MasterComponent>>(new Map());

  // ============================================================
  // Helper Functions
  // ============================================================

  /**
   * Get a master component, using cache if available.
   */
  const fetchMasterComponent = useCallback(
    async (masterComponentId: string): Promise<MasterComponent | null> => {
      // Check cache first
      const cached = masterComponentsCache.current.get(masterComponentId);
      if (cached) {
        return cached;
      }

      try {
        const master = await getMasterComponent(websiteId, masterComponentId);
        if (master) {
          masterComponentsCache.current.set(masterComponentId, master);
        }
        return master;
      } catch (err) {
        console.error(
          `[useComponentInstances] Error fetching master component: ${masterComponentId}`,
          err
        );
        return null;
      }
    },
    [websiteId]
  );

  /**
   * Handle errors consistently.
   */
  const handleError = useCallback(
    (err: unknown, context: string) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[useComponentInstances] ${context}:`, error);
      setError(error);
      onError?.(error);
    },
    [onError]
  );

  /**
   * Update instances state and notify listeners.
   */
  const updateInstancesState = useCallback(
    (newInstances: ComponentInstance[]) => {
      setInstances(newInstances);
      onInstancesChange?.(newInstances);
    },
    [onInstancesChange]
  );

  // ============================================================
  // Core Operations
  // ============================================================

  /**
   * Load instances from Firestore.
   */
  const refreshInstances = useCallback(async () => {
    if (!websiteId || !pageId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const loadedInstances = await getPageComponentInstances(websiteId, pageId);
      updateInstancesState(loadedInstances);
    } catch (err) {
      handleError(err, 'Error loading instances');
    } finally {
      setIsLoading(false);
    }
  }, [websiteId, pageId, updateInstancesState, handleError]);

  /**
   * Create a new component instance.
   */
  const createInstance = useCallback(
    async (
      masterComponentId: string,
      position: { x: number; y: number },
      variantId?: string
    ): Promise<ComponentInstance> => {
      // Fetch master component to get default variant
      const master = await fetchMasterComponent(masterComponentId);
      if (!master) {
        throw new Error(
          `Master component not found: ${masterComponentId}`
        );
      }

      const now = new Date().toISOString();
      const instanceId = generateElementId('inst');
      const domElementId = generateElementId('dom');

      const newInstance: ComponentInstance = {
        id: instanceId,
        masterComponentId,
        variantId: variantId || master.defaultVariantId,
        domElementId,
        overrides: [],
        propertyValues: {},
        position,
        pageId,
        createdAt: now,
        updatedAt: now,
      };

      // Set default property values from exposed properties
      for (const prop of master.exposedProperties) {
        newInstance.propertyValues[prop.id] = prop.defaultValue;
      }

      try {
        // Save to Firestore
        await saveComponentInstance(websiteId, pageId, newInstance);

        // Update local state
        const newInstances = [...instances, newInstance];
        updateInstancesState(newInstances);

        return newInstance;
      } catch (err) {
        handleError(err, 'Error creating instance');
        throw err;
      }
    },
    [
      websiteId,
      pageId,
      instances,
      fetchMasterComponent,
      updateInstancesState,
      handleError,
    ]
  );

  /**
   * Delete a component instance.
   */
  const deleteInstanceFn = useCallback(
    async (instanceId: string): Promise<void> => {
      try {
        // Delete from Firestore
        await deleteComponentInstance(websiteId, pageId, instanceId);

        // Update local state
        const newInstances = instances.filter((i) => i.id !== instanceId);
        updateInstancesState(newInstances);
      } catch (err) {
        handleError(err, 'Error deleting instance');
        throw err;
      }
    },
    [websiteId, pageId, instances, updateInstancesState, handleError]
  );

  /**
   * Update a component instance.
   */
  const updateInstanceFn = useCallback(
    async (
      instanceId: string,
      updates: Partial<ComponentInstance>
    ): Promise<void> => {
      try {
        // Update in Firestore
        await updateComponentInstance(websiteId, pageId, instanceId, updates);

        // Update local state
        const newInstances = instances.map((i) =>
          i.id === instanceId
            ? { ...i, ...updates, updatedAt: new Date().toISOString() }
            : i
        );
        updateInstancesState(newInstances);
      } catch (err) {
        handleError(err, 'Error updating instance');
        throw err;
      }
    },
    [websiteId, pageId, instances, updateInstancesState, handleError]
  );

  /**
   * Render an instance to the DOM.
   */
  const renderInstanceToDOM = useCallback(
    async (
      instance: ComponentInstance,
      container: HTMLElement
    ): Promise<HTMLElement | null> => {
      try {
        const master = await fetchMasterComponent(instance.masterComponentId);
        if (!master) {
          console.error(
            `[useComponentInstances] Master component not found: ${instance.masterComponentId}`
          );
          return null;
        }

        // Get the document from the container
        const doc = container.ownerDocument;

        // Render the instance
        const el = renderInstance(master, instance, doc);

        // Append to container
        container.appendChild(el);

        return el;
      } catch (err) {
        handleError(err, 'Error rendering instance to DOM');
        return null;
      }
    },
    [fetchMasterComponent, handleError]
  );

  /**
   * Get an instance by ID.
   */
  const getInstance = useCallback(
    (instanceId: string): ComponentInstance | undefined => {
      return instances.find((i) => i.id === instanceId);
    },
    [instances]
  );

  /**
   * Get an instance by DOM element ID.
   */
  const getInstanceByDomId = useCallback(
    (domElementId: string): ComponentInstance | undefined => {
      return instances.find((i) => i.domElementId === domElementId);
    },
    [instances]
  );

  // ============================================================
  // Override Operations
  // ============================================================

  /**
   * Add an override to an instance.
   */
  const addOverride = useCallback(
    async (
      instanceId: string,
      override: Omit<ComponentOverride, 'id'>
    ): Promise<void> => {
      const instance = instances.find((i) => i.id === instanceId);
      if (!instance) {
        throw new Error(`Instance not found: ${instanceId}`);
      }

      const newOverride: ComponentOverride = {
        ...override,
        id: generateElementId('ovr'),
      };

      // Check if there's an existing override for the same target and type
      const existingIndex = instance.overrides.findIndex(
        (o) =>
          (o.targetElementId === newOverride.targetElementId ||
            o.elementPath === newOverride.elementPath) &&
          o.type === newOverride.type
      );

      let newOverrides: ComponentOverride[];
      if (existingIndex >= 0) {
        // Replace existing override
        newOverrides = [...instance.overrides];
        newOverrides[existingIndex] = newOverride;
      } else {
        // Add new override
        newOverrides = [...instance.overrides, newOverride];
      }

      await updateInstanceFn(instanceId, { overrides: newOverrides });
    },
    [instances, updateInstanceFn]
  );

  /**
   * Remove an override from an instance.
   */
  const removeOverride = useCallback(
    async (instanceId: string, overrideId: string): Promise<void> => {
      const instance = instances.find((i) => i.id === instanceId);
      if (!instance) {
        throw new Error(`Instance not found: ${instanceId}`);
      }

      const newOverrides = instance.overrides.filter((o) => o.id !== overrideId);
      await updateInstanceFn(instanceId, { overrides: newOverrides });
    },
    [instances, updateInstanceFn]
  );

  /**
   * Reset all overrides on an instance.
   */
  const resetAllOverrides = useCallback(
    async (instanceId: string): Promise<void> => {
      await updateInstanceFn(instanceId, { overrides: [] });
    },
    [updateInstanceFn]
  );

  /**
   * Change the variant of an instance.
   */
  const changeVariant = useCallback(
    async (instanceId: string, variantId: string): Promise<void> => {
      const instance = instances.find((i) => i.id === instanceId);
      if (!instance) {
        throw new Error(`Instance not found: ${instanceId}`);
      }

      // Fetch master to validate variant exists
      const master = await fetchMasterComponent(instance.masterComponentId);
      if (!master) {
        throw new Error(
          `Master component not found: ${instance.masterComponentId}`
        );
      }

      const variant = master.variants.find((v) => v.id === variantId);
      if (!variant) {
        throw new Error(
          `Variant not found: ${variantId} in master ${master.id}`
        );
      }

      await updateInstanceFn(instanceId, { variantId });
    },
    [instances, fetchMasterComponent, updateInstanceFn]
  );

  /**
   * Detach an instance from its master.
   */
  const detachInstance = useCallback(
    async (instanceId: string): Promise<void> => {
      await updateInstanceFn(instanceId, { isDetached: true });
    },
    [updateInstanceFn]
  );

  // ============================================================
  // Effects
  // ============================================================

  /**
   * Auto-load instances on mount if enabled.
   */
  useEffect(() => {
    if (autoLoad && websiteId && pageId) {
      refreshInstances();
    }
  }, [autoLoad, websiteId, pageId, refreshInstances]);

  /**
   * Clear cache when websiteId changes.
   */
  useEffect(() => {
    masterComponentsCache.current.clear();
  }, [websiteId]);

  // ============================================================
  // Return
  // ============================================================

  return {
    instances,
    isLoading,
    error,
    createInstance,
    deleteInstance: deleteInstanceFn,
    updateInstance: updateInstanceFn,
    renderInstanceToDOM,
    refreshInstances,
    getInstance,
    getInstanceByDomId,
    addOverride,
    removeOverride,
    resetAllOverrides,
    changeVariant,
    detachInstance,
  };
}
