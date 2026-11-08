'use client';

/**
 * 定規から引くガイド(Figma の「定規からドラッグしてガイドを作る」)。
 *
 * - 上の定規から下へドラッグ → 横のガイド、左の定規から右へドラッグ → 縦のガイド
 * - ガイドはドラッグで動かせる。定規の上へ戻して離すと消える
 * - クリックで選ぶ(青くなる)。選んだまま Delete / Backspace で消える。Esc か外をクリックで選択を外す
 * - 位置は編集中のページの紙面の座標(px)で持ち、要素の移動・リサイズの吸着の相手になる
 * - 保存しない(ページごとにメモリで持つ。読み込み直すと消える)
 *
 * CanvasRulers の中(定規と同じ重ね合わせの層)に置く。座標の換算は定規と同じ:
 * 画面 = canvasOffset + (ページの位置 + 紙面の px) × canvasZoom
 */

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RULER_SIZE, useCanvasViewState, useMultiPageCanvas } from '../../contexts/MultiPageCanvasContext';
import {
  getPageGuides,
  setActiveGuidePage,
  setPageGuides,
  subscribeGuides,
  type PageGuides,
} from '../../utils/canvas-guides';

/** Figma のガイドに近い赤 */
const GUIDE_COLOR = '#f24822';
/** 選んでいるガイドの色 */
const GUIDE_SELECTED_COLOR = '#0d99ff';
/** これより動かなければクリック(選ぶだけ)とみなす(画面 px) */
const CLICK_SLOP = 2;
/** ガイドをつかめる幅(画面 px) */
const HIT = 7;

type Axis = 'x' | 'y';

interface Drag {
  axis: Axis;
  /** 動かしている既存のガイドの番号(新しく引いているときは null) */
  index: number | null;
  /** いまの位置(紙面の px) */
  value: number;
  /** ポインタが定規の上にある(離すと消える) */
  overRuler: boolean;
}

export const CanvasGuides = memo(function CanvasGuides() {
  const { pages } = useMultiPageCanvas();
  const { canvasOffset, canvasZoom, activePageId } = useCanvasViewState();
  const active = pages.find((p) => p.id === activePageId) ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<{ axis: Axis; index: number } | null>(null);
  // ドラッグ中に window へ張ったリスナーを外す関数。アンマウント・ページ切り替えで残さない
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const guides = useSyncExternalStore(
    subscribeGuides,
    () => getPageGuides(activePageId),
    () => getPageGuides(null),
  );

  // 吸着が見るページ。定規(= この部品)が消えたら外す
  useEffect(() => {
    setActiveGuidePage(activePageId);
    setSelected(null);
    // ページが替わったら引いている途中のドラッグも捨てる(前のページへ書き込まない)
    detachRef.current?.();
    setDrag(null);
    return () => setActiveGuidePage(null);
  }, [activePageId]);

  if (!active) return null;

  const originX = canvasOffset.x + active.position.x * canvasZoom;
  const originY = canvasOffset.y + active.position.y * canvasZoom;
  const toScreen = (axis: Axis, v: number) => (axis === 'x' ? originX : originY) + v * canvasZoom;

  /** ドラッグを始める。終わり(離したとき)にガイドを足す・動かす・消す */
  const begin = (e: React.PointerEvent, axis: Axis, index: number | null) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const read = (ev: PointerEvent | React.PointerEvent): Drag => {
      const sx = ev.clientX - box.left;
      const sy = ev.clientY - box.top;
      const screen = axis === 'x' ? sx : sy;
      const value = Math.round((screen - (axis === 'x' ? originX : originY)) / canvasZoom);
      // 縦のガイドは左の定規、横のガイドは上の定規へ戻すと消える
      const overRuler = axis === 'x' ? sx < RULER_SIZE : sy < RULER_SIZE;
      return { axis, index, value, overRuler };
    };
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let current = read(e);
    // 既存のガイドは、動かし始めるまでは線を出したまま(クリックで選ぶだけのときにちらつかない)
    if (index === null) setDrag(current);
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) <= CLICK_SLOP && Math.abs(ev.clientY - startY) <= CLICK_SLOP) return;
      moved = true;
      current = read(ev);
      setDrag(current);
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (detachRef.current === detach) detachRef.current = null;
    };
    const onUp = () => {
      detach();
      setDrag(null);
      // 既存のガイドをクリックしただけ → 選ぶ(Delete で消せるように、キー入力をこの線に向ける)
      if (index !== null && !moved) {
        setSelected({ axis, index });
        return;
      }
      const now = getPageGuides(active.id);
      const list = [...(axis === 'x' ? now.xs : now.ys)];
      let nextIndex: number | null = null;
      if (index !== null && current.overRuler) list.splice(index, 1);
      else if (index !== null) {
        list[index] = current.value;
        nextIndex = index;
      } else if (!current.overRuler) {
        list.push(current.value);
        nextIndex = list.length - 1;
      }
      const next: PageGuides = axis === 'x' ? { xs: list, ys: now.ys } : { xs: now.xs, ys: list };
      setPageGuides(active.id, next);
      setSelected(nextIndex === null ? null : { axis, index: nextIndex });
    };
    detachRef.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    detachRef.current = detach;
  };

  /** 選んでいるガイドを消す(Delete / Backspace) */
  const removeSelected = () => {
    if (!selected) return;
    const now = getPageGuides(active.id);
    const list = [...(selected.axis === 'x' ? now.xs : now.ys)];
    list.splice(selected.index, 1);
    setPageGuides(active.id, selected.axis === 'x' ? { xs: list, ys: now.ys } : { xs: now.xs, ys: list });
    setSelected(null);
  };

  const pageW = active.size.width * canvasZoom;
  const pageH = active.size.height * canvasZoom;

  const renderLine = (axis: Axis, v: number, key: string, index: number | null, ghost: boolean) => {
    const pos = toScreen(axis, v);
    const vertical = axis === 'x';
    // 置いたガイドは編集中のページの範囲に引く(ページごとのガイドなので)。引いている最中は画面いっぱい
    const style: React.CSSProperties = vertical
      ? { left: pos - HIT / 2, width: HIT, top: ghost ? RULER_SIZE : originY, height: ghost ? undefined : pageH, bottom: ghost ? 0 : undefined, cursor: 'ew-resize' }
      : { top: pos - HIT / 2, height: HIT, left: ghost ? RULER_SIZE : originX, width: ghost ? undefined : pageW, right: ghost ? 0 : undefined, cursor: 'ns-resize' };
    const isSelected = !ghost && index !== null && selected?.axis === axis && selected.index === index;
    const color = isSelected ? GUIDE_SELECTED_COLOR : GUIDE_COLOR;
    return (
      <div
        key={key}
        data-canvas-guide={axis}
        data-selected={isSelected || undefined}
        className="absolute"
        style={{ ...style, pointerEvents: ghost ? 'none' : 'auto', outline: 'none' }}
        // 選んだガイドにフォーカスを当て、Delete を紙面(要素の削除)ではなくこの線で受ける
        tabIndex={isSelected ? -1 : undefined}
        ref={isSelected ? (el) => el?.focus({ preventScroll: true }) : undefined}
        onPointerDown={ghost || index === null ? undefined : (e) => begin(e, axis, index)}
        onKeyDown={
          isSelected
            ? (e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  e.stopPropagation();
                  removeSelected();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setSelected(null);
                }
              }
            : undefined
        }
        onBlur={isSelected ? () => setSelected(null) : undefined}
      >
        <div
          className="absolute"
          style={
            vertical
              ? { left: HIT / 2 - 0.5, top: 0, bottom: 0, width: 1, background: color }
              : { top: HIT / 2 - 0.5, left: 0, right: 0, height: 1, background: color }
          }
        />
      </div>
    );
  };

  return (
    <div ref={rootRef} className="absolute inset-0" data-canvas-guides>
      {guides.xs.map((v, i) => (drag && drag.axis === 'x' && drag.index === i ? null : renderLine('x', v, `x${i}`, i, false)))}
      {guides.ys.map((v, i) => (drag && drag.axis === 'y' && drag.index === i ? null : renderLine('y', v, `y${i}`, i, false)))}

      {/* 定規の上の、ガイドを引き出す当たり(上 = 横のガイド、左 = 縦のガイド) */}
      <div
        className="absolute"
        data-ruler-hit="top"
        style={{ left: RULER_SIZE, right: 0, top: 0, height: RULER_SIZE, pointerEvents: 'auto', cursor: 'ns-resize' }}
        onPointerDown={(e) => begin(e, 'y', null)}
      />
      <div
        className="absolute"
        data-ruler-hit="left"
        style={{ top: RULER_SIZE, bottom: 0, left: 0, width: RULER_SIZE, pointerEvents: 'auto', cursor: 'ew-resize' }}
        onPointerDown={(e) => begin(e, 'x', null)}
      />

      {drag && (
        <>
          {/* 引いている間は紙面(iframe)にポインタを取られないよう全面を覆う */}
          <div className="fixed inset-0" style={{ pointerEvents: 'auto', cursor: drag.axis === 'x' ? 'ew-resize' : 'ns-resize', zIndex: 1 }} />
          {!drag.overRuler && renderLine(drag.axis, drag.value, 'ghost', null, true)}
          {!drag.overRuler && (
            <div
              className="absolute rounded px-1 text-[10px] tabular-nums text-white"
              style={{
                background: GUIDE_COLOR,
                left: drag.axis === 'x' ? toScreen('x', drag.value) + 4 : RULER_SIZE + 4,
                top: drag.axis === 'y' ? toScreen('y', drag.value) + 4 : RULER_SIZE + 4,
                pointerEvents: 'none',
              }}
            >
              {drag.value}
            </div>
          )}
        </>
      )}
    </div>
  );
});
