'use client';

/**
 * EditorComponentsContext
 *
 * Manages the component system for the frontend editor.
 * Handles master components, instances, overrides, and variants.
 *
 * Features:
 * - Master component CRUD operations
 * - Instance management with DOM element ID mapping
 * - Override system for instance customization
 * - Variant switching
 * - Instance resolution (master + overrides -> final element)
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import type {
  MasterComponent,
  ComponentInstance,
  ComponentLibraryCategory,
  ComponentOverride,
  ComponentElement,
  ComponentVariant,
  EditorComponentsContextValue,
  OverridableProperties,
} from '../../types/editor-components';
import {
  saveMasterComponent as saveToFirestore,
  getAllMasterComponents,
  deleteMasterComponent as deleteFromFirestore,
  updateMasterComponent as updateMasterComponentInFirestore,
  saveComponentInstance,
  updateComponentInstance,
  deleteComponentInstance,
  getPageComponentInstances,
} from '../../lib/firebase/editor-components';

// ============================================================
// Context Creation
// ============================================================

const EditorComponentsContext =
  createContext<EditorComponentsContextValue | null>(null);

/**
 * Hook to access the EditorComponentsContext.
 * Must be used within an EditorComponentsProvider.
 */
export function useEditorComponents(): EditorComponentsContextValue {
  const context = useContext(EditorComponentsContext);
  if (!context) {
    throw new Error(
      'useEditorComponents must be used within EditorComponentsProvider'
    );
  }
  return context;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate a unique ID for components and instances.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Default overridable properties for component elements.
 */
const defaultOverridable: OverridableProperties = {
  text: true,
  fill: true,
  stroke: true,
  visibility: true,
  image: true,
};

/**
 * Position-related CSS properties that should be excluded from component root elements.
 * These are applied by instance placement instead.
 */
const POSITION_STYLES = new Set([
  'position', 'left', 'top', 'right', 'bottom',
  'transform', 'zIndex', 'z-index'
]);

/**
 * Convert an HTMLElement to a ComponentElement structure.
 * Exported for use in component editing mode.
 *
 * Handles three cases for content:
 * 1. Element has only text content (no child elements) -> uses textContent
 * 2. Element has only child elements (no text nodes) -> uses children array
 * 3. Element has mixed content (text + elements) -> uses innerHTML
 *
 * @param element - The HTML element to convert
 * @param isRoot - Whether this is the root element (default: true for first call)
 */
export function htmlElementToComponentElement(element: HTMLElement, isRoot: boolean = true): ComponentElement {
  // Preserve existing component element ID if present (for edit mode), otherwise generate new
  const existingId = element.getAttribute('data-element-id');
  const id = existingId || generateId();

  // Extract class name using getAttribute to handle SVG elements correctly
  // (element.className returns SVGAnimatedString for SVG elements)
  const className = element.getAttribute('class') || '';

  // Extract attributes (excluding class and style which are handled separately)
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name !== 'style' && attr.name !== 'class' && attr.name !== 'id' && !attr.name.startsWith('data-element') && !attr.name.startsWith('data-editable')) {
      attributes[attr.name] = attr.value;
    }
  }

  // Extract computed styles (only explicitly set ones)
  // For root element: exclude position-related styles (applied by instance placement)
  const styles: Record<string, string> = {};
  const inlineStyle = element.getAttribute('style');
  if (inlineStyle) {
    const stylePairs = inlineStyle.split(';').filter((s) => s.trim());
    for (const pair of stylePairs) {
      // Handle styles with colons in values (like url(data:...) or https://...)
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) continue;
      const key = pair.slice(0, colonIndex).trim();
      const value = pair.slice(colonIndex + 1).trim();
      if (key && value) {
        // Skip position-related styles for root element
        if (isRoot && POSITION_STYLES.has(key)) {
          console.log(`[htmlElementToComponentElement] Skipping position style for root: ${key}`);
          continue;
        }
        // Convert kebab-case to camelCase
        const camelKey = key.replace(/-([a-z])/g, (_, letter) =>
          letter.toUpperCase()
        );
        styles[camelKey] = value;
      }
    }
  }

  // Check for mixed content (text nodes + element nodes)
  const hasElementChildren = element.children.length > 0;
  const childNodes = Array.from(element.childNodes);
  const hasTextNodes = childNodes.some(
    node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  const hasMixedContent = hasElementChildren && hasTextNodes;

  let textContent: string | undefined;
  let innerHTML: string | undefined;
  let children: ComponentElement[] = [];

  if (hasMixedContent) {
    // Mixed content: use innerHTML to preserve all content
    innerHTML = element.innerHTML;
    console.log('[htmlElementToComponentElement] Mixed content detected, using innerHTML');
  } else if (hasElementChildren) {
    // Only element children: recursively process (not root)
    for (const child of Array.from(element.children)) {
      children.push(htmlElementToComponentElement(child as HTMLElement, false));
    }
  } else {
    // Only text content (or empty)
    textContent = element.textContent?.trim() || undefined;
  }

  const result: ComponentElement = {
    id,
    tagName: element.tagName.toLowerCase(),
    attributes,
    className,
    styles,
    textContent,
    innerHTML,
    children,
    overridable: { ...defaultOverridable },
  };

  // Debug logging
  console.log('[htmlElementToComponentElement] Converted:', {
    tagName: result.tagName,
    className: result.className,
    hasTextContent: !!result.textContent,
    hasInnerHTML: !!result.innerHTML,
    textContentPreview: result.textContent?.substring(0, 50),
    innerHTMLPreview: result.innerHTML?.substring(0, 50),
    childrenCount: result.children.length,
    stylesCount: Object.keys(result.styles).length,
  });

  return result;
}

/**
 * Deep clone a ComponentElement.
 */
function deepCloneElement(element: ComponentElement): ComponentElement {
  return {
    ...element,
    attributes: { ...element.attributes },
    styles: { ...element.styles },
    overridable: { ...element.overridable },
    children: element.children.map(deepCloneElement),
  };
}

/**
 * Get an element at a specific path within a ComponentElement tree.
 * Path format: "children.0.children.1" or "root" for the root element.
 */
function getElementAtPath(
  root: ComponentElement,
  path: string
): ComponentElement | null {
  if (path === 'root' || path === '') {
    return root;
  }

  const parts = path.split('.');
  let current: ComponentElement | undefined = root;

  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] !== 'children') {
      return null;
    }
    const index = parseInt(parts[i + 1], 10);
    if (isNaN(index) || !current?.children[index]) {
      return null;
    }
    current = current.children[index];
  }

  return current || null;
}

/**
 * Find element by ID in a ComponentElement tree.
 */
function findElementById(
  root: ComponentElement,
  targetId: string
): ComponentElement | null {
  if (root.id === targetId) {
    return root;
  }
  for (const child of root.children) {
    const found = findElementById(child, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Apply a single override to a ComponentElement tree.
 * Supports both path-based (elementPath) and ID-based (targetElementId) targeting.
 */
function applyOverrideToElement(
  root: ComponentElement,
  override: ComponentOverride
): void {
  // Find target element - support both elementPath and targetElementId
  let element: ComponentElement | null = null;

  if (override.elementPath) {
    element = getElementAtPath(root, override.elementPath);
  } else if (override.targetElementId) {
    element = findElementById(root, override.targetElementId);
  }

  if (!element) {
    console.warn(
      `[EditorComponentsContext] Override target not found: ${override.elementPath || override.targetElementId}`
    );
    return;
  }

  switch (override.type) {
    case 'text':
      element.textContent = override.value as string;
      break;

    case 'style':
      const styleOverrides = override.value as Record<string, string>;
      element.styles = { ...element.styles, ...styleOverrides };
      break;

    case 'attribute':
      const attrOverrides = override.value as Record<string, string>;
      element.attributes = { ...element.attributes, ...attrOverrides };
      break;

    case 'fill':
      // Fill is a style override for background-color
      element.styles = { ...element.styles, backgroundColor: override.value as string };
      break;

    case 'stroke':
      // Stroke is a style override for border-color
      element.styles = { ...element.styles, borderColor: override.value as string };
      break;

    case 'visibility':
      if (override.value === false) {
        element.styles = { ...element.styles, display: 'none' };
      } else {
        const { display, ...restStyles } = element.styles;
        element.styles = restStyles;
      }
      break;

    case 'children':
      element.children = override.value as ComponentElement[];
      break;

    case 'image':
      // Image override for img elements
      if (typeof override.value === 'object' && 'url' in override.value) {
        element.attributes = { ...element.attributes, src: (override.value as { url: string }).url };
      } else if (typeof override.value === 'string') {
        element.attributes = { ...element.attributes, src: override.value };
      }
      break;
  }
}

/**
 * Convert a ComponentElement back to an HTMLElement.
 */
function componentElementToHtml(
  element: ComponentElement,
  doc: Document = document
): HTMLElement {
  const el = doc.createElement(element.tagName);

  // Set ID
  el.id = element.id;

  // Set className
  if (element.className) {
    el.className = element.className;
  }

  // Set attributes
  for (const [key, value] of Object.entries(element.attributes)) {
    if (key !== 'id' && key !== 'class') {
      el.setAttribute(key, value);
    }
  }

  // Set styles
  const styleString = Object.entries(element.styles)
    .map(([key, value]) => {
      // Convert camelCase to kebab-case
      const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${kebabKey}: ${value}`;
    })
    .join('; ');
  if (styleString) {
    el.setAttribute('style', styleString);
  }

  // Set text content or children
  if (element.textContent !== undefined && element.children.length === 0) {
    el.textContent = element.textContent;
  } else {
    for (const child of element.children) {
      el.appendChild(componentElementToHtml(child, doc));
    }
  }

  return el;
}

// ============================================================
// Provider Props
// ============================================================

interface EditorComponentsProviderProps {
  children: React.ReactNode;
  websiteId?: string;
  pageId?: string;
}

// ============================================================
// Provider Component
// ============================================================

export function EditorComponentsProvider({
  children,
  websiteId,
  pageId,
}: EditorComponentsProviderProps) {
  // State
  const [masterComponents, setMasterComponents] = useState<
    Map<string, MasterComponent>
  >(new Map());
  const [componentInstances, setComponentInstances] = useState<
    Map<string, ComponentInstance>
  >(new Map());
  const [componentLibrary, setComponentLibrary] = useState<
    ComponentLibraryCategory[]
  >([]);
  const [isLoadingComponents, setIsLoadingComponents] = useState(false);
  const [selectedMasterComponentId, setSelectedMasterComponentId] = useState<
    string | null
  >(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingNavigationTarget, setPendingNavigationTarget] = useState<string | null>(null);

  // ============================================================
  // Navigation
  // ============================================================

  /**
   * Request to navigate to a master component.
   * This sets a pending navigation target that FrontendVisualEditor will observe
   * to open the component panel and select the specified master.
   */
  const navigateToMasterComponent = useCallback((masterComponentId: string) => {
    setPendingNavigationTarget(masterComponentId);
  }, []);

  /**
   * Clear the pending navigation request.
   * Called by FrontendVisualEditor after handling the navigation.
   */
  const clearNavigationRequest = useCallback(() => {
    setPendingNavigationTarget(null);
  }, []);

  // ============================================================
  // Loading
  // ============================================================

  // Default categories
  // [移植時の修正] 汎用Web向け(Layout/Navigation/Form…)から、提案書スライドの
  // デザイン部品(src/lib/design-parts.ts が登録する chrome2 の構成要素)に合わせたカテゴリへ変更。
  const defaultCategories: ComponentLibraryCategory[] = useMemo(() => [
    {
      id: 'structure',
      name: 'ページ構成',
      description: 'ヘッダー・考察帯など、ページの骨格をつくる要素',
      icon: 'layout',
      color: '#0b6b3a',
      order: 1,
      componentIds: [],
    },
    {
      id: 'block',
      name: 'ブロック',
      description: 'パネル・キーポイントなど、情報をまとめる要素',
      icon: 'file-text',
      color: '#3b82f6',
      order: 2,
      componentIds: [],
    },
    {
      id: 'data',
      name: 'データ表現',
      description: '数値・定義リストなど、根拠を見せる要素',
      icon: 'bar-chart',
      color: '#f59e0b',
      order: 3,
      componentIds: [],
    },
    {
      id: 'label',
      name: 'ラベル',
      description: 'チップなどの区分ラベル',
      icon: 'tag',
      color: '#8b5cf6',
      order: 4,
      componentIds: [],
    },
    {
      id: 'media',
      name: 'メディア',
      description: '画像・図版',
      icon: 'image',
      color: '#ef4444',
      order: 5,
      componentIds: [],
    },
  ], []);

  const loadComponents = useCallback(async (targetWebsiteId: string) => {
    setIsLoadingComponents(true);
    setError(null);
    try {
      console.log(
        `[EditorComponentsContext] Loading components for website: ${targetWebsiteId}`
      );

      // Load master components from Firestore
      const components = await getAllMasterComponents(targetWebsiteId);
      console.log(`[EditorComponentsContext] Loaded ${components.length} components`);

      // Create Map from components
      const componentsMap = new Map<string, MasterComponent>();
      for (const component of components) {
        componentsMap.set(component.id, component);
      }
      setMasterComponents(componentsMap);

      // Build component library with loaded components
      const categoryMap = new Map<string, string[]>();
      for (const component of components) {
        const categoryId = component.categoryId;
        if (!categoryMap.has(categoryId)) {
          categoryMap.set(categoryId, []);
        }
        categoryMap.get(categoryId)!.push(component.id);
      }

      // Update categories with loaded component IDs
      const updatedCategories = defaultCategories.map((cat) => ({
        ...cat,
        componentIds: categoryMap.get(cat.id) || [],
      }));
      setComponentLibrary(updatedCategories);

      setComponentInstances(new Map());
    } catch (err) {
      console.error('[EditorComponentsContext] Failed to load components:', err);
      setError(err instanceof Error ? err.message : 'Failed to load components');
      // Still set default categories even on error
      setComponentLibrary(defaultCategories);
    } finally {
      setIsLoadingComponents(false);
    }
  }, [defaultCategories]);

  // Initialize on mount or when websiteId changes
  const loadedWebsiteIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only load if websiteId exists and is different from the last loaded one
    if (websiteId && websiteId !== loadedWebsiteIdRef.current) {
      loadedWebsiteIdRef.current = websiteId;
      loadComponents(websiteId);
    } else if (!websiteId) {
      // Reset to default categories if no websiteId
      setComponentLibrary(defaultCategories);
      setMasterComponents(new Map());
      loadedWebsiteIdRef.current = null;
    }
  }, [websiteId, loadComponents, defaultCategories]);

  // Load instances when pageId changes
  const loadedPageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!websiteId || !pageId) {
      setComponentInstances(new Map());
      loadedPageIdRef.current = null;
      return;
    }

    // Only load if pageId is different from last loaded
    if (pageId === loadedPageIdRef.current) {
      return;
    }

    loadedPageIdRef.current = pageId;

    const loadInstances = async () => {
      try {
        console.log(`[EditorComponentsContext] Loading instances for page: ${pageId}`);
        const instances = await getPageComponentInstances(websiteId, pageId);
        console.log(`[EditorComponentsContext] Loaded ${instances.length} instances`);

        // Create Map from instances (keyed by domElementId)
        const instancesMap = new Map<string, ComponentInstance>();
        for (const instance of instances) {
          instancesMap.set(instance.domElementId, instance);
        }
        setComponentInstances(instancesMap);
      } catch (err) {
        console.error('[EditorComponentsContext] Failed to load instances:', err);
        setError(err instanceof Error ? err.message : 'Failed to load instances');
      }
    };

    loadInstances();
  }, [websiteId, pageId]);

  // ============================================================
  // Master Component Operations
  // ============================================================

  const createMasterComponent = useCallback(
    (element: HTMLElement, name: string, categoryId: string): MasterComponent => {
      const id = generateId();
      const now = new Date().toISOString();

      // Convert HTML element to component element
      const rootElement = htmlElementToComponentElement(element);

      // Create default variant
      const defaultVariant: ComponentVariant = {
        id: generateId(),
        name: 'Default',
        description: 'Default variant',
        rootElement,
        isDefault: true,
      };

      const masterComponent: MasterComponent = {
        id,
        name,
        categoryId,
        tags: [],
        variants: [defaultVariant],
        defaultVariantId: defaultVariant.id,
        exposedProperties: [],
        createdAt: now,
        updatedAt: now,
        websiteId: websiteId || '',
        version: 1,
      };

      setMasterComponents((prev) => {
        const next = new Map(prev);
        next.set(id, masterComponent);
        return next;
      });

      // Add to category
      setComponentLibrary((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? { ...cat, componentIds: [...cat.componentIds, id] }
            : cat
        )
      );

      // Save to Firestore asynchronously
      if (websiteId) {
        saveToFirestore(websiteId, masterComponent).catch((err) => {
          console.error('[EditorComponentsContext] Failed to save component to Firestore:', err);
          setError('Failed to save component');
        });
      }

      console.log(
        `[EditorComponentsContext] Created master component: ${name} (${id})`
      );
      return masterComponent;
    },
    [websiteId]
  );

  const updateMasterComponent = useCallback(
    (id: string, updates: Partial<MasterComponent>) => {
      setMasterComponents((prev) => {
        const component = prev.get(id);
        if (!component) {
          console.warn(
            `[EditorComponentsContext] Master component not found: ${id}`
          );
          return prev;
        }

        const updatedComponent = {
          ...component,
          ...updates,
          updatedAt: new Date().toISOString(),
          version: component.version + 1,
        };

        const next = new Map(prev);
        next.set(id, updatedComponent);

        // Save to Firestore asynchronously
        if (websiteId) {
          updateMasterComponentInFirestore(websiteId, id, updates).catch((err) => {
            console.error('[EditorComponentsContext] Failed to update component in Firestore:', err);
            setError('Failed to save component changes');
          });
        }

        return next;
      });
    },
    [websiteId]
  );

  const deleteMasterComponent = useCallback((id: string) => {
    setMasterComponents((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    // Remove from category
    setComponentLibrary((prev) =>
      prev.map((cat) => ({
        ...cat,
        componentIds: cat.componentIds.filter((cid) => cid !== id),
      }))
    );

    // Delete all instances of this master
    setComponentInstances((prev) => {
      const next = new Map(prev);
      for (const [instanceId, instance] of prev) {
        if (instance.masterComponentId === id) {
          next.delete(instanceId);
        }
      }
      return next;
    });

    // Delete from Firestore asynchronously
    if (websiteId) {
      deleteFromFirestore(websiteId, id).catch((err) => {
        console.error('[EditorComponentsContext] Failed to delete component from Firestore:', err);
      });
    }

    console.log(`[EditorComponentsContext] Deleted master component: ${id}`);
  }, [websiteId]);

  const getMasterComponent = useCallback(
    (id: string): MasterComponent | null => {
      return masterComponents.get(id) || null;
    },
    [masterComponents]
  );

  // ============================================================
  // Instance Operations
  // ============================================================

  const createInstance = useCallback(
    (
      masterComponentId: string,
      variantId?: string,
      instancePageId?: string,
      /** Optional: pass the master component directly if it's not yet in state */
      providedMaster?: MasterComponent,
      /** Optional: specify domElementId (for duplication) */
      customDomElementId?: string,
      /** Optional: initial overrides to copy (for duplication) */
      initialOverrides?: ComponentOverride[],
      /** Optional: initial property values to copy (for duplication) */
      initialPropertyValues?: Record<string, string | number | boolean>,
      /** Optional: initial position for the instance */
      initialPosition?: { x: number; y: number },
      /** Optional: initial size for the instance */
      initialSize?: { width: number; height: number }
    ): ComponentInstance => {
      const master = providedMaster || masterComponents.get(masterComponentId);
      if (!master) {
        throw new Error(
          `Master component not found: ${masterComponentId}`
        );
      }

      const id = generateId();
      const domElementId = customDomElementId || `component-instance-${id}`;
      const now = new Date().toISOString();
      const effectivePageId = instancePageId || pageId;

      const instance: ComponentInstance = {
        id,
        masterComponentId,
        variantId: variantId || master.defaultVariantId,
        domElementId,
        overrides: initialOverrides ? [...initialOverrides] : [],
        propertyValues: initialPropertyValues ? { ...initialPropertyValues } : {},
        isDetached: false,
        pageId: effectivePageId,
        position: initialPosition,
        size: initialSize,
        createdAt: now,
        updatedAt: now,
      };

      setComponentInstances((prev) => {
        const next = new Map(prev);
        next.set(domElementId, instance);
        return next;
      });

      // Save to Firestore asynchronously
      if (websiteId && effectivePageId) {
        saveComponentInstance(websiteId, effectivePageId, instance).catch((err) => {
          console.error('[EditorComponentsContext] Failed to save instance to Firestore:', err);
          setError('Failed to save component instance');
        });
      }

      console.log(
        `[EditorComponentsContext] Created instance: ${id} of master ${masterComponentId}`
      );
      return instance;
    },
    [masterComponents, websiteId, pageId]
  );

  const updateInstance = useCallback(
    (instanceId: string, updates: Partial<ComponentInstance>) => {
      setComponentInstances((prev) => {
        // Find instance by ID (not domElementId)
        let targetKey: string | null = null;
        let foundInstance: ComponentInstance | null = null;
        for (const [key, instance] of prev) {
          if (instance.id === instanceId) {
            targetKey = key;
            foundInstance = instance;
            break;
          }
        }

        if (!targetKey || !foundInstance) {
          console.warn(
            `[EditorComponentsContext] Instance not found: ${instanceId}`
          );
          return prev;
        }

        const updatedInstance = {
          ...foundInstance,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const next = new Map(prev);
        next.set(targetKey, updatedInstance);

        // Save to Firestore asynchronously
        const instancePageId = updatedInstance.pageId || pageId;
        if (websiteId && instancePageId) {
          updateComponentInstance(websiteId, instancePageId, instanceId, updates).catch((err) => {
            console.error('[EditorComponentsContext] Failed to update instance in Firestore:', err);
            setError('Failed to save instance changes');
          });
        }

        return next;
      });
    },
    [websiteId, pageId]
  );

  const deleteInstance = useCallback((instanceId: string) => {
    setComponentInstances((prev) => {
      // Find instance by ID
      let targetKey: string | null = null;
      let foundInstance: ComponentInstance | null = null;
      for (const [key, instance] of prev) {
        if (instance.id === instanceId) {
          targetKey = key;
          foundInstance = instance;
          break;
        }
      }

      if (!targetKey || !foundInstance) {
        console.warn(
          `[EditorComponentsContext] Instance not found for deletion: ${instanceId}`
        );
        return prev;
      }

      const next = new Map(prev);
      next.delete(targetKey);

      // Delete from Firestore asynchronously
      const instancePageId = foundInstance.pageId || pageId;
      if (websiteId && instancePageId) {
        deleteComponentInstance(websiteId, instancePageId, instanceId).catch((err) => {
          console.error('[EditorComponentsContext] Failed to delete instance from Firestore:', err);
          setError('Failed to delete component instance');
        });
      }

      return next;
    });

    console.log(`[EditorComponentsContext] Deleted instance: ${instanceId}`);
  }, [websiteId, pageId]);

  const getInstanceByDomId = useCallback(
    (domElementId: string): ComponentInstance | null => {
      return componentInstances.get(domElementId) || null;
    },
    [componentInstances]
  );

  // ============================================================
  // Override Operations
  // ============================================================

  const addOverride = useCallback(
    (instanceId: string, override: Omit<ComponentOverride, 'id'>) => {
      const newOverride: ComponentOverride = {
        ...override,
        id: generateId(),
      };

      setComponentInstances((prev) => {
        // Find instance by ID
        let targetKey: string | null = null;
        let foundInstance: ComponentInstance | null = null;
        for (const [key, instance] of prev) {
          if (instance.id === instanceId) {
            targetKey = key;
            foundInstance = instance;
            break;
          }
        }

        if (!targetKey || !foundInstance) {
          console.warn(
            `[EditorComponentsContext] Instance not found for override: ${instanceId}`
          );
          return prev;
        }

        const newOverrides = [...foundInstance.overrides, newOverride];
        const updatedInstance = {
          ...foundInstance,
          overrides: newOverrides,
          updatedAt: new Date().toISOString(),
        };

        const next = new Map(prev);
        next.set(targetKey, updatedInstance);

        // Save to Firestore asynchronously
        const instancePageId = foundInstance.pageId || pageId;
        if (websiteId && instancePageId) {
          updateComponentInstance(websiteId, instancePageId, instanceId, { overrides: newOverrides }).catch((err) => {
            console.error('[EditorComponentsContext] Failed to save override to Firestore:', err);
            setError('Failed to save override');
          });
        }

        return next;
      });

      console.log(
        `[EditorComponentsContext] Added override to instance: ${instanceId}`
      );
    },
    [websiteId, pageId]
  );

  const removeOverride = useCallback(
    (instanceId: string, overrideId: string) => {
      setComponentInstances((prev) => {
        // Find instance by ID
        let targetKey: string | null = null;
        let foundInstance: ComponentInstance | null = null;
        for (const [key, instance] of prev) {
          if (instance.id === instanceId) {
            targetKey = key;
            foundInstance = instance;
            break;
          }
        }

        if (!targetKey || !foundInstance) {
          console.warn(
            `[EditorComponentsContext] Instance not found for override removal: ${instanceId}`
          );
          return prev;
        }

        const newOverrides = foundInstance.overrides.filter((o) => o.id !== overrideId);
        const updatedInstance = {
          ...foundInstance,
          overrides: newOverrides,
          updatedAt: new Date().toISOString(),
        };

        const next = new Map(prev);
        next.set(targetKey, updatedInstance);

        // Save to Firestore asynchronously
        const instancePageId = foundInstance.pageId || pageId;
        if (websiteId && instancePageId) {
          updateComponentInstance(websiteId, instancePageId, instanceId, { overrides: newOverrides }).catch((err) => {
            console.error('[EditorComponentsContext] Failed to remove override in Firestore:', err);
            setError('Failed to remove override');
          });
        }

        return next;
      });

      console.log(
        `[EditorComponentsContext] Removed override ${overrideId} from instance: ${instanceId}`
      );
    },
    [websiteId, pageId]
  );

  const resetAllOverrides = useCallback((instanceId: string) => {
    setComponentInstances((prev) => {
      // Find instance by ID
      let targetKey: string | null = null;
      let foundInstance: ComponentInstance | null = null;
      for (const [key, instance] of prev) {
        if (instance.id === instanceId) {
          targetKey = key;
          foundInstance = instance;
          break;
        }
      }

      if (!targetKey || !foundInstance) {
        console.warn(
          `[EditorComponentsContext] Instance not found for reset: ${instanceId}`
        );
        return prev;
      }

      const updatedInstance = {
        ...foundInstance,
        overrides: [],
        propertyValues: {},
        updatedAt: new Date().toISOString(),
      };

      const next = new Map(prev);
      next.set(targetKey, updatedInstance);

      // Save to Firestore asynchronously
      const instancePageId = foundInstance.pageId || pageId;
      if (websiteId && instancePageId) {
        updateComponentInstance(websiteId, instancePageId, instanceId, {
          overrides: [],
          propertyValues: {}
        }).catch((err) => {
          console.error('[EditorComponentsContext] Failed to reset overrides in Firestore:', err);
          setError('Failed to reset overrides');
        });
      }

      return next;
    });

    console.log(
      `[EditorComponentsContext] Reset all overrides for instance: ${instanceId}`
    );
  }, [websiteId, pageId]);

  // ============================================================
  // Variant Operations
  // ============================================================

  const changeVariant = useCallback(
    (instanceId: string, variantId: string) => {
      setComponentInstances((prev) => {
        // Find instance by ID
        let targetKey: string | null = null;
        let foundInstance: ComponentInstance | null = null;
        for (const [key, instance] of prev) {
          if (instance.id === instanceId) {
            targetKey = key;
            foundInstance = instance;
            break;
          }
        }

        if (!targetKey || !foundInstance) {
          console.warn(
            `[EditorComponentsContext] Instance not found for variant change: ${instanceId}`
          );
          return prev;
        }

        // Verify variant exists in master
        const master = masterComponents.get(foundInstance.masterComponentId);
        if (!master) {
          console.warn(
            `[EditorComponentsContext] Master component not found: ${foundInstance.masterComponentId}`
          );
          return prev;
        }

        const variantExists = master.variants.some((v) => v.id === variantId);
        if (!variantExists) {
          console.warn(
            `[EditorComponentsContext] Variant not found: ${variantId}`
          );
          return prev;
        }

        const updatedInstance = {
          ...foundInstance,
          variantId,
          // Reset overrides when changing variants (optional, could be configurable)
          overrides: [],
          updatedAt: new Date().toISOString(),
        };

        const next = new Map(prev);
        next.set(targetKey, updatedInstance);

        // Save to Firestore asynchronously
        const instancePageId = foundInstance.pageId || pageId;
        if (websiteId && instancePageId) {
          updateComponentInstance(websiteId, instancePageId, instanceId, {
            variantId,
            overrides: []
          }).catch((err) => {
            console.error('[EditorComponentsContext] Failed to change variant in Firestore:', err);
            setError('Failed to change variant');
          });
        }

        return next;
      });

      console.log(
        `[EditorComponentsContext] Changed variant for instance ${instanceId} to ${variantId}`
      );
    },
    [masterComponents, websiteId, pageId]
  );

  // ============================================================
  // Detach Operation
  // ============================================================

  const detachInstance = useCallback(
    (instanceId: string): HTMLElement => {
      // Find instance
      let instance: ComponentInstance | null = null;
      let targetKey: string | null = null;
      for (const [key, inst] of componentInstances) {
        if (inst.id === instanceId) {
          instance = inst;
          targetKey = key;
          break;
        }
      }

      if (!instance || !targetKey) {
        throw new Error(`Instance not found: ${instanceId}`);
      }

      // Get master component
      const master = masterComponents.get(instance.masterComponentId);
      if (!master) {
        throw new Error(
          `Master component not found: ${instance.masterComponentId}`
        );
      }

      // Resolve the instance to get the final element
      const resolved = resolveInstance(master, instance);

      // Convert to HTMLElement
      const htmlElement = componentElementToHtml(resolved);

      // Mark instance as detached
      setComponentInstances((prev) => {
        const next = new Map(prev);
        next.set(targetKey!, {
          ...instance!,
          isDetached: true,
          updatedAt: new Date().toISOString(),
        });
        return next;
      });

      // Save to Firestore asynchronously
      const instancePageId = instance.pageId || pageId;
      if (websiteId && instancePageId) {
        updateComponentInstance(websiteId, instancePageId, instanceId, {
          isDetached: true
        }).catch((err) => {
          console.error('[EditorComponentsContext] Failed to detach instance in Firestore:', err);
          setError('Failed to detach instance');
        });
      }

      console.log(
        `[EditorComponentsContext] Detached instance: ${instanceId}`
      );
      return htmlElement;
    },
    [componentInstances, masterComponents, websiteId, pageId]
  );

  // ============================================================
  // Resolution
  // ============================================================

  const resolveInstance = useCallback(
    (master: MasterComponent, instance: ComponentInstance): ComponentElement => {
      // Find the variant
      const variant = master.variants.find((v) => v.id === instance.variantId);
      if (!variant) {
        console.warn(
          `[EditorComponentsContext] Variant not found: ${instance.variantId}, using default`
        );
        const defaultVariant = master.variants.find(
          (v) => v.id === master.defaultVariantId
        );
        if (!defaultVariant) {
          throw new Error(
            `No variants found for master component: ${master.id}`
          );
        }
        return deepCloneElement(defaultVariant.rootElement);
      }

      // Deep clone the variant's root element
      const resolved = deepCloneElement(variant.rootElement);

      // Set the instance's DOM element ID
      resolved.id = instance.domElementId;

      // Add data attribute to identify as component instance
      resolved.attributes['data-component-instance'] = instance.id;
      resolved.attributes['data-component-master'] = master.id;

      // Apply all overrides
      for (const override of instance.overrides) {
        applyOverrideToElement(resolved, override);
      }

      return resolved;
    },
    []
  );

  // ============================================================
  // Context Value
  // ============================================================

  const value: EditorComponentsContextValue = useMemo(
    () => ({
      // State
      masterComponents,
      componentInstances,
      componentLibrary,
      isLoadingComponents,
      selectedMasterComponentId,
      selectedInstanceId,
      error,
      pendingNavigationTarget,

      // Actions
      loadComponents,
      createMasterComponent,
      updateMasterComponent,
      deleteMasterComponent,
      getMasterComponent,
      createInstance,
      updateInstance,
      deleteInstance,
      getInstanceByDomId,
      addOverride,
      removeOverride,
      resetAllOverrides,
      changeVariant,
      detachInstance,
      resolveInstance,
      navigateToMasterComponent,
      clearNavigationRequest,
    }),
    [
      masterComponents,
      componentInstances,
      componentLibrary,
      isLoadingComponents,
      selectedMasterComponentId,
      selectedInstanceId,
      error,
      pendingNavigationTarget,
      loadComponents,
      createMasterComponent,
      updateMasterComponent,
      deleteMasterComponent,
      getMasterComponent,
      createInstance,
      updateInstance,
      deleteInstance,
      getInstanceByDomId,
      addOverride,
      removeOverride,
      resetAllOverrides,
      changeVariant,
      detachInstance,
      resolveInstance,
      navigateToMasterComponent,
      clearNavigationRequest,
    ]
  );

  return (
    <EditorComponentsContext.Provider value={value}>
      {children}
    </EditorComponentsContext.Provider>
  );
}

export default EditorComponentsContext;
