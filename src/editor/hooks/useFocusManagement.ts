/**
 * フォーカス管理フック
 *
 * ショートカットが効かなくなる問題を解決するため、
 * エディタ全体のフォーカス状態を管理する
 */

import { useCallback, useRef, useEffect } from 'react';
import { useEditorContext } from '../EditorContext';
import { debugLog } from '../utils/debug';

interface UseFocusManagementReturn {
  /**
   * iframeにフォーカスを復元する
   * ダイアログを閉じた後などに呼び出す
   */
  restoreFocus: () => void;

  /**
   * フォーカスがエディタ内にあるかチェック
   */
  isEditorFocused: () => boolean;

  /**
   * フォーカス喪失時の自動復元を設定
   * @returns クリーンアップ関数
   */
  setupFocusRecovery: () => () => void;
}

/**
 * フォーカス管理フック
 *
 * エディタのフォーカス状態を管理し、ショートカットが
 * 確実に機能するようにする
 */
export function useFocusManagement(): UseFocusManagementReturn {
  const { iframeRef, getIframeDoc } = useEditorContext();

  // フォーカス復元のタイマー（デバウンス用）
  const focusRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 最後にフォーカスがあった場所を記録
  const lastFocusedElementRef = useRef<'iframe' | 'parent' | null>(null);

  /**
   * iframeにフォーカスを復元する
   */
  const restoreFocus = useCallback(() => {
    const iframe = iframeRef.current;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      debugLog('[FocusManagement] Cannot restore focus: iframe doc not available');
      return;
    }

    // テキスト編集中の要素があればそこにフォーカス
    const editingElement = iframeDoc.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editingElement) {
      // まずiframe要素自体にフォーカス（親ドキュメントの観点から）
      if (iframe) iframe.focus();
      editingElement.focus();
      debugLog('[FocusManagement] Restored focus to editing element');
      return;
    }

    // iframeとbodyにフォーカス
    // 重要: iframe要素自体にもフォーカスを当てないとキーボードイベントが届かない
    if (iframe) {
      iframe.focus();
    }
    if (iframeDoc.body) {
      iframeDoc.body.focus();
      debugLog('[FocusManagement] Restored focus to iframe and body');
    }
  }, [iframeRef, getIframeDoc]);

  /**
   * フォーカスがエディタ内にあるかチェック
   */
  const isEditorFocused = useCallback(() => {
    const iframe = iframeRef.current;
    const iframeDoc = getIframeDoc();

    // 親ドキュメントのアクティブ要素をチェック
    const activeElement = document.activeElement;

    // iframeにフォーカスがあるか（iframe内の要素にフォーカスがあるとiframeがactiveElementになる）
    if (activeElement === iframe) {
      return true;
    }

    // エディタ関連の要素にフォーカスがあるか
    const editorContainer = document.querySelector('[data-frontend-visual-editor="true"]');
    if (editorContainer?.contains(activeElement)) {
      return true;
    }

    // iframe内にフォーカスがあるか（bodyを含む）
    // 重要: bodyにフォーカスがある場合もキーボードイベントは受け取れるのでtrueを返す
    if (iframeDoc && iframeDoc.activeElement) {
      return true;
    }

    return false;
  }, [iframeRef, getIframeDoc]);

  /**
   * フォーカス喪失時の自動復元を設定
   */
  const setupFocusRecovery = useCallback(() => {
    const iframe = iframeRef.current;
    const iframeDoc = getIframeDoc();

    /**
     * フォーカスアウト時のハンドラ
     * フォーカスがエディタ外に出た場合、一定時間後に復元を試みる
     */
    const handleFocusOut = (e: FocusEvent) => {
      // 次にフォーカスが移動する先を確認
      const relatedTarget = e.relatedTarget as HTMLElement | null;

      // ダイアログやポップオーバー内への移動は許可
      if (relatedTarget) {
        const isDialogOrPopover =
          relatedTarget.closest('[role="dialog"]') ||
          relatedTarget.closest('[role="menu"]') ||
          relatedTarget.closest('[role="listbox"]') ||
          relatedTarget.closest('[role="combobox"]') ||
          relatedTarget.closest('[role="slider"]') ||              // Radix Slider（カラーピッカーの透明度等）
          relatedTarget.closest('[data-radix-slider-thumb]') ||    // Radix Sliderのつまみ
          relatedTarget.closest('[data-radix-slider-track]') ||    // Radix Sliderのトラック
          relatedTarget.closest('[data-radix-popper-content-wrapper]') ||
          relatedTarget.closest('[data-radix-select-content]') ||
          relatedTarget.closest('[data-radix-dropdown-menu-content]') ||
          relatedTarget.closest('[data-radix-popover-content]') ||
          relatedTarget.closest('.ai-prompt-popover') ||
          relatedTarget.closest('[data-state="open"]') ||
          relatedTarget.closest('[data-color-picker]') ||
          relatedTarget.closest('[data-dropdown-menu]');

        if (isDialogOrPopover) {
          debugLog('[FocusManagement] Focus moved to dialog/popover, allowing');
          return;
        }

        // 入力フィールドへの移動は許可（ただし後でフォーカス復元のためにトラッキング）
        const isInputField =
          relatedTarget instanceof HTMLInputElement ||
          relatedTarget instanceof HTMLTextAreaElement ||
          relatedTarget instanceof HTMLSelectElement ||
          relatedTarget.getAttribute('contenteditable') === 'true';

        if (isInputField) {
          debugLog('[FocusManagement] Focus moved to input field, allowing');
          return;
        }

        // エディタ内の他の要素への移動は許可
        const editorContainer = document.querySelector('[data-frontend-visual-editor="true"]');
        if (editorContainer?.contains(relatedTarget)) {
          return;
        }
      }

      // フォーカスが完全に外に出た場合、遅延して復元
      if (focusRecoveryTimerRef.current) {
        clearTimeout(focusRecoveryTimerRef.current);
      }

      focusRecoveryTimerRef.current = setTimeout(() => {
        // まだフォーカスがエディタ外にあれば復元
        if (!isEditorFocused()) {
          debugLog('[FocusManagement] Focus lost, attempting recovery');
          restoreFocus();
        }
      }, 30); // 30msに短縮してフォーカス復元を高速化
    };

    /**
     * クリック時のフォーカス確認
     * エディタ内をクリックした場合、フォーカスを確保
     */
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const editorContainer = document.querySelector('[data-frontend-visual-editor="true"]');

      // エディタ内のクリックでフォーカスが失われていれば復元
      if (editorContainer?.contains(target)) {
        // 入力要素でなければiframeにフォーカス
        if (
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement) &&
          !target.isContentEditable &&
          target.getAttribute('contenteditable') !== 'true'
        ) {
          // 少し遅延してフォーカス状態を確認
          setTimeout(() => {
            if (!isEditorFocused()) {
              restoreFocus();
            }
          }, 50);
        }
      }
    };

    // iframe内のフォーカス管理
    const handleIframeFocusIn = () => {
      lastFocusedElementRef.current = 'iframe';
    };

    const handleParentFocusIn = () => {
      const editorContainer = document.querySelector('[data-frontend-visual-editor="true"]');
      if (editorContainer?.contains(document.activeElement)) {
        lastFocusedElementRef.current = 'parent';
      }
    };

    // イベントリスナーを登録
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('focusin', handleParentFocusIn, true);

    if (iframeDoc) {
      iframeDoc.addEventListener('focusin', handleIframeFocusIn, true);
    }

    // クリーンアップ
    return () => {
      if (focusRecoveryTimerRef.current) {
        clearTimeout(focusRecoveryTimerRef.current);
      }
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('focusin', handleParentFocusIn, true);

      if (iframeDoc) {
        iframeDoc.removeEventListener('focusin', handleIframeFocusIn, true);
      }
    };
  }, [iframeRef, getIframeDoc, isEditorFocused, restoreFocus]);

  return {
    restoreFocus,
    isEditorFocused,
    setupFocusRecovery,
  };
}

export default useFocusManagement;
