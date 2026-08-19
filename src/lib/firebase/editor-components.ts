/**
 * ローカル永続化スタブ。オリジナルは Firebase 実装（Firestore）。
 *
 * MasterComponent / ComponentInstance の CRUD をバックエンド無しで提供する。
 *
 * オリジナルの Firestore スキーマ:
 * - /websites/{websiteId}/componentLibrary/master/components/{componentId} -> MasterComponent
 * - /websites/{websiteId}/pages/{pageId}/componentInstances/{instanceId}   -> ComponentInstance
 *
 * 本実装の localStorage スキーマ:
 * - `gg-editor:masterComponents`   -> { [websiteId]: { [componentId]: doc } }
 * - `gg-editor:componentInstances` -> { [websiteId]: { [pageId]: { [instanceId]: doc } } }
 *
 * export 名・引数・戻り値型はオリジナルと同一（呼び出し側を変更しないため）。
 * 日時は Firestore Timestamp ではなく ISO 8601 文字列で保持する。
 */

import type {
  MasterComponent,
  ComponentInstance,
  ComponentVariant,
  ComponentOverride,
  ExposedProperty,
} from '../../types/editor-components';

// ============================================================
// localStorage Helpers
// ============================================================

const MASTER_COMPONENTS_KEY = 'gg-editor:masterComponents';
const COMPONENT_INSTANCES_KEY = 'gg-editor:componentInstances';

type StoredDoc = Record<string, unknown>;
/** { [websiteId]: { [componentId]: doc } } */
type MasterStore = Record<string, Record<string, StoredDoc>>;
/** { [websiteId]: { [pageId]: { [instanceId]: doc } } } */
type InstanceStore = Record<string, Record<string, Record<string, StoredDoc>>>;

/**
 * localStorage が利用可能かどうか（SSR / 制限環境対策）
 */
function getStore(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStore<T extends object>(key: string): T {
  const store = getStore();
  if (!store) return {} as T;

  const raw = store.getItem(key);
  if (!raw) return {} as T;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {} as T;
    return parsed as T;
  } catch (error) {
    console.error(`Error parsing localStorage key "${key}":`, error);
    return {} as T;
  }
}

function writeStore(key: string, value: object): void {
  const store = getStore();
  if (!store) return;
  store.setItem(key, JSON.stringify(value));
}

function readMasterStore(): MasterStore {
  return readStore<MasterStore>(MASTER_COMPONENTS_KEY);
}

function writeMasterStore(store: MasterStore): void {
  writeStore(MASTER_COMPONENTS_KEY, store);
}

function readInstanceStore(): InstanceStore {
  return readStore<InstanceStore>(COMPONENT_INSTANCES_KEY);
}

function writeInstanceStore(store: InstanceStore): void {
  writeStore(COMPONENT_INSTANCES_KEY, store);
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Remove undefined values from an object recursively.
 * （オリジナルは Firestore が undefined を受け付けないための処理。
 *  JSON.stringify でも undefined は落ちるが、挙動を揃えるため移植している）
 */
function removeUndefinedValues<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const cleaned = removeUndefinedValues(value as Record<string, unknown>);
      result[key] = cleaned;
    } else if (Array.isArray(value)) {
      result[key] = value
        .map((item) =>
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          !(item instanceof Date)
            ? removeUndefinedValues(item as Record<string, unknown>)
            : item
        )
        .filter((item) => item !== undefined);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Convert stored timestamp value to Date.
 */
function timestampToDate(timestamp: unknown): Date {
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
  if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp) {
    try {
      return (timestamp as { toDate: () => Date }).toDate();
    } catch {
      return new Date();
    }
  }
  return new Date();
}

/**
 * Convert Date or ISO string to ISO string for storage.
 */
function dateToISOString(date: Date | string | undefined): string {
  if (!date) return new Date().toISOString();
  if (typeof date === 'string') return date;
  return date.toISOString();
}

/**
 * Convert stored document data to MasterComponent.
 */
function docToMasterComponent(
  id: string,
  data: Record<string, unknown>
): MasterComponent {
  return {
    // 保存時に載せた追加フィールド（rootElement / variantProperties / figmaData 等）を維持
    ...(data as Partial<MasterComponent>),
    id,
    name: data.name as string,
    description: data.description as string | undefined,
    categoryId: data.categoryId as string,
    tags: (data.tags as string[]) || [],
    variants: (data.variants as ComponentVariant[]) || [],
    defaultVariantId: data.defaultVariantId as string,
    exposedProperties: (data.exposedProperties as ExposedProperty[]) || [],
    createdAt: dateToISOString(
      data.createdAt
        ? timestampToDate(data.createdAt)
        : undefined
    ),
    updatedAt: dateToISOString(
      data.updatedAt
        ? timestampToDate(data.updatedAt)
        : undefined
    ),
    createdBy: data.createdBy as string | undefined,
    websiteId: data.websiteId as string,
    thumbnail: data.thumbnail as string | undefined,
    version: (data.version as number) || 1,
  };
}

/**
 * Convert stored document data to ComponentInstance.
 */
function docToComponentInstance(
  id: string,
  data: Record<string, unknown>
): ComponentInstance {
  return {
    // 保存時に載せた追加フィールド（position / size / name 等）を維持
    ...(data as Partial<ComponentInstance>),
    id,
    masterComponentId: data.masterComponentId as string,
    variantId: data.variantId as string,
    domElementId: data.domElementId as string,
    overrides: (data.overrides as ComponentOverride[]) || [],
    propertyValues:
      (data.propertyValues as Record<string, string | number | boolean>) || {},
    isDetached: (data.isDetached as boolean) || false,
    pageId: data.pageId as string | undefined,
    createdAt: dateToISOString(
      data.createdAt
        ? timestampToDate(data.createdAt)
        : undefined
    ),
    updatedAt: dateToISOString(
      data.updatedAt
        ? timestampToDate(data.updatedAt)
        : undefined
    ),
  };
}

/**
 * Prepare MasterComponent for storage.
 */
function masterComponentToDoc(
  component: MasterComponent
): Record<string, unknown> {
  const { id: _id, ...rest } = component;
  void _id; // id はキーとして保持するのでドキュメント本体には含めない

  const doc: Record<string, unknown> = {
    ...rest,
    name: component.name,
    categoryId: component.categoryId,
    tags: component.tags,
    variants: component.variants,
    defaultVariantId: component.defaultVariantId,
    exposedProperties: component.exposedProperties,
    createdAt: component.createdAt,
    updatedAt: new Date().toISOString(),
    websiteId: component.websiteId,
    version: component.version,
  };

  if (component.description) doc.description = component.description;
  if (component.createdBy) doc.createdBy = component.createdBy;
  if (component.thumbnail) doc.thumbnail = component.thumbnail;

  return removeUndefinedValues(doc);
}

/**
 * Prepare ComponentInstance for storage.
 */
function componentInstanceToDoc(
  instance: ComponentInstance
): Record<string, unknown> {
  const { id: _id, ...rest } = instance;
  void _id; // id はキーとして保持するのでドキュメント本体には含めない

  const doc: Record<string, unknown> = {
    ...rest,
    masterComponentId: instance.masterComponentId,
    variantId: instance.variantId,
    domElementId: instance.domElementId,
    overrides: instance.overrides,
    propertyValues: instance.propertyValues,
    isDetached: instance.isDetached,
    createdAt: instance.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (instance.pageId) doc.pageId = instance.pageId;

  return removeUndefinedValues(doc);
}

// ============================================================
// Master Component Operations
// ============================================================

/**
 * Save a master component to localStorage.
 */
export async function saveMasterComponent(
  websiteId: string,
  component: MasterComponent
): Promise<void> {
  try {
    const store = readMasterStore();
    const websiteComponents = store[websiteId] ?? {};
    websiteComponents[component.id] = masterComponentToDoc(component);
    store[websiteId] = websiteComponents;
    writeMasterStore(store);
  } catch (error) {
    console.error('Error saving master component:', error);
    throw error;
  }
}

/**
 * Get a master component by ID.
 */
export async function getMasterComponent(
  websiteId: string,
  componentId: string
): Promise<MasterComponent | null> {
  try {
    const store = readMasterStore();
    const data = store[websiteId]?.[componentId];

    if (!data) {
      return null;
    }

    return docToMasterComponent(componentId, data);
  } catch (error) {
    console.error('Error getting master component:', error);
    throw error;
  }
}

/**
 * Get all master components for a website.
 */
export async function getAllMasterComponents(
  websiteId: string
): Promise<MasterComponent[]> {
  try {
    const store = readMasterStore();
    const websiteComponents = store[websiteId] ?? {};

    return Object.entries(websiteComponents).map(([componentId, data]) =>
      docToMasterComponent(componentId, data)
    );
  } catch (error) {
    console.error('Error getting all master components:', error);
    throw error;
  }
}

/**
 * Update a master component.
 */
export async function updateMasterComponent(
  websiteId: string,
  componentId: string,
  updates: Partial<MasterComponent>
): Promise<void> {
  try {
    const store = readMasterStore();
    const websiteComponents = store[websiteId] ?? {};
    const existing = websiteComponents[componentId];

    if (!existing) {
      console.warn(
        `[editor-components] Master component not found, creating: ${websiteId}/${componentId}`
      );
    }

    const updateData = removeUndefinedValues({
      ...updates,
      updatedAt: new Date().toISOString(),
      version: (updates.version ?? 1) + 1,
    } as Record<string, unknown>);

    // Remove id from updates (should not be stored in the document)
    delete updateData.id;

    websiteComponents[componentId] = { ...(existing ?? {}), ...updateData };
    store[websiteId] = websiteComponents;
    writeMasterStore(store);
  } catch (error) {
    console.error('Error updating master component:', error);
    throw error;
  }
}

/**
 * Delete a master component.
 */
export async function deleteMasterComponent(
  websiteId: string,
  componentId: string
): Promise<void> {
  try {
    const store = readMasterStore();
    const websiteComponents = store[websiteId];
    if (!websiteComponents) return;

    delete websiteComponents[componentId];
    store[websiteId] = websiteComponents;
    writeMasterStore(store);
  } catch (error) {
    console.error('Error deleting master component:', error);
    throw error;
  }
}

// ============================================================
// Component Instance Operations
// ============================================================

/**
 * Save a component instance to localStorage.
 */
export async function saveComponentInstance(
  websiteId: string,
  pageId: string,
  instance: ComponentInstance
): Promise<void> {
  try {
    const store = readInstanceStore();
    const pages = store[websiteId] ?? {};
    const instances = pages[pageId] ?? {};

    instances[instance.id] = componentInstanceToDoc(instance);
    pages[pageId] = instances;
    store[websiteId] = pages;
    writeInstanceStore(store);
  } catch (error) {
    console.error('Error saving component instance:', error);
    throw error;
  }
}

/**
 * Get a component instance by ID.
 */
export async function getComponentInstance(
  websiteId: string,
  pageId: string,
  instanceId: string
): Promise<ComponentInstance | null> {
  try {
    const store = readInstanceStore();
    const data = store[websiteId]?.[pageId]?.[instanceId];

    if (!data) {
      return null;
    }

    return docToComponentInstance(instanceId, data);
  } catch (error) {
    console.error('Error getting component instance:', error);
    throw error;
  }
}

/**
 * Get all component instances for a page.
 */
export async function getPageComponentInstances(
  websiteId: string,
  pageId: string
): Promise<ComponentInstance[]> {
  try {
    const store = readInstanceStore();
    const instances = store[websiteId]?.[pageId] ?? {};

    return Object.entries(instances).map(([instanceId, data]) =>
      docToComponentInstance(instanceId, data)
    );
  } catch (error) {
    console.error('Error getting page component instances:', error);
    throw error;
  }
}

/**
 * Update a component instance.
 */
export async function updateComponentInstance(
  websiteId: string,
  pageId: string,
  instanceId: string,
  updates: Partial<ComponentInstance>
): Promise<void> {
  try {
    const store = readInstanceStore();
    const pages = store[websiteId] ?? {};
    const instances = pages[pageId] ?? {};
    const existing = instances[instanceId];

    if (!existing) {
      console.warn(
        `[editor-components] Component instance not found, creating: ${websiteId}/${pageId}/${instanceId}`
      );
    }

    const updateData = removeUndefinedValues({
      ...updates,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>);

    // Remove id from updates (should not be stored in the document)
    delete updateData.id;

    instances[instanceId] = { ...(existing ?? {}), ...updateData };
    pages[pageId] = instances;
    store[websiteId] = pages;
    writeInstanceStore(store);
  } catch (error) {
    console.error('Error updating component instance:', error);
    throw error;
  }
}

/**
 * Delete a component instance.
 */
export async function deleteComponentInstance(
  websiteId: string,
  pageId: string,
  instanceId: string
): Promise<void> {
  try {
    const store = readInstanceStore();
    const instances = store[websiteId]?.[pageId];
    if (!instances) return;

    delete instances[instanceId];
    writeInstanceStore(store);
  } catch (error) {
    console.error('Error deleting component instance:', error);
    throw error;
  }
}

/**
 * Get all instances of a master component across all pages.
 * （オリジナルは Firestore の collectionGroup クエリ。ここでは全ページを走査する）
 */
export async function getInstancesByMasterComponent(
  websiteId: string,
  masterComponentId: string
): Promise<ComponentInstance[]> {
  try {
    const store = readInstanceStore();
    const pages = store[websiteId] ?? {};

    const instances: ComponentInstance[] = [];
    for (const [pageId, pageInstances] of Object.entries(pages)) {
      for (const [instanceId, data] of Object.entries(pageInstances)) {
        if (data.masterComponentId !== masterComponentId) continue;
        instances.push(
          docToComponentInstance(instanceId, { pageId, ...data })
        );
      }
    }

    return instances;
  } catch (error) {
    console.error('Error getting instances by master component:', error);
    throw error;
  }
}

// ============================================================
// Batch Operations
// ============================================================

/**
 * Batch update multiple component instances across pages.
 */
export async function batchUpdateInstances(
  websiteId: string,
  updates: Array<{
    pageId: string;
    instanceId: string;
    data: Partial<ComponentInstance>;
  }>
): Promise<void> {
  try {
    const store = readInstanceStore();
    const pages = store[websiteId] ?? {};
    const now = new Date().toISOString();

    for (const update of updates) {
      const instances = pages[update.pageId] ?? {};
      const existing = instances[update.instanceId];

      const updateData = removeUndefinedValues({
        ...update.data,
        updatedAt: now,
      } as Record<string, unknown>);

      // Remove id from updates
      delete updateData.id;

      instances[update.instanceId] = { ...(existing ?? {}), ...updateData };
      pages[update.pageId] = instances;
    }

    store[websiteId] = pages;
    writeInstanceStore(store);
  } catch (error) {
    console.error('Error batch updating instances:', error);
    throw error;
  }
}

/**
 * Batch delete multiple component instances.
 */
export async function batchDeleteInstances(
  websiteId: string,
  instances: Array<{ pageId: string; instanceId: string }>
): Promise<void> {
  try {
    const store = readInstanceStore();
    const pages = store[websiteId];
    if (!pages) return;

    for (const instance of instances) {
      const pageInstances = pages[instance.pageId];
      if (!pageInstances) continue;
      delete pageInstances[instance.instanceId];
    }

    writeInstanceStore(store);
  } catch (error) {
    console.error('Error batch deleting instances:', error);
    throw error;
  }
}

/**
 * Propagate master component changes to all non-detached instances.
 * Updates the variant structure for all instances using the specified master component.
 */
export async function propagateMasterChanges(
  websiteId: string,
  masterComponentId: string,
  newVersion: number
): Promise<number> {
  try {
    void newVersion; // オリジナル同様、現状はバージョン番号を直接書き込まない

    const instances = await getInstancesByMasterComponent(
      websiteId,
      masterComponentId
    );

    // Filter to only non-detached instances
    const linkedInstances = instances.filter((inst) => !inst.isDetached);

    if (linkedInstances.length === 0) {
      return 0;
    }

    // Batch update all linked instances
    const updates = linkedInstances.map((instance) => ({
      pageId: instance.pageId || '',
      instanceId: instance.id,
      data: {
        updatedAt: new Date().toISOString(),
      },
    }));

    // Filter out instances without pageId
    const validUpdates = updates.filter((u) => u.pageId);

    if (validUpdates.length > 0) {
      await batchUpdateInstances(websiteId, validUpdates);
    }

    return linkedInstances.length;
  } catch (error) {
    console.error('Error propagating master changes:', error);
    throw error;
  }
}
