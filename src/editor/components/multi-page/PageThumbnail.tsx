'use client';

import { memo } from 'react';
import { WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT } from '../../contexts/MultiPageCanvasContext';

interface PageThumbnailProps {
  html: string;
  dataUrl: string | null;
  size: { width: number; height: number };
}

/**
 * ページサムネイル: CSS scaleで縮小描画
 * dataUrl（高品質キャプチャ）がある場合はそれを表示、
 * なければHTMLをdangerouslySetInnerHTMLで描画
 */
export const PageThumbnail = memo(function PageThumbnail({
  html,
  dataUrl,
  size,
}: PageThumbnailProps) {
  // 高品質サムネイルがあればそれを表示
  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt=""
        className="w-full h-full object-cover object-top"
        draggable={false}
      />
    );
  }

  // HTMLが空の場合はプレースホルダー
  if (!html?.trim()) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <span className="text-gray-400 text-sm">Empty Page</span>
      </div>
    );
  }

  // HTMLをCSS scaleで縮小描画
  const scale = size.width / WEBPAGE_WIDTH;

  return (
    <div className="w-full h-full overflow-hidden">
      <div
        className="origin-top-left pointer-events-none"
        style={{
          width: WEBPAGE_WIDTH,
          height: WEBPAGE_MIN_HEIGHT,
          transform: `scale(${scale})`,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
