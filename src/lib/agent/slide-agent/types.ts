/**
 * Slide Agent 型定義
 *
 * Interactions API を使用したスライド生成エージェントの型定義
 */

import type { SlidePresentationPlan, SlideGenerationResult, SlideMaster, Slide, DesignFlexibility } from '../../../types/slide';
/** 移植時にローカル定義へ置換(オリジナルは @/lib/ai/gemini-presentaion) */
type ThemeDetails = Record<string, unknown>;

// Re-export types used by other modules
export type { SlidePresentationPlan, SlideGenerationResult, SlideMaster, Slide, ThemeDetails, DesignFlexibility };

// =====================
// Interactions API 型
// =====================

/**
 * ツール定義
 */
export interface SlideAgentTool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/**
 * インタラクションオプション
 */
export interface InteractionOptions {
  model?: string;
  previousInteractionId?: string;
  stream?: boolean;
  systemInstruction?: string;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
    thinkingSummaries?: 'auto' | 'none';
  };
  store?: boolean;
}

/**
 * インタラクション出力
 */
export type InteractionOutput =
  | TextOutput
  | ThoughtOutput
  | ToolCallOutput
  | ToolResultOutput;

export interface TextOutput {
  type: 'text';
  text: string;
}

export interface ThoughtOutput {
  type: 'thought';
  summary?: string;
  signature: string;
}

export interface ToolCallOutput {
  type: 'function_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultOutput {
  type: 'function_result';
  name: string;
  call_id: string;
  result: unknown;
}

/**
 * インタラクション結果
 */
export interface InteractionResult {
  id: string;
  status: 'completed' | 'in_progress' | 'requires_action' | 'failed' | 'cancelled';
  outputs: InteractionOutput[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// =====================
// ツール引数型
// =====================

/**
 * generate_slide_plan ツール引数
 */
export interface GeneratePlanArgs {
  prompt: string;
  slideCount?: number;
  theme?: 'light' | 'dark' | 'corporate' | 'modern';
  primaryColor?: string;
  attachedFiles?: Array<{
    name: string;
    type: string;
    data: string; // base64
  }>;
}

/**
 * generate_slide_html ツール引数
 */
export interface GenerateSlideHtmlArgs {
  slideIndex: number;
  plan: SlidePresentationPlan;
  slideMasterId?: string;
  theme?: string;
  primaryColor?: string;
  slideHeightMode?: 'fixed' | 'auto';
}

/**
 * search_slide_masters ツール引数
 */
export interface SearchSlideMastersArgs {
  query?: string;
  category?: SlideMaster['category'];
  limit?: number;
}

/**
 * get_slide_master ツール引数
 */
export interface GetSlideMasterArgs {
  masterId: string;
}

/**
 * save_slide ツール引数
 */
export interface SaveSlideArgs {
  presentationId: string;
  slideData: {
    title: string;
    slideNumber: number;
    html: string;
    css?: string;
    notes?: string;
    category?: string;
    slideMasterId?: string;
  };
}

/**
 * update_slide ツール引数
 */
export interface UpdateSlideArgs {
  presentationId: string;
  slideId: string;
  updates: Partial<{
    title: string;
    content: Slide['content'];
    generatedHtml: string;
  }>;
}

/**
 * google_search ツール引数
 */
export interface GoogleSearchArgs {
  query: string;
  maxResults?: number;
}

/**
 * generate_image ツール引数
 */
export interface GenerateImageArgs {
  prompt: string;
  style?: 'realistic' | 'illustration' | 'icon' | 'diagram' | 'flat' | 'minimal';
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4' | '9:16';
  backgroundColor?: string;
}

/**
 * fetch_page ツール引数
 */
export interface FetchPageArgs {
  url: string;
  extractText?: boolean;
}

// =====================
// ツール結果型
// =====================

export interface GeneratePlanResult {
  success: boolean;
  plan?: SlidePresentationPlan;
  error?: string;
}

export interface GenerateSlideHtmlResult {
  success: boolean;
  slide?: SlideGenerationResult;
  error?: string;
  // 自動生成された画像情報
  generatedImage?: {
    dataUri: string;
    description?: string;
  };
}

export interface SearchSlideMastersResult {
  success: boolean;
  masters?: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    thumbnail?: string;
  }>;
  error?: string;
}

export interface GetSlideMasterResult {
  success: boolean;
  master?: SlideMaster;
  error?: string;
}

export interface SaveSlideResult {
  success: boolean;
  slideId?: string;
  error?: string;
}

export interface UpdateSlideResult {
  success: boolean;
  error?: string;
}

export interface GoogleSearchResult {
  success: boolean;
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  error?: string;
}

export interface GenerateImageResult {
  success: boolean;
  imageUrl?: string;  // data URI形式の画像（内部用）
  imageId?: string;   // 画像ID（キャッシュ参照用）
  message?: string;   // メッセージ
  error?: string;
}

export interface FetchPageResult {
  success: boolean;
  content?: string;
  title?: string;
  error?: string;
}

// =====================
// エージェントモード
// =====================

/**
 * エージェント実行モード
 * - plan: 計画のみ生成（generate_slide_planのみ使用）
 * - generate: スライド生成（generate_slide_html, save_slide等を使用）
 * - generate_single: 単一スライド生成（1スライド=1インタラクション）
 * - full: 計画からスライド生成まで一括実行
 * - element_replace: 要素置換（選択要素をAI生成HTMLで置換）
 */
export type SlideAgentMode = 'plan' | 'generate' | 'generate_single' | 'full' | 'element_replace';

// =====================
// 要素置換（element_replace）関連
// =====================

/**
 * 添付ファイル型
 */
export interface AttachedFile {
  name: string;
  type: string;      // MIME type (e.g., 'image/png', 'application/pdf')
  size: number;
  data: string;      // Base64 encoded data
}

/**
 * generate_element_html ツール引数
 */
export interface GenerateElementHtmlArgs {
  prompt: string;                    // ユーザーのプロンプト
  slideHtml: string;                 // 現在のスライド全体HTML
  selectedElementHtml: string;       // 選択中の要素HTML
  selectedElementInfo: {             // 要素のメタ情報
    tagName: string;
    width: number;
    height: number;
    position: { x: number; y: number };
  };
  imageId?: string;                  // 使用する画像ID（generate_imageで生成した場合）
  attachedFiles?: AttachedFile[];    // 添付ファイル（画像、PDF等）
}

/**
 * generate_element_html ツール結果
 */
export interface GenerateElementHtmlResult {
  success: boolean;
  html?: string;                     // 生成されたHTML
  explanation?: string;              // 生成内容の説明
  error?: string;
}

// =====================
// 画像キャッシュ
// =====================

/**
 * 生成された画像のキャッシュエントリ
 * Firebase Storageにアップロードされた画像のメタデータを保持
 */
export interface GeneratedImageCache {
  imageId: string;
  storageUrl: string;  // Firebase StorageのURL
  storagePath?: string; // Storage内のパス
  prompt: string;
  style?: string;
  createdAt: number;
}

// =====================
// エージェントコンテキスト
// =====================

/**
 * テーマ詳細情報
 * Note: ThemeDetails は gemini-presentaion.ts からインポート・再エクスポートされています
 */
export type ThemeDetailsContext = ThemeDetails;

/**
 * スライドエージェントのコンテキスト
 */
export interface SlideAgentContext {
  userId: string;
  presentationId?: string;
  modelName?: string;
  originalPrompt?: string; // ユーザーの元のプロンプト（スライド生成時に使用）
  currentPlan?: SlidePresentationPlan;
  generatedSlides?: SlideGenerationResult[];
  // 画像キャッシュ（generate_imageの結果を内部保持）
  generatedImages?: Map<string, GeneratedImageCache>;
  latestImageId?: string;
  // テーマ関連
  theme?: string;
  themeDetails?: ThemeDetailsContext;
  primaryColor?: string;
  slideHeightMode?: 'fixed' | 'auto';
  slideMasterId?: string;
  /** デザイン自由度設定（デフォルト: standard） */
  designFlexibility?: DesignFlexibility;
  // 要素置換用コンテキスト
  elementReplaceContext?: {
    slideHtml: string;
    selectedElementHtml: string;
    selectedElementInfo: {
      tagName: string;
      width: number;
      height: number;
      position: { x: number; y: number };
    };
  };
}

/**
 * ツールハンドラー
 */
export type ToolHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  context: SlideAgentContext
) => Promise<TResult>;

/**
 * ツールレジストリ
 */
export interface ToolRegistry {
  tools: SlideAgentTool[];
  handlers: Map<string, ToolHandler>;
}

// =====================
// SSE ストリーミング型
// =====================

export interface SSEEvent {
  type: 'status' | 'progress' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'complete';
  data: unknown;
}

export interface SSEStatusEvent extends SSEEvent {
  type: 'status';
  data: {
    stage: 'initializing' | 'planning' | 'generating' | 'saving' | 'complete' | 'error';
    message: string;
  };
}

export interface SSEProgressEvent extends SSEEvent {
  type: 'progress';
  data: {
    current: number;
    total: number;
    message: string;
  };
}

export interface SSEToolCallEvent extends SSEEvent {
  type: 'tool_call';
  data: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface SSEToolResultEvent extends SSEEvent {
  type: 'tool_result';
  data: {
    name: string;
    success: boolean;
    result?: unknown;
    error?: string;
  };
}

export interface SSETextEvent extends SSEEvent {
  type: 'text';
  data: {
    text: string;
    isPartial?: boolean;
  };
}

export interface SSEErrorEvent extends SSEEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

export interface SSECompleteEvent extends SSEEvent {
  type: 'complete';
  data: {
    plan?: SlidePresentationPlan;
    slides?: SlideGenerationResult[];
    message: string;
  };
}

// =====================
// API リクエスト/レスポンス
// =====================

/**
 * スライドエージェント API リクエスト
 */
export interface SlideAgentRequest {
  prompt: string;
  presentationId?: string; // element_replaceモードではオプショナル
  userId: string;
  options?: {
    /** エージェント実行モード（plan: 計画のみ, generate: スライド生成, generate_single: 単一スライド, full: 一括, element_replace: 要素置換） */
    mode?: SlideAgentMode;
    /** 生成するスライドのインデックス（generate_singleモード時に必須、0から開始） */
    slideIndex?: number;
    slideCount?: number;
    theme?: 'light' | 'dark' | 'corporate' | 'modern';
    /** テーマ詳細（色、タイポグラフィ、レイアウト設定） */
    themeDetails?: ThemeDetails;
    primaryColor?: string;
    slideMasterId?: string;
    presentationMasterId?: string;
    modelName?: string;
    slideHeightMode?: 'fixed' | 'auto';
    /** デザイン自由度設定（strict: テンプレート厳守, standard: 推奨, creative: 自由） */
    designFlexibility?: DesignFlexibility;
    attachedFiles?: Array<{
      name: string;
      type: string;
      size: number;
      data: string;
    }>;
    stream?: boolean;
    /** 既存の計画（generate/generate_singleモード時に使用） */
    existingPlan?: SlidePresentationPlan;
    /** 要素置換用オプション（element_replaceモード時に使用） */
    elementReplace?: {
      slideHtml: string;
      selectedElementHtml: string;
      selectedElementInfo: {
        tagName: string;
        width: number;
        height: number;
        position: { x: number; y: number };
      };
      attachedFiles?: AttachedFile[];  // 添付ファイル（画像、PDF等）
    };
  };
}

/**
 * スライドエージェント API レスポンス
 */
export interface SlideAgentResponse {
  success: boolean;
  interactionId?: string;
  plan?: SlidePresentationPlan;
  slides?: SlideGenerationResult[];
  /** 要素置換モード用: 生成されたHTML */
  generatedHtml?: string;
  message?: string;
  error?: string;
}
