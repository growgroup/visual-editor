'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseResizablePanelOptions {
  /** 初期幅 */
  initialWidth: number;
  /** 最小幅 */
  minWidth: number;
  /** 最大幅 */
  maxWidth: number;
  /** リサイズ方向: 'left'=左端をドラッグ, 'right'=右端をドラッグ */
  direction: 'left' | 'right';
  /** ローカルストレージのキー（指定時は幅を永続化） */
  storageKey?: string;
}

export interface UseResizablePanelReturn {
  /** 現在の幅 */
  width: number;
  /** 幅を設定 */
  setWidth: (width: number) => void;
  /** ドラッグ中かどうか */
  isDragging: boolean;
  /** リサイズハンドルのprops */
  resizeHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
    style: React.CSSProperties;
    className: string;
  };
}

/**
 * リサイズ可能なパネル用フック
 */
export function useResizablePanel({
  initialWidth,
  minWidth,
  maxWidth,
  direction,
  storageKey,
}: UseResizablePanelOptions): UseResizablePanelReturn {
  // ローカルストレージから初期値を読み込み
  const getInitialWidth = () => {
    if (storageKey && typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return initialWidth;
  };

  const [width, setWidthState] = useState(getInitialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // 幅を設定（範囲内に収める）
  const setWidth = useCallback((newWidth: number) => {
    const clampedWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
    setWidthState(clampedWidth);

    // ローカルストレージに保存
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(clampedWidth));
    }
  }, [minWidth, maxWidth, storageKey]);

  // マウスダウン
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  // タッチスタート
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
    startWidthRef.current = width;
  }, [width]);

  // マウス移動・アップイベント
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      // direction が 'right' なら右にドラッグすると幅が増える
      // direction が 'left' なら左にドラッグすると幅が増える
      const newWidth = direction === 'right'
        ? startWidthRef.current + deltaX
        : startWidthRef.current - deltaX;
      setWidth(newWidth);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const deltaX = e.touches[0].clientX - startXRef.current;
      const newWidth = direction === 'right'
        ? startWidthRef.current + deltaX
        : startWidthRef.current - deltaX;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    // グローバルイベントリスナー
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);

    // カーソルスタイルを変更
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, direction, setWidth]);

  // リサイズハンドルのprops
  const resizeHandleProps = {
    onMouseDown: handleMouseDown,
    onTouchStart: handleTouchStart,
    style: {
      cursor: 'col-resize',
    } as React.CSSProperties,
    className: `
      absolute top-0 ${direction === 'right' ? 'right-0' : 'left-0'}
      w-1 h-full z-10
      hover:bg-blue-500/50
      ${isDragging ? 'bg-blue-500' : 'bg-transparent'}
      transition-colors duration-150
    `.trim().replace(/\s+/g, ' '),
  };

  return {
    width,
    setWidth,
    isDragging,
    resizeHandleProps,
  };
}
