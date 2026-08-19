'use client';

/**
 * ブレイクポイントガイド
 * キャンバス上にブレイクポイントの縦線を表示し、クリックで幅を切り替える
 * Studioのような直感的なインタラクション
 *
 * iframe内にガイド要素を直接注入することで:
 * - スクロールに自然に追従
 * - コンテンツの背面に表示
 */

import { useEffect, useCallback, useRef } from 'react';
import { useEditorContext } from '../EditorContext';
import { BREAKPOINT_PRESETS } from '../constants';

// ガイドコンテナのID
const GUIDES_CONTAINER_ID = 'breakpoint-guides-container';

interface BreakpointGuidesProps {
  /** キャンバスコンテナの幅（未使用だが互換性のため残す） */
  containerWidth: number;
  /** キャンバスコンテナの高さ（未使用だが互換性のため残す） */
  containerHeight: number;
}

/**
 * ブレイクポイントガイドコンポーネント
 * webpageモード専用
 *
 * iframe内にガイド要素を注入して、スクロールに追従し、コンテンツの背面に表示
 */
export function BreakpointGuides({ containerWidth, containerHeight }: BreakpointGuidesProps) {
  const { viewportWidth, setViewportWidth, zoom, editorMode, iframeRef } = useEditorContext();
  const hoveredBreakpointRef = useRef<string | null>(null);

  // ガイド要素を作成・更新する関数
  const updateGuides = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    const canvasScrollArea = iframeDoc.getElementById('canvas-scroll-area');
    if (!canvasScrollArea) return;

    // 既存のガイドコンテナを取得または作成
    let guidesContainer = iframeDoc.getElementById(GUIDES_CONTAINER_ID);
    if (!guidesContainer) {
      guidesContainer = iframeDoc.createElement('div');
      guidesContainer.id = GUIDES_CONTAINER_ID;
      guidesContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        z-index: 0;
      `;
      // canvas-scroll-areaの最初の子として挿入（artboard-wrapperより前）
      canvasScrollArea.insertBefore(guidesContainer, canvasScrollArea.firstChild);
    }

    const scale = zoom / 100;

    // artboard-wrapperの中心位置を取得
    const artboardWrapper = iframeDoc.getElementById('artboard-wrapper');
    if (!artboardWrapper) return;

    // artboard-wrapperのスタイルから位置を計算
    const wrapperRect = artboardWrapper.getBoundingClientRect();
    const scrollAreaRect = canvasScrollArea.getBoundingClientRect();

    // scroll-area内でのartboard中心位置
    const scrollLeft = canvasScrollArea.scrollLeft;
    const scrollTop = canvasScrollArea.scrollTop;
    const centerX = (wrapperRect.left - scrollAreaRect.left + scrollLeft) + (wrapperRect.width / 2);

    // ガイドのHTML生成
    const guideLines: string[] = [];

    // 全てのブレイクポイントのガイドラインを生成（現在のビューポート幅以外）
    BREAKPOINT_PRESETS.filter(bp => bp.width !== viewportWidth).forEach((breakpoint) => {
      const isSmaller = breakpoint.width < viewportWidth;
      const halfWidth = (breakpoint.width * scale) / 2;
      const leftPos = centerX - halfWidth;
      const rightPos = centerX + halfWidth;

      // 線のスタイル
      const lineColor = isSmaller ? 'rgba(107, 114, 128, 0.3)' : 'rgba(107, 114, 128, 0.5)';
      const hoverColor = '#3b82f6';

      // 共通のラインスタイル
      const lineStyle = `
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: ${lineColor};
        pointer-events: auto;
        cursor: pointer;
        transition: all 0.15s ease;
      `;

      // 左側のガイドライン
      guideLines.push(`
        <div
          class="bp-guide-line"
          data-breakpoint="${breakpoint.id}"
          data-width="${breakpoint.width}"
          data-side="left"
          style="${lineStyle} left: ${leftPos}px;"
          onmouseenter="this.style.width='3px'; this.style.background='${hoverColor}'; this.style.transform='translateX(-1px)'; this.querySelector('.bp-label').style.opacity='1';"
          onmouseleave="this.style.width='1px'; this.style.background='${lineColor}'; this.style.transform='none'; this.querySelector('.bp-label').style.opacity='0';"
        >
          <div class="bp-label" style="
            position: absolute;
            top: 16px;
            left: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: ${hoverColor};
            color: white;
            font-size: 12px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.15s ease;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">
            <span style="font-weight: 500;">${breakpoint.name}</span>
            <span style="opacity: 0.75;">${breakpoint.width}px</span>
          </div>
        </div>
      `);

      // 右側のガイドライン
      guideLines.push(`
        <div
          class="bp-guide-line"
          data-breakpoint="${breakpoint.id}"
          data-width="${breakpoint.width}"
          data-side="right"
          style="${lineStyle} left: ${rightPos}px;"
          onmouseenter="this.style.width='3px'; this.style.background='${hoverColor}'; this.style.transform='translateX(-1px)'; this.querySelector('.bp-label').style.opacity='1';"
          onmouseleave="this.style.width='1px'; this.style.background='${lineColor}'; this.style.transform='none'; this.querySelector('.bp-label').style.opacity='0';"
        >
          <div class="bp-label" style="
            position: absolute;
            top: 16px;
            right: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: ${hoverColor};
            color: white;
            font-size: 12px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.15s ease;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">
            <span style="opacity: 0.75;">${breakpoint.width}px</span>
            <span style="font-weight: 500;">${breakpoint.name}</span>
          </div>
        </div>
      `);
    });

    // 現在のビューポート幅の境界線（緑色）
    const currentHalfWidth = (viewportWidth * scale) / 2;
    const currentLeftPos = centerX - currentHalfWidth;
    const currentRightPos = centerX + currentHalfWidth;

    guideLines.push(`
      <div style="
        position: absolute;
        top: 0;
        bottom: 0;
        left: ${currentLeftPos}px;
        width: 2px;
        background: rgba(34, 197, 94, 0.7);
        pointer-events: none;
      "></div>
      <div style="
        position: absolute;
        top: 0;
        bottom: 0;
        left: ${currentRightPos}px;
        width: 2px;
        background: rgba(34, 197, 94, 0.7);
        pointer-events: none;
      "></div>
    `);

    guidesContainer.innerHTML = guideLines.join('');

    // クリックイベントを設定
    const guideLineElements = guidesContainer.querySelectorAll('.bp-guide-line');
    guideLineElements.forEach((el) => {
      el.addEventListener('click', (e) => {
        const width = parseInt((el as HTMLElement).dataset.width || '0', 10);
        if (width > 0) {
          setViewportWidth(width);
        }
      });
    });
  }, [iframeRef, viewportWidth, zoom, setViewportWidth]);

  // ガイドを更新するタイミング
  useEffect(() => {
    if (editorMode !== 'webpage') return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    // iframeがロードされたら更新
    const handleLoad = () => {
      // 少し遅延させてDOMが準備されるのを待つ
      setTimeout(updateGuides, 100);
    };

    iframe.addEventListener('load', handleLoad);

    // 既にロード済みの場合
    if (iframe.contentDocument) {
      setTimeout(updateGuides, 100);
    }

    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [editorMode, iframeRef, updateGuides]);

  // ズーム、ビューポート幅、コンテナ幅が変わったら更新
  useEffect(() => {
    if (editorMode !== 'webpage') return;

    // 遅延させてスタイルが適用されてから更新
    const timer = setTimeout(updateGuides, 50);
    return () => clearTimeout(timer);
  }, [zoom, viewportWidth, containerWidth, editorMode, updateGuides]);

  // ブラウザリサイズ時にガイドを更新
  useEffect(() => {
    if (editorMode !== 'webpage') return;

    const handleResize = () => {
      // debounce的に少し遅延させて更新
      setTimeout(updateGuides, 50);
    };

    // メインウィンドウのリサイズを監視
    window.addEventListener('resize', handleResize);

    // iframe内のリサイズも監視
    const iframe = iframeRef.current;
    const iframeWindow = iframe?.contentWindow;
    if (iframeWindow) {
      iframeWindow.addEventListener('resize', handleResize);
    }

    // ResizeObserverでartboard-wrapperのサイズ変更を監視
    let resizeObserver: ResizeObserver | null = null;
    const iframeDoc = iframe?.contentDocument;
    if (iframeDoc) {
      const artboardWrapper = iframeDoc.getElementById('artboard-wrapper');
      const canvasScrollArea = iframeDoc.getElementById('canvas-scroll-area');

      if (artboardWrapper || canvasScrollArea) {
        resizeObserver = new ResizeObserver(() => {
          setTimeout(updateGuides, 50);
        });

        if (artboardWrapper) {
          resizeObserver.observe(artboardWrapper);
        }
        if (canvasScrollArea) {
          resizeObserver.observe(canvasScrollArea);
        }
      }
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (iframeWindow) {
        iframeWindow.removeEventListener('resize', handleResize);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [editorMode, iframeRef, updateGuides]);

  // クリーンアップ: コンポーネントがアンマウントされたらガイドを削除
  useEffect(() => {
    return () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;
      const container = iframeDoc.getElementById(GUIDES_CONTAINER_ID);
      if (container) {
        container.remove();
      }
    };
  }, [iframeRef]);

  // このコンポーネント自体は何もレンダリングしない（iframe内にガイドを注入するため）
  return null;
}

export default BreakpointGuides;
