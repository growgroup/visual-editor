/**
 * iframe初期化処理フック
 * - スタイル注入
 * - data-editable属性の付与
 * - インライン要素の検出
 * - MutationObserverのセットアップ
 */

import { useCallback, useRef, useEffect } from 'react';
import { useEditorContext } from '../EditorContext';
import { buildDomTree, isInlineElement } from '../utils/dom-utils';
import { EDITOR_IFRAME_STYLES } from '../constants';
import { isLockedInsidePart } from '../parts';
import { debugLog } from '../utils/debug';

interface UseIframeSetupReturn {
  /**
   * iframe ドキュメントの初期化処理
   * - スタイル注入
   * - data-editable属性の付与
   * - DOMツリーの構築
   */
  initializeIframeDocument: (iframeDoc: Document) => void;

  /**
   * MutationObserverをセットアップ
   * @returns クリーンアップ関数
   */
  setupMutationObserver: (iframeDoc: Document) => () => void;

  /**
   * テキスト要素ホバーリスナーをセットアップ
   *
   * @param resolveHoverTarget
   *   「いまクリックしたら選択されるであろう要素」を返す関数。
   *   選択側（useElementSelection）と同じ判別器を渡すことで、
   *   ホバー輪郭が必ずクリック結果の予告になる。
   *   省略可（未指定なら輪郭は出さず、従来のテキスト下線だけ動く）。
   * @returns クリーンアップ関数
   */
  setupTextHoverListener: (
    iframeDoc: Document,
    resolveHoverTarget?: HoverTargetResolver,
  ) => () => void;
}

/** ホバー予告の対象を決める関数の型（選択側の判別器と同じもの） */
export type HoverTargetResolver = (
  target: EventTarget | null,
  iframeDoc: Document,
  options: { meta: boolean },
) => HTMLElement | null;

/**
 * iframe初期化処理フック
 */
export function useIframeSetup(): UseIframeSetupReturn {
  const { setDomTree } = useEditorContext();

  // クロージャ問題回避のためのref
  const setDomTreeRef = useRef(setDomTree);

  // refを最新値に同期
  useEffect(() => {
    setDomTreeRef.current = setDomTree;
  }, [setDomTree]);

  /**
   * 全要素にdata-editable属性とdata-element-idを付与
   */
  const initializeEditableElements = useCallback((iframeDoc: Document) => {
    const artboard = iframeDoc.getElementById('artboard');
    if (!artboard) {
      console.warn('[IframeSetup] #artboard not found');
      return 0;
    }

    let elementIndex = 0;
    const elements = artboard.querySelectorAll('*');

    elements.forEach((el) => {
      const element = el as HTMLElement;

      // スキップする要素
      if (element === artboard) return;
      if (element === iframeDoc.documentElement) return;
      // [移植時の修正] スライドのキャンバス本体(#artboard 直下で紙面と同じ大きさの器)は
      // 編集対象にしない。ここを掴めるとスライドごと動いてしまい、中身が版面の外
      // (overflow:hidden)へ出るため、要素が消えたように見える
      if (
        element.parentElement === artboard &&
        element.offsetWidth >= artboard.clientWidth - 2 &&
        element.offsetHeight >= artboard.clientHeight - 2
      ) {
        return;
      }
      if (
        element.tagName === 'SCRIPT' ||
        element.tagName === 'STYLE' ||
        element.tagName === 'HEAD'
      )
        return;
      if (element.closest('script, style, svg path, svg g')) return;
      if (element.classList.contains('material-icons')) return;
      if (element.classList.contains('material-icons-outlined')) return;
      // selection-box およびその子要素はスキップ
      if (element.classList.contains('selection-box')) return;
      if (element.classList.contains('resize-handle')) return;
      if (element.classList.contains('selection-outline')) return;
      if (element.classList.contains('size-label')) return;
      if (element.classList.contains('border-radius-handle')) return;
      if (element.classList.contains('rotation-handle')) return;
      // selection-boxの子孫要素をすべてスキップ（念のため）
      if (element.closest('.selection-box')) return;
      // 共同編集の他人の選択枠・カーソル(表示専用の層)
      if (element.closest('.gg-collab-layer')) return;

      // 部品のインスタンス(data-part)の中で、スロット(data-slot)の外にある要素は編集対象にしない。
      // ルート自身とスロットの中は通常どおり(src/editor/parts.ts)。
      // 保存 HTML には data-editable が残らないので、古い保存物には効かない = 既存の挙動は変わらない
      if (isLockedInsidePart(element)) {
        element.removeAttribute('data-editable');
        element.removeAttribute('data-element-id');
        return;
      }

      // 既にIDがある場合はスキップ
      if (!element.getAttribute('data-element-id')) {
        const elementId = `el-${Date.now()}-${elementIndex++}`;
        element.setAttribute('data-editable', 'true');
        element.setAttribute('data-element-id', elementId);

        // インライン要素にはフラグを付与（絶対配置に変換しない）
        const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);
        if (computedStyle && isInlineElement(element, computedStyle)) {
          element.setAttribute('data-inline', 'true');
        }
      } else if (!element.getAttribute('data-editable')) {
        element.setAttribute('data-editable', 'true');
      }
    });

    return elementIndex;
  }, []);

  /**
   * iframe ドキュメントの初期化
   */
  const initializeIframeDocument = useCallback(
    (iframeDoc: Document) => {
      debugLog('[IframeSetup] Initializing iframe document...');

      // スタイルを注入
      const style = iframeDoc.createElement('style');
      style.textContent = EDITOR_IFRAME_STYLES;
      iframeDoc.head.appendChild(style);

      // タッチアクションを無効化
      iframeDoc.documentElement.style.touchAction = 'none';
      iframeDoc.body.style.touchAction = 'none';

      // 全要素にdata-editableとdata-element-idを付与
      const elementCount = initializeEditableElements(iframeDoc);
      debugLog('[IframeSetup] Initialized', elementCount, 'editable elements');

      // DOMツリーを構築
      const newTree = buildDomTree(iframeDoc);
      setDomTreeRef.current(newTree);
    },
    [initializeEditableElements]
  );

  /**
   * MutationObserverをセットアップ
   */
  const setupMutationObserver = useCallback(
    (iframeDoc: Document) => {
      const artboard = iframeDoc.getElementById('artboard');
      if (!artboard) {
        console.warn('[IframeSetup] #artboard not found for MutationObserver');
        return () => {};
      }

      let mutationTimeout: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        // デバウンス: 連続した変更を一度にまとめる
        if (mutationTimeout) {
          clearTimeout(mutationTimeout);
        }
        mutationTimeout = setTimeout(() => {
          // 新しい要素にdata-editableを付与
          initializeEditableElements(iframeDoc);
          // DOMツリーを再構築
          const newTree = buildDomTree(iframeDoc);
          setDomTreeRef.current(newTree);
        }, 100);
      });

      observer.observe(artboard, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false,
      });

      // クリーンアップ関数
      return () => {
        if (mutationTimeout) {
          clearTimeout(mutationTimeout);
        }
        observer.disconnect();
      };
    },
    [initializeEditableElements]
  );

  /**
   * 要素が直下にテキストを含むかチェック
   */
  const hasDirectTextContent = useCallback((element: HTMLElement): boolean => {
    // 画像やSVGは除外
    const tagName = element.tagName.toUpperCase();
    if (['IMG', 'SVG', 'VIDEO', 'IFRAME', 'CANVAS'].includes(tagName)) return false;

    // 直接テキストノードを含むかチェック
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        return true;
      }
    }

    // テキスト系タグで、テキストコンテンツがある場合
    const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'A', 'LABEL', 'LI', 'TD', 'TH', 'BUTTON'];
    if (textTags.includes(tagName) && element.textContent?.trim()) {
      return true;
    }

    return false;
  }, []);

  /**
   * テキスト要素ホバーリスナーをセットアップ
   */
  const setupTextHoverListener = useCallback(
    (iframeDoc: Document, resolveHoverTarget?: HoverTargetResolver) => {
      let currentHoveredTextElement: HTMLElement | null = null;
      // [選択セマンティクスの一本化] クリック結果を予告する輪郭は1要素だけに付ける。
      // CSS の :hover は祖先チェーン全体に当たってしまうため、ここで付け替える。
      let currentPreviewElement: HTMLElement | null = null;

      const clearPreview = () => {
        if (currentPreviewElement) {
          currentPreviewElement.classList.remove('hover-preview');
          currentPreviewElement = null;
        }
      };

      /** 予告輪郭を1要素だけに付け替える */
      const updatePreview = (e: MouseEvent) => {
        if (!resolveHoverTarget) return;
        // ドラッグ／マーキー中は予告を出さない（掴んでいる最中に輪郭が踊るのを防ぐ）
        if (
          iframeDoc.body.classList.contains('marquee-active') ||
          iframeDoc.querySelector('.dragging')
        ) {
          clearPreview();
          return;
        }
        const next = resolveHoverTarget(e.target, iframeDoc, {
          meta: e.metaKey || e.ctrlKey,
        });
        if (next === currentPreviewElement) return;
        clearPreview();
        if (next) {
          next.classList.add('hover-preview');
          currentPreviewElement = next;
        }
      };

      const handleMouseMove = (e: MouseEvent) => {
        // 描画モードやテキストモードでは無効
        const bodyClasses = iframeDoc.body.classList;
        if (bodyClasses.contains('draw-mode') || bodyClasses.contains('text-mode') || bodyClasses.contains('move-mode') || bodyClasses.contains('comment-mode')) {
          if (currentHoveredTextElement) {
            currentHoveredTextElement.classList.remove('text-editable-hover');
            currentHoveredTextElement = null;
          }
          clearPreview();
          return;
        }

        updatePreview(e);

        // マウス下の要素を取得
        const target = e.target as HTMLElement;

        // 編集可能要素を探す
        let editableElement: HTMLElement | null = target;
        while (editableElement && editableElement !== iframeDoc.body) {
          if (editableElement.getAttribute('data-editable') === 'true') {
            break;
          }
          editableElement = editableElement.parentElement;
        }

        if (!editableElement || editableElement === iframeDoc.body) {
          // 編集可能要素がない場合、既存のホバーをクリア
          if (currentHoveredTextElement) {
            currentHoveredTextElement.classList.remove('text-editable-hover');
            currentHoveredTextElement = null;
          }
          return;
        }

        // テキスト編集可能かチェック
        const isTextElement = hasDirectTextContent(editableElement);

        if (isTextElement && editableElement !== currentHoveredTextElement) {
          // 前のホバーをクリア
          if (currentHoveredTextElement) {
            currentHoveredTextElement.classList.remove('text-editable-hover');
          }
          // 新しいホバーを設定
          editableElement.classList.add('text-editable-hover');
          currentHoveredTextElement = editableElement;
        } else if (!isTextElement && currentHoveredTextElement) {
          // テキスト要素でない場合、ホバーをクリア
          currentHoveredTextElement.classList.remove('text-editable-hover');
          currentHoveredTextElement = null;
        }
      };

      const handleMouseLeave = () => {
        if (currentHoveredTextElement) {
          currentHoveredTextElement.classList.remove('text-editable-hover');
          currentHoveredTextElement = null;
        }
        clearPreview();
      };

      // Cmd/Ctrl の押し下げ・解放でも予告先が変わる（Cmdは最深要素を選ぶため）
      const handleModifierChange = (e: KeyboardEvent) => {
        if (e.key !== 'Meta' && e.key !== 'Control') return;
        clearPreview();
      };

      iframeDoc.addEventListener('mousemove', handleMouseMove);
      iframeDoc.addEventListener('mouseleave', handleMouseLeave);
      iframeDoc.addEventListener('keydown', handleModifierChange);
      iframeDoc.addEventListener('keyup', handleModifierChange);

      // クリーンアップ関数
      return () => {
        iframeDoc.removeEventListener('mousemove', handleMouseMove);
        iframeDoc.removeEventListener('mouseleave', handleMouseLeave);
        iframeDoc.removeEventListener('keydown', handleModifierChange);
        iframeDoc.removeEventListener('keyup', handleModifierChange);
        if (currentHoveredTextElement) {
          currentHoveredTextElement.classList.remove('text-editable-hover');
        }
        clearPreview();
      };
    },
    [hasDirectTextContent]
  );

  return {
    initializeIframeDocument,
    setupMutationObserver,
    setupTextHoverListener,
  };
}
