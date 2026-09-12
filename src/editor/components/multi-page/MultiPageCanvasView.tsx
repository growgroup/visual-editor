'use client';

/**
 * MultiPageCanvasView
 *
 * Figma 風のマルチフレームキャンバス。全ページをフレームとして並べ、
 * 1 つのフレームだけが生きているエディタ(EditorCanvas)、残りは見るだけの紙面。
 *
 * 層の構成(下から):
 *   1. 転写層(translate + scale)… フレームの白地 + 見るだけの紙面(PageFramePreview)
 *   2. 転写層の中、編集中のフレームの位置に EditorCanvas(1 つだけ。ページを移っても作り直さない)
 *   3. 画面座標のオーバーレイ … フレーム名・選択リング(倍率に関係なく同じ太さ・同じ文字サイズ)
 *   4. 定規
 *
 * EditorCanvas を pages.map の中に置くとページを移るたびに React が作り直して
 * iframe が読み直される。map の外に 1 つだけ置き、位置だけ動かす
 */

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMultiPageCanvas, RULER_SIZE } from '../../contexts/MultiPageCanvasContext';
import { useEditorContext } from '../../EditorContext';
import { useInfiniteCanvas } from '../../hooks/useInfiniteCanvas';
import { editorZoomApiRef } from '../../hooks/useCanvasControls';
import { EditorAppearanceContext } from '../../contexts/EditorAppearanceContext';
import { EditorCanvas } from '../EditorCanvas';
import { PageFramePreview } from './PageFramePreview';
import { CanvasRulers } from './CanvasRulers';
import { cn } from '../../../lib/utils';

/** フレーム名の高さ(px、画面上)。フレームの上端との間隔 */
const LABEL_HEIGHT = 20;

export const MultiPageCanvasView = memo(function MultiPageCanvasView() {
  const canvas = useMultiPageCanvas();
  const {
    viewState,
    pages,
    bounds,
    registerContainer,
    activatePage,
    zoomToFit,
    zoomToPage,
    zoomToActual,
    rulersVisible,
    isInteracting,
    initialViewRestored,
  } = canvas;
  const { setZoom, setFitZoom, activeTool } = useEditorContext();
  const theme = useContext(EditorAppearanceContext) ?? 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const { canvasOffset, canvasZoom, activePageId } = viewState;
  const active = useMemo(() => pages.find((p) => p.id === activePageId) ?? null, [pages, activePageId]);

  // 無限キャンバスのズーム/パン操作(容器と、iframe から転送される操作の両方)
  const { isSpaceHeld, isPanning } = useInfiniteCanvas(containerRef);

  useEffect(() => {
    registerContainer(containerRef.current);
    return () => registerContainer(null);
  }, [registerContainer]);

  // エディタの内側の倍率は 100% 固定(倍率は外側の transform が持つ)
  useEffect(() => {
    setZoom(100);
    setFitZoom(100);
  }, [setZoom, setFitZoom]);

  // Cmd+0 / Cmd+1 / Cmd+2 とヘッダーの「全体表示」「100%」をキャンバスに向ける
  useEffect(() => {
    editorZoomApiRef.current = {
      fit: () => zoomToFit({ animate: true }),
      actual: () => zoomToActual(),
      selection: () => {
        if (activePageId) zoomToPage(activePageId, { animate: true });
        else zoomToFit({ animate: true });
      },
    };
    return () => {
      editorZoomApiRef.current = null;
    };
  }, [zoomToFit, zoomToActual, zoomToPage, activePageId]);

  // 初回の表示: 前回の場所が保存されていて内容と重なるならそこへ。無ければ編集中のページを大きく
  const initialViewDoneRef = useRef(false);
  useEffect(() => {
    if (initialViewDoneRef.current || pages.length === 0) return;
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return;
    initialViewDoneRef.current = true;
    if (initialViewRestored) {
      const { canvasOffset: o, canvasZoom: z } = viewState;
      const left = o.x + bounds.minX * z;
      const top = o.y + bounds.minY * z;
      const right = o.x + bounds.maxX * z;
      const bottom = o.y + bounds.maxY * z;
      const intersects = right > 0 && left < el.clientWidth && bottom > 0 && top < el.clientHeight;
      if (intersects) return;
    }
    if (activePageId) zoomToPage(activePageId);
    else zoomToFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, activePageId]);

  const [hoverId, setHoverId] = useState<string | null>(null);

  // Space・中ボタン・手のひらツールの間は、iframe に触らせず容器がパンを受ける
  const passThrough = isSpaceHeld || isPanning || activeTool === 'move';

  const handleFrameMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button !== 0 || passThrough) return;
      if (id === activePageId) return;
      e.preventDefault();
      void activatePage(id);
    },
    [activatePage, activePageId, passThrough],
  );

  const cursor = isPanning ? 'grabbing' : isSpaceHeld || activeTool === 'move' ? 'grab' : undefined;

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      data-canvas-zoom={Math.round(canvasZoom * 100)}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'var(--ed-canvas, var(--ed-bg))', cursor, touchAction: 'none', overscrollBehavior: 'none' }}
    >
      {/* 転写層 */}
      <div
        data-canvas-transform-layer
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasZoom})`,
          transformOrigin: '0 0',
          willChange: isInteracting ? 'transform' : undefined,
        }}
      >
        {pages.map((page) => (
          <div
            key={page.id}
            data-page-frame={page.id}
            data-page-active={page.id === activePageId ? 'true' : undefined}
            className="absolute"
            style={{
              left: page.position.x,
              top: page.position.y,
              width: page.size.width,
              height: page.size.height,
              background: '#fff',
              boxShadow: `0 0 0 ${1 / canvasZoom}px var(--ed-frame-edge, rgba(0,0,0,0.08))`,
              cursor: page.id === activePageId || passThrough ? undefined : 'pointer',
            }}
            onMouseDown={(e) => handleFrameMouseDown(e, page.id)}
            onMouseEnter={() => setHoverId(page.id)}
            onMouseLeave={() => setHoverId((v) => (v === page.id ? null : v))}
          >
            <PageFramePreview page={page} rootRef={containerRef} />
          </div>
        ))}

        {/* 生きているエディタ(1 つだけ)。編集中のフレームの上に重ねる */}
        {active && (
          <div
            data-editor-frame={active.id}
            className="absolute"
            style={{
              left: active.position.x,
              top: active.position.y,
              width: active.size.width,
              height: active.size.height,
              pointerEvents: passThrough ? 'none' : 'auto',
            }}
          >
            <EditorCanvas />
          </div>
        )}
      </div>

      {/* 画面座標のオーバーレイ: フレーム名・リング */}
      <div className="pointer-events-none absolute inset-0 z-10" data-canvas-overlay>
        {pages.map((page) => {
          const sx = canvasOffset.x + page.position.x * canvasZoom;
          const sy = canvasOffset.y + page.position.y * canvasZoom;
          const sw = page.size.width * canvasZoom;
          const sh = page.size.height * canvasZoom;
          const isActive = page.id === activePageId;
          const isHover = hoverId === page.id && !isActive && !passThrough;
          // 縮小してフレームが細くなったら名前は幅に収める(重ならない)。極端に小さければ出さない
          const showLabel = sw >= 28;
          return (
            <div key={page.id} className="absolute left-0 top-0" style={{ transform: `translate(${sx}px, ${sy}px)` }}>
              {/* フレーム名(Figma: フレームの左上、倍率に関係なく同じ大きさ) */}
              {showLabel && (
              <button
                type="button"
                data-frame-label={page.id}
                className={cn('ed-frame-label', isActive && 'ed-frame-label-active')}
                style={{ top: -LABEL_HEIGHT, maxWidth: Math.max(28, sw) }}
                title={`${page.index + 1}. ${page.title || page.id}${isActive ? '(編集中)' : ''}。ダブルクリックでこのページを画面に合わせる`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (isActive) zoomToPage(page.id, { animate: true });
                  else void activatePage(page.id, { reveal: true });
                }}
                onDoubleClick={() => zoomToPage(page.id, { animate: true })}
              >
                <span className="ed-frame-label-index">{page.index + 1}</span>
                <span className="ed-frame-label-title">{page.title || page.id}</span>
                {page.isDirty && <span className="ed-frame-label-dirty" aria-label="未保存の変更" />}
                {page.loading && <span className="ed-frame-label-loading" aria-label="読み込み中" />}
              </button>
              )}
              {/* リング(選択中 = 実線、ホバー = 淡い実線) */}
              {(isActive || isHover) && (
                <div
                  className={cn('ed-frame-ring', isActive ? 'ed-frame-ring-active' : 'ed-frame-ring-hover')}
                  style={{ width: sw, height: sh }}
                />
              )}
            </div>
          );
        })}
      </div>

      {rulersVisible && <CanvasRulers theme={theme} />}

      {pages.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: rulersVisible ? RULER_SIZE : 0 }}>
          <div className="ed-empty">
            <strong>ページがありません</strong>
            <span>contentList にページを渡すと、ここに並びます。</span>
          </div>
        </div>
      )}
    </div>
  );
});
