import { Timestamp } from '../vendor/firebase-firestore';

// =====================================================
// Website（Webサイト）
// =====================================================

// Webサイトのカテゴリ
export type WebsiteCategory =
  | 'landing'      // ランディングページ
  | 'corporate'    // コーポレートサイト
  | 'portfolio'    // ポートフォリオ
  | 'blog'         // ブログ
  | 'ecommerce'    // ECサイト
  | 'other';       // その他

// Webサイト
export interface Website {
  id: string;
  title: string;
  description: string;
  userId: string;
  pageCount: number;
  sourceWebsiteMasterId?: string; // 作成元のWebサイトマスターID
  settings: {
    theme: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor: string;
    fontFamily: string;
    domain?: string;
    favicon?: string;
  };
  // 直近の生成設定を保存して、再編集・再利用を可能にする
  lastGenerationConfig?: {
    prompt?: string;
    pageMasterId?: string;
    websiteMasterId?: string;
    theme?: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor?: string;
    modelName?: string;
  };
  metadata: {
    tags: string[];
    category?: WebsiteCategory;
    isPublished?: boolean;
    publishedUrl?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =====================================================
// WebPage（Webページ）
// =====================================================

// ページのカテゴリ（Webサイトのページタイプ）
// マルチページWebサイトにおける各ページの種類を表す
export type PageCategory =
  | 'home'          // トップページ・ホームページ
  | 'services'      // サービス紹介ページ
  | 'about'         // 会社概要・自己紹介ページ
  | 'contact'       // お問い合わせページ
  | 'pricing'       // 料金・プランページ
  | 'portfolio'     // 実績・ポートフォリオページ
  | 'blog'          // ブログ・お知らせページ
  | 'news'          // ニュース・更新情報ページ
  | 'faq'           // よくある質問ページ
  | 'team'          // チーム紹介ページ
  | 'custom';       // その他のカスタムページ

// セクションカテゴリ（ページマスター用）
// ページ内のセクション・コンポーネントの種類を表す
export type SectionCategory =
  | 'hero'          // ヒーローセクション
  | 'features'      // 機能紹介セクション
  | 'pricing'       // 料金セクション
  | 'testimonials'  // お客様の声セクション
  | 'contact'       // お問い合わせフォームセクション
  | 'about'         // 会社概要セクション
  | 'blog'          // ブログセクション
  | 'footer'        // フッターセクション
  | 'header'        // ヘッダーセクション
  | 'cta'           // CTAセクション
  | 'gallery'       // ギャラリーセクション
  | 'team'          // チーム紹介セクション
  | 'faq'           // FAQセクション
  | 'custom';       // カスタムセクション

// Webページ
export interface WebPage {
  id: string;
  websiteId: string;
  title: string;
  slug: string;
  pageNumber: number;
  pageMasterId?: string;
  content: {
    title?: string;
    description?: string;
    html?: string;
    css?: string;
    sections?: PageSection[];
    metadata?: Record<string, unknown>;
  };
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    ogImage?: string;
    keywords?: string[];
  };
  layoutMode?: 'absolute' | 'auto';
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ページセクション
export interface PageSection {
  id: string;
  type: PageCategory;
  order: number;
  content: {
    html?: string;
    css?: string;
    data?: Record<string, unknown>;
  };
}

// =====================================================
// WebsitePlan（Webサイト生成計画）
// =====================================================

// 計画内の個別ページ
export interface PagePlanItem {
  id: string;
  title: string;
  pageNumber: number;
  slug: string;
  category: PageCategory;
  content: {
    title: string;
    description?: string;
    sections?: string[];
    notes?: string;
  };
  recommendedMaster?: string;
  // 画像・ビジュアル関連
  visualElements?: {
    needsImage?: boolean;
    imageDescription?: string;
    imageStyle?: 'realistic' | 'illustration' | 'icon' | 'diagram' | 'flat' | 'minimal';
  };
  // Figma参照情報（デザイン再現時に使用）
  figmaReference?: {
    url: string;           // FigmaのURL
    nodeId?: string;       // 特定のノードID
    nodeName?: string;     // ノード名
    description?: string;  // このデザインの説明
  };
  // 計画編集用フィールド
  userInstructions?: string;
  isDeleted?: boolean;
  isNew?: boolean;
}

// Webサイト生成計画
export interface WebsitePlan {
  overview: string;
  pages: PagePlanItem[];
  structure: {
    totalPages: number;
    navigation: NavigationItem[];
    sitemap: string;
  };
  theme: {
    primaryColor: string;
    mood: string;
    targetAudience: string;
  };
  // Figma参照情報（計画全体のソース）
  figmaSource?: {
    url: string;           // 元のFigma URL
    fileKey?: string;      // Figmaファイルキー
    nodeName?: string;     // メインノード名
    isDesignReproduction?: boolean; // デザイン再現モードかどうか
  };
}

// ナビゲーション項目
export interface NavigationItem {
  label: string;
  slug: string;
  order: number;
  children?: NavigationItem[];
}

// =====================================================
// 作成・更新用データ型
// =====================================================

export interface CreateWebsiteData {
  title: string;
  description: string;
  sourceWebsiteMasterId?: string;
  settings?: Partial<Website['settings']>;
  metadata?: Partial<Website['metadata']>;
}

export interface UpdateWebsiteData {
  title?: string;
  description?: string;
  pageCount?: number;
  settings?: Partial<Website['settings']>;
  metadata?: Partial<Website['metadata']>;
  lastGenerationConfig?: Website['lastGenerationConfig'];
}

export interface CreatePageData {
  title: string;
  slug: string;
  pageNumber: number;
  pageMasterId?: string;
  content: WebPage['content'];
  seo?: WebPage['seo'];
  layoutMode?: 'absolute' | 'auto';
}

export interface UpdatePageData {
  title?: string;
  slug?: string;
  pageNumber?: number;
  pageMasterId?: string;
  content?: Partial<WebPage['content']>;
  seo?: Partial<WebPage['seo']>;
  layoutMode?: 'absolute' | 'auto';
}

// =====================================================
// フィルター用型
// =====================================================

export interface WebsiteFilter {
  userId?: string;
  tags?: string[];
  search?: string;
  category?: WebsiteCategory;
  isPublished?: boolean;
}

export interface PageFilter {
  websiteId?: string;
  category?: PageCategory;
  search?: string;
}

// =====================================================
// AI生成用型
// =====================================================

// ページ生成リクエスト
export interface PageGenerationRequest {
  prompt: string;
  pageMasterId?: string;
  pageMasterInfo?: {
    htmlTemplate: string;
    cssStyles?: string;
    category: PageCategory;
    samplePages?: PageGenerationResult[];
  };
  attachedFiles?: Array<{
    name: string;
    type: string;
    data: string;
  }>;
  theme?: Website['settings']['theme'];
  primaryColor?: string;
  websiteContext?: {
    title: string;
    description: string;
    existingPages?: Array<{
      title: string;
      slug: string;
      category: PageCategory;
    }>;
  };
}

// ページ生成結果
export interface PageGenerationResult {
  title: string;
  slug: string;
  pageNumber: number;
  category: PageCategory;
  content: WebPage['content'];
  html: string;
  css: string;
  seo?: WebPage['seo'];
  metadata?: {
    pageNumber: number;
    category: string;
    generatedAt: string;
    modelName: string;
    estimatedTime: string;
  };
}

// Webサイト生成リクエスト
export interface WebsiteGenerationRequest {
  prompt: string;
  pageCount?: number;
  websiteMasterId?: string;
  websiteMasterInfo?: {
    name: string;
    description: string;
    pages: Array<{
      title: string;
      slug: string;
      category: PageCategory;
    }>;
  };
  attachedFiles?: Array<{
    name: string;
    type: string;
    data: string;
  }>;
  theme?: Website['settings']['theme'];
  primaryColor?: string;
  /** When true, skip theme settings and prioritize Figma design fidelity */
  codingMode?: boolean;
}

// =====================================================
// 一覧表示用の拡張型
// =====================================================

// 一覧表示用（先頭ページ含む）
export interface WebsiteWithFirstPage extends Website {
  firstPage?: {
    html: string;
    title: string;
    slug: string;
  };
}

// =====================================================
// 出力用型
// =====================================================

export interface WebsiteExportOptions {
  format: 'html' | 'zip' | 'json';
  includeAssets?: boolean;
  minify?: boolean;
}

export interface WebsiteExportResult {
  success: boolean;
  data?: string;
  downloadUrl?: string;
  error?: string;
}

// =====================================================
// 生成ステータス
// =====================================================

export interface WebsiteGenerationStatus {
  status: 'idle' | 'planning' | 'generating' | 'completed' | 'error';
  progress: number;
  currentPage?: number;
  totalPages?: number;
  message?: string;
  error?: string;
  completedPages?: number[];
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}
