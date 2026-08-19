/**
 * Website Agent 型定義
 *
 * Interactions API を使用したWebサイト生成エージェントの型定義
 */

import type { WebsitePlan, PageGenerationResult, WebPage, PageCategory, SectionCategory } from '../../../types/website';
import type { PageMaster } from '../../../types/page-master';

// =====================
// Interactions API 型
// =====================

/**
 * ツール定義
 */
export interface WebsiteAgentTool {
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
 * generate_website_plan ツール引数
 */
export interface GenerateWebsitePlanArgs {
  prompt: string;
  pageCount?: number;
  theme?: 'light' | 'dark' | 'corporate' | 'modern';
  primaryColor?: string;
  attachedFiles?: Array<{
    name: string;
    type: string;
    data: string; // base64
  }>;
  /** figma_get_design で取得したデザインデータ */
  figmaDesignData?: {
    fileKey?: string;  // FigmaファイルキーURL再構築用）
    nodeId?: string;
    nodeName?: string;
    structure?: Record<string, unknown>;
    hint?: string;
    image?: {
      base64: string;
      mimeType: string;
    };
  };
}

/**
 * generate_page_html ツール引数
 */
export interface GeneratePageHtmlArgs {
  pageIndex: number;
  plan: WebsitePlan;
  pageMasterId?: string;
  theme?: string;
  primaryColor?: string;
  /** figma_get_design で取得したFigmaデザインコンテキスト */
  figmaDesignContext?: {
    nodeId?: string;
    nodeName?: string;
    structure?: Record<string, unknown>;
    hint?: string;
    image?: {
      base64: string;
      mimeType: string;
    };
  };
}

/**
 * search_page_masters ツール引数
 */
export interface SearchPageMastersArgs {
  query?: string;
  category?: SectionCategory;
  limit?: number;
}

/**
 * get_page_master ツール引数
 */
export interface GetPageMasterArgs {
  masterId: string;
}

/**
 * save_page ツール引数
 */
export interface SavePageArgs {
  websiteId: string;
  pageData: {
    title: string;
    slug: string;
    pageNumber: number;
    html: string;
    css?: string;
    category?: PageCategory;
    pageMasterId?: string;
    seo?: {
      metaTitle?: string;
      metaDescription?: string;
      keywords?: string[];
    };
  };
}

/**
 * update_page ツール引数
 */
export interface UpdatePageArgs {
  websiteId: string;
  pageId: string;
  updates: Partial<{
    title: string;
    slug: string;
    content: WebPage['content'];
    seo: WebPage['seo'];
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

export interface GenerateWebsitePlanResult {
  success: boolean;
  plan?: WebsitePlan;
  error?: string;
}

export interface GeneratePageHtmlResult {
  success: boolean;
  page?: PageGenerationResult;
  error?: string;
  // 自動生成された画像情報
  generatedImage?: {
    dataUri: string;
    description?: string;
  };
}

export interface SearchPageMastersResult {
  success: boolean;
  masters?: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
  }>;
  error?: string;
}

export interface GetPageMasterResult {
  success: boolean;
  master?: PageMaster;
  error?: string;
}

export interface SavePageResult {
  success: boolean;
  pageId?: string;
  error?: string;
}

export interface UpdatePageResult {
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
// Figma ツール型
// =====================

/**
 * Figma内で検出された画像ノード情報
 */
export interface FigmaImageNodeInfo {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  isImageFill: boolean;
  isVectorNode: boolean;
}

/**
 * figma_get_design ツール引数
 */
export interface FigmaGetDesignArgs {
  figmaUrl: string;
  depth?: number;
  includeImage?: boolean;
  /** 画像ノードを自動的に抽出してFirebase Storageにアップロードするか */
  extractAssets?: boolean;
}

/**
 * figma_get_design ツール結果
 */
export interface FigmaGetDesignResult {
  success: boolean;
  fileKey?: string;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  structure?: Record<string, unknown>;
  image?: {
    base64: string;
    mimeType: string;
    url?: string;
  };
  hint?: string;
  /** 検出された画像ノード一覧 */
  detectedImageNodes?: FigmaImageNodeInfo[];
  /** 抽出されたアセット（ノードID → Firebase Storage URL） */
  extractedAssets?: Record<string, string>;
  /** Figma APIから取得した生のノードデータ（決定論的変換用） */
  rawNode?: Record<string, unknown>;
  error?: string;
}

/**
 * figma_list_components ツール引数
 */
export interface FigmaListComponentsArgs {
  figmaUrl: string;
}

/**
 * figma_list_components ツール結果
 */
export interface FigmaListComponentsResult {
  success: boolean;
  fileName?: string;
  lastModified?: string;
  pages?: Array<{
    id: string;
    name: string;
    frames: Array<{
      id: string;
      name: string;
      type: string;
      width?: number;
      height?: number;
    }>;
  }>;
  hint?: string;
  error?: string;
}

/**
 * figma_export_image ツール引数
 */
export interface FigmaExportImageArgs {
  figmaUrl: string;
  format?: 'png' | 'jpg' | 'svg';
  scale?: number;
}

/**
 * figma_export_image ツール結果
 */
export interface FigmaExportImageResult {
  success: boolean;
  url?: string;
  storagePath?: string;
  format?: string;
  scale?: number;
  originalFigmaUrl?: string;
  hint?: string;
  error?: string;
}

// =====================
// Progressive Generation 型
// =====================

/**
 * セクションタイプ
 */
export type FigmaSectionType = 'header' | 'hero' | 'content' | 'features' | 'cta' | 'footer' | 'navigation' | 'sidebar' | 'other';

/**
 * Figmaセクション情報
 */
export interface FigmaSection {
  id: string;
  name: string;
  type: FigmaSectionType;
  order: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  figmaUrl?: string;
  childCount: number;
  description?: string;
}

/**
 * analyze_figma_sections ツール引数
 */
export interface AnalyzeFigmaSectionsArgs {
  figmaUrl: string;
  pageCategory?: string;
}

/**
 * 親フレームのスタイル情報
 */
export interface ParentFrameStyles {
  backgroundColor?: string;
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a?: number };
    opacity?: number;
  }>;
  width?: number;
  height?: number;
}

/**
 * analyze_figma_sections ツール結果
 */
export interface AnalyzeFigmaSectionsResult {
  success: boolean;
  sections?: FigmaSection[];
  totalSections?: number;
  analysisHint?: string;
  parentStyles?: ParentFrameStyles;
  error?: string;
}

/**
 * 生成されたセクションHTML
 */
export interface GeneratedSectionHtml {
  sectionId: string;
  sectionType: FigmaSectionType;
  html: string;
  css: string;
  order: number;
}

/**
 * generate_section_html ツール引数
 */
export interface GenerateSectionHtmlArgs {
  sectionIndex: number;
  section: FigmaSection;
  plan: WebsitePlan;
  pageIndex: number;
  previousSections?: GeneratedSectionHtml[];
  parentStyles?: ParentFrameStyles;
  figmaDesignContext?: {
    nodeId?: string;
    nodeName?: string;
    structure?: Record<string, unknown>;
    hint?: string;
    image?: {
      base64: string;
      mimeType: string;
    };
  };
}

/**
 * generate_section_html ツール結果
 */
export interface GenerateSectionHtmlResult {
  success: boolean;
  section?: GeneratedSectionHtml;
  error?: string;
  /** 生成に使用したプロンプト（デバッグ用） */
  generatedPrompt?: string;
}

/**
 * unify_page_styles ツール引数
 */
export interface UnifyPageStylesArgs {
  sections: GeneratedSectionHtml[];
  pageTitle: string;
  pageSlug: string;
  parentStyles?: ParentFrameStyles;
}

/**
 * unify_page_styles ツール結果
 */
export interface UnifyPageStylesResult {
  success: boolean;
  html?: string;
  css?: string;
  unifiedStyles?: {
    colorPalette: string[];
    fontFamilies: string[];
    spacingScale: number[];
  };
  error?: string;
}

// =====================
// エージェントモード
// =====================

/**
 * エージェント実行モード
 * - plan: 計画のみ生成（generate_website_planのみ使用）
 * - generate: ページ生成（generate_page_html, save_page等を使用）
 * - generate_single: 単一ページ生成（1ページ=1インタラクション）
 * - full: 計画からページ生成まで一括実行
 * - element_replace: 要素置換（選択要素をAI生成HTMLで置換）
 */
export type WebsiteAgentMode = 'plan' | 'generate' | 'generate_single' | 'generate_single_progressive' | 'full' | 'element_replace';

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
  pageHtml: string;                  // 現在のページ全体HTML
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
 * Webサイトエージェントのコンテキスト
 */
/**
 * CSSメソドロジー
 */
export type CssMethodology = 'tailwind' | 'flocss';

export interface WebsiteAgentContext {
  userId: string;
  websiteId?: string;
  modelName?: string;
  originalPrompt?: string; // ユーザーの元のプロンプト（ページ生成時に使用）
  currentPlan?: WebsitePlan;
  generatedPages?: PageGenerationResult[];
  // 画像キャッシュ（generate_imageの結果を内部保持）
  generatedImages?: Map<string, GeneratedImageCache>;
  latestImageId?: string;
  // 要素置換用コンテキスト
  elementReplaceContext?: {
    pageHtml: string;
    selectedElementHtml: string;
    selectedElementInfo: {
      tagName: string;
      width: number;
      height: number;
      position: { x: number; y: number };
    };
  };
  // Progressive mode用コンテキスト
  analyzedSections?: FigmaSection[];
  generatedSections?: GeneratedSectionHtml[];
  // CSSメソドロジー設定
  cssMethodology?: CssMethodology;
}

/**
 * ツールハンドラー
 */
export type ToolHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  context: WebsiteAgentContext
) => Promise<TResult>;

/**
 * ツールレジストリ
 */
export interface ToolRegistry {
  tools: WebsiteAgentTool[];
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
    plan?: WebsitePlan;
    pages?: PageGenerationResult[];
    message: string;
  };
}

// =====================
// API リクエスト/レスポンス
// =====================

/**
 * Webサイトエージェント API リクエスト
 */
export interface WebsiteAgentRequest {
  prompt: string;
  websiteId?: string; // element_replaceモードではオプショナル
  userId: string;
  options?: {
    /** エージェント実行モード（plan: 計画のみ, generate: ページ生成, generate_single: 単一ページ, full: 一括, element_replace: 要素置換） */
    mode?: WebsiteAgentMode;
    /** 生成するページのインデックス（generate_singleモード時に必須、0から開始） */
    pageIndex?: number;
    pageCount?: number;
    theme?: 'light' | 'dark' | 'corporate' | 'modern';
    primaryColor?: string;
    pageMasterId?: string;
    websiteMasterId?: string;
    modelName?: string;
    attachedFiles?: Array<{
      name: string;
      type: string;
      size: number;
      data: string;
    }>;
    stream?: boolean;
    /** 既存の計画（generate/generate_singleモード時に使用） */
    existingPlan?: WebsitePlan;
    /** グローバルFigma URL（ページ固有のfigmaReferenceがない場合のフォールバック） */
    globalFigmaUrl?: string;
    /** 要素置換用オプション（element_replaceモード時に使用） */
    elementReplace?: {
      pageHtml: string;
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
 * Webサイトエージェント API レスポンス
 */
export interface WebsiteAgentResponse {
  success: boolean;
  interactionId?: string;
  plan?: WebsitePlan;
  pages?: PageGenerationResult[];
  /** 要素置換モード用: 生成されたHTML */
  generatedHtml?: string;
  message?: string;
  error?: string;
}
