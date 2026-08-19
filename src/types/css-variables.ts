/**
 * CSS変数システムの型定義
 * FigmaライクなCSS変数（デザイントークン）管理用
 */

import { Timestamp } from '../vendor/firebase-firestore';

// ============================================
// 変数カテゴリと基本型
// ============================================

/**
 * CSS変数のカテゴリ
 */
export type CSSVariableCategory = 'color' | 'spacing' | 'typography' | 'border' | 'shadow' | 'other';

/**
 * CSS変数のスコープ（現在はprojectのみ対応）
 */
export type CSSVariableScope = 'project';

/**
 * 数値変数のメタ情報
 */
export interface NumericMeta {
  unit: 'px' | 'rem' | 'em' | '%' | 'none';
  numericValue: number;
}

// ============================================
// ブレークポイント対応
// ============================================

/**
 * ブレークポイントID（BREAKPOINT_PRESETSと同期）
 */
export type BreakpointId = 'default' | 'small' | 'tablet' | 'mobile' | 'mini';

/**
 * ブレークポイント固有の値
 */
export interface BreakpointValue {
  /** ブレークポイントID */
  breakpoint: BreakpointId;
  /** 値 */
  value: string;
  /** 数値メタ情報（オプション） */
  numericMeta?: NumericMeta;
}

/**
 * ブレークポイント設定
 */
export interface BreakpointConfig {
  id: BreakpointId;
  name: string;
  label: string;
  maxWidth?: number;
  icon: 'Monitor' | 'Tablet' | 'Smartphone' | 'Watch';
}

/**
 * デフォルトのブレークポイント設定
 */
export const BREAKPOINT_CONFIGS: BreakpointConfig[] = [
  { id: 'default', name: 'Desktop', label: 'デスクトップ', icon: 'Monitor' },
  { id: 'tablet', name: 'Tablet', label: 'タブレット', maxWidth: 1024, icon: 'Tablet' },
  { id: 'mobile', name: 'Mobile', label: 'モバイル', maxWidth: 768, icon: 'Smartphone' },
];

// ============================================
// 変数定義
// ============================================

/**
 * CSS変数の定義
 */
export interface CSSVariableDefinition {
  /** 一意のID */
  id: string;
  /** 表示名（例: "primary"） */
  name: string;
  /** CSS変数名（例: "--color-primary"） */
  cssName: string;
  /** 値（例: "#3b82f6"）- デフォルト（Desktop）の値 */
  value: string;
  /** ブレークポイント固有の値（オプション） */
  breakpointValues?: BreakpointValue[];
  /** カテゴリ */
  category: CSSVariableCategory;
  /** 説明（オプション） */
  description?: string;
  /** 数値メタ情報（スペーシング等の場合） */
  numericMeta?: NumericMeta;
  /** 作成日時 */
  createdAt?: Timestamp | Date;
  /** 更新日時 */
  updatedAt?: Timestamp | Date;
}

/**
 * CSS変数コレクション（プロジェクト単位）
 */
export interface CSSVariableCollection {
  /** コレクションID */
  id: string;
  /** スコープ */
  scope: CSSVariableScope;
  /** スコープID（websiteId） */
  scopeId: string;
  /** 変数リスト */
  variables: CSSVariableDefinition[];
  /** テーマから継承フラグ */
  syncedFromTheme?: boolean;
  /** 最終同期日時 */
  lastSyncedAt?: Timestamp | Date;
  /** 作成日時 */
  createdAt: Timestamp | Date;
  /** 更新日時 */
  updatedAt: Timestamp | Date;
}

// ============================================
// 変数グループ（UIでの表示用）
// ============================================

/**
 * カテゴリごとの変数グループ
 */
export interface CSSVariableGroup {
  category: CSSVariableCategory;
  label: string;
  icon: string;
  variables: CSSVariableDefinition[];
}

// ============================================
// API リクエスト型
// ============================================

/**
 * 変数作成リクエスト
 */
export interface CreateCSSVariableRequest {
  name: string;
  value: string;
  category: CSSVariableCategory;
  description?: string;
}

/**
 * 変数更新リクエスト
 */
export interface UpdateCSSVariableRequest {
  name?: string;
  value?: string;
  category?: CSSVariableCategory;
  description?: string;
}

/**
 * 変数コレクション保存リクエスト
 */
export interface SaveCSSVariablesRequest {
  variables: CSSVariableDefinition[];
  syncedFromTheme?: boolean;
}

// ============================================
// カテゴリ定義と設定
// ============================================

/**
 * カテゴリ設定
 */
export interface CSSVariableCategoryConfig {
  id: CSSVariableCategory;
  label: string;
  labelEn: string;
  icon: string;
  prefix: string;
  defaultUnit?: 'px' | 'rem' | 'em' | '%' | 'none';
  description: string;
}

/**
 * カテゴリ設定リスト
 */
export const CSS_VARIABLE_CATEGORIES: CSSVariableCategoryConfig[] = [
  {
    id: 'color',
    label: 'カラー',
    labelEn: 'Colors',
    icon: 'Palette',
    prefix: '--color-',
    description: '背景色、テキスト色、ボーダー色など',
  },
  {
    id: 'spacing',
    label: 'スペーシング',
    labelEn: 'Spacing',
    icon: 'Ruler',
    prefix: '--spacing-',
    defaultUnit: 'px',
    description: '余白、パディング、ギャップなど',
  },
  {
    id: 'typography',
    label: 'タイポグラフィ',
    labelEn: 'Typography',
    icon: 'Type',
    prefix: '--font-',
    description: 'フォントサイズ、行間、文字間など',
  },
  {
    id: 'border',
    label: 'ボーダー',
    labelEn: 'Border',
    icon: 'Square',
    prefix: '--border-',
    defaultUnit: 'px',
    description: 'ボーダー幅、角丸など',
  },
  {
    id: 'shadow',
    label: 'シャドウ',
    labelEn: 'Shadow',
    icon: 'Layers',
    prefix: '--shadow-',
    description: 'ボックスシャドウ、テキストシャドウなど',
  },
  {
    id: 'other',
    label: 'その他',
    labelEn: 'Other',
    icon: 'Settings',
    prefix: '--',
    description: 'その他のカスタムプロパティ',
  },
];

/**
 * カテゴリIDからカテゴリ設定を取得
 */
export function getCategoryConfig(category: CSSVariableCategory): CSSVariableCategoryConfig {
  return CSS_VARIABLE_CATEGORIES.find(c => c.id === category) ?? CSS_VARIABLE_CATEGORIES[5]; // fallback to 'other'
}

// ============================================
// ヘルパー関数
// ============================================

/**
 * 変数名からCSS変数名を生成
 */
export function generateCSSName(name: string, category: CSSVariableCategory): string {
  const config = getCategoryConfig(category);
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${config.prefix}${safeName}`;
}

/**
 * 新しい変数IDを生成
 */
export function generateVariableId(): string {
  return `var-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 変数をカテゴリごとにグループ化
 */
export function groupVariablesByCategory(variables: CSSVariableDefinition[]): CSSVariableGroup[] {
  return CSS_VARIABLE_CATEGORIES.map(config => ({
    category: config.id,
    label: config.label,
    icon: config.icon,
    variables: variables.filter(v => v.category === config.id),
  })).filter(group => group.variables.length > 0);
}

/**
 * 変数コレクションからCSS文字列を生成
 */
export function generateCSSFromVariables(variables: CSSVariableDefinition[]): string {
  if (variables.length === 0) return '';

  const lines = variables.map(v => `  ${v.cssName}: ${v.value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * ブレークポイント対応のCSS変数を生成
 */
export function generateResponsiveCSSFromVariables(variables: CSSVariableDefinition[]): string {
  if (variables.length === 0) return '';

  // ベース（Desktop）スタイル
  const baseLines = variables.map(v => `  ${v.cssName}: ${v.value};`);
  let css = `:root {\n${baseLines.join('\n')}\n}`;

  // ブレークポイント別のスタイル
  for (const bp of BREAKPOINT_CONFIGS) {
    if (bp.id === 'default' || !bp.maxWidth) continue;

    const bpLines: string[] = [];
    for (const v of variables) {
      const bpValue = v.breakpointValues?.find(bv => bv.breakpoint === bp.id);
      if (bpValue) {
        bpLines.push(`    ${v.cssName}: ${bpValue.value};`);
      }
    }

    if (bpLines.length > 0) {
      css += `\n\n@media (max-width: ${bp.maxWidth}px) {\n  :root {\n${bpLines.join('\n')}\n  }\n}`;
    }
  }

  return css;
}

/**
 * 特定のブレークポイントの値を取得
 */
export function getValueForBreakpoint(
  variable: CSSVariableDefinition,
  breakpoint: BreakpointId
): string {
  if (breakpoint === 'default') return variable.value;
  const bpValue = variable.breakpointValues?.find(v => v.breakpoint === breakpoint);
  return bpValue?.value ?? variable.value;
}

/**
 * 特定のブレークポイントに値を設定した新しい変数を返す
 */
export function setValueForBreakpoint(
  variable: CSSVariableDefinition,
  breakpoint: BreakpointId,
  value: string
): CSSVariableDefinition {
  if (breakpoint === 'default') {
    return { ...variable, value };
  }

  const existingBpValues = variable.breakpointValues ?? [];
  const existingIndex = existingBpValues.findIndex(v => v.breakpoint === breakpoint);

  const newBpValues = [...existingBpValues];
  if (existingIndex >= 0) {
    // 既存のブレークポイント値を更新（値がデフォルトと同じ場合は削除）
    if (value === variable.value) {
      newBpValues.splice(existingIndex, 1);
    } else {
      newBpValues[existingIndex] = { breakpoint, value };
    }
  } else if (value !== variable.value) {
    // 新しいブレークポイント値を追加
    newBpValues.push({ breakpoint, value });
  }

  return {
    ...variable,
    breakpointValues: newBpValues.length > 0 ? newBpValues : undefined,
  };
}

/**
 * CSS変数参照値を生成
 */
export function generateVarReference(variable: CSSVariableDefinition): string {
  return `var(${variable.cssName})`;
}

/**
 * 値がCSS変数参照かどうかをチェック
 */
export function isVariableReference(value: string): boolean {
  return /^var\(--[a-z0-9-]+\)$/i.test(value);
}

/**
 * CSS変数参照から変数名を抽出
 */
export function extractVariableName(varReference: string): string | null {
  const match = varReference.match(/^var\((--[a-z0-9-]+)\)$/i);
  return match ? match[1] : null;
}

// ============================================
// デフォルト変数セット
// ============================================

/**
 * デフォルトのカラー変数
 */
export const DEFAULT_COLOR_VARIABLES: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'primary',
    cssName: '--color-primary',
    value: '#3b82f6',
    category: 'color',
    description: 'プライマリカラー',
  },
  {
    name: 'secondary',
    cssName: '--color-secondary',
    value: '#6b7280',
    category: 'color',
    description: 'セカンダリカラー',
  },
  {
    name: 'accent',
    cssName: '--color-accent',
    value: '#2563eb',
    category: 'color',
    description: 'アクセントカラー',
  },
  {
    name: 'background',
    cssName: '--color-background',
    value: '#ffffff',
    category: 'color',
    description: '背景色',
  },
  {
    name: 'text',
    cssName: '--color-text',
    value: '#1f2937',
    category: 'color',
    description: 'テキスト色',
  },
  {
    name: 'text-muted',
    cssName: '--color-text-muted',
    value: '#6b7280',
    category: 'color',
    description: '薄いテキスト色',
  },
  {
    name: 'surface',
    cssName: '--color-surface',
    value: '#f9fafb',
    category: 'color',
    description: 'サーフェス色',
  },
  {
    name: 'border',
    cssName: '--color-border',
    value: '#e5e7eb',
    category: 'color',
    description: 'ボーダー色',
  },
];

/**
 * デフォルトのスペーシング変数
 */
export const DEFAULT_SPACING_VARIABLES: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'xs',
    cssName: '--spacing-xs',
    value: '4px',
    category: 'spacing',
    description: '極小スペース',
    numericMeta: { unit: 'px', numericValue: 4 },
  },
  {
    name: 'sm',
    cssName: '--spacing-sm',
    value: '8px',
    category: 'spacing',
    description: '小スペース',
    numericMeta: { unit: 'px', numericValue: 8 },
  },
  {
    name: 'md',
    cssName: '--spacing-md',
    value: '16px',
    category: 'spacing',
    description: '中スペース',
    numericMeta: { unit: 'px', numericValue: 16 },
  },
  {
    name: 'lg',
    cssName: '--spacing-lg',
    value: '24px',
    category: 'spacing',
    description: '大スペース',
    numericMeta: { unit: 'px', numericValue: 24 },
  },
  {
    name: 'xl',
    cssName: '--spacing-xl',
    value: '32px',
    category: 'spacing',
    description: '特大スペース',
    numericMeta: { unit: 'px', numericValue: 32 },
  },
];

/**
 * デフォルトのタイポグラフィ変数
 */
export const DEFAULT_TYPOGRAPHY_VARIABLES: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'size-xs',
    cssName: '--font-size-xs',
    value: '12px',
    category: 'typography',
    description: '極小フォント',
    numericMeta: { unit: 'px', numericValue: 12 },
  },
  {
    name: 'size-sm',
    cssName: '--font-size-sm',
    value: '14px',
    category: 'typography',
    description: '小フォント',
    numericMeta: { unit: 'px', numericValue: 14 },
  },
  {
    name: 'size-base',
    cssName: '--font-size-base',
    value: '16px',
    category: 'typography',
    description: '基本フォント',
    numericMeta: { unit: 'px', numericValue: 16 },
  },
  {
    name: 'size-lg',
    cssName: '--font-size-lg',
    value: '18px',
    category: 'typography',
    description: '大フォント',
    numericMeta: { unit: 'px', numericValue: 18 },
  },
  {
    name: 'size-xl',
    cssName: '--font-size-xl',
    value: '20px',
    category: 'typography',
    description: '特大フォント',
    numericMeta: { unit: 'px', numericValue: 20 },
  },
  {
    name: 'size-2xl',
    cssName: '--font-size-2xl',
    value: '24px',
    category: 'typography',
    description: '見出し大',
    numericMeta: { unit: 'px', numericValue: 24 },
  },
];

/**
 * デフォルトのボーダー変数
 */
export const DEFAULT_BORDER_VARIABLES: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'radius-sm',
    cssName: '--border-radius-sm',
    value: '4px',
    category: 'border',
    description: '小角丸',
    numericMeta: { unit: 'px', numericValue: 4 },
  },
  {
    name: 'radius-md',
    cssName: '--border-radius-md',
    value: '8px',
    category: 'border',
    description: '中角丸',
    numericMeta: { unit: 'px', numericValue: 8 },
  },
  {
    name: 'radius-lg',
    cssName: '--border-radius-lg',
    value: '16px',
    category: 'border',
    description: '大角丸',
    numericMeta: { unit: 'px', numericValue: 16 },
  },
  {
    name: 'radius-full',
    cssName: '--border-radius-full',
    value: '9999px',
    category: 'border',
    description: '完全丸',
    numericMeta: { unit: 'px', numericValue: 9999 },
  },
];

/**
 * デフォルトのシャドウ変数
 */
export const DEFAULT_SHADOW_VARIABLES: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'sm',
    cssName: '--shadow-sm',
    value: '0 1px 2px rgba(0,0,0,0.05)',
    category: 'shadow',
    description: '小シャドウ',
  },
  {
    name: 'md',
    cssName: '--shadow-md',
    value: '0 4px 6px rgba(0,0,0,0.1)',
    category: 'shadow',
    description: '中シャドウ',
  },
  {
    name: 'lg',
    cssName: '--shadow-lg',
    value: '0 10px 15px rgba(0,0,0,0.15)',
    category: 'shadow',
    description: '大シャドウ',
  },
];

/**
 * 全デフォルト変数を統合
 */
export function getDefaultVariables(): CSSVariableDefinition[] {
  const now = new Date();
  let index = 0;

  const createVar = (def: Omit<CSSVariableDefinition, 'id' | 'createdAt' | 'updatedAt'>): CSSVariableDefinition => ({
    ...def,
    id: `default-var-${index++}`,
    createdAt: now,
    updatedAt: now,
  });

  return [
    ...DEFAULT_COLOR_VARIABLES.map(createVar),
    ...DEFAULT_SPACING_VARIABLES.map(createVar),
    ...DEFAULT_TYPOGRAPHY_VARIABLES.map(createVar),
    ...DEFAULT_BORDER_VARIABLES.map(createVar),
    ...DEFAULT_SHADOW_VARIABLES.map(createVar),
  ];
}
