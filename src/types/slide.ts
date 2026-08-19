import { Timestamp } from '../vendor/firebase-firestore';

// デザイン自由度設定
// - strict: テンプレート厳守（現行動作）- スライドマスターのデザインを完全に踏襲
// - standard: テーマガイドライン準拠、レイアウト最適化許可（デフォルト）
// - creative: テーマカラーのみ準拠、自由なデザイン
export type DesignFlexibility = 'strict' | 'standard' | 'creative';

// スライドマスター（テンプレート）
export interface SlideMaster {
  id: string;
  name: string;
  description: string;
  category: 'title' | 'content' | 'comparison' | 'chart' | 'conclusion' | 'image' | 'quote' | 'agenda';
  userId: string;
  isPublic?: boolean;
  layout: {
    aspectRatio: '16:9';
    width: number; // 1920
    height: number; // 1080
    sections: Array<{
      type: 'header' | 'content' | 'footer' | 'sidebar';
      position: { x: number; y: number; width: number; height: number };
      styles?: Record<string, string>;
    }>;
  };
  template: {
    htmlTemplate: string;
    cssClasses: string[];
    nextjsCode: string;
  };
  metadata: {
    usageCount: number;
    tags: string[];
    author: string;
    version: string;
    rating: number;
    reviews: unknown[];
  };
  // AI生成されたスライド（1スライドマスター = 1スライド）
  generatedSlide?: SlideGenerationResult;
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

// プレゼンテーション
export interface SlidePresentation {
  id: string;
  title: string;
  description: string;
  userId: string;
  slideCount: number;
  sourcePresentationMasterId?: string; // ⛅ 作成元のプレゼンテーションマスターID
  settings: {
    theme: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor: string;
    fontFamily: string;
    aspectRatio: '16:9';
  };
  // 🆕 直近の生成設定を保存して、再編集・再利用を可能にする
  lastGenerationConfig?: {
    prompt?: string;
    slideMasterId?: string;
    presentationMasterId?: string; // ⛅ 直近で使用したプレゼンテーションマスターID
    theme?: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor?: string;
    modelName?: string;
    useOriginalGeneration?: boolean;
    slideHeightMode?: 'fixed' | 'auto';
  };
  metadata: {
    totalDuration?: number; // 分
    tags: string[];
    category?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}


// スライド
export interface Slide {
  id: string;
  presentationId: string;
  title: string;
  slideNumber: number;
  slideMasterId?: string;
  content: {
    title?: string;
    subtitle?: string;
    bulletPoints?: string[];
    imageUrl?: string;
    customContent?: string;
    chartData?: unknown;
    notes?: string; // スピーカーノート
    html?: string; // 生成されたHTMLコンテンツ
    css?: string; // 生成されたCSSスタイル
    category?: SlideMaster['category']; // スライドのカテゴリ
    metadata?: Record<string, unknown>; // その他のメタデータ
  };
  generatedHtml?: string;
  layoutMode?: 'absolute' | 'auto'; // 🆕 レイアウトモード
  userId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 作成用データ型
export interface CreateSlideMasterData {
  name: string;
  description: string;
  category: SlideMaster['category'];
  layout: SlideMaster['layout'];
  template: SlideMaster['template'];
  metadata?: Partial<SlideMaster['metadata']>;
}

export interface UpdateSlideMasterData {
  name?: string;
  description?: string;
  category?: SlideMaster['category'];
  layout?: SlideMaster['layout'];
  template?: SlideMaster['template'];
  metadata?: Partial<SlideMaster['metadata']>;
}

export interface CreatePresentationData {
  title: string;
  description: string;
  sourcePresentationMasterId?: string; // ⛅ 作成元のプレゼンテーションマスターID
  settings?: Partial<SlidePresentation['settings']>;
  metadata?: Partial<SlidePresentation['metadata']>;
}

export interface UpdatePresentationData {
  title?: string;
  description?: string;
  slideCount?: number;
  settings?: Partial<SlidePresentation['settings']>;
  metadata?: Partial<SlidePresentation['metadata']>;
  lastGenerationConfig?: SlidePresentation['lastGenerationConfig'];
}

export interface CreateSlideData {
  title: string;
  slideNumber: number;
  slideMasterId?: string;
  content: Slide['content'];
  settings?: {
    backgroundColor?: string;
    transition?: string;
    duration?: number;
  };
  metadata?: {
    generatedAt?: Date;
    modelName?: string;
    generationTime?: string;
  };
}

export interface UpdateSlideData {
  title?: string;
  slideNumber?: number;
  slideMasterId?: string;
  content?: Partial<Slide['content']>;
  generatedHtml?: string;
  layoutMode?: 'absolute' | 'auto'; // 🆕 レイアウトモード
}

// フィルター用型
export interface SlideMasterFilter {
  category?: SlideMaster['category'];
  userId?: string;
  tags?: string[];
  search?: string;
  isPublic?: boolean;
}

export interface PresentationFilter {
  userId?: string;
  tags?: string[];
  search?: string;
  category?: string;
}

// AI生成用型 - 計画内の個別スライド
export interface SlidePlanItem {
  id: string; // 一意識別子（並び替え・編集用）
  title: string;
  slideNumber: number;
  category: SlideMaster['category'];
  content: {
    title: string;
    subtitle?: string;
    bulletPoints?: string[];
    notes?: string;
  };
  slideDescription?: string; // そのスライドでカバーすべき内容の短い説明
  templateId?: string; // 推奨するスライドテンプレートID
  recommendedMaster?: string; // スライドマスターID
  // 画像・ビジュアル関連
  visualElements?: {
    needsImage?: boolean; // 画像生成が必要かどうか
    imageDescription?: string; // 必要な画像の説明
    imageStyle?: 'realistic' | 'illustration' | 'icon' | 'diagram' | 'flat' | 'minimal';
    diagramType?: 'flowchart' | 'comparison' | 'timeline' | 'hierarchy' | 'process' | 'cycle';
  };
  // 計画編集用フィールド
  userInstructions?: string; // ユーザーの追加指示メモ
  isDeleted?: boolean; // 削除フラグ（論理削除）
  isNew?: boolean; // 新規追加フラグ
}

export interface SlidePresentationPlan {
  overview: string;
  slides: SlidePlanItem[];
  structure: {
    totalSlides: number;
    estimatedDuration: number; // 分
    flow: string; // プレゼンの流れ説明
  };
  theme: {
    primaryColor: string;
    mood: string;
    audience: string;
  };
}

// 一覧表示用の拡張型（先頭スライド含む）
export interface PresentationWithFirstSlide extends SlidePresentation {
  firstSlide?: {
    html: string;
    title: string;
  };
}

// スライドマスター生成用型
export interface SlideMasterGenerationRequest {
  name: string;
  description: string;
  category: SlideMaster['category'];
  samplePrompt: string; // サンプルスライド生成用プロンプト
  slideCount?: number; // 自動生成するサンプルスライド数（デフォルト1枚）
  attachedFiles?: Array<{
    name: string;
    type: string;
    size: number;
    data: string;
  }>;
}

// プレゼンテーション生成リクエスト（スライドマスター情報含む）
export interface PresentationGenerationRequest {
  prompt: string;
  slideMasterId?: string;
  slideMasterInfo?: {
    htmlTemplate: string;
    cssStyles?: string;
    category: SlideMaster['category'];
    sampleSlides?: SlideGenerationResult[];
  };
  attachedFiles?: Array<{
    name: string;
    type: string;
    data: string;
  }>;
  theme?: SlidePresentation['settings']['theme'];
  primaryColor?: string;
}

export interface SlideGenerationResult {
  title: string;
  slideNumber: number;
  category: SlideMaster['category'];
  content: Slide['content'];
  html: string;
  css: string;
  notes?: string; // スピーカーノート
  mainComponent?: {
    name: string;
    code: string;
    props: Record<string, unknown>;
  };
  explanation?: string;
  slideMasterId?: string;
  metadata?: {
    slideNumber: number;
    category: string;
    generatedAt: string;
    modelName: string;
    estimatedTime: string;
  };
}

// 出力用型
export interface SlideExportOptions {
  format: 'html' | 'figma';
  includeNotes?: boolean;
  theme?: string;
  resolution?: '1920x1080' | '1280x720';
}

export interface SlideExportResult {
  success: boolean;
  data?: string;
  downloadUrl?: string;
  error?: string;
}

// 🆕 プレゼンテーションマスターのカテゴリ
export type PresentationMasterCategory =
  | 'proposal'       // 企画提案書
  | 'design'         // デザインコンセプト
  | 'requirements'   // 要件定義書
  | 'report'         // レポート・報告書
  | 'pitch'          // ピッチデック
  | 'training'       // 研修・教育資料
  | 'other';         // その他

// 🆕 プレゼンテーションマスター内のスライド定義
export interface PresentationMasterSlide {
  id: string;
  slideMasterId: string;          // 参照するスライドマスターID
  slideOrder: number;             // スライド順序（1始まり）
  title?: string;                 // カスタムタイトル（上書き用）
  notes?: string;                 // 生成時の指示メモ
  overrides?: {                   // スライドマスターからの上書き設定
    category?: SlideMaster['category'];
    variables?: Record<string, string>;
  };
}

// 🆕 プレゼンテーションマスター（テンプレート）
export interface PresentationMaster {
  id: string;
  name: string;                    // 例: "企画提案書テンプレート"
  description: string;
  category: PresentationMasterCategory;
  userId: string;

  // スライド構成（順序付きリスト）
  slides: PresentationMasterSlide[];

  settings: {
    theme: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor: string;
    fontFamily: string;
    aspectRatio: '16:9';
  };

  metadata: {
    usageCount: number;
    tags: string[];
    author: string;
    version: string;
    estimatedDuration?: number;   // 推定所要時間（分）
    isPublic: boolean;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 🆕 プレゼンテーションマスター作成用データ型
export interface CreatePresentationMasterData {
  name: string;
  description: string;
  category: PresentationMasterCategory;
  slides: Omit<PresentationMasterSlide, 'id'>[];
  settings?: Partial<PresentationMaster['settings']>;
  metadata?: Partial<PresentationMaster['metadata']>;
}

// 🆕 プレゼンテーションマスター更新用データ型
export interface UpdatePresentationMasterData {
  name?: string;
  description?: string;
  category?: PresentationMasterCategory;
  slides?: PresentationMasterSlide[];
  settings?: Partial<PresentationMaster['settings']>;
  metadata?: Partial<PresentationMaster['metadata']>;
}

// 🆕 プレゼンテーションマスターフィルター
export interface PresentationMasterFilter {
  category?: PresentationMasterCategory;
  userId?: string;
  tags?: string[];
  search?: string;
  isPublic?: boolean;
} 