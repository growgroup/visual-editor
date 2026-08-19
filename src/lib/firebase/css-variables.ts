/**
 * ローカル永続化スタブ。オリジナルは Firebase 実装（Firestore）。
 *
 * オリジナルは /websites/{websiteId}/cssVariables/current または
 * /presentations/{presentationId}/cssVariables/current に保存していたが、
 * ここではバックエンドを持たないため localStorage に JSON で保存する。
 *
 * localStorage キー:
 * - website スコープ:      `gg-editor:cssVariables:<resourceId>`
 * - presentation スコープ: `gg-editor:cssVariables:presentation:<resourceId>`
 *
 * export 名・引数・戻り値型はオリジナルと同一（呼び出し側を変更しないため）。
 * Firestore Timestamp の代わりに ISO 文字列で保存し、読み出し時に Date へ変換する。
 */

import type {
  CSSVariableDefinition,
  CSSVariableCollection,
} from '../../types/css-variables';

// ============================================
// スコープタイプ定義
// ============================================

export type CSSVariableScope = 'website' | 'presentation';

// ============================================
// localStorage パス定義
// ============================================

const STORAGE_PREFIX = 'gg-editor:cssVariables';

/**
 * CSS変数コレクションの localStorage キーを取得
 * （オリジナルの getCSSVariablesDocRef 相当）
 * @param resourceId - website ID または presentation ID
 * @param scope - 'website'（デフォルト）または 'presentation'
 */
function getCSSVariablesKey(resourceId: string, scope: CSSVariableScope = 'website'): string {
  return scope === 'presentation'
    ? `${STORAGE_PREFIX}:presentation:${resourceId}`
    : `${STORAGE_PREFIX}:${resourceId}`;
}

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

/**
 * 保存済みドキュメントを読み出す（存在しなければ null）
 */
function readDoc(key: string): Record<string, unknown> | null {
  const store = getStore();
  if (!store) return null;

  const raw = store.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.error('[CSSVariables] Failed to parse stored data:', error);
    return null;
  }
}

/**
 * ドキュメントを書き込む
 */
function writeDoc(key: string, data: Record<string, unknown>): void {
  const store = getStore();
  if (!store) return;
  store.setItem(key, JSON.stringify(data));
}

// ============================================
// 型変換ヘルパー
// ============================================

/**
 * 保存データを型付きオブジェクトに変換
 */
function convertToCollection(
  docData: Record<string, unknown>,
  websiteId: string
): CSSVariableCollection {
  const variables = ((docData.variables as Array<Record<string, unknown>>) || []).map(v => ({
    id: v.id as string,
    name: v.name as string,
    cssName: v.cssName as string,
    value: v.value as string,
    category: v.category as CSSVariableDefinition['category'],
    description: v.description as string | undefined,
    numericMeta: v.numericMeta as CSSVariableDefinition['numericMeta'],
    breakpointValues: v.breakpointValues as CSSVariableDefinition['breakpointValues'],
    createdAt: convertTimestamp(v.createdAt),
    updatedAt: convertTimestamp(v.updatedAt),
  }));

  return {
    id: 'current',
    scope: 'project',
    scopeId: websiteId,
    variables,
    syncedFromTheme: docData.syncedFromTheme as boolean | undefined,
    lastSyncedAt: convertTimestamp(docData.lastSyncedAt),
    createdAt: convertTimestamp(docData.createdAt) ?? new Date(),
    updatedAt: convertTimestamp(docData.updatedAt) ?? new Date(),
  };
}

/**
 * 保存値（ISO文字列 / Date / Timestamp 互換オブジェクト）を Date に変換
 */
function convertTimestamp(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 保存用に日時を ISO 文字列へ変換
 */
function toISO(value: unknown): string {
  const date = convertTimestamp(value);
  return (date ?? new Date()).toISOString();
}

/**
 * 保存用に変数リストをシリアライズ可能な形へ変換
 */
function prepareForSave(variables: CSSVariableDefinition[]): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  return variables.map(v => ({
    id: v.id,
    name: v.name,
    cssName: v.cssName,
    value: v.value,
    category: v.category,
    description: v.description ?? null,
    numericMeta: v.numericMeta ?? null,
    breakpointValues: v.breakpointValues ?? null,
    createdAt: v.createdAt ? toISO(v.createdAt) : now,
    updatedAt: now,
  }));
}

// ============================================
// CRUD 操作
// ============================================

/**
 * CSS変数コレクションを取得
 * @param resourceId - website ID または presentation ID
 * @param scope - 'website'（デフォルト）または 'presentation'
 */
export async function getCSSVariables(
  resourceId: string,
  scope: CSSVariableScope = 'website'
): Promise<CSSVariableCollection | null> {
  try {
    const key = getCSSVariablesKey(resourceId, scope);
    const data = readDoc(key);

    if (!data) {
      console.log(`[CSSVariables] No variables found for ${scope}:`, resourceId);
      return null;
    }

    return convertToCollection(data, resourceId);
  } catch (error) {
    console.error('[CSSVariables] Error getting variables:', error);
    throw error;
  }
}

/**
 * CSS変数リストのみを取得
 * @param resourceId - website ID または presentation ID
 * @param scope - 'website'（デフォルト）または 'presentation'
 */
export async function getCSSVariablesList(
  resourceId: string,
  scope: CSSVariableScope = 'website'
): Promise<CSSVariableDefinition[]> {
  const collection = await getCSSVariables(resourceId, scope);
  return collection?.variables ?? [];
}

/**
 * CSS変数コレクションを保存（全体上書き）
 * @param resourceId - website ID または presentation ID
 * @param variables - CSS変数リスト
 * @param options - オプション（syncedFromTheme, scope）
 */
export async function saveCSSVariables(
  resourceId: string,
  variables: CSSVariableDefinition[],
  options?: {
    syncedFromTheme?: boolean;
    scope?: CSSVariableScope;
  }
): Promise<void> {
  try {
    const scope = options?.scope ?? 'website';
    const key = getCSSVariablesKey(resourceId, scope);
    const now = new Date().toISOString();

    // 既存ドキュメントをチェック（createdAt を維持）
    const existing = readDoc(key);
    const createdAt = existing?.createdAt ? toISO(existing.createdAt) : now;

    const data = {
      variables: prepareForSave(variables),
      syncedFromTheme: options?.syncedFromTheme ?? false,
      lastSyncedAt: options?.syncedFromTheme ? now : null,
      createdAt,
      updatedAt: now,
    };

    writeDoc(key, data);
    console.log(`[CSSVariables] Saved variables for ${scope}:`, resourceId, 'count:', variables.length);
  } catch (error) {
    console.error('[CSSVariables] Error saving variables:', error);
    throw error;
  }
}

/**
 * CSS変数を追加（既存に追加）
 */
export async function addCSSVariable(
  websiteId: string,
  variable: CSSVariableDefinition
): Promise<void> {
  const existing = await getCSSVariablesList(websiteId);
  await saveCSSVariables(websiteId, [...existing, variable]);
}

/**
 * CSS変数を更新
 */
export async function updateCSSVariable(
  websiteId: string,
  variableId: string,
  updates: Partial<Omit<CSSVariableDefinition, 'id'>>
): Promise<void> {
  const existing = await getCSSVariablesList(websiteId);
  const updatedVariables = existing.map(v => {
    if (v.id !== variableId) return v;
    return {
      ...v,
      ...updates,
      updatedAt: new Date(),
    };
  });
  await saveCSSVariables(websiteId, updatedVariables);
}

/**
 * CSS変数を削除
 */
export async function deleteCSSVariable(
  websiteId: string,
  variableId: string
): Promise<void> {
  const existing = await getCSSVariablesList(websiteId);
  const filteredVariables = existing.filter(v => v.id !== variableId);
  await saveCSSVariables(websiteId, filteredVariables);
}

/**
 * CSS変数コレクションを削除
 */
export async function deleteCSSVariablesCollection(websiteId: string): Promise<void> {
  try {
    const key = getCSSVariablesKey(websiteId);
    const store = getStore();
    if (store) store.removeItem(key);
    console.log('[CSSVariables] Deleted variables for website:', websiteId);
  } catch (error) {
    console.error('[CSSVariables] Error deleting variables:', error);
    throw error;
  }
}

// ============================================
// バルク操作
// ============================================

/**
 * 複数の変数を一括追加
 */
export async function addCSSVariablesBulk(
  websiteId: string,
  variables: CSSVariableDefinition[]
): Promise<void> {
  const existing = await getCSSVariablesList(websiteId);
  await saveCSSVariables(websiteId, [...existing, ...variables]);
}

/**
 * 変数をマージ（同じcssNameは上書き、新規は追加）
 */
export async function mergeCSSVariables(
  websiteId: string,
  variables: CSSVariableDefinition[],
  options?: { syncedFromTheme?: boolean }
): Promise<void> {
  const existing = await getCSSVariablesList(websiteId);

  // cssNameでマップを作成
  const existingMap = new Map(existing.map(v => [v.cssName, v]));

  // マージ
  for (const newVar of variables) {
    const existingVar = existingMap.get(newVar.cssName);
    if (existingVar) {
      // 既存変数を更新（IDは維持）
      existingMap.set(newVar.cssName, {
        ...existingVar,
        ...newVar,
        id: existingVar.id, // 既存IDを維持
        updatedAt: new Date(),
      });
    } else {
      // 新規追加
      existingMap.set(newVar.cssName, newVar);
    }
  }

  await saveCSSVariables(websiteId, Array.from(existingMap.values()), options);
}

// ============================================
// 検証・ユーティリティ
// ============================================

/**
 * 変数名の重複チェック
 */
export async function isVariableNameTaken(
  websiteId: string,
  cssName: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await getCSSVariablesList(websiteId);
  return existing.some(v => v.cssName === cssName && v.id !== excludeId);
}

/**
 * CSS変数が存在するかチェック
 */
export async function hasCSSVariables(websiteId: string): Promise<boolean> {
  const collection = await getCSSVariables(websiteId);
  return collection !== null && collection.variables.length > 0;
}
