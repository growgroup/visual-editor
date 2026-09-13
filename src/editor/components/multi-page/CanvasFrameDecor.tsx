'use client';

/**
 * フレームの枠線と階層の線を <canvas> に描く(画面の座標)。
 *
 * [なぜ DOM ではなく canvas か]
 * 枠線を転写層の中の要素に持たせる(box-shadow / outline / border のどれでも)と、
 * 倍率が変わるたびに転写層まるごとが塗り直される。26 ページで 1 段あたり 10〜20ms、
 * 30 段の縮小で主スレッドの Paint が 870ms になる(実測)。階層の線(SVG)も同じ。
 * 逆に、転写層の中身が「白い矩形 + 合成済みの iframe」だけなら 1 段の Paint は 0.5ms 前後。
 *
 * 26 ページ・30 段の縮小での実測(DPR 2、CPU 4 倍遅く):
 *   枠線 box-shadow + 線 SVG … Paint 287 回 / 1293ms、フレーム p95 42ms
 *   枠線 outline + 線 SVG    … Paint 218 回 /  793ms、フレーム p95 42ms
 *   どちらも消す(この実装と同じ状態) … Paint  82 回 /   64ms、フレーム p95 25ms
 *
 * そこで枠線と線は転写層から出し、画面の座標で 1 枚の canvas に描く。倍率・位置が
 * 変わるたびに描き直すが、26 本の矩形と 25 本の折れ線を 1600×1000 に描くだけなので
 * 1ms もかからない。定規(CanvasRulers)と同じ考え方
 *
 * [書き方の約束]
 * - canvas の寸法(width / height / style)は載せたときと容器の大きさが変わったときだけ書く。
 *   毎段書くと再確保が起き、パン・ズームで style が変わる要素の数も増える(検証が数えている)
 * - 色は載せたときとテーマが変わったときだけ読む(毎回 getComputedStyle すると同期のレイアウトが走る)
 */

import { memo, useEffect, useRef } from 'react';
import { FRAME_GAP, useMultiPageCanvas, type CanvasLayoutKind, type PageFrameLayout } from '../../contexts/MultiPageCanvasContext';

/** 枠線の太さ(画面上の px)。以前の box-shadow: 0 0 0 1px と同じ見え方 */
const EDGE_WIDTH = 1;
/** 階層の線の太さ(画面上の px) */
const CONNECTOR_WIDTH = 1.5;

function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export const CanvasFrameDecor = memo(function CanvasFrameDecor({ theme }: { theme: 'light' | 'dark' }) {
  const { pages, layout, editorMode, viewStore } = useMultiPageCanvas();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 描き直しの入口。倍率・位置の購読と、ページ・テーマの変化の両方から呼ぶ
  const drawRef = useRef<() => void>(() => undefined);
  // 購読のコールバックは載せたときの props を閉じ込めてしまうので、ref 越しに読む
  const pagesRef = useRef<PageFrameLayout[]>(pages);
  pagesRef.current = pages;
  const layoutRef = useRef<CanvasLayoutKind>(layout);
  layoutRef.current = layout;
  const gapYRef = useRef(FRAME_GAP[editorMode].y);
  gapYRef.current = FRAME_GAP[editorMode].y;
  const colorsRef = useRef({ edge: 'rgba(0,0,0,0.08)', line: '#e6e6e6' });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 容器は自分の親をそのまま使う。context の containerRef は親(MultiPageCanvasView)の
    // useEffect で入るので、子のこの useEffect が走る時点ではまだ null
    const host = canvas.parentElement as HTMLElement | null;
    if (!host) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = host.clientWidth;
      const height = host.clientHeight;
      const prev = sizeRef.current;
      if (width === prev.width && height === prev.height && dpr === prev.dpr) return width > 0 && height > 0;
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      return width > 0 && height > 0;
    };

    const readColors = () => {
      colorsRef.current = {
        edge: readVar(host, '--ed-frame-edge', theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
        line: readVar(host, '--ed-line-strong', theme === 'dark' ? '#5a5a5a' : '#d0d0d0'),
      };
    };

    const draw = () => {
      const { width, height, dpr } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const { canvasOffset: o, canvasZoom: z } = viewStore.get();
      const list = pagesRef.current;
      if (list.length === 0) return;
      // 画面の座標へ。半 px ずらして 1px の線がぼやけないようにする
      const rectOf = (p: PageFrameLayout) => ({
        x: Math.round(o.x + p.position.x * z),
        y: Math.round(o.y + p.position.y * z),
        w: Math.round(p.size.width * z),
        h: Math.round(p.size.height * z),
      });
      const visible = (r: { x: number; y: number; w: number; h: number }) =>
        r.x + r.w >= -2 && r.x <= width + 2 && r.y + r.h >= -2 && r.y <= height + 2;

      // 階層の線 → 枠線の順(線の端が枠に隠れる)
      if (layoutRef.current === 'tree') {
        const byId = new Map(list.map((p) => [p.id, p] as const));
        ctx.strokeStyle = colorsRef.current.line;
        ctx.lineWidth = CONNECTOR_WIDTH;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const child of list) {
          const parent = child.parentId ? byId.get(child.parentId) : undefined;
          if (!parent) continue;
          // 画素の境目に載せる(端数のままだと 1.5px の線が 3 画素に散ってぼやける)
          const x1 = Math.round(o.x + (parent.position.x + parent.size.width / 2) * z);
          const y1 = Math.round(o.y + (parent.position.y + parent.size.height) * z);
          const x2 = Math.round(o.x + (child.position.x + child.size.width / 2) * z);
          const y2 = Math.round(o.y + child.position.y * z);
          // 画面から外れている組はたどらない(150 枚でも描く本数は見えている分だけ)
          if (Math.max(x1, x2) < -2 || Math.min(x1, x2) > width + 2 || y2 < -2 || y1 > height + 2) continue;
          // 親の下から、子の行との隙間の真ん中まで下り、横へ移って子の上へ
          const ym = Math.round(y2 - (gapYRef.current * z) / 2);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1, ym);
          ctx.lineTo(x2, ym);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = colorsRef.current.edge;
      ctx.lineWidth = EDGE_WIDTH;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      for (const p of list) {
        const r = rectOf(p);
        if (!visible(r)) continue;
        // 以前の box-shadow: 0 0 0 1px は枠の外側に出ていたので、境目に重ねて同じ見え方にする
        ctx.rect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
      }
      ctx.stroke();
    };

    drawRef.current = draw;
    readColors();
    resize();
    draw();
    const unsubscribe = viewStore.subscribe(draw);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { resize(); draw(); });
      observer.observe(host);
    }
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, [viewStore, theme]);

  // ページの並び・高さが変わったら描き直す(倍率・位置は上の購読が受ける)。
  // viewStore を空更新して呼ぶことはしない ── 他の購読者(定規・コメントのピン)まで巻き込むので
  useEffect(() => { drawRef.current(); }, [pages, layout, editorMode]);

  return (
    <canvas
      ref={canvasRef}
      data-canvas-decor
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0"
    />
  );
});
