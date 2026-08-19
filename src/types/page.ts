import { Timestamp } from '../vendor/firebase-firestore';

export interface Page {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  description?: string;           // ページの説明
  fullPath: string;
  parentId?: string;
  children: string[];
  level: number;
  order: number;
  settings: PageSettings;
  currentGenerationId?: string;
  totalGenerations: number;
  // レイアウト関連フィールド
  selectedLayoutId?: string;      // このページに適用するレイアウトID
  // フロー管理関連フィールド
  flowPosition?: { x: number; y: number }; // React Flowでの位置
  // リソース関連フィールド
  resourceCount?: number;         // 関連リソース数
  lastResourceUpdate?: Timestamp; // 最終リソース更新日時
  // 🆕 ページ戦略・分析フィールド
  priority?: 'highest' | 'high' | 'medium' | 'low'; // 重要度
  purpose?: 'awareness' | 'consideration' | 'conversion' | 'support' | 'other'; // 目的
  targetAudience?: 'potential' | 'aware' | 'consideration' | 'existing' | 'other'; // ターゲット
  strategy?: string;              // 戦略（自由入力）
  functionalRequirements?: string; // 機能要件（自由入力）
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastGeneratedAt?: Timestamp; // 最終生成日時
  // Figmaエクスポート関連フィールド
  figmaExportData?: string;     // Figmaクリップボードデータ
  figmaExportedAt?: Timestamp;  // Figmaエクスポート日時
}

/**
 * OGP (Open Graph Protocol) 設定
 */
export interface OgpSettings {
  /** og:title */
  title?: string;
  /** og:description */
  description?: string;
  /** og:image URL */
  image?: string;
  /** og:type (website, article, product など) */
  type?: 'website' | 'article' | 'product' | 'profile' | string;
  /** og:url */
  url?: string;
  /** og:site_name */
  siteName?: string;
  /** og:locale */
  locale?: string;
}

/**
 * Twitter Card 設定
 */
export interface TwitterCardSettings {
  /** twitter:card (summary, summary_large_image, app, player) */
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  /** twitter:site (@username) */
  site?: string;
  /** twitter:creator (@username) */
  creator?: string;
  /** twitter:title */
  title?: string;
  /** twitter:description */
  description?: string;
  /** twitter:image URL */
  image?: string;
}

/**
 * 外部リソース
 */
export interface ExternalResource {
  /** リソースID */
  id: string;
  /** リソースURL */
  url: string;
  /** リソースタイプ */
  type: 'css' | 'js';
  /** 読み込み位置 (JSのみ) */
  position?: 'head' | 'body-start' | 'body-end';
  /** async属性 (JSのみ) */
  async?: boolean;
  /** defer属性 (JSのみ) */
  defer?: boolean;
  /** 説明・メモ */
  description?: string;
}

export interface PageSettings {
  // ===== 基本設定（既存） =====
  isPublished: boolean;
  showInNavigation: boolean;
  navigationLabel?: string;

  // ===== SEO設定 =====
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  canonicalUrl?: string;
  robots?: string;

  // ===== OGP設定 =====
  /** @deprecated ogImageの代わりにogp.imageを使用してください */
  ogImage?: string;
  ogp?: OgpSettings;

  // ===== Twitter Card設定 =====
  twitter?: TwitterCardSettings;

  // ===== カスタムコード =====
  /** @deprecated customCSSの代わりにcustomCssを使用してください */
  customCSS?: string;
  /** @deprecated customJSの代わりにcustomJsを使用してください */
  customJS?: string;
  customCss?: string;
  customJs?: string;

  // ===== HTML挿入 =====
  /** ページ固有の<head>追加HTML */
  customHeadHtml?: string;
  /** ページ固有の<body>開始直後HTML */
  bodyStartHtml?: string;
  /** ページ固有の</body>直前HTML */
  bodyEndHtml?: string;

  // ===== 外部リソース =====
  externalCss?: ExternalResource[];
  externalJs?: ExternalResource[];
}

export interface PageGeneration {
  id: string;
  pageId: string;
  prompt: string;
  result: GenerationResult;
  version: number;
  isCurrent: boolean;
  createdAt: Timestamp;
}

export interface GenerationResult {
  html: string;
  css: string;
  components: ComponentUsage[];
  navigation: NavigationStructure;
  internalLinks: InternalLink[];
  metadata: GenerationMetadata;
}

export interface ComponentUsage {
  componentId: string;
  componentName: string;
  props: Record<string, unknown>;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface NavigationStructure {
  global: NavigationItem[];
  breadcrumb: BreadcrumbItem[];
  sidebar?: NavigationItem[];
  footer?: NavigationItem[];
}

export interface NavigationItem {
  label: string;
  path: string;
  pageId: string;
  children?: NavigationItem[];
  isActive?: boolean;
  isCurrent?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  path: string;
  pageId: string;
}

export interface InternalLink {
  fromPageId: string;
  toPageId: string;
  linkText: string;
  linkType: 'navigation' | 'content' | 'breadcrumb' | 'footer';
  isValid: boolean;
}

export interface GenerationMetadata {
  generationTime: number;
  tokenUsage: number;
  quality: number;
  aiModel: string;
  promptVersion: string;
}

export interface CreatePageData {
  title: string;
  slug: string;
  description?: string;
  parentId?: string;
  selectedLayoutId?: string;
  order?: number;
  settings?: Partial<PageSettings>;
  // 🆕 ページ戦略・分析フィールド
  priority?: 'highest' | 'high' | 'medium' | 'low';
  purpose?: 'awareness' | 'consideration' | 'conversion' | 'support' | 'other';
  targetAudience?: 'potential' | 'aware' | 'consideration' | 'existing' | 'other';
  strategy?: string;
  functionalRequirements?: string;
}

export interface UpdatePageData {
  title?: string;
  slug?: string;
  description?: string;
  parentId?: string;
  order?: number;
  settings?: Partial<PageSettings>;
  // レイアウト関連フィールド
  selectedLayoutId?: string;
  // 🆕 ページ戦略・分析フィールド
  priority?: 'highest' | 'high' | 'medium' | 'low';
  purpose?: 'awareness' | 'consideration' | 'conversion' | 'support' | 'other';
  targetAudience?: 'potential' | 'aware' | 'consideration' | 'existing' | 'other';
  strategy?: string;
  functionalRequirements?: string;
  // Figmaエクスポート関連フィールド
  figmaExportData?: string;
  figmaExportedAt?: Timestamp;
}

export interface MovePageData {
  newParentId?: string;
  newOrder: number;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  isPublished: true,
  showInNavigation: true,
  ogp: {
    type: 'website',
    locale: 'ja_JP',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

/**
 * プロジェクトレベルのデフォルト設定
 */
export interface ProjectPageSettings {
  // ===== 基本SEO =====
  /** デフォルトのtitleテンプレート (例: "{page} | サイト名") */
  titleTemplate?: string;
  /** デフォルトのdescription */
  defaultDescription?: string;
  /** デフォルトのkeywords */
  defaultKeywords?: string;
  /** 言語設定 */
  language?: string;
  /** 文字エンコーディング */
  charset?: string;

  // ===== OGP デフォルト =====
  ogp?: OgpSettings;

  // ===== Twitter Card デフォルト =====
  twitter?: TwitterCardSettings;

  // ===== Favicon =====
  favicon?: {
    /** 標準favicon (ICO/PNG) */
    ico?: string;
    /** Apple Touch Icon */
    appleTouchIcon?: string;
    /** 32x32 PNG */
    png32?: string;
    /** 16x16 PNG */
    png16?: string;
    /** SVG favicon */
    svg?: string;
    /** manifest.json URL */
    manifest?: string;
  };

  // ===== 共通挿入コンテンツ =====
  /** 全ページ共通の<head>追加HTML (analytics, fonts等) */
  commonHeadHtml?: string;
  /** 全ページ共通の<body>開始直後HTML */
  commonBodyStartHtml?: string;
  /** 全ページ共通の</body>直前HTML */
  commonBodyEndHtml?: string;

  // ===== 外部リソース =====
  /** 全ページ共通の外部CSS */
  externalCss?: ExternalResource[];
  /** 全ページ共通の外部JS */
  externalJs?: ExternalResource[];

  // ===== 共通スタイル・スクリプト =====
  /** 全ページ共通のカスタムCSS */
  commonCss?: string;
  /** 全ページ共通のカスタムJS */
  commonJs?: string;
}

export const DEFAULT_PROJECT_PAGE_SETTINGS: ProjectPageSettings = {
  titleTemplate: '{page}',
  language: 'ja',
  charset: 'UTF-8',
  ogp: {
    type: 'website',
    locale: 'ja_JP',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

// 🆕 ページ戦略・分析の選択肢定数
export const PAGE_PRIORITY_OPTIONS = [
  { value: 'highest', label: '最高' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
] as const;

export const PAGE_PURPOSE_OPTIONS = [
  { value: 'awareness', label: '集客・認知' },
  { value: 'consideration', label: '理解促進・比較検討' },
  { value: 'conversion', label: '行動喚起（コンバージョン）' },
  { value: 'support', label: '顧客サポート・関係維持' },
  { value: 'other', label: 'その他・管理的' }
] as const;

export const PAGE_TARGET_AUDIENCE_OPTIONS = [
  { value: 'potential', label: '潜在層' },
  { value: 'aware', label: '課題認知層' },
  { value: 'consideration', label: '比較検討層' },
  { value: 'existing', label: '既存顧客・ファン層' },
  { value: 'other', label: 'その他' }
] as const;

// フロー管理用のメモデータ
export interface ProjectMemo {
  id: string;
  projectId: string;
  content: string;
  color: string;
  position: { x: number; y: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateMemoData {
  content: string;
  color: string;
  position: { x: number; y: number };
}

export interface UpdateMemoData {
  content?: string;
  color?: string;
  position?: { x: number; y: number };
}

export interface PageWithComponents extends Page {
  // ... existing code ...
}

// ページリソース関連の型定義
export interface PageResource {
  id: string;
  pageId: string;
  projectId: string;
  fileName: string;
  originalFileName: string;
  fileType: 'pdf' | 'csv' | 'md' | 'txt' | 'mp4';
  fileSize: number;
  description?: string;
  tags?: string[];         // リソースのタグ
  storageUrl: string;      // Firebase Storageのダウンロード URL
  storagePath: string;     // Firebase Storage内のパス
  uploadedBy: string;      // アップロードしたユーザーID
  isPublic?: boolean;      // 公開設定
  downloadCount: number;   // ダウンロード数
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreatePageResourceData {
  fileName: string;
  fileType: 'pdf' | 'csv' | 'md' | 'txt' | 'mp4';
  fileSize: number;
  description?: string;
}

export interface UpdatePageResourceData {
  fileName?: string;
  description?: string;
  downloadCount?: number;
}

export interface PageResourceUpload {
  file: File;
  description?: string;
} 