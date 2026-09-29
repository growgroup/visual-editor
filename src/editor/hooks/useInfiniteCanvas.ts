'use client';

/**
 * useInfiniteCanvas
 *
 * マルチフレームキャンバスのズーム/パン操作。
 * - ホイール: パン(2 本指スクロール)。Shift で横
 * - Ctrl/Cmd + ホイール、トラックパッドのピンチ: カーソル位置を固定してズーム
 * - Space + ドラッグ / 中ボタンドラッグ: パン
 * - Safari・WKWebView のトラックパッドのピンチ(gesturestart / gesturechange): カーソル位置を固定してズーム(0.10.0)
 * - Cmd/Ctrl + / - : 段階ズーム(既定 1.25 倍。canvasZoomOptions.steps で 2 の累乗の段)。Shift+0 = 100%、Shift+1 = 全体、
 *   Shift+2 = 編集中のページ(canvasZoomOptions.fitShortcut: 'selection' なら選んでいる要素)、Shift+R = 定規
 *   (Cmd+0 / 1 / 2 は既存のディスパッチャ(editorZoomApiRef)が受ける)
 * - 2 本指タッチ: ピンチズーム / 1 本指: パン
 * - 拡大縮小はどの経路も zoomAt(カーソル位置が中心)に集める。キーとボタンは画面の中心
 * - IME の変換中のキーは奪わない
 *
 * [iframe から来る操作]
 * 生きているエディタ(EditorCanvas)と見るだけの紙面は iframe なので、その上で起きた
 * ホイール・キー・中ボタンは親へ届かない。iframe 側が postMessage で転送し
 * (EMBEDDED_WHEEL / EMBEDDED_PINCH / EMBEDDED_KEY / EMBEDDED_PAN_START)、
 * ここで **同じ処理** に流す。座標は iframe の座標で届くので、
 * 送り元の iframe 要素の実測矩形と倍率で親の座標へ直す
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMultiPageCanvasOptional, MIN_ZOOM, MAX_ZOOM } from '../contexts/MultiPageCanvasContext';
import { isSpaceActivatedControl, editorZoomApiRef } from './useCanvasControls';
import { listenCanvasGestures, isImeKeyEvent } from '../utils/canvas-gestures';

/** iframe 側が転送してくるメッセージ */
export type EmbeddedCanvasMessage =
  | { type: 'EMBEDDED_WHEEL'; coords?: 'parent'; deltaX: number; deltaY: number; clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  | { type: 'EMBEDDED_PINCH'; coords?: 'parent'; previousDistance: number; currentDistance: number; centerX: number; centerY: number }
  | { type: 'EMBEDDED_PAN_START'; coords?: 'parent'; clientX: number; clientY: number }
  | { type: 'EMBEDDED_KEY'; kind: 'down' | 'up'; key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
// ピンチ(GestureEvent)の転送 EMBEDDED_GESTURE は listenCanvasGestures が受ける(utils/canvas-gestures.ts)

/** ホイール 1 目盛りのズーム係数。トラックパッド(小さい delta が連続)と、マウスホイール(大きい delta)で分ける */
const PINCH_K = 0.01;
const WHEEL_K = 0.0025;
const MAX_STEP = 1.25;

function wheelFactor(deltaY: number): number {
  const k = Math.abs(deltaY) < 50 ? PINCH_K : WHEEL_K;
  return Math.max(1 / MAX_STEP, Math.min(MAX_STEP, Math.exp(-deltaY * k)));
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

export function useInfiniteCanvas(containerRef: RefObject<HTMLDivElement | null>) {
  const canvas = useMultiPageCanvasOptional();
  const enabled = !!canvas?.isEnabled;

  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const spaceRef = useRef(false);
  const panningRef = useRef(false);
  const lastPanPosRef = useRef({ x: 0, y: 0 });

  // Stale closure回避: 頻繁に変わる値はrefで保持
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const c = () => canvasRef.current!;
    const toContainerPoint = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    /**
     * 送り元 iframe の座標を親の client 座標へ(外側の transform の倍率を実測で掛ける)。
     * 送り手が親の座標に直して送ってきた(coords: 'parent')ならそのまま
     */
    const fromIframe = (source: MessageEventSource | null, x: number, y: number, coords?: 'parent') => {
      if (coords === 'parent') return { clientX: x, clientY: y };
      if (!source) return null;
      const iframes = Array.from(container.querySelectorAll('iframe'));
      const iframe = iframes.find((f) => f.contentWindow === source);
      if (!iframe) return null;
      const rect = iframe.getBoundingClientRect();
      const scale = rect.width / (iframe.clientWidth || rect.width) || 1;
      return { clientX: rect.left + x * scale, clientY: rect.top + y * scale };
    };

    // ---- Safari・WKWebView のピンチ(容器の上で起きたものと、紙面の iframe から転送されたもの)
    const gestures = listenCanvasGestures({
      win: window,
      container,
      target: () => ({
        getZoom: () => c().viewStore.get().canvasZoom,
        zoomAt: (zoom, clientX, clientY) => c().zoomAt(zoom, toContainerPoint(clientX, clientY)),
        markInteracting: () => c().markInteracting(),
      }),
    });

    // ---- ズーム/パンの実処理(ホイールと転送メッセージで共通)
    const applyWheel = (deltaX: number, deltaY: number, clientX: number, clientY: number, zoomGesture: boolean, shiftKey: boolean) => {
      c().markInteracting();
      if (zoomGesture) {
        // ピンチ(GestureEvent)の最中に ctrl 付き wheel も届く環境で二重に拡大しない
        if (gestures.active) return;
        const { canvasZoom } = c().viewStore.get();
        c().zoomAt(canvasZoom * wheelFactor(deltaY), toContainerPoint(clientX, clientY));
        return;
      }
      const { canvasOffset } = c().viewStore.get();
      // Shift + 縦ホイール = 横パン(マウス向け。トラックパッドは deltaX が来る)
      const dx = shiftKey && deltaX === 0 ? deltaY : deltaX;
      const dy = shiftKey && deltaX === 0 ? 0 : deltaY;
      c().setCanvasOffset({ x: canvasOffset.x - dx, y: canvasOffset.y - dy });
    };

    const applyPinch = (previousDistance: number, currentDistance: number, clientX: number, clientY: number) => {
      if (!previousDistance || !currentDistance) return;
      c().markInteracting();
      const factor = Math.max(1 / MAX_STEP, Math.min(MAX_STEP, currentDistance / previousDistance));
      c().zoomAt(c().viewStore.get().canvasZoom * factor, toContainerPoint(clientX, clientY));
    };

    const startPan = (clientX: number, clientY: number) => {
      panningRef.current = true;
      setIsPanning(true);
      lastPanPosRef.current = { x: clientX, y: clientY };
      container.style.cursor = 'grabbing';
      c().markInteracting();
    };

    // ---- ホイール(容器の上で起きたもの)
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyWheel(e.deltaX, e.deltaY, e.clientX, e.clientY, e.ctrlKey || e.metaKey, e.shiftKey);
    };

    // ブラウザ自体の拡大を殺す(どこから来ても)
    const preventNativeZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };

    // ---- キー
    // ヘッダーの +/− と同じ zoomIn / zoomOut(刻みは canvasZoomOptions.steps)
    const stepZoom = (dir: 1 | -1) => (dir > 0 ? c().zoomIn() : c().zoomOut());
    const handleKey = (kind: 'down' | 'up', key: string, code: string, mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, preventDefault: () => void, typing: boolean) => {
      if (code === 'Space') {
        if (typing) return;
        if (kind === 'down') {
          if (!spaceRef.current) {
            spaceRef.current = true;
            setIsSpaceHeld(true);
            container.style.cursor = 'grab';
          }
          preventDefault();
        } else {
          spaceRef.current = false;
          setIsSpaceHeld(false);
          if (!panningRef.current) container.style.cursor = '';
        }
        return;
      }
      if (kind !== 'down' || typing) return;
      const cmd = mods.metaKey || mods.ctrlKey;
      if (cmd && (key === '=' || key === '+' || key === ';' )) { preventDefault(); stepZoom(1); return; }
      if (cmd && (key === '-' || key === '_')) { preventDefault(); stepZoom(-1); return; }
      if (!cmd && mods.shiftKey && !mods.altKey) {
        if (key === '0' || code === 'Digit0') { preventDefault(); c().zoomToActual(); return; }
        if (key === '1' || code === 'Digit1') { preventDefault(); c().zoomToFit({ animate: true }); return; }
        if (key === '2' || code === 'Digit2') {
          // ⌘2 と同じ合わせ先(既定は編集中のページ。fitShortcut: 'selection' なら選んでいる要素)
          preventDefault();
          if (editorZoomApiRef.current) { editorZoomApiRef.current.selection(); return; }
          const id = c().viewStore.get().activePageId;
          if (id) c().zoomToPage(id, { animate: true });
          return;
        }
        if (key.toLowerCase() === 'r' || code === 'KeyR') { preventDefault(); c().toggleRulers(); return; }
      }
    };

    // ボタンにフォーカスがあるときの Space はそのボタンのもの(キーボードだけで操作している人が押せなくなる)
    const spaceBelongsToControl = (e: KeyboardEvent) =>
      e.code === 'Space' && (isSpaceActivatedControl(e.target) || isSpaceActivatedControl(document.activeElement));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return; // IME の変換中のキーは奪わない
      if (spaceBelongsToControl(e)) return;
      if (e.repeat && e.code === 'Space') { if (!isTypingTarget(e.target)) e.preventDefault(); return; }
      handleKey('down', e.key, e.code, e, () => e.preventDefault(), isTypingTarget(e.target));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (spaceBelongsToControl(e) && !spaceRef.current) return;
      handleKey('up', e.key, e.code, e, () => e.preventDefault(), isTypingTarget(e.target));
    };
    // ウィンドウのフォーカスが外れたら Space を離したことにする(押しっぱなし状態が残らない)
    const handleBlur = () => {
      spaceRef.current = false;
      setIsSpaceHeld(false);
      panningRef.current = false;
      setIsPanning(false);
      container.style.cursor = '';
    };

    // ---- マウス(Space または中ボタンでパン)
    const handleMouseDown = (e: MouseEvent) => {
      if (spaceRef.current || e.button === 1) {
        e.preventDefault();
        startPan(e.clientX, e.clientY);
      }
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!panningRef.current) return;
      e.preventDefault();
      const dx = e.clientX - lastPanPosRef.current.x;
      const dy = e.clientY - lastPanPosRef.current.y;
      lastPanPosRef.current = { x: e.clientX, y: e.clientY };
      const { canvasOffset } = c().viewStore.get();
      c().setCanvasOffset({ x: canvasOffset.x + dx, y: canvasOffset.y + dy });
      c().markInteracting();
    };
    const handleMouseUp = () => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setIsPanning(false);
      container.style.cursor = spaceRef.current ? 'grab' : '';
    };

    // ---- iframe からの転送
    const handleMessage = (e: MessageEvent) => {
      const data = e.data as EmbeddedCanvasMessage | undefined;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type.startsWith('EMBEDDED_')) return;
      if (data.type === 'EMBEDDED_WHEEL') {
        const p = fromIframe(e.source, data.clientX, data.clientY, data.coords);
        if (!p) return;
        applyWheel(data.deltaX, data.deltaY, p.clientX, p.clientY, data.ctrlKey || data.metaKey, data.shiftKey);
      } else if (data.type === 'EMBEDDED_PINCH') {
        const p = fromIframe(e.source, data.centerX, data.centerY, data.coords);
        if (!p) return;
        applyPinch(data.previousDistance, data.currentDistance, p.clientX, p.clientY);
      } else if (data.type === 'EMBEDDED_PAN_START') {
        const p = fromIframe(e.source, data.clientX, data.clientY, data.coords);
        if (!p) return;
        startPan(p.clientX, p.clientY);
      } else if (data.type === 'EMBEDDED_KEY') {
        handleKey(data.kind, data.key, data.code, data, () => undefined, false);
      }
    };

    // ---- タッチ
    let lastTouch: { x: number; y: number } | null = null;
    let pinchStart: { distance: number; zoom: number } | null = null;
    const distance = (t1: Touch, t2: Touch) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = (t1: Touch, t2: Touch) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      else if (e.touches.length === 2) {
        e.preventDefault();
        pinchStart = { distance: distance(e.touches[0], e.touches[1]), zoom: c().viewStore.get().canvasZoom };
        lastTouch = null;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && lastTouch) {
        const dx = e.touches[0].clientX - lastTouch.x;
        const dy = e.touches[0].clientY - lastTouch.y;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const { canvasOffset } = c().viewStore.get();
        c().setCanvasOffset({ x: canvasOffset.x + dx, y: canvasOffset.y + dy });
        c().markInteracting();
      } else if (e.touches.length === 2 && pinchStart) {
        e.preventDefault();
        const scale = distance(e.touches[0], e.touches[1]) / pinchStart.distance;
        const p = center(e.touches[0], e.touches[1]);
        c().zoomAt(pinchStart.zoom * scale, toContainerPoint(p.x, p.y));
        c().markInteracting();
      }
    };
    const handleTouchEnd = () => {
      lastTouch = null;
      pinchStart = null;
    };
    const preventNativeTouchZoom = (e: TouchEvent) => {
      if (e.touches && e.touches.length >= 2) e.preventDefault();
    };

    window.addEventListener('wheel', preventNativeZoom, { passive: false, capture: true });
    document.addEventListener('wheel', preventNativeZoom, { passive: false, capture: true });
    container.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('message', handleMessage);
    window.addEventListener('touchstart', preventNativeTouchZoom, { passive: false, capture: true });
    window.addEventListener('touchmove', preventNativeTouchZoom, { passive: false, capture: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      gestures.dispose();
      window.removeEventListener('wheel', preventNativeZoom, { capture: true });
      document.removeEventListener('wheel', preventNativeZoom, { capture: true });
      container.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('touchstart', preventNativeTouchZoom, { capture: true });
      window.removeEventListener('touchmove', preventNativeTouchZoom, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, containerRef]);

  return { isSpaceHeld, isPanning, MIN_ZOOM, MAX_ZOOM };
}
