'use client';

import { memo, useRef, useEffect, useCallback } from 'react';
import { useMultiPageCanvas } from '../../contexts/MultiPageCanvasContext';
import { useInfiniteCanvas } from '../../hooks/useInfiniteCanvas';
import { PageFrameOverlay } from './PageFrameOverlay';
import { CanvasZoomControls } from './CanvasZoomControls';

/**
 * InfiniteCanvas: 無限キャンバスコンテナ（レガシー）
 *
 * 全ページをフレームとして表示し、CSS transformでズーム/パンを実現。
 * Note: マルチページ統合ビューはMultiPageCanvasViewを使用。
 * このコンポーネントはサムネイル表示のみ（編集iframe含まず）。
 */
export const InfiniteCanvas = memo(function InfiniteCanvas() {
  const {
    viewState,
    pages,
    switchPage,
    zoomToFit,
  } = useMultiPageCanvas();
  const { canvasOffset, canvasZoom, activePageId } = viewState;
  const containerRef = useRef<HTMLDivElement>(null);

  // 無限キャンバスのズーム/パン操作
  useInfiniteCanvas(containerRef);

  // 初回表示時にフィットズーム
  const hasInitialFitRef = useRef(false);
  useEffect(() => {
    if (hasInitialFitRef.current || pages.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const timer = setTimeout(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        zoomToFit(rect.width, rect.height);
        hasInitialFitRef.current = true;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [pages.length, zoomToFit]);

  const handlePageClick = useCallback((pageId: string) => {
    switchPage(pageId);
  }, [switchPage]);

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      className="absolute inset-0 overflow-hidden select-none"
      style={{ backgroundColor: '#1a1a1a' }}
    >
      {/* ドットグリッド背景 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
          backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px`,
          backgroundPosition: `${canvasOffset.x % (24 * canvasZoom)}px ${canvasOffset.y % (24 * canvasZoom)}px`,
        }}
      />

      {/* CSS transform による無限キャンバス */}
      <div
        className="canvas-transform-layer"
        style={{
          transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasZoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {pages.map(page => (
          <PageFrameOverlay
            key={page.id}
            page={page}
            isActive={page.id === activePageId}
            onClick={handlePageClick}
          />
        ))}
      </div>

      {/* ズームコントロール */}
      <CanvasZoomControls />

      {/* ページ数表示 */}
      <div className="absolute top-4 left-4 z-10 text-xs text-gray-500 select-none">
        {pages.length} pages
      </div>
    </div>
  );
});
