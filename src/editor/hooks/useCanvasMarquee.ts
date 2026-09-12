'use client';

/**
 * キャンバスの余白から始めるマーキー選択(マルチフレームのキャンバス用)。
 *
 * 単独表示では紙面の外側(灰色の器)が「空白」なので、そこからドラッグして紙面の要素を
 * 囲めた。埋め込み(キャンバス)では iframe が紙面ぴったりの大きさで外側が無い。
 * そこでキャンバスの余白で押したドラッグを親が受け、矩形を編集中の iframe の座標に
 * 直して、iframe 内のマーキーと同じ判定(交差 → 最上位に畳む)で選ぶ。
 *
 * [縁をまたいだだけの「器」は選ばない]
 * 紙面の外から中へ引くと、ページ全体の器(main 等)の縁を必ずまたぐ。交差だけで判定すると
 * 常に器が選ばれて畳まれてしまう。そこで「他の候補をすべて含み、かつ矩形にすっぽり
 * 入っていない」要素は背景とみなして外す(外→中に引いたときの main / section がこれ)。
 * カード 1 枚やセクションを丸ごと囲んだときは、それがすっぽり入っているので残る
 *
 * [押している間はエディタの iframe に触らせない]
 * ドラッグ中にポインタが iframe の上へ入ると、mousemove / mouseup は iframe の文書へ
 * 届き、親の window には来ない(実測)。押した瞬間から離すまで、エディタの層を
 * pointer-events: none にして、親が最後まで受ける(armed)
 *
 * [途中で Space を押しても取り残さない]
 * mousemove / mouseup の購読は enabled に関係なく張っておく(enabled は押し始めだけに効く)。
 * 押している途中で Space(パン)を押して enabled が切れても、離したときに必ず畳める。
 * Escape とウィンドウの blur でも畳む(ボタンを離したことが分からないため)
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorContext } from '../EditorContext';
import { useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';
import { findElementsIntersectingMarquee, collapseToTopMost } from './useMarqueeSelection';
import { refreshSelectionOverlay } from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import { MARQUEE_DRAG_THRESHOLD } from '../constants';

export interface CanvasMarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Bounds = { left: number; top: number; right: number; bottom: number };

/** 要素が矩形にすっぽり入っているか(2px の遊び) */
function isEnclosed(el: HTMLElement, b: Bounds): boolean {
  const r = el.getBoundingClientRect();
  return r.left >= b.left - 2 && r.top >= b.top - 2 && r.right <= b.right + 2 && r.bottom <= b.bottom + 2;
}

/**
 * 他の候補をすべて含む器を、矩形にすっぽり入っていない限り外す(外側から順に)。
 * 器ごと囲んだ(すっぽり入った)ならその器が「選んだもの」。縁をまたいだだけなら背景
 */
function dropEnclosingContainers(candidates: HTMLElement[], b: Bounds): HTMLElement[] {
  let list = candidates.slice();
  while (list.length > 1) {
    const outer = list.find((el) => list.every((other) => other === el || el.contains(other)));
    if (!outer || isEnclosed(outer, b)) break;
    list = list.filter((el) => el !== outer);
  }
  return list;
}

export function useCanvasMarquee(containerRef: RefObject<HTMLDivElement | null>, options: { enabled: boolean }) {
  const { enabled } = options;
  const { setSelectedElementIds } = useEditorContext();
  const canvas = useMultiPageCanvasOptional();
  // Context の値はズーム・パン中(markInteracting)に変わる。effect の依存に入れると
  // ドラッグの最中に張り直されて状態が畳まれる(実測)ので ref で持つ
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const [rect, setRect] = useState<CanvasMarqueeRect | null>(null);
  const [armed, setArmed] = useState(false);
  const startRef = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const activeRef = useRef(false);
  const setSelectedRef = useRef(setSelectedElementIds);
  setSelectedRef.current = setSelectedElementIds;

  const editorIframe = useCallback(
    () => containerRef.current?.querySelector<HTMLIFrameElement>('[data-editor-frame] iframe') ?? null,
    [containerRef],
  );

  /** キャンバスの余白(フレームの外)で押したか */
  const isBlankTarget = useCallback(
    (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const container = containerRef.current;
      if (!el || !container) return false;
      if (el === container) return true;
      return el.hasAttribute?.('data-canvas-transform-layer') === true;
    },
    [containerRef],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || e.button !== 0 || !isBlankTarget(e.target)) return;
      e.preventDefault();
      const container = containerRef.current!;
      const box = container.getBoundingClientRect();
      startRef.current = { x: e.clientX - box.left, y: e.clientY - box.top, additive: e.shiftKey };
      activeRef.current = false;
      setArmed(true);
      // Figma と同じく、空白を押した瞬間に選択は消える(Shift のときは残す)
      if (!e.shiftKey) {
        const doc = editorIframe()?.contentDocument;
        if (doc) {
          doc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
          refreshSelectionOverlay(doc);
        }
        setSelectedRef.current([]);
        window.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
      }
    },
    [enabled, isBlankTarget, containerRef, editorIframe],
  );

  const cancel = useCallback(() => {
    startRef.current = null;
    activeRef.current = false;
    setRect(null);
    setArmed(false);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      const container = containerRef.current;
      if (!start || !container) return;
      const box = container.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      if (!activeRef.current) {
        if (Math.abs(x - start.x) < MARQUEE_DRAG_THRESHOLD && Math.abs(y - start.y) < MARQUEE_DRAG_THRESHOLD) return;
        activeRef.current = true;
        canvasRef.current?.markInteracting();
      }
      setRect({ left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
    };
    const finish = (e: MouseEvent) => {
      const start = startRef.current;
      startRef.current = null;
      const wasActive = activeRef.current;
      activeRef.current = false;
      setRect(null);
      setArmed(false);
      const container = containerRef.current;
      if (!start || !wasActive || !container) return;
      const box = container.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const screen: Bounds = { left: Math.min(start.x, x), top: Math.min(start.y, y), right: Math.max(start.x, x), bottom: Math.max(start.y, y) };
      const iframe = editorIframe();
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) return;
      // 画面の矩形 → iframe の座標(外側の倍率は実測)
      const r = iframe.getBoundingClientRect();
      const scale = r.width / (iframe.clientWidth || r.width) || 1;
      const toX = (sx: number) => (sx + box.left - r.left) / scale;
      const toY = (sy: number) => (sy + box.top - r.top) / scale;
      const bounds: Bounds = { left: toX(screen.left), top: toY(screen.top), right: toX(screen.right), bottom: toY(screen.bottom) };
      const existing = start.additive ? Array.from(doc.querySelectorAll<HTMLElement>('[data-element-id].selected')) : [];
      const hit = dropEnclosingContainers(findElementsIntersectingMarquee(doc, bounds), bounds);
      const merged = collapseToTopMost(Array.from(new Set<HTMLElement>([...existing, ...hit])));
      doc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
      merged.forEach((el) => el.classList.add('selected'));
      refreshSelectionOverlay(doc);
      const ids = merged.map((el) => el.getAttribute('data-element-id') || '').filter(Boolean);
      setSelectedRef.current(ids);
      if (merged.length > 0) {
        const info = extractElementInfo(merged[0], doc);
        if (info) window.postMessage({ type: 'ELEMENT_SELECTED', element: info }, '*');
      } else {
        window.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && startRef.current) cancel();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', finish);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKeyDown);
      cancel();
    };
  }, [containerRef, editorIframe, cancel]);

  return { marqueeRect: rect, marqueeArmed: armed, onMouseDown };
}
