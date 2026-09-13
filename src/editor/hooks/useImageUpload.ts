'use client';

/**
 * エディタの画像アップロード機能を管理するHook
 * - ファイル選択からのアップロード
 * - ドラッグ&ドロップ
 * - クリップボードからのペースト
 */

import { useState, useCallback } from 'react';
import { useEditorContext } from '../EditorContext';
import { 
  uploadEditorImage, 
  uploadEditorImageFromDataUrl,
  SUPPORTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from '../../lib/firebase/storage';
import { buildDomTree } from '../utils/dom-utils';
import { findInsertionParent, findSlideRoot } from '../utils/slide-root';
import { debugLog } from '../utils/debug';

interface UploadResult {
  storageUrl: string;
  storagePath: string;
  width?: number;
  height?: number;
}

interface UseImageUploadOptions {
  presentationId?: string;
  slideId?: string;
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  const { getIframeDoc, setDomTree, notifyIframeChange, layoutMode } = useEditorContext();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * 画像要素をiframeに挿入
   */
  const insertImageElement = useCallback((
    url: string,
    options: { width?: number; height?: number; x?: number; y?: number } = {}
  ) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 画像要素を作成
    const img = iframeDoc.createElement('img');
    img.src = url;
    img.alt = 'Uploaded image';
    
    // サイズを設定（デフォルトは元のサイズ、最大幅500px）
    const maxWidth = 500;
    let width = options.width || 300;
    let height = options.height || 200;
    
    if (width > maxWidth) {
      const ratio = maxWidth / width;
      width = maxWidth;
      height = Math.round(height * ratio);
    }
    
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    
    // 位置を設定
    // [移植時の修正] スライド編集中はオートレイアウトでも絶対配置にする。
    // スライドは1920×1080の固定枠(overflow:hidden)で、中身も絶対配置で組まれているため、
    // フロー配置にすると画像がスライドの下(1080pxの外)に積まれて見えなくなり、
    // その状態でドラッグすると画面外へ飛んでいったように見えてしまう。
    const insideSlide = !!findSlideRoot(iframeDoc);
    if (layoutMode === 'absolute' || insideSlide) {
      const x = options.x ?? 100;
      const y = options.y ?? 100;
      img.style.position = 'absolute';
      img.style.left = `${x}px`;
      img.style.top = `${y}px`;
    } else {
      // オートレイアウトモード: 通常のレイアウトフローに従う
      img.style.display = 'block';
      img.style.margin = '10px auto';
    }
    
    // 編集可能属性を追加
    const elementId = `el-${Date.now()}-img`;
    img.setAttribute('data-editable', 'true');
    img.setAttribute('data-element-id', elementId);

    // [移植時の修正] スライドがある場合はスライドの中に追加する。
    // 外側(#artboard/body)に入れると、ズーム倍率の分だけ座標系がずれて
    // スライド外に表示されたり、ドラッグで飛んでいったりする。
    findInsertionParent(iframeDoc).appendChild(img);
    
    // DOMツリーを更新
    const newTree = buildDomTree(iframeDoc);
    setDomTree(newTree);
    
    // 変更を通知
    notifyIframeChange();
    
    return elementId;
  }, [getIframeDoc, setDomTree, notifyIframeChange]);

  /**
   * ファイルからアップロード
   */
  const uploadFromFile = useCallback(async (
    file: File,
    insertOptions?: { x?: number; y?: number }
  ): Promise<UploadResult | null> => {
    setIsUploading(true);
    setUploadError(null);

    try {
      // ファイルタイプチェック
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        throw new Error('サポートされていない画像形式です。JPEG、PNG、GIF、WebP、SVGがサポートされています。');
      }

      // ファイルサイズチェック
      if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(`画像サイズが大きすぎます。${MAX_IMAGE_SIZE / (1024 * 1024)}MB以下にしてください。`);
      }

      const result = await uploadEditorImage(file, {
        presentationId: options.presentationId,
        slideId: options.slideId,
        fileName: file.name,
      });

      // 画像をiframeに挿入
      insertImageElement(result.storageUrl, {
        width: result.width,
        height: result.height,
        x: insertOptions?.x,
        y: insertOptions?.y,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '画像のアップロードに失敗しました。';
      setUploadError(message);
      console.error('Image upload error:', error);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [options.presentationId, options.slideId, insertImageElement]);

  /**
   * 複数ファイルからアップロード
   */
  const uploadFromFiles = useCallback(async (
    files: FileList | File[],
    insertOptions?: { x?: number; y?: number }
  ): Promise<UploadResult[]> => {
    const results: UploadResult[] = [];
    let currentX = insertOptions?.x ?? 100;
    const startY = insertOptions?.y ?? 100;

    for (const file of Array.from(files)) {
      const result = await uploadFromFile(file, { x: currentX, y: startY });
      if (result) {
        results.push(result);
        currentX += (result.width || 300) + 20; // 次の画像の位置
      }
    }

    return results;
  }, [uploadFromFile]);

  /**
   * クリップボードからアップロード
   */
  const uploadFromClipboard = useCallback(async (
    clipboardData: DataTransfer,
    insertOptions?: { x?: number; y?: number }
  ): Promise<UploadResult | null> => {
    debugLog('[useImageUpload] uploadFromClipboard called');
    // クリップボードから画像を探す
    const items = Array.from(clipboardData.items);
    debugLog('[useImageUpload] Clipboard items:', items.map(i => ({ type: i.type, kind: i.kind })));

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        debugLog('[useImageUpload] Got file from clipboard item:', file);
        if (file) {
          return uploadFromFile(file, insertOptions);
        }
      }
    }

    // DataURLとして取得を試みる
    const htmlData = clipboardData.getData('text/html');
    if (htmlData) {
      const imgMatch = htmlData.match(/<img[^>]+src="(data:image\/[^"]+)"/);
      if (imgMatch) {
        setIsUploading(true);
        setUploadError(null);
        
        try {
          const result = await uploadEditorImageFromDataUrl(imgMatch[1], {
            presentationId: options.presentationId,
            slideId: options.slideId,
          });

          insertImageElement(result.storageUrl, {
            width: result.width,
            height: result.height,
            x: insertOptions?.x,
            y: insertOptions?.y,
          });

          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : '画像のアップロードに失敗しました。';
          setUploadError(message);
          console.error('Image upload error:', error);
          return null;
        } finally {
          setIsUploading(false);
        }
      }
    }

    return null;
  }, [options.presentationId, options.slideId, uploadFromFile, insertImageElement]);

  /**
   * URLから画像を挿入（アップロードなし、外部URL）
   */
  const insertImageFromUrl = useCallback((
    url: string,
    insertOptions?: { width?: number; height?: number; x?: number; y?: number }
  ) => {
    return insertImageElement(url, insertOptions);
  }, [insertImageElement]);

  /**
   * ファイル選択ダイアログを開く
   */
  const openFilePicker = useCallback((insertOptions?: { x?: number; y?: number }) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SUPPORTED_IMAGE_TYPES.join(',');
    input.multiple = true;
    
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        await uploadFromFiles(files, insertOptions);
      }
    };
    
    input.click();
  }, [uploadFromFiles]);

  return {
    isUploading,
    uploadError,
    uploadFromFile,
    uploadFromFiles,
    uploadFromClipboard,
    insertImageFromUrl,
    openFilePicker,
    insertImageElement,
  };
}
