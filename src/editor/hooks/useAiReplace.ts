'use client';

/**
 * AI要素置換Hook
 * 選択した要素をAI生成したHTMLで置換する
 * editorModeに基づいて slide-agent または website-agent API を使用
 */

import { useState, useCallback } from 'react';
import { useEditorContext } from '../EditorContext';
import { useAuth } from '../../components/auth/AuthProvider';
import { createAuthApi } from '../../lib/api/auth-fetch';
import { convertSingleElementToAbsolute, generateElementId } from '../utils/dom-utils';
import type { SlideAgentRequest, SlideAgentResponse, AttachedFile as SlideAttachedFile } from '../../lib/agent/slide-agent/types';
import type { WebsiteAgentRequest, WebsiteAgentResponse, AttachedFile as WebsiteAttachedFile } from '../../lib/agent/website-agent/types';

// AttachedFile型を共通化（両方同じ構造）
export type AttachedFile = SlideAttachedFile;

interface UseAiReplaceProps {
  /** スライドモード用: プレゼンテーションID */
  presentationId?: string;
  /** Webページモード用: WebサイトID */
  websiteId?: string;
}

/**
 * AI要素置換フック
 * editorModeに基づいてslide-agentまたはwebsite-agentを使い分ける
 */
export function useAiReplace({ presentationId, websiteId }: UseAiReplaceProps = {}) {
  const { getIdToken, user } = useAuth();
  const {
    selectedElement,
    getIframeDoc,
    notifyIframeChange,
    setSelectedElement,
    layoutMode,
    editorMode,
  } = useEditorContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 選択要素のHTMLを取得
   */
  const getSelectedElementHtml = useCallback((): string | null => {
    if (!selectedElement) return null;
    
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return null;

    const element = iframeDoc.querySelector(
      `[data-element-id="${selectedElement.id}"]`
    ) as HTMLElement | null;

    if (!element) return null;

    // 選択ボックス等のUI要素を除いたHTMLを取得
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.remove('selected');
    clone.querySelectorAll('.selection-box, .resize-handle').forEach(el => el.remove());
    
    return clone.outerHTML;
  }, [selectedElement, getIframeDoc]);

  /**
   * 現在のスライドHTML全体を取得
   * キャンバス構造（#canvas-container等）ではなく、#artboard内のコンテンツのみを返す
   */
  const getContentHtml = useCallback((): string => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return '';

    // #artboard内のHTMLをクリーンに取得（キャンバス構造は含めない）
    const artboard = iframeDoc.getElementById('artboard');
    const sourceElement = artboard || iframeDoc.body;
    const clone = sourceElement.cloneNode(true) as HTMLElement;

    // UI要素を除去
    clone.querySelectorAll('.selection-box, .resize-handle, [data-editor-ui]').forEach(el => el.remove());

    return clone.innerHTML;
  }, [getIframeDoc]);

  /**
   * 要素を新しいHTMLで置換
   * 新しい要素には data-editable, data-element-id を付与し、
   * 絶対位置に変換する
   */
  const replaceElement = useCallback((newHtml: string) => {
    if (!selectedElement) return false;
    
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return false;

    const element = iframeDoc.querySelector(
      `[data-element-id="${selectedElement.id}"]`
    ) as HTMLElement | null;

    if (!element) return false;

    try {
      // 元の要素の位置とサイズを保持
      const originalStyle = {
        position: element.style.position || 'absolute',
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
      };

      // 新しいHTML要素を作成
      const temp = iframeDoc.createElement('div');
      temp.innerHTML = newHtml.trim();
      const newElement = temp.firstElementChild as HTMLElement;

      if (!newElement) {
        console.error('[useAiReplace] Failed to create new element from HTML');
        return false;
      }

      // ルート要素にdata属性を設定
      newElement.setAttribute('data-editable', 'true');
      newElement.setAttribute('data-element-id', selectedElement.id);
      // 出所の刻印(data-gg-src)を引き継ぐ。AIの出力には残らないため、
      // 移植しないとこの要素だけ原本TSXへの書き戻しが効かなくなる
      const ggSrc = element.getAttribute('data-gg-src');
      if (ggSrc && !newElement.getAttribute('data-gg-src')) {
        newElement.setAttribute('data-gg-src', ggSrc);
      }

      // 子要素にもdata-editable, data-element-idを付与（ブロック要素のみ）
      const inlineTags = new Set([
        'SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'MARK', 'CODE',
        'SMALL', 'SUB', 'SUP', 'ABBR', 'BR', 'WBR', 'LABEL'
      ]);
      
      const processChildren = (parent: HTMLElement) => {
        Array.from(parent.children).forEach((child) => {
          const htmlChild = child as HTMLElement;
          
          // インライン要素とSCRIPT/STYLEはスキップ
          if (inlineTags.has(htmlChild.tagName) || 
              htmlChild.tagName === 'SCRIPT' || 
              htmlChild.tagName === 'STYLE') {
            return;
          }

          // まだdata-element-idがない場合は付与
          if (!htmlChild.getAttribute('data-element-id')) {
            htmlChild.setAttribute('data-editable', 'true');
            htmlChild.setAttribute('data-element-id', generateElementId());
          }
          
          // 再帰的に子要素を処理
          processChildren(htmlChild);
        });
      };
      
      processChildren(newElement);

      // 元の位置・サイズを適用（置換前に設定）
      newElement.style.position = originalStyle.position;
      if (originalStyle.left) newElement.style.left = originalStyle.left;
      if (originalStyle.top) newElement.style.top = originalStyle.top;
      if (originalStyle.width) newElement.style.width = originalStyle.width;
      if (originalStyle.height) newElement.style.height = originalStyle.height;

      // 要素を置換
      element.parentNode?.replaceChild(newElement, element);

      // フォントの読み込みを待ってから絶対位置に変換
      // (フォントによってサイズが変わる可能性があるため)
      const convertChildrenToAbsolute = async () => {
        // オートレイアウトモードの場合は変換をスキップ
        if (layoutMode === 'auto') {
          console.log('[useAiReplace] Auto layout mode - skipping absolute positioning conversion for children');
          return;
        }

        try {
          // フォントの読み込みを待つ
          if (iframeDoc.fonts?.ready) {
            await iframeDoc.fonts.ready;
          }
          
          // 少し待ってからレイアウトを確定
          await new Promise(resolve => setTimeout(resolve, 50));

          // 子要素を絶対配置に変換
          const editableChildren = newElement.querySelectorAll('[data-editable="true"]');
          editableChildren.forEach((child) => {
            const htmlChild = child as HTMLElement;
            convertSingleElementToAbsolute(iframeDoc, htmlChild);
          });

          console.log('[useAiReplace] Converted', editableChildren.length, 'child elements to absolute positioning');
          
          // 変更を再度通知
          notifyIframeChange();
        } catch (err) {
          console.error('[useAiReplace] Error converting children to absolute:', err);
        }
      };

      // 非同期で変換を実行
      convertChildrenToAbsolute();

      // 選択ボックスを更新
      const selectionBox = iframeDoc.querySelector(
        `.selection-box[data-for-element="${selectedElement.id}"]`
      );
      if (selectionBox) {
        selectionBox.remove();
      }

      // 変更を通知
      notifyIframeChange();

      // 選択状態をクリア（新しい要素は選択し直す必要がある）
      setSelectedElement(null);

      return true;
    } catch (err) {
      console.error('[useAiReplace] Replace element error:', err);
      return false;
    }
  }, [selectedElement, getIframeDoc, notifyIframeChange, setSelectedElement]);

  /**
   * AIで要素を生成して置換
   * editorModeに基づいてslide-agentまたはwebsite-agent APIを使用
   * @param prompt ユーザーの指示
   * @param attachedFiles 添付ファイル（画像、PDF等）
   */
  const generateAndReplace = useCallback(async (
    prompt: string,
    attachedFiles?: AttachedFile[],
    engine?: 'codex' | 'claude',
  ): Promise<void> => {
    if (!selectedElement) {
      throw new Error('要素が選択されていません');
    }

    if (!user) {
      throw new Error('ログインが必要です');
    }

    const selectedElementHtml = getSelectedElementHtml();
    if (!selectedElementHtml) {
      throw new Error('選択要素のHTMLを取得できません');
    }

    setIsGenerating(true);
    setError(null);

    try {
      const api = await createAuthApi(getIdToken);
      const contentHtml = getContentHtml();

      // editorModeに基づいてAPI呼び出しを分岐
      const isWebpageMode = editorMode === 'webpage';

      console.log('[useAiReplace] API呼び出し:', {
        editorMode,
        apiEndpoint: isWebpageMode ? '/api/website-agent' : '/api/slide-agent',
        promptLength: prompt.length,
        attachedFilesCount: attachedFiles?.length ?? 0,
      });

      let generatedHtml: string | undefined;

      if (isWebpageMode) {
        // Webページモード: website-agent API を使用
        const requestBody: WebsiteAgentRequest = {
          prompt,
          userId: user.id,
          websiteId, // WebサイトIDを渡す（画像保存用）
          options: {
            mode: 'element_replace',
            elementReplace: {
              pageHtml: contentHtml,
              selectedElementHtml,
              selectedElementInfo: {
                tagName: selectedElement.tagName,
                width: selectedElement.width,
                height: selectedElement.height,
                position: {
                  x: selectedElement.x,
                  y: selectedElement.y,
                },
              },
              attachedFiles: attachedFiles as WebsiteAttachedFile[],
            },
          },
        };

        const response: WebsiteAgentResponse = await api.post(
          '/api/website-agent',
          requestBody
        );

        if (!response.success) {
          throw new Error(response.error || '生成に失敗しました');
        }
        generatedHtml = response.generatedHtml;
      } else {
        // スライドモード: slide-agent API を使用
        const requestBody: SlideAgentRequest & { engine?: string } = {
          prompt,
          engine,
          userId: user.id,
          presentationId, // プレゼンテーションIDを渡す（画像保存用）
          options: {
            mode: 'element_replace',
            elementReplace: {
              slideHtml: contentHtml,
              selectedElementHtml,
              selectedElementInfo: {
                tagName: selectedElement.tagName,
                width: selectedElement.width,
                height: selectedElement.height,
                position: {
                  x: selectedElement.x,
                  y: selectedElement.y,
                },
              },
              attachedFiles: attachedFiles as SlideAttachedFile[],
            },
          },
        };

        const response: SlideAgentResponse = await api.post(
          '/api/slide-agent',
          requestBody
        );

        if (!response.success) {
          throw new Error(response.error || '生成に失敗しました');
        }
        generatedHtml = response.generatedHtml;
      }

      if (!generatedHtml) {
        throw new Error('HTMLが生成されませんでした');
      }

      // 要素を置換
      const success = replaceElement(generatedHtml);
      if (!success) {
        throw new Error('要素の置換に失敗しました');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成に失敗しました';
      setError(message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectedElement,
    user,
    getSelectedElementHtml,
    getContentHtml,
    replaceElement,
    getIdToken,
    editorMode,
    presentationId,
    websiteId,
  ]);

  /**
   * 選択要素の簡易情報を取得
   */
  const getSelectedElementInfo = useCallback((): string | undefined => {
    if (!selectedElement) return undefined;

    const { tagName, text, width, height } = selectedElement;
    const safeText = text || '';
    const truncatedText = safeText.length > 20 ? safeText.substring(0, 20) + '...' : safeText;

    return `<${tagName.toLowerCase()}> ${truncatedText} (${Math.round(width || 0)}×${Math.round(height || 0)})`.trim();
  }, [selectedElement]);

  return {
    generateAndReplace,
    replaceElement,
    isGenerating,
    error,
    hasSelection: !!selectedElement,
    getSelectedElementInfo,
    /** 現在のエディタモード（どのエージェントを使用するかを示す） */
    editorMode,
  };
}
