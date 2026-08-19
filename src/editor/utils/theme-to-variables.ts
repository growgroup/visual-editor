/**
 * WebsiteTheme → CSS変数への変換ユーティリティ
 * テーマ設定からエディタ用のCSS変数を生成
 */

import type { WebsiteTheme, WebsiteThemeColors, WebsiteTypography } from '../../types/website-theme';
import type { CSSVariableDefinition, CSSVariableCategory } from '../../types/css-variables';
import { generateVariableId } from '../../types/css-variables';

// ============================================
// 変数生成ヘルパー
// ============================================

/**
 * 単一のCSS変数定義を生成
 */
function createVariable(
  name: string,
  cssName: string,
  value: string,
  category: CSSVariableCategory,
  description?: string
): CSSVariableDefinition {
  const now = new Date();
  return {
    id: generateVariableId(),
    name,
    cssName,
    value,
    category,
    description,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================
// カラー変数の変換
// ============================================

/**
 * テーマカラーからCSS変数を生成
 */
export function colorsToVariables(colors: WebsiteThemeColors): CSSVariableDefinition[] {
  const variables: CSSVariableDefinition[] = [];

  // メインカラー
  variables.push(createVariable('background', '--color-background', colors.background, 'color', '背景色'));
  variables.push(createVariable('text', '--color-text', colors.text, 'color', 'テキスト色'));
  variables.push(createVariable('primary', '--color-primary', colors.primary, 'color', 'プライマリカラー'));

  // オプショナルカラー
  if (colors.textMuted) {
    variables.push(createVariable('text-muted', '--color-text-muted', colors.textMuted, 'color', '薄いテキスト色'));
  }
  if (colors.secondary) {
    variables.push(createVariable('secondary', '--color-secondary', colors.secondary, 'color', 'セカンダリカラー'));
  }
  if (colors.accent) {
    variables.push(createVariable('accent', '--color-accent', colors.accent, 'color', 'アクセントカラー'));
  }
  if (colors.surface) {
    variables.push(createVariable('surface', '--color-surface', colors.surface, 'color', 'サーフェス色'));
  }
  if (colors.surfaceAlt) {
    variables.push(createVariable('surface-alt', '--color-surface-alt', colors.surfaceAlt, 'color', '代替サーフェス色'));
  }
  if (colors.border) {
    variables.push(createVariable('border', '--color-border', colors.border, 'color', 'ボーダー色'));
  }
  if (colors.borderStrong) {
    variables.push(createVariable('border-strong', '--color-border-strong', colors.borderStrong, 'color', '強調ボーダー色'));
  }

  // ステータスカラー
  if (colors.success) {
    variables.push(createVariable('success', '--color-success', colors.success, 'color', '成功色'));
  }
  if (colors.warning) {
    variables.push(createVariable('warning', '--color-warning', colors.warning, 'color', '警告色'));
  }
  if (colors.error) {
    variables.push(createVariable('error', '--color-error', colors.error, 'color', 'エラー色'));
  }
  if (colors.info) {
    variables.push(createVariable('info', '--color-info', colors.info, 'color', '情報色'));
  }

  return variables;
}

// ============================================
// タイポグラフィ変数の変換
// ============================================

/**
 * タイポグラフィ設定からCSS変数を生成
 */
export function typographyToVariables(typography: WebsiteTypography): CSSVariableDefinition[] {
  const variables: CSSVariableDefinition[] = [];

  // フォントファミリー
  variables.push(createVariable('family', '--font-family', typography.fontFamily, 'typography', '本文フォント'));

  if (typography.headingFontFamily) {
    variables.push(createVariable('family-heading', '--font-family-heading', typography.headingFontFamily, 'typography', '見出しフォント'));
  }
  if (typography.monoFontFamily) {
    variables.push(createVariable('family-mono', '--font-family-mono', typography.monoFontFamily, 'typography', '等幅フォント'));
  }

  // 基準フォントサイズ
  if (typography.baseFontSize) {
    variables.push(createVariable('size-base', '--font-size-base', typography.baseFontSize, 'typography', '基準フォントサイズ'));
  }

  // 見出しスタイル
  if (typography.headings) {
    const headings = typography.headings;

    // H1
    if (headings.h1) {
      variables.push(createVariable('size-h1', '--font-size-h1', headings.h1.fontSize, 'typography', 'H1フォントサイズ'));
    }
    // H2
    if (headings.h2) {
      variables.push(createVariable('size-h2', '--font-size-h2', headings.h2.fontSize, 'typography', 'H2フォントサイズ'));
    }
    // H3
    if (headings.h3) {
      variables.push(createVariable('size-h3', '--font-size-h3', headings.h3.fontSize, 'typography', 'H3フォントサイズ'));
    }
    // H4
    if (headings.h4) {
      variables.push(createVariable('size-h4', '--font-size-h4', headings.h4.fontSize, 'typography', 'H4フォントサイズ'));
    }
    // H5
    if (headings.h5) {
      variables.push(createVariable('size-h5', '--font-size-h5', headings.h5.fontSize, 'typography', 'H5フォントサイズ'));
    }
    // H6
    if (headings.h6) {
      variables.push(createVariable('size-h6', '--font-size-h6', headings.h6.fontSize, 'typography', 'H6フォントサイズ'));
    }
  }

  // 本文スタイル
  if (typography.body) {
    const body = typography.body;

    if (body.base) {
      variables.push(createVariable('size-body', '--font-size-body', body.base.fontSize, 'typography', '本文フォントサイズ'));
      variables.push(createVariable('line-height-body', '--line-height-body', body.base.lineHeight, 'typography', '本文行間'));
    }
    if (body.large) {
      variables.push(createVariable('size-body-lg', '--font-size-body-lg', body.large.fontSize, 'typography', '大本文フォントサイズ'));
    }
    if (body.small) {
      variables.push(createVariable('size-body-sm', '--font-size-body-sm', body.small.fontSize, 'typography', '小本文フォントサイズ'));
    }
  }

  return variables;
}

// ============================================
// スペーシング変数の生成
// ============================================

/**
 * スタイルオプションからスペーシング変数を生成
 */
export function generateSpacingVariables(spacing: 'compact' | 'normal' | 'relaxed' | 'spacious' = 'normal'): CSSVariableDefinition[] {
  const multipliers: Record<string, number> = {
    compact: 0.75,
    normal: 1,
    relaxed: 1.25,
    spacious: 1.5,
  };
  const multiplier = multipliers[spacing] ?? 1;

  const baseValues = [4, 8, 16, 24, 32, 48, 64];
  const names = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

  return baseValues.map((value, index) => {
    const adjustedValue = Math.round(value * multiplier);
    return createVariable(
      names[index],
      `--spacing-${names[index]}`,
      `${adjustedValue}px`,
      'spacing',
      `${names[index].toUpperCase()}スペース`
    );
  });
}

// ============================================
// ボーダー変数の生成
// ============================================

/**
 * ボーダースタイルからCSS変数を生成
 */
export function generateBorderVariables(borderRadius: 'none' | 'small' | 'medium' | 'large' | 'full' = 'medium'): CSSVariableDefinition[] {
  const radiusMap: Record<string, { sm: string; md: string; lg: string; full: string }> = {
    none: { sm: '0', md: '0', lg: '0', full: '0' },
    small: { sm: '2px', md: '4px', lg: '6px', full: '9999px' },
    medium: { sm: '4px', md: '8px', lg: '12px', full: '9999px' },
    large: { sm: '8px', md: '16px', lg: '24px', full: '9999px' },
    full: { sm: '9999px', md: '9999px', lg: '9999px', full: '9999px' },
  };

  const values = radiusMap[borderRadius] ?? radiusMap.medium;

  return [
    createVariable('radius-sm', '--border-radius-sm', values.sm, 'border', '小角丸'),
    createVariable('radius-md', '--border-radius-md', values.md, 'border', '中角丸'),
    createVariable('radius-lg', '--border-radius-lg', values.lg, 'border', '大角丸'),
    createVariable('radius-full', '--border-radius-full', values.full, 'border', '完全丸'),
  ];
}

// ============================================
// シャドウ変数の生成
// ============================================

/**
 * シャドウスタイルからCSS変数を生成
 */
export function generateShadowVariables(shadow: 'none' | 'subtle' | 'medium' | 'strong' = 'medium'): CSSVariableDefinition[] {
  const shadowMap: Record<string, { sm: string; md: string; lg: string }> = {
    none: {
      sm: 'none',
      md: 'none',
      lg: 'none',
    },
    subtle: {
      sm: '0 1px 2px rgba(0,0,0,0.03)',
      md: '0 2px 4px rgba(0,0,0,0.05)',
      lg: '0 4px 6px rgba(0,0,0,0.07)',
    },
    medium: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.1)',
      lg: '0 10px 15px rgba(0,0,0,0.15)',
    },
    strong: {
      sm: '0 2px 4px rgba(0,0,0,0.1)',
      md: '0 8px 12px rgba(0,0,0,0.15)',
      lg: '0 15px 25px rgba(0,0,0,0.2)',
    },
  };

  const values = shadowMap[shadow] ?? shadowMap.medium;

  return [
    createVariable('sm', '--shadow-sm', values.sm, 'shadow', '小シャドウ'),
    createVariable('md', '--shadow-md', values.md, 'shadow', '中シャドウ'),
    createVariable('lg', '--shadow-lg', values.lg, 'shadow', '大シャドウ'),
  ];
}

// ============================================
// テーマ全体の変換
// ============================================

/**
 * WebsiteTheme全体からCSS変数を生成
 */
export function themeToVariables(theme: WebsiteTheme): CSSVariableDefinition[] {
  const variables: CSSVariableDefinition[] = [];

  // カラー
  variables.push(...colorsToVariables(theme.colors));

  // タイポグラフィ
  if (theme.typography) {
    variables.push(...typographyToVariables(theme.typography));
  }

  // スペーシング
  if (theme.styles?.spacing) {
    variables.push(...generateSpacingVariables(theme.styles.spacing));
  } else {
    variables.push(...generateSpacingVariables('normal'));
  }

  // ボーダー
  if (theme.styles?.borderRadius) {
    variables.push(...generateBorderVariables(theme.styles.borderRadius));
  } else {
    variables.push(...generateBorderVariables('medium'));
  }

  // シャドウ
  if (theme.styles?.shadow) {
    variables.push(...generateShadowVariables(theme.styles.shadow));
  } else {
    variables.push(...generateShadowVariables('medium'));
  }

  return variables;
}

// ============================================
// 差分検出
// ============================================

/**
 * 現在の変数とテーマから生成した変数の差分を検出
 */
export function detectVariableDifferences(
  current: CSSVariableDefinition[],
  fromTheme: CSSVariableDefinition[]
): {
  added: CSSVariableDefinition[];
  updated: CSSVariableDefinition[];
  unchanged: CSSVariableDefinition[];
} {
  const currentMap = new Map(current.map(v => [v.cssName, v]));
  const added: CSSVariableDefinition[] = [];
  const updated: CSSVariableDefinition[] = [];
  const unchanged: CSSVariableDefinition[] = [];

  for (const themeVar of fromTheme) {
    const existing = currentMap.get(themeVar.cssName);
    if (!existing) {
      added.push(themeVar);
    } else if (existing.value !== themeVar.value) {
      updated.push({
        ...existing,
        value: themeVar.value,
        updatedAt: new Date(),
      });
    } else {
      unchanged.push(existing);
    }
  }

  return { added, updated, unchanged };
}
