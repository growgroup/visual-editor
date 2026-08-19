'use client';

/**
 * EditorVariablesContext
 *
 * CSS変数（デザイントークン）の管理を行うContext
 * 変更頻度: 低（変数定義時のみ）
 *
 * 含まれる状態:
 * - variables: CSS変数定義のリスト
 * - isLoading: 読み込み中フラグ
 * - isSaving: 保存中フラグ
 * - hasChanges: 未保存変更フラグ
 *
 * 含まれる操作:
 * - addVariable: 変数を追加
 * - updateVariable: 変数を更新
 * - deleteVariable: 変数を削除
 * - saveVariables: 変数を保存
 * - loadVariables: 変数を読み込み
 * - syncFromTheme: テーマから同期
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import type {
  CSSVariableDefinition,
  CSSVariableCategory,
  CSSVariableGroup,
} from '../../types/css-variables';
import {
  generateVariableId,
  generateCSSName,
  generateResponsiveCSSFromVariables,
  groupVariablesByCategory,
} from '../../types/css-variables';

// ============================================
// Context Value Interface
// ============================================

export interface EditorVariablesContextValue {
  // 状態
  variables: CSSVariableDefinition[];
  isLoading: boolean;
  isSaving: boolean;
  hasChanges: boolean;
  /** 変数が1つ以上定義されているかどうか */
  hasVariables: boolean;

  // グループ化された変数（UIで使用）
  variableGroups: CSSVariableGroup[];

  // CSS出力
  cssString: string;

  // 変数操作
  addVariable: (name: string, value: string, category: CSSVariableCategory, description?: string) => CSSVariableDefinition;
  updateVariable: (id: string, updates: Partial<Omit<CSSVariableDefinition, 'id'>>) => void;
  deleteVariable: (id: string) => void;
  reorderVariables: (categoryId: CSSVariableCategory, fromIndex: number, toIndex: number) => void;

  // 変数検索
  getVariableById: (id: string) => CSSVariableDefinition | undefined;
  getVariableByCssName: (cssName: string) => CSSVariableDefinition | undefined;
  getVariablesByCategory: (category: CSSVariableCategory) => CSSVariableDefinition[];

  // 永続化
  saveVariables: () => Promise<void>;
  loadVariables: (websiteId: string) => Promise<void>;

  // テーマ同期
  syncFromTheme: (themeVariables: CSSVariableDefinition[]) => void;

  // バルク操作
  setVariables: (variables: CSSVariableDefinition[]) => void;
  clearVariables: () => void;

  // iframe注入用
  injectCSSToIframe: (iframeDoc: Document) => void;
}

// ============================================
// Context Creation
// ============================================

const EditorVariablesContext = createContext<EditorVariablesContextValue | null>(null);

export function useEditorVariables(): EditorVariablesContextValue {
  const context = useContext(EditorVariablesContext);
  if (!context) {
    throw new Error('useEditorVariables must be used within EditorVariablesProvider');
  }
  return context;
}

// ============================================
// Provider Props
// ============================================

interface EditorVariablesProviderProps {
  children: React.ReactNode;
  /** 初期変数（オプション） */
  initialVariables?: CSSVariableDefinition[];
  /** 変数保存コールバック */
  onSave?: (variables: CSSVariableDefinition[]) => Promise<void>;
  /** 変数読み込みコールバック */
  onLoad?: (websiteId: string) => Promise<CSSVariableDefinition[]>;
}

// ============================================
// Provider Implementation
// ============================================

export function EditorVariablesProvider({
  children,
  initialVariables = [],
  onSave,
  onLoad,
}: EditorVariablesProviderProps) {
  // 状態
  const [variables, setVariablesState] = useState<CSSVariableDefinition[]>(initialVariables);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // 最後に保存した変数のスナップショット
  const savedVariablesRef = useRef<CSSVariableDefinition[]>(initialVariables);

  // 変数をグループ化
  const variableGroups = useMemo(() => groupVariablesByCategory(variables), [variables]);

  // CSS文字列生成
  const cssString = useMemo(() => generateResponsiveCSSFromVariables(variables), [variables]);

  // 変更フラグを更新するヘルパー
  const markAsChanged = useCallback(() => {
    setHasChanges(true);
  }, []);

  // 変数追加
  const addVariable = useCallback((
    name: string,
    value: string,
    category: CSSVariableCategory,
    description?: string
  ): CSSVariableDefinition => {
    const now = new Date();
    const newVariable: CSSVariableDefinition = {
      id: generateVariableId(),
      name,
      cssName: generateCSSName(name, category),
      value,
      category,
      description,
      createdAt: now,
      updatedAt: now,
    };

    setVariablesState(prev => [...prev, newVariable]);
    markAsChanged();

    return newVariable;
  }, [markAsChanged]);

  // 変数更新
  const updateVariable = useCallback((
    id: string,
    updates: Partial<Omit<CSSVariableDefinition, 'id'>>
  ) => {
    setVariablesState(prev => prev.map(v => {
      if (v.id !== id) return v;

      const updated = { ...v, ...updates, updatedAt: new Date() };

      // 名前が変更された場合、CSS名も更新
      if (updates.name && updates.name !== v.name) {
        updated.cssName = generateCSSName(updates.name, updates.category ?? v.category);
      }

      // カテゴリが変更された場合、プレフィックスを更新
      if (updates.category && updates.category !== v.category && !updates.name) {
        updated.cssName = generateCSSName(v.name, updates.category);
      }

      return updated;
    }));
    markAsChanged();
  }, [markAsChanged]);

  // 変数削除
  const deleteVariable = useCallback((id: string) => {
    setVariablesState(prev => prev.filter(v => v.id !== id));
    markAsChanged();
  }, [markAsChanged]);

  // 変数並び替え
  const reorderVariables = useCallback((
    category: CSSVariableCategory,
    fromIndex: number,
    toIndex: number
  ) => {
    setVariablesState(prev => {
      // カテゴリ内の変数のインデックスを取得
      const categoryIndices: number[] = [];
      prev.forEach((v, i) => {
        if (v.category === category) {
          categoryIndices.push(i);
        }
      });

      // インデックスが範囲外の場合は何もしない
      if (fromIndex < 0 || fromIndex >= categoryIndices.length ||
          toIndex < 0 || toIndex >= categoryIndices.length) {
        return prev;
      }

      // 新しい配列を作成
      const result = [...prev];

      // 移動元と移動先の実際のインデックス
      const fromActualIndex = categoryIndices[fromIndex];
      const toActualIndex = categoryIndices[toIndex];

      // 要素を移動
      const [movedVar] = result.splice(fromActualIndex, 1);

      // 削除後のインデックスを再計算（削除により位置がずれる場合がある）
      let adjustedToIndex = toActualIndex;
      if (fromActualIndex < toActualIndex) {
        adjustedToIndex = toActualIndex - 1;
      }

      result.splice(adjustedToIndex, 0, movedVar);

      return result;
    });
    markAsChanged();
  }, [markAsChanged]);

  // ID で変数を取得
  const getVariableById = useCallback((id: string): CSSVariableDefinition | undefined => {
    return variables.find(v => v.id === id);
  }, [variables]);

  // CSS名で変数を取得
  const getVariableByCssName = useCallback((cssName: string): CSSVariableDefinition | undefined => {
    return variables.find(v => v.cssName === cssName);
  }, [variables]);

  // カテゴリで変数を取得
  const getVariablesByCategory = useCallback((category: CSSVariableCategory): CSSVariableDefinition[] => {
    return variables.filter(v => v.category === category);
  }, [variables]);

  // 変数を保存
  const saveVariables = useCallback(async () => {
    if (!onSave) {
      console.warn('[EditorVariablesContext] onSave callback not provided');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(variables);
      savedVariablesRef.current = [...variables];
      setHasChanges(false);
      console.log('[EditorVariablesContext] Variables saved successfully');
    } catch (error) {
      console.error('[EditorVariablesContext] Failed to save variables:', error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [variables, onSave]);

  // 変数を読み込み
  const loadVariables = useCallback(async (websiteId: string) => {
    if (!onLoad) {
      console.warn('[EditorVariablesContext] onLoad callback not provided');
      return;
    }

    setIsLoading(true);
    try {
      const loaded = await onLoad(websiteId);
      setVariablesState(loaded);
      savedVariablesRef.current = [...loaded];
      setHasChanges(false);
      console.log('[EditorVariablesContext] Variables loaded:', loaded.length);
    } catch (error) {
      console.error('[EditorVariablesContext] Failed to load variables:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [onLoad]);

  // テーマから同期
  const syncFromTheme = useCallback((themeVariables: CSSVariableDefinition[]) => {
    setVariablesState(themeVariables);
    markAsChanged();
    console.log('[EditorVariablesContext] Synced from theme:', themeVariables.length, 'variables');
  }, [markAsChanged]);

  // バルク設定
  const setVariables = useCallback((newVariables: CSSVariableDefinition[]) => {
    setVariablesState(newVariables);
    markAsChanged();
  }, [markAsChanged]);

  // クリア
  const clearVariables = useCallback(() => {
    setVariablesState([]);
    markAsChanged();
  }, [markAsChanged]);

  // iframeにCSSを注入
  const injectCSSToIframe = useCallback((iframeDoc: Document) => {
    const styleId = 'editor-css-variables';
    let styleEl = iframeDoc.getElementById(styleId) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = styleId;
      // headの最初に挿入（他のスタイルより優先）
      iframeDoc.head.insertBefore(styleEl, iframeDoc.head.firstChild);
    }

    styleEl.textContent = cssString;
    console.log('[EditorVariablesContext] Injected CSS variables to iframe');
  }, [cssString]);

  // Context値
  const value: EditorVariablesContextValue = useMemo(() => ({
    // 状態
    variables,
    isLoading,
    isSaving,
    hasChanges,
    hasVariables: variables.length > 0,
    variableGroups,
    cssString,

    // 変数操作
    addVariable,
    updateVariable,
    deleteVariable,
    reorderVariables,

    // 変数検索
    getVariableById,
    getVariableByCssName,
    getVariablesByCategory,

    // 永続化
    saveVariables,
    loadVariables,

    // テーマ同期
    syncFromTheme,

    // バルク操作
    setVariables,
    clearVariables,

    // iframe注入
    injectCSSToIframe,
  }), [
    variables,
    isLoading,
    isSaving,
    hasChanges,
    variableGroups,
    cssString,
    addVariable,
    updateVariable,
    deleteVariable,
    reorderVariables,
    getVariableById,
    getVariableByCssName,
    getVariablesByCategory,
    saveVariables,
    loadVariables,
    syncFromTheme,
    setVariables,
    clearVariables,
    injectCSSToIframe,
  ]);

  return (
    <EditorVariablesContext.Provider value={value}>
      {children}
    </EditorVariablesContext.Provider>
  );
}

export default EditorVariablesContext;
