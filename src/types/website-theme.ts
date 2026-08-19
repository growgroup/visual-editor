/**
 * Webサイトテーマの型定義
 * デザインシステムの基盤となる包括的な設定
 */

import { Timestamp } from '../vendor/firebase-firestore';

// ============================================
// 基本カラー設定
// ============================================

export interface WebsiteThemeColors {
  background: string;       // ページ背景色
  text: string;             // 本文テキスト色
  textMuted?: string;       // 薄いテキスト色（キャプション等）
  primary: string;          // プライマリカラー
  secondary?: string;       // セカンダリカラー
  accent?: string;          // アクセントカラー
  surface?: string;         // サーフェス（カード等）の色
  surfaceAlt?: string;      // 代替サーフェス色（ストライプ等）
  border?: string;          // ボーダー色
  borderStrong?: string;    // 強調ボーダー色
  success?: string;         // 成功色
  warning?: string;         // 警告色
  error?: string;           // エラー色
  info?: string;            // 情報色
}

// ============================================
// 基本スタイルオプション
// ============================================

export type BorderRadiusOption = 'none' | 'small' | 'medium' | 'large' | 'full';
export type ShadowOption = 'none' | 'subtle' | 'medium' | 'strong';
export type SpacingOption = 'compact' | 'normal' | 'relaxed' | 'spacious';

export interface WebsiteThemeStyles {
  borderRadius?: BorderRadiusOption;
  shadow?: ShadowOption;
  spacing?: SpacingOption;
}

// ============================================
// タイポグラフィ設定
// ============================================

// テキストスタイルの詳細設定
export interface TextStyle {
  fontSize: string;         // 例: '16px', '1rem'
  fontWeight: string;       // 例: '400', '700'
  lineHeight: string;       // 例: '1.5', '1.75'
  letterSpacing?: string;   // 例: '-0.02em', '0.05em'
  color?: string;           // テーマカラーを上書きする場合
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  marginBottom?: string;    // 要素後の余白
}

// 見出しスタイル（h1-h6）
export interface HeadingStyles {
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  h4: TextStyle;
  h5: TextStyle;
  h6: TextStyle;
}

// 本文スタイル
export interface BodyStyles {
  base: TextStyle;          // 通常本文
  large: TextStyle;         // リード文・大きめ本文
  small: TextStyle;         // 小さめ本文・注釈
}

// 拡張タイポグラフィ設定
export interface WebsiteTypography {
  // フォント設定
  fontFamily: string;           // 本文フォント
  headingFontFamily?: string;   // 見出しフォント（省略時はfontFamily）
  monoFontFamily?: string;      // コード用等幅フォント

  // 基準フォントサイズ
  baseFontSize?: string;        // 例: '16px'

  // 見出しスタイル
  headings: HeadingStyles;

  // 本文スタイル
  body: BodyStyles;
}

// ============================================
// コンポーネントスタイル設定
// ============================================

// リンクスタイル
export interface LinkStyles {
  color?: string;
  hoverColor?: string;
  textDecoration?: 'none' | 'underline';
  hoverTextDecoration?: 'none' | 'underline';
}

// ボタンバリアント
export interface ButtonVariantStyle {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  hoverBackgroundColor?: string;
  hoverTextColor?: string;
  hoverBorderColor?: string;
}

// ボタンスタイル
export interface ButtonStyles {
  borderRadius?: string;
  fontWeight?: string;
  paddingX?: string;
  paddingY?: string;
  // バリアント
  primary?: ButtonVariantStyle;
  secondary?: ButtonVariantStyle;
  outline?: ButtonVariantStyle;
  ghost?: ButtonVariantStyle;
}

// テーブルスタイル
export interface TableStyles {
  // ヘッダー
  headerBackgroundColor?: string;
  headerTextColor?: string;
  headerFontWeight?: string;
  headerBorderColor?: string;
  // セル
  cellPaddingX?: string;
  cellPaddingY?: string;
  cellBorderColor?: string;
  // ストライプ
  stripedBackgroundColor?: string;
  // ホバー
  hoverBackgroundColor?: string;
}

// 引用（blockquote）スタイル
export interface BlockquoteStyles {
  backgroundColor?: string;
  borderLeftColor?: string;
  borderLeftWidth?: string;
  textColor?: string;
  fontStyle?: 'normal' | 'italic';
  paddingX?: string;
  paddingY?: string;
  fontSize?: string;
}

// リストスタイル
export interface ListStyles {
  // マーカーカラー
  markerColor?: string;
  // 項目間の余白
  itemSpacing?: string;
  // ネストのインデント
  nestedIndent?: string;
  // 順序付きリストのスタイル
  orderedListStyle?: 'decimal' | 'lower-alpha' | 'lower-roman' | 'upper-alpha' | 'upper-roman';
  // 順序なしリストのスタイル
  unorderedListStyle?: 'disc' | 'circle' | 'square' | 'none';
}

// コードブロックスタイル
export interface CodeStyles {
  // インラインコード
  inlineBackgroundColor?: string;
  inlineTextColor?: string;
  inlinePaddingX?: string;
  inlinePaddingY?: string;
  inlineBorderRadius?: string;
  // コードブロック
  blockBackgroundColor?: string;
  blockTextColor?: string;
  blockPadding?: string;
  blockBorderRadius?: string;
  blockBorderColor?: string;
}

// カード/サーフェススタイル
export interface CardStyles {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: string;
  borderRadius?: string;
  shadow?: string;
  padding?: string;
  hoverShadow?: string;
  hoverBorderColor?: string;
}

// フォーム要素スタイル
export interface FormStyles {
  // 入力フィールド
  inputBackgroundColor?: string;
  inputTextColor?: string;
  inputBorderColor?: string;
  inputBorderRadius?: string;
  inputPaddingX?: string;
  inputPaddingY?: string;
  inputFocusBorderColor?: string;
  inputFocusRingColor?: string;
  // プレースホルダー
  placeholderColor?: string;
  // ラベル
  labelColor?: string;
  labelFontWeight?: string;
  labelFontSize?: string;
  // エラー状態
  errorBorderColor?: string;
  errorTextColor?: string;
}

// 区切り線/セパレータスタイル
export interface DividerStyles {
  color?: string;
  thickness?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  spacing?: string;         // 上下の余白
}

// バッジ/タグスタイル
export interface BadgeStyles {
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  paddingX?: string;
  paddingY?: string;
  fontSize?: string;
  fontWeight?: string;
}

// アラート/通知スタイル
export interface AlertStyles {
  borderRadius?: string;
  padding?: string;
  // バリアント
  successBackgroundColor?: string;
  successBorderColor?: string;
  successTextColor?: string;
  warningBackgroundColor?: string;
  warningBorderColor?: string;
  warningTextColor?: string;
  errorBackgroundColor?: string;
  errorBorderColor?: string;
  errorTextColor?: string;
  infoBackgroundColor?: string;
  infoBorderColor?: string;
  infoTextColor?: string;
}

// 全コンポーネントスタイル
export interface ComponentStyles {
  link?: LinkStyles;
  button?: ButtonStyles;
  table?: TableStyles;
  blockquote?: BlockquoteStyles;
  list?: ListStyles;
  code?: CodeStyles;
  card?: CardStyles;
  form?: FormStyles;
  divider?: DividerStyles;
  badge?: BadgeStyles;
  alert?: AlertStyles;
}

// ============================================
// Webサイトテーマ本体
// ============================================

export interface WebsiteTheme {
  id: string;
  name: string;
  description?: string;
  category?: 'light' | 'dark' | 'corporate' | 'modern' | 'custom';

  // カラー設定
  colors: WebsiteThemeColors;

  // 基本スタイル設定
  styles?: WebsiteThemeStyles;

  // タイポグラフィ設定
  typography?: WebsiteTypography;

  // コンポーネントスタイル設定
  components?: ComponentStyles;

  // 追加プロンプト（AIへの追加指示）
  additionalPrompt?: string;

  // メタデータ
  isDefault?: boolean;
  isSystem?: boolean;
  userId?: string;

  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

// ============================================
// スタイルオプション定数
// ============================================

export const BORDER_RADIUS_OPTIONS: { value: BorderRadiusOption; label: string; css: string }[] = [
  { value: 'none', label: 'なし', css: '0' },
  { value: 'small', label: '小', css: '4px' },
  { value: 'medium', label: '中', css: '8px' },
  { value: 'large', label: '大', css: '16px' },
  { value: 'full', label: '最大', css: '9999px' },
];

export const SHADOW_OPTIONS: { value: ShadowOption; label: string; css: string }[] = [
  { value: 'none', label: 'なし', css: 'none' },
  { value: 'subtle', label: '控えめ', css: '0 1px 2px rgba(0,0,0,0.05)' },
  { value: 'medium', label: '標準', css: '0 4px 6px rgba(0,0,0,0.1)' },
  { value: 'strong', label: '強め', css: '0 10px 15px rgba(0,0,0,0.15)' },
];

export const SPACING_OPTIONS: { value: SpacingOption; label: string; description: string }[] = [
  { value: 'compact', label: '詰める', description: '要素間の余白を最小限に' },
  { value: 'normal', label: '通常', description: '標準的な余白感' },
  { value: 'relaxed', label: '広め', description: 'ゆったりとした余白' },
  { value: 'spacious', label: '最大', description: '大きな余白でインパクト重視' },
];

// フォントウェイトオプション
export const FONT_WEIGHT_OPTIONS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi Bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' },
];

// フォントサイズプリセット
export const FONT_SIZE_PRESETS = {
  h1: ['32px', '36px', '40px', '48px', '56px', '64px'],
  h2: ['28px', '32px', '36px', '40px', '48px'],
  h3: ['24px', '28px', '32px', '36px'],
  h4: ['20px', '22px', '24px', '28px'],
  h5: ['18px', '20px', '22px', '24px'],
  h6: ['16px', '18px', '20px'],
  body: ['14px', '16px', '18px', '20px'],
  small: ['12px', '13px', '14px'],
};

// ============================================
// デフォルト値の定義
// ============================================

// デフォルトの見出しスタイル
export const DEFAULT_HEADING_STYLES: HeadingStyles = {
  h1: {
    fontSize: '48px',
    fontWeight: '700',
    lineHeight: '1.2',
    letterSpacing: '-0.02em',
    marginBottom: '24px',
  },
  h2: {
    fontSize: '36px',
    fontWeight: '600',
    lineHeight: '1.25',
    letterSpacing: '-0.01em',
    marginBottom: '20px',
  },
  h3: {
    fontSize: '28px',
    fontWeight: '600',
    lineHeight: '1.3',
    marginBottom: '16px',
  },
  h4: {
    fontSize: '24px',
    fontWeight: '600',
    lineHeight: '1.35',
    marginBottom: '12px',
  },
  h5: {
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '1.4',
    marginBottom: '8px',
  },
  h6: {
    fontSize: '18px',
    fontWeight: '600',
    lineHeight: '1.4',
    marginBottom: '8px',
  },
};

// デフォルトの本文スタイル
export const DEFAULT_BODY_STYLES: BodyStyles = {
  base: {
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '1.7',
    marginBottom: '16px',
  },
  large: {
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '1.6',
    marginBottom: '20px',
  },
  small: {
    fontSize: '14px',
    fontWeight: '400',
    lineHeight: '1.5',
    marginBottom: '12px',
  },
};

// デフォルトのタイポグラフィ設定
export const DEFAULT_WEBSITE_TYPOGRAPHY: WebsiteTypography = {
  fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif",
  headingFontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
  monoFontFamily: "'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace",
  baseFontSize: '16px',
  headings: DEFAULT_HEADING_STYLES,
  body: DEFAULT_BODY_STYLES,
};

// デフォルトのコンポーネントスタイル
export const DEFAULT_COMPONENT_STYLES: ComponentStyles = {
  link: {
    textDecoration: 'none',
    hoverTextDecoration: 'underline',
  },
  button: {
    borderRadius: '8px',
    fontWeight: '500',
    paddingX: '16px',
    paddingY: '10px',
  },
  table: {
    headerFontWeight: '600',
    cellPaddingX: '16px',
    cellPaddingY: '12px',
  },
  blockquote: {
    borderLeftWidth: '4px',
    fontStyle: 'normal',
    paddingX: '20px',
    paddingY: '16px',
    fontSize: '18px',
  },
  list: {
    itemSpacing: '8px',
    nestedIndent: '24px',
    orderedListStyle: 'decimal',
    unorderedListStyle: 'disc',
  },
  code: {
    inlinePaddingX: '6px',
    inlinePaddingY: '2px',
    inlineBorderRadius: '4px',
    blockPadding: '16px',
    blockBorderRadius: '8px',
  },
  card: {
    borderWidth: '1px',
    borderRadius: '12px',
    padding: '24px',
  },
  form: {
    inputBorderRadius: '8px',
    inputPaddingX: '12px',
    inputPaddingY: '10px',
    labelFontWeight: '500',
    labelFontSize: '14px',
  },
  divider: {
    thickness: '1px',
    style: 'solid',
    spacing: '24px',
  },
  badge: {
    borderRadius: '9999px',
    paddingX: '10px',
    paddingY: '4px',
    fontSize: '12px',
    fontWeight: '500',
  },
  alert: {
    borderRadius: '8px',
    padding: '16px',
  },
};

// ============================================
// リクエスト型
// ============================================

export interface CreateWebsiteThemeRequest {
  name: string;
  description?: string;
  category?: WebsiteTheme['category'];
  colors: WebsiteThemeColors;
  styles?: WebsiteThemeStyles;
  typography?: WebsiteTypography;
  components?: ComponentStyles;
  additionalPrompt?: string;
}

export interface UpdateWebsiteThemeRequest {
  name?: string;
  description?: string;
  category?: WebsiteTheme['category'];
  colors?: Partial<WebsiteThemeColors>;
  styles?: WebsiteThemeStyles;
  typography?: Partial<WebsiteTypography>;
  components?: Partial<ComponentStyles>;
  additionalPrompt?: string;
}

export interface WebsiteThemeFilter {
  category?: WebsiteTheme['category'];
  userId?: string;
  includeSystem?: boolean;
}

// ============================================
// デフォルトテーマ（4 system themes）
// ============================================

export const DEFAULT_WEBSITE_THEMES: Omit<WebsiteTheme, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'ライト',
    description: '明るく清潔感のある標準テーマ',
    category: 'light',
    colors: {
      background: '#ffffff',
      text: '#1f2937',
      textMuted: '#6b7280',
      primary: '#3b82f6',
      secondary: '#6b7280',
      accent: '#2563eb',
      surface: '#f9fafb',
      surfaceAlt: '#f3f4f6',
      border: '#e5e7eb',
      borderStrong: '#d1d5db',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
    },
    styles: {
      borderRadius: 'medium',
      shadow: 'medium',
      spacing: 'normal',
    },
    isDefault: true,
    isSystem: true,
  },
  {
    name: 'ダーク',
    description: 'モダンで落ち着いたダークテーマ',
    category: 'dark',
    colors: {
      background: '#111827',
      text: '#f9fafb',
      textMuted: '#9ca3af',
      primary: '#3b82f6',
      secondary: '#9ca3af',
      accent: '#60a5fa',
      surface: '#1f2937',
      surfaceAlt: '#374151',
      border: '#374151',
      borderStrong: '#4b5563',
      success: '#34d399',
      warning: '#fbbf24',
      error: '#f87171',
      info: '#60a5fa',
    },
    styles: {
      borderRadius: 'medium',
      shadow: 'medium',
      spacing: 'normal',
    },
    isSystem: true,
  },
  {
    name: 'コーポレート',
    description: 'ビジネス向けの信頼感あるテーマ',
    category: 'corporate',
    colors: {
      background: '#ffffff',
      text: '#1e3a5f',
      textMuted: '#64748b',
      primary: '#0a4d8c',
      secondary: '#64748b',
      accent: '#0d6efd',
      surface: '#f8fafc',
      surfaceAlt: '#f1f5f9',
      border: '#cbd5e1',
      borderStrong: '#94a3b8',
      success: '#059669',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0284c7',
    },
    styles: {
      borderRadius: 'small',
      shadow: 'subtle',
      spacing: 'normal',
    },
    isSystem: true,
  },
  {
    name: 'モダン',
    description: 'スタイリッシュで現代的なテーマ',
    category: 'modern',
    colors: {
      background: '#fafafa',
      text: '#18181b',
      textMuted: '#71717a',
      primary: '#8b5cf6',
      secondary: '#71717a',
      accent: '#a855f7',
      surface: '#ffffff',
      surfaceAlt: '#f4f4f5',
      border: '#e4e4e7',
      borderStrong: '#d4d4d8',
      success: '#22c55e',
      warning: '#eab308',
      error: '#ef4444',
      info: '#6366f1',
    },
    styles: {
      borderRadius: 'large',
      shadow: 'medium',
      spacing: 'relaxed',
    },
    isSystem: true,
  },
];

// ============================================
// ヘルパー関数
// ============================================

/**
 * テーマからコンポーネントの完全なスタイルを取得
 * デフォルト値とテーマ値をマージ
 */
export function getComponentStyles(theme: WebsiteTheme): ComponentStyles {
  return {
    link: {
      ...DEFAULT_COMPONENT_STYLES.link,
      color: theme.colors.accent || theme.colors.primary,
      hoverColor: theme.colors.primary,
      ...theme.components?.link,
    },
    button: {
      ...DEFAULT_COMPONENT_STYLES.button,
      primary: {
        backgroundColor: theme.colors.primary,
        textColor: '#ffffff',
        ...theme.components?.button?.primary,
      },
      secondary: {
        backgroundColor: theme.colors.secondary || theme.colors.surface,
        textColor: theme.colors.text,
        borderColor: theme.colors.border,
        ...theme.components?.button?.secondary,
      },
      outline: {
        backgroundColor: 'transparent',
        textColor: theme.colors.primary,
        borderColor: theme.colors.primary,
        ...theme.components?.button?.outline,
      },
      ghost: {
        backgroundColor: 'transparent',
        textColor: theme.colors.text,
        ...theme.components?.button?.ghost,
      },
      ...theme.components?.button,
    },
    table: {
      ...DEFAULT_COMPONENT_STYLES.table,
      headerBackgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      headerTextColor: theme.colors.text,
      headerBorderColor: theme.colors.border,
      cellBorderColor: theme.colors.border,
      stripedBackgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      hoverBackgroundColor: theme.colors.surface,
      ...theme.components?.table,
    },
    blockquote: {
      ...DEFAULT_COMPONENT_STYLES.blockquote,
      backgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      borderLeftColor: theme.colors.primary,
      textColor: theme.colors.textMuted || theme.colors.text,
      ...theme.components?.blockquote,
    },
    list: {
      ...DEFAULT_COMPONENT_STYLES.list,
      markerColor: theme.colors.primary,
      ...theme.components?.list,
    },
    code: {
      ...DEFAULT_COMPONENT_STYLES.code,
      inlineBackgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      inlineTextColor: theme.colors.accent || theme.colors.primary,
      blockBackgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      blockTextColor: theme.colors.text,
      blockBorderColor: theme.colors.border,
      ...theme.components?.code,
    },
    card: {
      ...DEFAULT_COMPONENT_STYLES.card,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      shadow: SHADOW_OPTIONS.find(s => s.value === theme.styles?.shadow)?.css || 'none',
      ...theme.components?.card,
    },
    form: {
      ...DEFAULT_COMPONENT_STYLES.form,
      inputBackgroundColor: theme.colors.background,
      inputTextColor: theme.colors.text,
      inputBorderColor: theme.colors.border,
      inputFocusBorderColor: theme.colors.primary,
      inputFocusRingColor: `${theme.colors.primary}33`,
      placeholderColor: theme.colors.textMuted || theme.colors.secondary,
      labelColor: theme.colors.text,
      errorBorderColor: theme.colors.error,
      errorTextColor: theme.colors.error,
      ...theme.components?.form,
    },
    divider: {
      ...DEFAULT_COMPONENT_STYLES.divider,
      color: theme.colors.border,
      ...theme.components?.divider,
    },
    badge: {
      ...DEFAULT_COMPONENT_STYLES.badge,
      backgroundColor: theme.colors.surfaceAlt || theme.colors.surface,
      textColor: theme.colors.text,
      ...theme.components?.badge,
    },
    alert: {
      ...DEFAULT_COMPONENT_STYLES.alert,
      successBackgroundColor: `${theme.colors.success}15`,
      successBorderColor: theme.colors.success,
      successTextColor: theme.colors.success,
      warningBackgroundColor: `${theme.colors.warning}15`,
      warningBorderColor: theme.colors.warning,
      warningTextColor: theme.colors.warning,
      errorBackgroundColor: `${theme.colors.error}15`,
      errorBorderColor: theme.colors.error,
      errorTextColor: theme.colors.error,
      infoBackgroundColor: `${theme.colors.info}15`,
      infoBorderColor: theme.colors.info,
      infoTextColor: theme.colors.info,
      ...theme.components?.alert,
    },
  };
}

/**
 * テーマから完全なタイポグラフィ設定を取得
 * デフォルト値とテーマ値をマージ
 */
export function getTypography(theme: WebsiteTheme): WebsiteTypography {
  return {
    ...DEFAULT_WEBSITE_TYPOGRAPHY,
    ...theme.typography,
    headings: {
      ...DEFAULT_HEADING_STYLES,
      ...theme.typography?.headings,
    },
    body: {
      ...DEFAULT_BODY_STYLES,
      ...theme.typography?.body,
    },
  };
}
