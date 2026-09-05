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
    role: 'separator';
    tabIndex: number;
    'aria-label': string;
    'aria-orientation': 'vertical';
    'aria-valuemin': number;
    'aria-valuemax': number;
    'aria-valuenow': number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onDoubleClick: () => void;
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
      let stored: string | null = null;
      try { stored = localStorage.getItem(storageKey); } catch { /* 既定幅を使う */ }
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

  }, [minWidth, maxWidth]);

  // ドラッグ中の同期ストレージ書込みを避け、確定時だけ幅を記憶する。
  useEffect(() => {
    if (isDragging || !storageKey) return;
    try { localStorage.setItem(storageKey, String(width)); } catch { /* 表示は継続 */ }
  }, [width, isDragging, storageKey]);

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
    document.addEventListener('touchcancel', handleTouchEnd);

    // カーソルスタイルを変更
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [isDragging, direction, setWidth]);

  // リサイズハンドルのprops
  const resizeHandleProps: UseResizablePanelReturn['resizeHandleProps'] = {
    role: 'separator', tabIndex: 0,
    'aria-label': 'パネルの幅（矢印キーで調整）',
    'aria-orientation': 'vertical',
    'aria-valuemin': minWidth, 'aria-valuemax': maxWidth, 'aria-valuenow': width,
    onDoubleClick: () => setWidth(initialWidth),
    onKeyDown: (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const sign = direction === 'right' ? 1 : -1;
      if (e.key === 'Home') setWidth(minWidth);
      else if (e.key === 'End') setWidth(maxWidth);
      else setWidth(width + (e.key === 'ArrowRight' ? sign : -sign) * (e.shiftKey ? 32 : 8));
    },
    onMouseDown: handleMouseDown,
    onTouchStart: handleTouchStart,
    style: {
      cursor: 'col-resize', touchAction: 'none',
    } as React.CSSProperties,
    className: `
      absolute top-0 ${direction === 'right' ? 'right-0' : 'left-0'}
      ed-resize-handle w-1 h-full z-10
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
