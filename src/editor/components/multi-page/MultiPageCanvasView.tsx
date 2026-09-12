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
 *
 * [パン・ズームの軽さ]
 * パンは 2 つの層の transform 文字列を変えるだけにする。フレーム 1 枚ずつの要素
 * (FrameShell / FrameChrome)は memo で、位置は倍率だけに依存させる(画面上の位置 =
 * 層の translate + 紙面の位置 × 倍率)。150 枚あってもパンで描き直る要素は 2 つ。
 * ズームは倍率に依存する要素が描き直る(それでも小さな要素が 300 個ほど)
 */

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMultiPageCanvas,
  useCanvasViewState,
  RULER_SIZE,
  FRAME_GAP,
  type PageFrameLayout,
} from '../../contexts/MultiPageCanvasContext';
import { useEditorContext } from '../../EditorContext';
import { useInfiniteCanvas } from '../../hooks/useInfiniteCanvas';
import { useCanvasMarquee } from '../../hooks/useCanvasMarquee';
import { editorZoomApiRef } from '../../hooks/useCanvasControls';
import { EditorAppearanceContext } from '../../contexts/EditorAppearanceContext';
import { EditorCanvas } from '../EditorCanvas';
import { PageFramePreview } from './PageFramePreview';
import { CanvasRulers } from './CanvasRulers';
import { cn } from '../../../lib/utils';

/** フレーム名の高さ(px、画面上)。フレームの上端との間隔 */
const LABEL_HEIGHT = 20;

// ------------------------------------------------------------
// フレームの白地 + 見るだけの紙面(転写層の中。紙面の座標)
// ------------------------------------------------------------

interface FrameShellProps {
  page: PageFrameLayout;
  zoom: number;
  isActive: boolean;
  passThrough: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onHover: (id: string | null) => void;
}

const FrameShell = memo(function FrameShell({ page, zoom, isActive, passThrough, rootRef, onMouseDown, onHover }: FrameShellProps) {
  return (
    <div
      data-page-frame={page.id}
      data-page-active={isActive ? 'true' : undefined}
      className="absolute"
      style={{
        left: page.position.x,
        top: page.position.y,
        width: page.size.width,
        height: page.size.height,
        background: '#fff',
        boxShadow: `0 0 0 ${1 / zoom}px var(--ed-frame-edge, rgba(0,0,0,0.08))`,
        cursor: isActive || passThrough ? undefined : 'pointer',
      }}
      onMouseDown={(e) => onMouseDown(e, page.id)}
      onMouseEnter={() => onHover(page.id)}
      onMouseLeave={() => onHover(null)}
    >
      <PageFramePreview page={page} rootRef={rootRef} />
    </div>
  );
});

// ------------------------------------------------------------
// フレーム名・リング(オーバーレイの中。画面の座標 = 紙面の位置 × 倍率)
// ------------------------------------------------------------

interface FrameChromeProps {
  page: PageFrameLayout;
  zoom: number;
  /** 名前を出せる倍率か(行の隙間に名前が収まる)。全フレーム共通なので親で判定する */
  labelsVisible: boolean;
  /** リングと名前の強調(切替中はクリックしたページへ先に移る) */
  isSelected: boolean;
  isHover: boolean;
  /** 本文を読んでいる・エディタを組み直している */
  isBusy: boolean;
  onActivate: (id: string) => void;
  onZoomTo: (id: string) => void;
}

const FrameChrome = memo(function FrameChrome({ page, zoom, labelsVisible, isSelected, isHover, isBusy, onActivate, onZoomTo }: FrameChromeProps) {
  const sx = page.position.x * zoom;
  const sy = page.position.y * zoom;
  const sw = page.size.width * zoom;
  const sh = page.size.height * zoom;
  // 縮小してフレームが細くなったら名前は幅に収める(重ならない)。極端に小さければ出さない
  const showLabel = labelsVisible && sw >= 28;
  return (
    <div className="absolute left-0 top-0" data-frame-chrome={page.id} style={{ transform: `translate(${sx}px, ${sy}px)` }}>
      {/* フレーム名(Figma: フレームの左上、倍率に関係なく同じ大きさ) */}
      {showLabel && (
        <button
          type="button"
          data-frame-label={page.id}
          className={cn('ed-frame-label', isSelected && 'ed-frame-label-active')}
          style={{ top: -LABEL_HEIGHT, maxWidth: Math.max(28, sw) }}
          title={`${page.index + 1}. ${page.title || page.id}${isSelected ? '(編集中)' : ''}。ダブルクリックでこのページを画面に合わせる`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (isSelected ? onZoomTo(page.id) : onActivate(page.id))}
          onDoubleClick={() => onZoomTo(page.id)}
        >
          <span className="ed-frame-label-index">{page.index + 1}</span>
          <span className="ed-frame-label-title">{page.title || page.id}</span>
          {page.isDirty && <span className="ed-frame-label-dirty" aria-label="未保存の変更" />}
          {isBusy && <span className="ed-frame-label-loading" aria-label="読み込み中" />}
        </button>
      )}
      {/* リング(選択中 = 実線、ホバー = 淡い実線) */}
      {(isSelected || isHover) && (
        <div
          className={cn('ed-frame-ring', isSelected ? 'ed-frame-ring-active' : 'ed-frame-ring-hover')}
          style={{ width: sw, height: sh }}
        />
      )}
    </div>
  );
});

// ------------------------------------------------------------
// キャンバス
// ------------------------------------------------------------

export const MultiPageCanvasView = memo(function MultiPageCanvasView() {
  const canvas = useMultiPageCanvas();
  const {
    pages,
    bounds,
    registerContainer,
    activatePage,
    activatingPageId,
    zoomToFit,
    zoomToPage,
    zoomToActual,
    rulersVisible,
    isInteracting,
    initialViewRestored,
  } = canvas;
  const { canvasOffset, canvasZoom, activePageId } = useCanvasViewState();
  const { setZoom, setFitZoom, activeTool, iframeReady } = useEditorContext();
  const theme = useContext(EditorAppearanceContext) ?? 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const active = useMemo(() => pages.find((p) => p.id === activePageId) ?? null, [pages, activePageId]);
  // リング・名前の強調は「移ろうとしているページ」を優先する(押した瞬間に手応えを返す)
  const selectedId = activatingPageId ?? activePageId;

  // 無限キャンバスのズーム/パン操作(容器と、iframe から転送される操作の両方)
  const { isSpaceHeld, isPanning } = useInfiniteCanvas(containerRef);
  // キャンバスの余白から始めるマーキー選択(選択ツールのときだけ。Space・手のひら中は動かさない)
  const { marqueeRect, marqueeArmed, onMouseDown: onMarqueeMouseDown } = useCanvasMarquee(containerRef, {
    enabled: activeTool === 'select' && !isSpaceHeld && !isPanning,
  });

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
      const { canvasOffset: o, canvasZoom: z } = canvas.viewStore.get();
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
  const handleHover = useCallback((id: string | null) => {
    setHoverId((prev) => (id === null ? null : id === prev ? prev : id));
  }, []);

  // Space・中ボタン・手のひらツールの間は、iframe に触らせず容器がパンを受ける
  const passThrough = isSpaceHeld || isPanning || activeTool === 'move';
  const passThroughRef = useRef(passThrough);
  passThroughRef.current = passThrough;
  const activePageIdRef = useRef(activePageId);
  activePageIdRef.current = activePageId;

  const handleFrameMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button !== 0 || passThroughRef.current) return;
      if (id === activePageIdRef.current) return;
      e.preventDefault();
      void activatePage(id);
    },
    [activatePage],
  );
  const handleActivate = useCallback((id: string) => { void activatePage(id, { reveal: true }); }, [activatePage]);
  const handleZoomTo = useCallback((id: string) => zoomToPage(id, { animate: true }), [zoomToPage]);

  const cursor = isPanning ? 'grabbing' : isSpaceHeld || activeTool === 'move' ? 'grab' : undefined;
  // 行の隙間(画面上)に名前が収まらない倍率では名前を出さない。出すと下の行の名前が
  // 上の行のフレームに被り、フレームのクリックを奪う(150 枚の全体表示で実測)
  const labelsVisible = FRAME_GAP[canvas.editorMode].y * canvasZoom >= LABEL_HEIGHT + 6;
  // data-interacting はズーム・パン中の印(CSS・検証用のフック。中では willChange に使う)
  const layerTransform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasZoom})`;
  const overlayTransform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`;

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      data-canvas-zoom={Math.round(canvasZoom * 100)}
      data-interacting={isInteracting ? 'true' : undefined}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'var(--ed-canvas, var(--ed-bg))', cursor, touchAction: 'none', overscrollBehavior: 'none' }}
      onMouseDown={onMarqueeMouseDown}
    >
      {/* 転写層 */}
      <div
        data-canvas-transform-layer
        className="absolute left-0 top-0"
        style={{
          transform: layerTransform,
          transformOrigin: '0 0',
          willChange: isInteracting ? 'transform' : undefined,
        }}
      >
        {pages.map((page) => (
          <FrameShell
            key={page.id}
            page={page}
            zoom={canvasZoom}
            isActive={page.id === activePageId}
            passThrough={passThrough}
            rootRef={containerRef}
            onMouseDown={handleFrameMouseDown}
            onHover={handleHover}
          />
        ))}

        {/* 生きているエディタ(1 つだけ)。編集中のフレームの上に重ねる。
            新しい本文を読み込んでいる間は隠す(前のページの姿が新しい枠に見えない。
            下の見るだけの紙面が透けて、読み込みが済んだところで差し替わる) */}
        {active && (
          <div
            data-editor-frame={active.id}
            data-editor-ready={iframeReady ? 'true' : 'false'}
            className="absolute"
            style={{
              left: active.position.x,
              top: active.position.y,
              width: active.size.width,
              height: active.size.height,
              // 余白からのマーキー中は親が最後まで受ける(iframe に入ると mouseup が親に来ない)
              pointerEvents: passThrough || marqueeArmed ? 'none' : 'auto',
              visibility: iframeReady ? 'visible' : 'hidden',
            }}
          >
            <EditorCanvas />
          </div>
        )}
      </div>

      {/* 画面座標のオーバーレイ: フレーム名・リング(層ごと平行移動。倍率だけ各要素に渡す) */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-10"
        data-canvas-overlay
        style={{ transform: overlayTransform, willChange: isInteracting ? 'transform' : undefined }}
      >
        {pages.map((page) => {
          const isSelected = page.id === selectedId;
          return (
            <FrameChrome
              key={page.id}
              page={page}
              zoom={canvasZoom}
              labelsVisible={labelsVisible}
              isSelected={isSelected}
              isHover={hoverId === page.id && !isSelected && !passThrough}
              isBusy={page.loading || page.id === activatingPageId || (page.id === activePageId && !iframeReady)}
              onActivate={handleActivate}
              onZoomTo={handleZoomTo}
            />
          );
        })}
      </div>

      {/* 余白から引いたマーキー(画面座標) */}
      {marqueeRect && (
        <div
          className="ed-canvas-marquee"
          data-canvas-marquee
          style={{ left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height }}
        />
      )}

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
