'use client';

/**
 * 定規(上・左)。Figma と同じく紙面の座標(等倍の px)で目盛りを打ち、
 * 編集中のフレームの範囲を淡く塗る。倍率に応じて目盛りの間隔を切り替える。
 * <canvas> に描くので、ズーム・パンの毎フレームでも DOM を作り直さない
 */

import { memo, useEffect, useRef } from 'react';
import { RULER_SIZE, useMultiPageCanvas } from '../../contexts/MultiPageCanvasContext';

/** 目盛りの候補(紙面の px)。画面上で 60px 以上離れる最小のものを選ぶ */
const STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function pickStep(zoom: number): number {
  return STEPS.find((s) => s * zoom >= 60) ?? STEPS[STEPS.length - 1];
}

function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export const CanvasRulers = memo(function CanvasRulers({ theme }: { theme: 'light' | 'dark' }) {
  const { viewState, pages } = useMultiPageCanvas();
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const { canvasOffset, canvasZoom, activePageId } = viewState;
  const active = pages.find((p) => p.id === activePageId);
  const activeKey = active ? `${active.position.x},${active.position.y},${active.size.width},${active.size.height}` : '';

  useEffect(() => {
    const top = topRef.current;
    const left = leftRef.current;
    if (!top || !left) return;
    const host = top.parentElement as HTMLElement | null;
    if (!host) return;
    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;

    const colors = {
      bg: readVar(host, '--ed-panel', theme === 'dark' ? '#2c2c2c' : '#ffffff'),
      line: readVar(host, '--ed-line', theme === 'dark' ? '#444444' : '#e6e6e6'),
      text: readVar(host, '--ed-muted', theme === 'dark' ? '#b3b3b3' : '#6b6b6b'),
      accent: readVar(host, '--ed-accent', '#0d99ff'),
    };
    const step = pickStep(canvasZoom);
    const minor = step / 5;

    const setup = (cv: HTMLCanvasElement, w: number, h: number) => {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
      ctx.fillStyle = colors.text;
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      return ctx;
    };

    // ---- 上の定規
    {
      const ctx = setup(top, width, RULER_SIZE);
      if (active) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(13,153,255,0.22)' : 'rgba(13,153,255,0.16)';
        const x0 = canvasOffset.x + active.position.x * canvasZoom;
        ctx.fillRect(x0, 0, active.size.width * canvasZoom, RULER_SIZE);
        ctx.fillStyle = colors.text;
      }
      const first = Math.floor((RULER_SIZE - canvasOffset.x) / canvasZoom / minor) * minor;
      const last = (width - canvasOffset.x) / canvasZoom;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.beginPath();
      for (let v = first; v <= last; v += minor) {
        const x = Math.round(canvasOffset.x + v * canvasZoom) + 0.5;
        if (x < RULER_SIZE) continue;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        ctx.moveTo(x, RULER_SIZE);
        ctx.lineTo(x, major ? RULER_SIZE - 9 : RULER_SIZE - 4);
        if (major) ctx.fillText(String(Math.round(v)), x + 3, 3);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(width, RULER_SIZE - 0.5);
      ctx.stroke();
    }

    // ---- 左の定規(文字は縦書きにせず、横のまま小さく置く)
    {
      const ctx = setup(left, RULER_SIZE, height);
      if (active) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(13,153,255,0.22)' : 'rgba(13,153,255,0.16)';
        const y0 = canvasOffset.y + active.position.y * canvasZoom;
        ctx.fillRect(0, y0, RULER_SIZE, active.size.height * canvasZoom);
        ctx.fillStyle = colors.text;
      }
      const first = Math.floor((RULER_SIZE - canvasOffset.y) / canvasZoom / minor) * minor;
      const last = (height - canvasOffset.y) / canvasZoom;
      ctx.beginPath();
      for (let v = first; v <= last; v += minor) {
        const y = Math.round(canvasOffset.y + v * canvasZoom) + 0.5;
        if (y < RULER_SIZE) continue;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        ctx.moveTo(RULER_SIZE, y);
        ctx.lineTo(major ? RULER_SIZE - 9 : RULER_SIZE - 4, y);
        if (major) {
          ctx.save();
          ctx.translate(3, y + 3);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(String(Math.round(v)), 0, 0);
          ctx.restore();
        }
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, height);
      ctx.stroke();
    }
  }, [canvasOffset.x, canvasOffset.y, canvasZoom, activeKey, theme, active]);

  // 容器のサイズ変更でも描き直す
  const [, force] = useForceRedraw(topRef);

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-canvas-rulers aria-hidden="true" data-redraw={force}>
      <canvas ref={topRef} className="absolute left-0 top-0" />
      <canvas ref={leftRef} className="absolute left-0 top-0" />
      <div
        className="absolute left-0 top-0"
        style={{ width: RULER_SIZE, height: RULER_SIZE, background: 'var(--ed-panel)', borderRight: '1px solid var(--ed-line)', borderBottom: '1px solid var(--ed-line)' }}
      />
    </div>
  );
});

function useForceRedraw(ref: React.RefObject<HTMLCanvasElement | null>): [number, number] {
  const tick = useRef(0);
  const [, set] = useStateSafe();
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { tick.current++; set(tick.current); });
    observer.observe(host);
    return () => observer.disconnect();
  }, [ref, set]);
  return [tick.current, tick.current];
}

import { useState } from 'react';
function useStateSafe(): [number, (v: number) => void] {
  const [v, set] = useState(0);
  return [v, set];
}
