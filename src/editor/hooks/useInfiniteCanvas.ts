'use client';

/**
 * useInfiniteCanvas
 *
 * 無限キャンバスのズーム/パン操作を管理するhook
 * - ホイールズーム (Ctrl/Cmd + wheel)
 * - ホイールパン (wheel without modifier)
 * - ピンチジェスチャー (trackpad pinch)
 * - スペース+ドラッグパン
 * - Ctrl/Cmd+0 でフィットズーム
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.0;

export function useInfiniteCanvas(
  containerRef: RefObject<HTMLDivElement | null>
) {
  const canvas = useMultiPageCanvasOptional();
  const isSpaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });

  // Stale closure回避: 頻繁に変わる値はrefで保持
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // ホイールイベント: ズームとパン（refベースで effect churn を回避）
  useEffect(() => {
    if (!canvas?.isEnabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const c = canvasRef.current;
      if (!c) return;
      const { canvasOffset, canvasZoom } = c.viewState;

      // ピンチジェスチャー（ctrlKey=trueになる）またはCtrl+Wheelでズーム
      if (e.ctrlKey || e.metaKey) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // ズーム感度調整
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.05 : 0.95;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, canvasZoom * factor));

        // マウス位置を中心にズーム
        const newOffset = {
          x: mouseX - (mouseX - canvasOffset.x) * (newZoom / canvasZoom),
          y: mouseY - (mouseY - canvasOffset.y) * (newZoom / canvasZoom),
        };

        c.setCanvasZoom(newZoom);
        c.setCanvasOffset(newOffset);
      } else {
        // 通常ホイール: パン
        c.setCanvasOffset({
          x: canvasOffset.x - e.deltaX,
          y: canvasOffset.y - e.deltaY,
        });
      }
    };

    const preventNativeZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    
    // イベントがどこから来てもブラウザズームをルートで殺す
    window.addEventListener('wheel', preventNativeZoom, { passive: false, capture: true });
    document.addEventListener('wheel', preventNativeZoom, { passive: false, capture: true });
    container.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('wheel', preventNativeZoom, { capture: true });
      document.removeEventListener('wheel', preventNativeZoom, { capture: true });
      container.removeEventListener('wheel', handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.isEnabled, containerRef]);

  // スペースキーでパンモード
  useEffect(() => {
    if (!canvas?.isEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        isSpaceHeldRef.current = true;
        const container = containerRef.current;
        if (container) {
          container.style.cursor = 'grab';
        }
      }

      const c = canvasRef.current;
      if (!c) return;

      // Ctrl/Cmd + 0: フィットズーム
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          c.zoomToFit(rect.width, rect.height);
        }
      }

      // Ctrl/Cmd + +: ズームイン
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        c.zoomIn();
      }

      // Ctrl/Cmd + -: ズームアウト
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        c.zoomOut();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceHeldRef.current = false;
        isPanningRef.current = false;
        const container = containerRef.current;
        if (container) {
          container.style.cursor = '';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.isEnabled, containerRef]);

  // スペース+マウスドラッグでパン
  useEffect(() => {
    if (!canvas?.isEnabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      // スペース押下中 or 中クリック
      if (isSpaceHeldRef.current || e.button === 1) {
        e.preventDefault();
        isPanningRef.current = true;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        container.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      e.preventDefault();

      const dx = e.clientX - lastPanPosRef.current.x;
      const dy = e.clientY - lastPanPosRef.current.y;
      lastPanPosRef.current = { x: e.clientX, y: e.clientY };

      const c = canvasRef.current;
      if (!c) return;
      const { canvasOffset } = c.viewState;
      c.setCanvasOffset({
        x: canvasOffset.x + dx,
        y: canvasOffset.y + dy,
      });
    };

    const handleMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        container.style.cursor = isSpaceHeldRef.current ? 'grab' : '';
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.isEnabled, containerRef]);

  // タッチパン（モバイル対応）
  useEffect(() => {
    if (!canvas?.isEnabled) return;
    const container = containerRef.current;
    if (!container) return;

    let lastTouchPos: { x: number; y: number } | null = null;
    let initialPinchDistance: number | null = null;
    let initialPinchZoom: number | null = null;

    const getCenter = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.sqrt((t2.clientX - t1.clientX) ** 2 + (t2.clientY - t1.clientY) ** 2);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const c = canvasRef.current;
        initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
        initialPinchZoom = c?.viewState.canvasZoom ?? 0.15;
        lastTouchPos = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const c = canvasRef.current;
      if (!c) return;

      if (e.touches.length === 1 && lastTouchPos) {
        // 1本指パン
        const dx = e.touches[0].clientX - lastTouchPos.x;
        const dy = e.touches[0].clientY - lastTouchPos.y;
        lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };

        const { canvasOffset } = c.viewState;
        c.setCanvasOffset({
          x: canvasOffset.x + dx,
          y: canvasOffset.y + dy,
        });
      } else if (e.touches.length === 2 && initialPinchDistance != null && initialPinchZoom != null) {
        e.preventDefault();
        // ピンチズーム
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const scale = currentDistance / initialPinchDistance;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialPinchZoom * scale));

        const rect = container.getBoundingClientRect();
        const center = getCenter(e.touches[0], e.touches[1]);
        const mouseX = center.x - rect.left;
        const mouseY = center.y - rect.top;

        const { canvasOffset, canvasZoom } = c.viewState;
        const newOffset = {
          x: mouseX - (mouseX - canvasOffset.x) * (newZoom / canvasZoom),
          y: mouseY - (mouseY - canvasOffset.y) * (newZoom / canvasZoom),
        };

        c.setCanvasZoom(newZoom);
        c.setCanvasOffset(newOffset);
      }
    };

    const handleTouchEnd = () => {
      lastTouchPos = null;
      initialPinchDistance = null;
      initialPinchZoom = null;
    };

    const preventNativeTouchZoom = (e: TouchEvent) => {
      if (e.touches && e.touches.length >= 2) {
        e.preventDefault();
      }
    };
    window.addEventListener('touchstart', preventNativeTouchZoom, { passive: false, capture: true });
    window.addEventListener('touchmove', preventNativeTouchZoom, { passive: false, capture: true });
    document.addEventListener('touchstart', preventNativeTouchZoom, { passive: false, capture: true });
    document.addEventListener('touchmove', preventNativeTouchZoom, { passive: false, capture: true });

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchstart', preventNativeTouchZoom, { capture: true });
      window.removeEventListener('touchmove', preventNativeTouchZoom, { capture: true });
      document.removeEventListener('touchstart', preventNativeTouchZoom, { capture: true });
      document.removeEventListener('touchmove', preventNativeTouchZoom, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.isEnabled, containerRef]);
}
