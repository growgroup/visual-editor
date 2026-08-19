'use client';

import { memo } from 'react';
import { cn } from '../../../lib/utils';

interface PageLabelProps {
  title: string;
  isDirty?: boolean;
  isActive?: boolean;
}

/**
 * ページ名ラベル（Figma風: フレーム上部に表示）
 */
export const PageLabel = memo(function PageLabel({
  title,
  isDirty = false,
  isActive = false,
}: PageLabelProps) {
  return (
    <div
      className={cn(
        'absolute -top-7 left-0 px-1.5 py-0.5 text-[11px] font-medium truncate max-w-[200px]',
        'select-none pointer-events-none',
        'text-gray-400'
      )}
    >
      {title}
      {isDirty && (
        <span className="ml-1 text-orange-400">*</span>
      )}
    </div>
  );
});
