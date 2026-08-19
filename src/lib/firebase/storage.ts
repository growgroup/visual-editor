import { io } from '../../io';
/**
 * ローカル永続化スタブ。オリジナルは Firebase 実装（Firebase Storage）。
 *
 * バックエンドが存在しないため、アップロード系の関数はファイルを転送せず
 * FileReader / Base64 で作った data URL をそのまま storageUrl として返す。
 * 削除系（deletePageResource / deleteFigmaComponentImages）は no-op。
 *
 * 定数（SUPPORTED_FILE_TYPES / MAX_FILE_SIZE / MAX_IMAGE_SIZE /
 * SUPPORTED_IMAGE_TYPES / CSS_JS_SIZE_THRESHOLD）とユーティリティ
 * （validateFile / formatFileSize / getFileTypeIcon / getFileTypeFromMime /
 * estimateImageSize）はオリジナルのロジックをそのまま移植している。
 *
 * export 名・引数・戻り値型はオリジナルと同一（呼び出し側を変更しないため）。
 */

/**
 * [移植版] data URL を dev サーバーへ送り、public/media/uploads/ に実ファイルとして保存する。
 * 失敗した場合は data URL をそのまま返す(オフライン/ビルド時のフォールバック)。
 */
async function persistDataUrl(dataUrl: string, fileName: string): Promise<string> {
  try {
    const res = await fetch('/__upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName, dataUrl }),
    });
    if (!res.ok) return dataUrl;
    const data = (await res.json()) as { url?: string };
    if (!data.url) return dataUrl;
    // エディタのiframeは blob: なので、ルート相対パス(/media/...)を解決できず
    // アップロード直後の画像がリンク切れに見える(右パネルは親文書なので表示される)。
    // 絶対URLで返す。保存時に slide-html.ts の fromEditorUrls が相対へ戻すので、
    // 永続化されるHTMLに localhost は残らない。
    if (data.url.startsWith('/') && typeof window !== 'undefined') {
      return new URL(data.url, window.location.origin).href;
    }
    return data.url;
  } catch {
    return dataUrl;
  }
}

import type { PageResourceUpload } from '../../types/page';

// ============================================
// 内部ヘルパー
// ============================================

/**
 * Blob / File を data URL（base64）に変換
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader が利用できない環境です。'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('ファイルの読み込みに失敗しました。'));
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Base64 文字列を Blob に変換
 */
function base64ToBlob(base64Data: string, mimeType: string): Blob {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// サポートされているファイルタイプ
export const SUPPORTED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ファイルバリデーション
export function validateFile(file: File): { isValid: boolean; error?: string } {
  // ファイルサイズチェック
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `ファイルサイズが大きすぎます。${MAX_FILE_SIZE / (1024 * 1024)}MB以下にしてください。`
    };
  }

  // ファイルタイプチェック
  const allowedTypes = Object.keys(SUPPORTED_FILE_TYPES);
  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'サポートされていないファイル形式です。PDF、CSV、TXT、MD、PPTX、XLSXファイルのみアップロード可能です。'
    };
  }

  return { isValid: true };
}

// ファイルアップロード（アップロードせず data URL を返す）
export async function uploadPageResource(
  projectId: string,
  pageId: string,
  file: File,
  uploadData: Omit<PageResourceUpload, 'file'>
): Promise<{ storageUrl: string; storagePath: string }> {
  try {
    void uploadData; // オリジナルは customMetadata に使用（ローカルでは保持しない）

    // ファイルバリデーション
    const validation = validateFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // ファイル名を生成（重複を避けるためにタイムスタンプを追加）
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${sanitizedFileName}`;

    // Storage path 相当の識別子を生成（互換のため同じ形式を維持）
    const storagePath = `projects/${projectId}/pages/${pageId}/resources/${fileName}`;

    // data URL 化した上で dev サーバーへ送り、実ファイルとして保存する
    const dataUrl = await blobToDataUrl(file);
    const storageUrl = await persistDataUrl(dataUrl, fileName);

    return {
      storageUrl,
      storagePath
    };
  } catch (error) {
    console.error('File upload error:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('ファイルのアップロードに失敗しました。');
  }
}

// ファイル削除（ローカルではリモート実体が無いため no-op）
export async function deletePageResource(storagePath: string): Promise<void> {
  console.log('[storage] deletePageResource is a no-op in local mode:', storagePath);
}

// ファイル情報取得（ローカルではメタデータを保持しないためスタブを返す）
export async function getFileMetadata(storagePath: string) {
  const now = new Date().toISOString();
  return {
    name: storagePath.split('/').pop() ?? storagePath,
    fullPath: storagePath,
    bucket: 'local',
    size: 0,
    contentType: undefined as string | undefined,
    timeCreated: now,
    updated: now,
    customMetadata: {} as Record<string, string>,
  };
}

// ファイルサイズのフォーマット
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ファイルタイプからアイコンを取得
export function getFileTypeIcon(fileType: string): string {
  switch (fileType) {
    case 'pdf':
      return '📄';
    case 'csv':
      return '📊';
    case 'txt':
    case 'md':
      return '📝';
    case 'pptx':
      return '📺';
    case 'xlsx':
      return '📋';
    default:
      return '📎';
  }
}

// MIMEタイプからファイルタイプを取得
export function getFileTypeFromMime(mimeType: string): string {
  return SUPPORTED_FILE_TYPES[mimeType as keyof typeof SUPPORTED_FILE_TYPES] || 'unknown';
}

// Figmaプラグインからの画像データ（アップロードせず data URL を返す）
export async function uploadFigmaImage(
  componentId: string,
  imageData: {
    base64: string;
    format: 'PNG' | 'JPG' | 'SVG';
    scale: number;
    capturedAt: string;
  },
  metadata: {
    figmaFileId: string;
    figmaNodeId: string;
    layerName: string;
    createdBy: string;
  }
): Promise<{ storageUrl: string; storagePath: string }> {
  try {
    const mimeType = `image/${imageData.format.toLowerCase()}`;

    // ファイル名を生成
    const timestamp = Date.now();
    const sanitizedLayerName = metadata.layerName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${sanitizedLayerName}_scale${imageData.scale}x.${imageData.format.toLowerCase()}`;

    // Storage path 相当の識別子を生成（互換のため同じ形式を維持）
    const storagePath = `components/${componentId}/figma-images/${fileName}`;

    // アップロードの代わりに data URL を組み立てる
    const storageUrl = imageData.base64.startsWith('data:')
      ? imageData.base64
      : `data:${mimeType};base64,${imageData.base64}`;

    return {
      storageUrl,
      storagePath
    };
  } catch (error) {
    console.error('❌ Figma image upload error:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Figma画像のアップロードに失敗しました。');
  }
}

// コンポーネントの画像ファイルを削除（ローカルでは no-op）
export async function deleteFigmaComponentImages(componentId: string): Promise<void> {
  const basePath = `components/${componentId}/figma-images/`;
  console.log(`[storage] deleteFigmaComponentImages is a no-op in local mode: ${basePath}`);
}

// 画像ファイルサイズの推定（Base64から）
export function estimateImageSize(base64: string): number {
  // Base64の実際のバイト数を推定（padding考慮）
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.round((base64.length * 0.75) - padding);
}

// 画像の最大サイズ（エディタ用）
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// サポートされている画像タイプ
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/**
 * エディタ用の画像アップロード
 * アップロードは行わず、data URL をそのまま storageUrl として返す
 */
export async function uploadEditorImage(
  file: File | Blob,
  options: {
    presentationId?: string;
    slideId?: string;
    fileName?: string;
  } = {}
): Promise<{ storageUrl: string; storagePath: string; width?: number; height?: number }> {
  // [パッケージ化での変更] 利用側が保存先を持っているならそれを使う。
  // 無ければ従来どおり data URL のまま埋め込む（バックエンド不要で動く）。
  const provided = io().uploadImage;
  if (provided) {
    const r = await provided(file, { fileName: options.fileName });
    return { storageUrl: r.url, storagePath: r.url, width: r.width, height: r.height };
  }

  try {
    // ファイルサイズチェック
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(`画像サイズが大きすぎます。${MAX_IMAGE_SIZE / (1024 * 1024)}MB以下にしてください。`);
    }

    // ファイルタイプチェック
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      throw new Error('サポートされていない画像形式です。JPEG、PNG、GIF、WebP、SVGがサポートされています。');
    }

    // ファイル名を生成
    const timestamp = Date.now();
    const extension = file.type.split('/')[1].replace('svg+xml', 'svg');
    const fileName = options.fileName
      ? `${timestamp}_${options.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`
      : `${timestamp}_image.${extension}`;

    // Storage path 相当の識別子を生成（互換のため同じ形式を維持）
    let storagePath: string;
    if (options.presentationId && options.slideId) {
      storagePath = `presentations/${options.presentationId}/slides/${options.slideId}/images/${fileName}`;
    } else if (options.presentationId) {
      storagePath = `presentations/${options.presentationId}/images/${fileName}`;
    } else {
      storagePath = `editor/images/${fileName}`;
    }

    // data URL 化した上で dev サーバーへ送り、実ファイルとして保存する
    const dataUrl = await blobToDataUrl(file);
    const storageUrl = await persistDataUrl(dataUrl, fileName);

    // 画像サイズを取得（ブラウザ環境の場合）
    let width: number | undefined;
    let height: number | undefined;

    if (typeof window !== 'undefined' && file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      try {
        const dimensions = await getImageDimensions(file);
        width = dimensions.width;
        height = dimensions.height;
      } catch (e) {
        console.warn('画像サイズの取得に失敗:', e);
      }
    }

    return {
      storageUrl,
      storagePath,
      width,
      height,
    };
  } catch (error) {
    console.error('Editor image upload error:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('画像のアップロードに失敗しました。');
  }
}

/**
 * 画像のサイズを取得
 */
function getImageDimensions(file: File | Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };

    img.src = url;
  });
}

/**
 * Base64データから画像をアップロード
 */
export async function uploadEditorImageFromBase64(
  base64Data: string,
  mimeType: string,
  options: {
    presentationId?: string;
    slideId?: string;
    fileName?: string;
  } = {}
): Promise<{ storageUrl: string; storagePath: string; width?: number; height?: number }> {
  // Base64データをBlobに変換
  const blob = base64ToBlob(base64Data, mimeType);

  return uploadEditorImage(blob, options);
}

/**
 * DataURLから画像をアップロード
 */
export async function uploadEditorImageFromDataUrl(
  dataUrl: string,
  options: {
    presentationId?: string;
    slideId?: string;
    fileName?: string;
  } = {}
): Promise<{ storageUrl: string; storagePath: string; width?: number; height?: number }> {
  // DataURLをパース
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('無効なDataURL形式です。');
  }

  const mimeType = matches[1];
  const base64Data = matches[2];

  return uploadEditorImageFromBase64(base64Data, mimeType, options);
}

// ===== CSS/JS Storage Functions =====

/**
 * 大きなCSS/JSはFirestoreに直接保存できないため、オリジナルではStorageに保存していた
 */
export const CSS_JS_SIZE_THRESHOLD = 100 * 1024; // 100KB以上はStorageに保存

export interface CssJsStorageResult {
  /** Storage URL (Storageに保存した場合) */
  storageUrl?: string;
  /** Storage path (Storageに保存した場合) */
  storagePath?: string;
  /** 直接保存する場合のコンテンツ (小さい場合) */
  content?: string;
  /** コンテンツサイズ */
  size: number;
  /** Storageに保存されたかどうか */
  isStoredInStorage: boolean;
}

/**
 * URL（data URL含む）からCSS/JSコンテンツを取得
 */
export async function fetchCssJsContent(storageUrl: string): Promise<string> {
  try {
    const response = await fetch(storageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch content: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error('[fetchCssJsContent] Failed to fetch:', error);
    throw error;
  }
}
