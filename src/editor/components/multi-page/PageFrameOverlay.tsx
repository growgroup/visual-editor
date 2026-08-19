'use client';

import { memo, useCallback } from 'react';
import { cn } from '../../../lib/utils';
import type { PageFrame } from '../../contexts/MultiPageCanvasContext';
import { PageLabel } from './PageLabel';
import { PageThumbnail } from './PageThumbnail';

interface PageFrameOverlayProps {
  page: PageFrame;
  isActive?: boolean;
  onDoubleClick?: (pageId: string) => void;
  onClick?: (pageId: string) => void;
}

/**
 * ページフレームオーバーレイ: 無限キャンバス上の各ページ表示
 * - ページ名ラベル（Figma風、上部）
 * - サムネイルプレビュー
 * - ホバー時のリング表示
 * - ダブルクリックでページフォーカス（Phase 2で完全実装）
 */
export const PageFrameOverlay = memo(function PageFrameOverlay({
  page,
  isActive = false,
  onDoubleClick,
  onClick,
}: PageFrameOverlayProps) {
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.(page.id);
  }, [onDoubleClick, page.id]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(page.id);
  }, [onClick, page.id]);

  return (
    <div
      className="absolute cursor-pointer group"
      style={{
        left: page.position.x,
        top: page.position.y,
        width: page.size.width,
        height: page.size.height,
      }}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
    >
      {/* ページ名ラベル */}
      <PageLabel
        title={page.title}
        isDirty={page.isDirty}
        isActive={isActive}
      />

      {/* サムネイルコンテナ */}
      <div
        className={cn(
          'w-full h-full bg-white rounded-sm shadow-lg overflow-hidden',
          'ring-2 transition-all duration-150',
          isActive
            ? 'ring-[#0d99ff] shadow-blue-500/20'
            : 'ring-transparent group-hover:ring-[#0d99ff]/50'
        )}
      >
        <PageThumbnail
          html={page.thumbnailHtml}
          dataUrl={page.thumbnailDataUrl}
          size={page.size}
        />
      </div>
    </div>
  );
});
