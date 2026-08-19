import { Timestamp } from '../vendor/firebase-firestore';
import { PageCategory, SectionCategory, PageGenerationResult } from './website';

// =====================================================
// PageMaster（ページマスター/テンプレート）
// =====================================================

export interface PageMaster {
  id: string;
  name: string;
  description: string;
  category: SectionCategory;  // セクション/コンポーネントの種類
  userId: string;
  isPublic?: boolean;
  layout?: {
    width: number;
    minHeight: number;
    sections: Array<{
      type: 'header' | 'content' | 'footer' | 'sidebar' | 'hero' | 'cta';
      position: { x: number; y: number; width: number; height: number };
      styles?: Record<string, string>;
    }>;
  };
  template: {
    htmlTemplate: string;
    cssClasses: string[];
    variables?: Record<string, string>; // テンプレート変数
  };
  metadata: {
    usageCount: number;
    tags: string[];
    author?: string;
    version?: string;
    rating?: number;
    reviews?: unknown[];
  };
  // AI生成されたサンプルページ
  generatedPage?: PageGenerationResult;
  // 生成時のプロンプト情報（再生成用）
  generationInfo?: {
    prompt: string;
    attachedFiles?: Array<{
      name: string;
      type: string;
      size: number;
      data: string;
    }>;
    modelName?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =====================================================
// WebsiteMaster（Webサイトマスター/テンプレート）
// =====================================================

// Webサイトマスターのカテゴリ
export type WebsiteMasterCategory =
  | 'landing'       // ランディングページ
  | 'corporate'     // コーポレートサイト
  | 'portfolio'     // ポートフォリオ
  | 'blog'          // ブログ
  | 'ecommerce'     // ECサイト
  | 'saas'          // SaaSプロダクト
  | 'agency'        // エージェンシー
  | 'other';        // その他

// Webサイトマスター内のページ定義
export interface WebsiteMasterPage {
  id: string;
  pageMasterId: string;           // 参照するページマスターID
  pageOrder: number;              // ページ順序（1始まり）
  title?: string;                 // カスタムタイトル（上書き用）
  slug?: string;                  // カスタムスラッグ
  notes?: string;                 // 生成時の指示メモ
  overrides?: {                   // ページマスターからの上書き設定
    category?: PageCategory;
    variables?: Record<string, string>;
  };
}

// Webサイトマスター
export interface WebsiteMaster {
  id: string;
  name: string;                    // 例: "SaaS LPテンプレート"
  description: string;
  category: WebsiteMasterCategory;
  userId: string;
  isPublic?: boolean;

  // ページ構成（順序付きリスト）
  pages: WebsiteMasterPage[];

  settings: {
    theme: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor: string;
    fontFamily: string;
  };

  metadata: {
    usageCount: number;
    tags: string[];
    author?: string;
    version?: string;
    estimatedBuildTime?: number;   // 推定構築時間（分）
  };

  // プレビュー用
  preview?: {
    thumbnailUrl?: string;
    demoUrl?: string;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =====================================================
// 作成・更新用データ型
// =====================================================

export interface CreatePageMasterData {
  name: string;
  description: string;
  category: SectionCategory;
  layout?: PageMaster['layout'];
  template: PageMaster['template'];
  metadata?: Partial<PageMaster['metadata']>;
}

export interface UpdatePageMasterData {
  name?: string;
  description?: string;
  category?: SectionCategory;
  layout?: PageMaster['layout'];
  template?: PageMaster['template'];
  metadata?: Partial<PageMaster['metadata']>;
  isPublic?: boolean;
}

export interface CreateWebsiteMasterData {
  name: string;
  description: string;
  category: WebsiteMasterCategory;
  pages: Omit<WebsiteMasterPage, 'id'>[];
  settings?: Partial<WebsiteMaster['settings']>;
  metadata?: Partial<WebsiteMaster['metadata']>;
}

export interface UpdateWebsiteMasterData {
  name?: string;
  description?: string;
  category?: WebsiteMasterCategory;
  pages?: WebsiteMasterPage[];
  settings?: Partial<WebsiteMaster['settings']>;
  metadata?: Partial<WebsiteMaster['metadata']>;
  isPublic?: boolean;
}

// =====================================================
// フィルター用型
// =====================================================

export interface PageMasterFilter {
  category?: SectionCategory;
  userId?: string;
  tags?: string[];
  search?: string;
  isPublic?: boolean;
}

export interface WebsiteMasterFilter {
  category?: WebsiteMasterCategory;
  userId?: string;
  tags?: string[];
  search?: string;
  isPublic?: boolean;
}

// =====================================================
// ページマスター生成用型
// =====================================================

export interface PageMasterGenerationRequest {
  name: string;
  description: string;
  category: SectionCategory;
  samplePrompt: string; // サンプルページ生成用プロンプト
  pageCount?: number; // 自動生成するサンプルページ数（デフォルト1枚）
  attachedFiles?: Array<{
    name: string;
    type: string;
    size: number;
    data: string;
  }>;
}
