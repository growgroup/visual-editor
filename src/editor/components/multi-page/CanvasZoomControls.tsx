'use client';

import { memo, useCallback, useRef } from 'react';
import { Minus, Plus, Maximize } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useMultiPageCanvas } from '../../contexts/MultiPageCanvasContext';

/**
 * ズームコントロール（右下固定）
 * - ズームイン/アウトボタン
 * - ズーム値表示
 * - フィットボタン (全ページを表示)
 */
export const CanvasZoomControls = memo(function CanvasZoomControls() {
  const { viewState, zoomIn, zoomOut, zoomToFit } = useMultiPageCanvas();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleFitToView = useCallback(() => {
    // 親のInfiniteCanvasコンテナサイズを取得
    const canvas = containerRef.current?.closest('[data-infinite-canvas]');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      zoomToFit(rect.width, rect.height);
    }
  }, [zoomToFit]);

  const zoomPercent = Math.round(viewState.canvasZoom * 100);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-[#2a2a2a] border border-[#404040] rounded-lg px-1 py-1 shadow-lg"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-[#404040]"
        onClick={zoomOut}
        title="ズームアウト"
      >
        <Minus className="w-3.5 h-3.5" />
      </Button>

      <span className="text-xs text-gray-300 min-w-[40px] text-center tabular-nums select-none">
        {zoomPercent}%
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-[#404040]"
        onClick={zoomIn}
        title="ズームイン"
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>

      <div className="w-px h-4 bg-[#404040] mx-0.5" />

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-[#404040]"
        onClick={handleFitToView}
        title="全体にフィット (Ctrl+0)"
      >
        <Maximize className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
});
