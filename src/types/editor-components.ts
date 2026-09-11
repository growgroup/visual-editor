/**
 * Editor Components Types - Figma-like component system type definitions
 *
 * This module defines the type system for a Figma-inspired component architecture
 * supporting master components, variants, instances, and overrides.
 *
 * NOTE: All dates use ISO 8601 strings for portability across contexts.
 * Firestore Timestamps are converted on read/write operations.
 */

import type { EditorPartDef } from '../io';

// =============================================================================
// 1. Overridable Properties
// =============================================================================

/**
 * Defines which properties of an element can be overridden in instances.
 * Maps to Figma's overridable properties concept.
 */
export interface OverridableProperties {
  /** Allow text content changes */
  text: boolean;
  /** Allow fill/background color changes */
  fill: boolean;
  /** Allow stroke/border changes */
  stroke: boolean;
  /** Allow visibility toggling */
  visibility: boolean;
  /** Allow image source replacement */
  image: boolean;
}

// =============================================================================
// 2. ComponentElement - Element structure
// =============================================================================

/**
 * Component element structure representing a node in the component tree.
 * Similar to Figma's layer structure with nested children.
 */
export interface ComponentElement {
  /** Unique identifier for this element within the component */
  id: string;
  /** HTML tag name (div, span, button, img, etc.) */
  tagName: string;
  /** HTML attributes (data-*, aria-*, role, href, src, etc.) */
  attributes: Record<string, string>;
  /** CSS class names (space-separated string or empty) */
  className: string;
  /** Text content (for text nodes, undefined for containers) */
  textContent?: string;
  /**
   * Raw innerHTML for elements with mixed content (text + elements).
   * When set, this takes precedence over children array.
   * Used to preserve complex content that can't be represented as a tree.
   */
  innerHTML?: string;
  /** Nested child elements */
  children: ComponentElement[];
  /** Specifies which properties can be overridden in instances */
  overridable: OverridableProperties;
  /**
   * Inline styles as key-value pairs (camelCase keys).
   * @example { backgroundColor: 'red', fontSize: '16px' }
   */
  styles: Record<string, string>;
  /** Element display name for layers panel */
  displayName?: string;
  /** Whether this element is locked from editing */
  locked?: boolean;
  /** Whether this element is hidden in the editor */
  hidden?: boolean;
}

// =============================================================================
// 3. VariantProperty - Variant property definition
// =============================================================================

/**
 * Defines a variant property dimension (e.g., "Size", "State", "Theme").
 * Similar to Figma's variant properties that define the axes of variation.
 */
export interface VariantProperty {
  /** Unique identifier for this property */
  id: string;
  /** Display name of the property (e.g., "Size", "State") */
  name: string;
  /** Possible values for this property (e.g., ["small", "medium", "large"]) */
  values: string[];
  /** Default value when creating new instances */
  defaultValue: string;
}

// =============================================================================
// 4. VariantDefinition - Specific variant
// =============================================================================

/**
 * Defines a specific variant combination with its element tree.
 * Each variant represents a unique combination of property values.
 */
export interface VariantDefinition {
  /** Unique identifier for this variant */
  id: string;
  /** Display name for this variant */
  name: string;
  /** Property values that define this variant (e.g., { size: "large", state: "hover" }) */
  propertyValues?: Record<string, string>;
  /** Root element tree for this variant (can differ from master) */
  rootElement: ComponentElement;
  /** Optional description for this variant */
  description?: string;
  /** Optional thumbnail URL for preview */
  thumbnailUrl?: string;
  /** Whether this is the default variant */
  isDefault?: boolean;
}

/**
 * Alias for VariantDefinition - used by context for clarity.
 * Represents a variant of a component with its visual representation.
 */
export type ComponentVariant = VariantDefinition;

// =============================================================================
// 5. ComponentPropertyType - Property type enum
// =============================================================================

/**
 * Types of component properties that can be exposed for configuration.
 * Mirrors Figma's component property types.
 */
export type ComponentPropertyType =
  | 'boolean'      // Toggle property (show/hide, enabled/disabled)
  | 'text'         // Text content property
  | 'instanceSwap' // Swap nested component instance
  | 'variant';     // Change variant selection

// =============================================================================
// 6. ComponentProperty - Property definition
// =============================================================================

/**
 * Defines an exposed component property that users can configure.
 * Properties provide a structured way to customize component instances.
 */
export interface ComponentProperty {
  /** Unique identifier for this property */
  id: string;
  /** Display name of the property */
  name: string;
  /** Type of property */
  type: ComponentPropertyType;
  /** Default value (type depends on property type) */
  defaultValue: string | boolean;
  /** Element IDs that this property affects */
  targetElementIds: string[];
  /** For instanceSwap type: IDs of components allowed for swapping */
  allowedComponentIds?: string[];
  /** Optional description for documentation */
  description?: string;
  /** Property group for organization in the UI */
  group?: string;
  /** Whether this property is required */
  required?: boolean;
}

/**
 * Alias for ComponentProperty - exposed properties that users can configure.
 * Used by context and firebase for clarity.
 */
export type ExposedProperty = ComponentProperty;

// =============================================================================
// 7. ComponentInstance - Instance reference
// =============================================================================

/**
 * Represents an instance of a master component placed in the editor.
 * Instances reference their master and can have local overrides.
 */
export interface ComponentInstance {
  /**
   * Unique identifier for this instance.
   * Note: Use `id` as the primary identifier. `instanceId` is deprecated alias.
   */
  id: string;
  /** Reference to the master component ID */
  masterComponentId: string;
  /** Currently selected variant ID */
  variantId: string;
  /** Overrides applied to this instance */
  overrides: ComponentOverride[];
  /** Current property values (key is property ID) */
  propertyValues: Record<string, string | number | boolean>;
  /** ID of the DOM element representing this instance */
  domElementId: string;
  /** Position within the canvas (optional) */
  position?: {
    x: number;
    y: number;
  };
  /** Size override if different from master (optional) */
  size?: {
    width: number;
    height: number;
  };
  /** Instance name for layers panel (optional) */
  name?: string;
  /** Whether this instance is detached from master */
  isDetached?: boolean;
  /** ISO 8601 timestamp when instance was created */
  createdAt?: string;
  /** ISO 8601 timestamp when instance was last updated */
  updatedAt?: string;
  /** Page ID where this instance exists */
  pageId?: string;
}

// =============================================================================
// 8. ComponentOverride - Single override
// =============================================================================

/**
 * Represents a single override applied to a component instance.
 * Overrides allow instances to diverge from their master component.
 */
export interface ComponentOverride {
  /** Unique identifier for this override */
  id: string;
  /**
   * ID of the target element within the component tree.
   * Use this for direct element ID reference.
   */
  targetElementId?: string;
  /**
   * Path to the target element (e.g., "children.0.children.1" or "root").
   * Alternative to targetElementId for path-based targeting.
   */
  elementPath?: string;
  /** Type of override being applied */
  type: OverrideType;
  /** Override value (type depends on override type) */
  value: string | boolean | Record<string, string> | ComponentElement[] | OverrideImageValue | OverrideInstanceSwapValue;
  /** Path to nested elements for deeply nested overrides (optional) */
  nestedPath?: string[];
  /** Description of this override (optional) */
  description?: string;
}

// =============================================================================
// 9. OverrideType - Override type enum
// =============================================================================

/**
 * Types of overrides that can be applied to instances.
 * Each type corresponds to a different aspect of the element that can be changed.
 */
export type OverrideType =
  | 'text'         // Text content override
  | 'fill'         // Fill/background color override
  | 'stroke'       // Stroke/border override
  | 'visibility'   // Show/hide override
  | 'image'        // Image source override
  | 'style'        // CSS style overrides (Record<string, string>)
  | 'attribute'    // HTML attribute overrides (Record<string, string>)
  | 'children'     // Replace children (ComponentElement[])
  | 'instanceSwap'; // Nested component swap override

// =============================================================================
// 10. ComponentCategory - Library structure
// =============================================================================

/**
 * Represents a category in the component library for organization.
 * Supports nested subcategories for hierarchical organization.
 */
export interface ComponentCategory {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /**
   * Component IDs directly in this category.
   * Use `componentIds` for consistency with context usage.
   */
  componentIds: string[];
  /** Nested subcategories (optional) */
  subcategories?: ComponentCategory[];
  /** Icon name for the category (optional) */
  icon?: string;
  /** Category color for visual distinction (optional) */
  color?: string;
  /** Sort order within parent (optional) */
  order?: number;
  /** Description of the category (optional) */
  description?: string;
  /** Parent category ID if nested (optional) */
  parentId?: string;
}

// =============================================================================
// 1. MasterComponent - Master component definition (main type)
// =============================================================================

/**
 * Master component definition - the source of truth for a component.
 * Similar to Figma's main component that instances are derived from.
 */
export interface MasterComponent {
  /** Unique identifier */
  id: string;
  /** Component name */
  name: string;
  /** Component description (optional) */
  description?: string;
  /**
   * Category ID for organization (e.g., "buttons", "cards", "navigation").
   * References a ComponentCategory.id.
   */
  categoryId: string;
  /**
   * Root element structure (optional if variants provide their own).
   * @deprecated Prefer using variants[].rootElement instead.
   */
  rootElement?: ComponentElement;
  /** Variant property definitions (the axes of variation) */
  variantProperties?: VariantProperty[];
  /** All variant definitions (ComponentVariant is alias for VariantDefinition) */
  variants: ComponentVariant[];
  /** ID of the default variant to use for new instances */
  defaultVariantId: string;
  /**
   * Exposed component properties for user configuration.
   * ExposedProperty is alias for ComponentProperty.
   */
  exposedProperties: ExposedProperty[];
  /** ISO 8601 timestamp when created */
  createdAt: string;
  /** ISO 8601 timestamp when last updated */
  updatedAt: string;
  /** Preview thumbnail URL (optional) */
  thumbnail?: string;
  /** Tags for search and filtering (optional) */
  tags?: string[];
  /** Author user ID (optional) */
  createdBy?: string;
  /** Whether this component is published to the library (optional) */
  isPublished?: boolean;
  /** Version number (incremented on updates) */
  version: number;
  /** Associated Figma data if imported (optional) */
  figmaData?: {
    fileId: string;
    nodeId: string;
    lastSyncedAt: string;
  };
  /** Website ID this component belongs to */
  websiteId: string;
  /** Project ID this component belongs to (optional) */
  projectId?: string;
}

// =============================================================================
// Override Value Types
// =============================================================================

/**
 * Image override value structure for image type overrides.
 */
export interface OverrideImageValue {
  /** Image URL */
  url: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Object fit mode for sizing */
  objectFit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
  /** Object position for alignment */
  objectPosition?: string;
}

/**
 * Instance swap override value structure for instanceSwap type overrides.
 */
export interface OverrideInstanceSwapValue {
  /** ID of the component to swap in */
  componentId: string;
  /** Variant ID within that component (optional) */
  variantId?: string;
}

/**
 * Union type for all possible override values.
 */
export type OverrideValue =
  | string
  | boolean
  | OverrideImageValue
  | OverrideInstanceSwapValue;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a MasterComponent.
 */
export function isMasterComponent(value: unknown): value is MasterComponent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.categoryId === 'string' &&
    Array.isArray(obj.variants) &&
    typeof obj.defaultVariantId === 'string' &&
    Array.isArray(obj.exposedProperties) &&
    typeof obj.websiteId === 'string'
  );
}

/**
 * Type guard to check if a value is a ComponentElement.
 */
export function isComponentElement(value: unknown): value is ComponentElement {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.tagName === 'string' &&
    typeof obj.attributes === 'object' &&
    typeof obj.className === 'string' &&
    Array.isArray(obj.children) &&
    typeof obj.overridable === 'object' &&
    typeof obj.styles === 'object'
  );
}

/**
 * Type guard to check if a value is a ComponentInstance.
 */
export function isComponentInstance(value: unknown): value is ComponentInstance {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.masterComponentId === 'string' &&
    typeof obj.variantId === 'string' &&
    Array.isArray(obj.overrides) &&
    typeof obj.propertyValues === 'object' &&
    typeof obj.domElementId === 'string'
  );
}

/**
 * Type guard to check if a value is a VariantProperty.
 */
export function isVariantProperty(value: unknown): value is VariantProperty {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.values) &&
    typeof obj.defaultValue === 'string'
  );
}

/**
 * Type guard to check if a value is a VariantDefinition.
 */
export function isVariantDefinition(value: unknown): value is VariantDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    isComponentElement(obj.rootElement)
  );
}

/**
 * Type guard to check if a value is a ComponentVariant (alias for VariantDefinition).
 */
export const isComponentVariant = isVariantDefinition;

/**
 * Type guard to check if a value is a ComponentProperty.
 */
export function isComponentProperty(value: unknown): value is ComponentProperty {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    ['boolean', 'text', 'instanceSwap', 'variant'].includes(obj.type as string) &&
    (typeof obj.defaultValue === 'string' || typeof obj.defaultValue === 'boolean') &&
    Array.isArray(obj.targetElementIds)
  );
}

/**
 * Type guard to check if a value is a ComponentOverride.
 */
export function isComponentOverride(value: unknown): value is ComponentOverride {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const hasTarget = typeof obj.targetElementId === 'string' || typeof obj.elementPath === 'string';
  return (
    typeof obj.id === 'string' &&
    hasTarget &&
    ['text', 'fill', 'stroke', 'visibility', 'image', 'style', 'attribute', 'children', 'instanceSwap'].includes(obj.type as string)
  );
}

/**
 * Type guard for OverrideImageValue.
 */
export function isOverrideImageValue(value: unknown): value is OverrideImageValue {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.url === 'string';
}

/**
 * Type guard for OverrideInstanceSwapValue.
 */
export function isOverrideInstanceSwapValue(value: unknown): value is OverrideInstanceSwapValue {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.componentId === 'string';
}

/**
 * Type guard to check if a value is a ComponentCategory.
 */
export function isComponentCategory(value: unknown): value is ComponentCategory {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.componentIds)
  );
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Partial component element for updates.
 */
export type PartialComponentElement = Partial<Omit<ComponentElement, 'children'>> & {
  children?: PartialComponentElement[];
};

/**
 * Create master component input type (without auto-generated fields).
 */
export type CreateMasterComponentInput = Omit<
  MasterComponent,
  'id' | 'createdAt' | 'updatedAt' | 'version'
>;

/**
 * Update master component input type.
 */
export type UpdateMasterComponentInput = Partial<
  Omit<MasterComponent, 'id' | 'createdAt' | 'websiteId'>
>;

/**
 * Create instance input type.
 */
export type CreateComponentInstanceInput = Omit<
  ComponentInstance,
  'id' | 'createdAt' | 'updatedAt'
>;

/**
 * Update instance input type.
 */
export type UpdateComponentInstanceInput = Partial<
  Omit<ComponentInstance, 'id' | 'masterComponentId' | 'createdAt'>
>;

/**
 * Element path type for nested element access.
 */
export type ElementPath = string[];

/**
 * Variant key computed from property values (for Map lookups).
 */
export type VariantKey = string;

// =============================================================================
// Default Values & Factory Functions
// =============================================================================

/**
 * Default overridable properties (all enabled).
 */
export const DEFAULT_OVERRIDABLE_PROPERTIES: OverridableProperties = {
  text: true,
  fill: true,
  stroke: true,
  visibility: true,
  image: true,
};

/**
 * Locked overridable properties (all disabled).
 */
export const LOCKED_OVERRIDABLE_PROPERTIES: OverridableProperties = {
  text: false,
  fill: false,
  stroke: false,
  visibility: false,
  image: false,
};

/**
 * Create an empty component element with sensible defaults.
 */
export function createEmptyComponentElement(
  id: string,
  tagName: string = 'div'
): ComponentElement {
  return {
    id,
    tagName,
    attributes: {},
    className: '',
    children: [],
    overridable: { ...DEFAULT_OVERRIDABLE_PROPERTIES },
    styles: {},
  };
}

/**
 * Create an empty variant property with default values.
 */
export function createEmptyVariantProperty(
  id: string,
  name: string
): VariantProperty {
  return {
    id,
    name,
    values: ['default'],
    defaultValue: 'default',
  };
}

/**
 * Create an empty variant definition.
 */
export function createEmptyVariantDefinition(
  id: string,
  name: string,
  rootElement?: ComponentElement,
  propertyValues?: Record<string, string>
): VariantDefinition {
  return {
    id,
    name,
    propertyValues,
    rootElement: rootElement || createEmptyComponentElement(`${id}-root`),
  };
}

/**
 * Create an empty component property.
 */
export function createEmptyComponentProperty(
  id: string,
  name: string,
  type: ComponentPropertyType = 'text'
): ComponentProperty {
  return {
    id,
    name,
    type,
    defaultValue: type === 'boolean' ? false : '',
    targetElementIds: [],
  };
}

/**
 * Create an empty component override using targetElementId.
 */
export function createEmptyComponentOverride(
  id: string,
  targetElementId: string,
  type: OverrideType
): ComponentOverride {
  const value = type === 'visibility' ? true : '';
  return {
    id,
    targetElementId,
    type,
    value,
  };
}

/**
 * Create a component override using element path.
 */
export function createPathBasedOverride(
  id: string,
  elementPath: string,
  type: OverrideType,
  value?: ComponentOverride['value']
): ComponentOverride {
  return {
    id,
    elementPath,
    type,
    value: value ?? (type === 'visibility' ? true : ''),
  };
}

/**
 * Create a variant key from property values (for indexing/lookup).
 */
export function createVariantKey(propertyValues: Record<string, string>): VariantKey {
  return Object.entries(propertyValues)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

/**
 * Parse a variant key back to property values.
 */
export function parseVariantKey(key: VariantKey): Record<string, string> {
  if (!key) return {};
  return Object.fromEntries(
    key.split('|').map(pair => {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) return [pair, ''];
      return [pair.slice(0, colonIndex), pair.slice(colonIndex + 1)];
    })
  );
}

// =============================================================================
// Component Search & Filter Types
// =============================================================================

/**
 * Search filters for component library.
 */
export interface ComponentSearchFilters {
  /** Filter by category ID */
  categoryId?: string;
  /** Filter by tags */
  tags?: string[];
  /** Text search query */
  query?: string;
  /** Filter by author */
  authorId?: string;
  /** Only published components */
  publishedOnly?: boolean;
  /** Filter by website ID */
  websiteId?: string;
  /** Filter by project ID */
  projectId?: string;
  /** Sort field */
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'usageCount';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Pagination limit */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Component search result.
 */
export interface ComponentSearchResult {
  /** Matched components */
  components: MasterComponent[];
  /** Total count for pagination */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
}

// =============================================================================
// Event Types for Component Operations
// =============================================================================

/**
 * Component event types for tracking changes.
 */
export type ComponentEventType =
  | 'component:created'
  | 'component:updated'
  | 'component:deleted'
  | 'component:published'
  | 'component:unpublished'
  | 'variant:added'
  | 'variant:updated'
  | 'variant:deleted'
  | 'instance:created'
  | 'instance:updated'
  | 'instance:deleted'
  | 'instance:detached'
  | 'override:applied'
  | 'override:removed'
  | 'override:reset'
  | 'property:changed';

/**
 * Component event payload structure.
 */
export interface ComponentEvent<T = unknown> {
  /** Event type */
  type: ComponentEventType;
  /** Event payload data */
  payload: T;
  /** Event timestamp */
  timestamp: number;
  /** User ID who triggered the event */
  userId?: string;
}

// =============================================================================
// Context State Types
// =============================================================================

/**
 * State managed by the EditorComponentsContext.
 */
export interface EditorComponentsState {
  /** Map of master component ID to master component */
  masterComponents: Map<string, MasterComponent>;
  /** Map of DOM element ID to component instance */
  componentInstances: Map<string, ComponentInstance>;
  /** Component library categories (alias for ComponentCategory) */
  componentLibrary: ComponentLibraryCategory[];
  /** Loading state */
  isLoadingComponents: boolean;
  /** Currently selected master component ID (for editing) */
  selectedMasterComponentId: string | null;
  /** Currently selected instance ID */
  selectedInstanceId: string | null;
  /** Error state */
  error: string | null;
  /** Pending navigation target for "go to main component" feature */
  pendingNavigationTarget: string | null;
}

/**
 * Actions available in the EditorComponentsContext.
 * Note: This is a minimal interface - implementations may provide additional methods.
 */
export interface EditorComponentsActions {
  // Loading
  loadComponents: (websiteId: string) => Promise<void>;

  // Master Component CRUD
  createMasterComponent: (
    element: HTMLElement,
    name: string,
    category: string,
    description?: string
  ) => MasterComponent;
  updateMasterComponent: (
    id: string,
    updates: Partial<MasterComponent>
  ) => void;
  deleteMasterComponent: (id: string) => void;
  getMasterComponent: (id: string) => MasterComponent | null;

  // Instance CRUD
  createInstance: (
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
  ) => ComponentInstance;
  updateInstance: (
    instanceId: string,
    updates: Partial<ComponentInstance>
  ) => void;
  deleteInstance: (instanceId: string) => void;
  getInstanceByDomId: (domElementId: string) => ComponentInstance | null;

  // Override Management
  addOverride: (
    instanceId: string,
    override: Omit<ComponentOverride, 'id'>
  ) => void;
  removeOverride: (instanceId: string, overrideId: string) => void;
  resetAllOverrides: (instanceId: string) => void;

  // Variant Operations
  changeVariant: (instanceId: string, variantId: string) => void;

  // Detach
  detachInstance: (instanceId: string) => HTMLElement;

  // Resolution
  resolveInstance: (
    master: MasterComponent,
    instance: ComponentInstance
  ) => ComponentElement;

  // Navigation
  /** Request to navigate to a master component (opens component panel) */
  navigateToMasterComponent: (masterComponentId: string) => void;
  /** Clear pending navigation request */
  clearNavigationRequest: () => void;
}

/**
 * 部品(HTML の template)モードの操作。io.loadParts が渡されているときだけ意味を持つ。
 * 詳細は src/editor/parts.ts。
 */
export interface EditorPartsActions {
  /** io.loadParts が渡されているか。true のとき部品パネルは HTML 部品を使い、挿入は実体化になる */
  partsMode: boolean;
  getPartDef: (id: string) => EditorPartDef | null;
  /** 定義を実体化した要素(まだページには入っていない)。定義が無ければ null */
  materializePartInstance: (id: string, doc: Document) => HTMLElement | null;
  /** 選択要素を新しい部品として保存し、その要素をその場でインスタンスにする */
  savePartFromElement: (
    el: HTMLElement,
    meta: { name: string; category?: string; description?: string }
  ) => Promise<EditorPartDef>;
  /** インスタンスの今の姿で定義を更新する(版 +1)。インスタンスでなければ null */
  updatePartFromElement: (el: HTMLElement) => Promise<EditorPartDef | null>;
}

/**
 * Combined context value type.
 */
export type EditorComponentsContextValue = EditorComponentsState &
  EditorComponentsActions &
  EditorPartsActions;

// =============================================================================
// Alias for backward compatibility
// =============================================================================

/**
 * Alias for ComponentCategory (backward compatibility).
 */
export type ComponentLibraryCategory = ComponentCategory;
