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
 *   3. 飾りの canvas(画面の座標)… フレームの枠線・階層の線
 *   4. オーバーレイ(転写層と同じ translate + scale)… フレーム名・選択リング。
 *      中身は紙面の座標に置いて scale(1/倍率) で打ち消すので、画面上は倍率に関係なく同じ大きさ
 *   5. 定規
 *
 * EditorCanvas を pages.map の中に置くとページを移るたびに React が作り直して
 * iframe が読み直される。map の外に 1 つだけ置き、位置だけ動かす
 *
 * [パン・ズームの軽さ]
 * ホイール 1 段の仕事を「合成だけ」にする。倍率・位置は React を通さず、viewStore を
 * 直接購読して 2 つの層の style へ書く(転写層とオーバーレイの transform、オーバーレイの
 * --ed-zoom / --ed-inv、容器の data-canvas-zoom の 4 つだけ)。フレーム 1 枚ずつの要素は
 * memo で、倍率を props に持たない。
 *
 * 転写層の中には「白い矩形 + 合成済みの iframe」しか置かない。枠線(box-shadow / outline /
 * border のどれでも)や階層の線(SVG)を中に置くと、倍率が変わるたびに転写層まるごとが
 * 塗り直され、1 段 10〜20ms の Paint になる(実測)。枠線と線は画面の座標の canvas
 * (CanvasFrameDecor)へ出した。
 *
 * 名前の幅と出し分けだけは DOM のままなので、段ごとではなく **粗い倍率**
 * (coarseZoom、150ms に 1 回まで。操作の終わりに必ず追いつく)から決める
 */

import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useMultiPageCanvas,
  useCanvasActivePageId,
  RULER_SIZE,
  FRAME_GAP,
  PREVIEW_IMAGE_ZOOM_HYSTERESIS,
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
import { CanvasFrameDecor } from './CanvasFrameDecor';
import { cn } from '../../../lib/utils';
import { ArrowUpRight } from 'lucide-react';
import { CollabPageDots } from '../../collab/CollabPresence';

/** フレーム名の高さ(px、画面上)。フレームの上端との間隔 */
const LABEL_HEIGHT = 20;
/**
 * 粗い倍率を更新する間隔(ms)。これを短くすると縮小中の塗り直しが増える。
 * 操作の終わりには必ず本当の倍率に追いつく(末尾で 1 回)
 */
const COARSE_ZOOM_MS = 150;
/** 紙面を画像に落とすかの判定を、操作が止まってから何 ms 後に見るか(全体表示の 240ms の動きを跨がない) */
const PREVIEW_MODE_SETTLE_MS = 300;
/**
 * この倍率より小さいところにいる間は、紙面の画像(thumbnail)を裏で先に読んでおく。
 * 読めていない画像は縮小の途中で使えない(空白のフレームになるので iframe を見せ続ける)。
 * 1 ページを大きく開いて編集しているときは読まない(利用側に 26 枚の画像を作らせない)
 */
const PREVIEW_IMAGE_PRELOAD_ZOOM = 1.2;

// ------------------------------------------------------------
// フレームの白地 + 見るだけの紙面(転写層の中。紙面の座標)
// ------------------------------------------------------------

interface FrameShellProps {
  page: PageFrameLayout;
  isActive: boolean;
  passThrough: boolean;
  /** 大きく縮小している間は紙面を画像で描く(この層の zoom には依存しない真偽値) */
  imageMode: boolean;
  /** 画像を裏で先に読んでおく(縮小の途中で切り替えられるように) */
  preloadImage: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onHover: (id: string | null) => void;
}

/**
 * 倍率を props に持たない(持たせるとホイール 1 段ごとに 26 枚が React を通る)。
 * 枠線はこの要素には無い ── 画面の座標の canvas(CanvasFrameDecor)が描く
 */
const FrameShell = memo(function FrameShell({ page, isActive, passThrough, imageMode, preloadImage, rootRef, onMouseDown, onHover }: FrameShellProps) {
  return (
    <div
      data-page-frame={page.id}
      data-page-active={isActive ? 'true' : undefined}
      className="ed-frame-shell absolute"
      style={{
        left: page.position.x,
        top: page.position.y,
        width: page.size.width,
        height: page.size.height,
        cursor: isActive || passThrough ? undefined : 'pointer',
      }}
      onMouseDown={(e) => onMouseDown(e, page.id)}
      onMouseEnter={() => onHover(page.id)}
      onMouseLeave={() => onHover(null)}
    >
      <PageFramePreview page={page} rootRef={rootRef} imageMode={imageMode} preloadImage={preloadImage} />
    </div>
  );
});

// ------------------------------------------------------------
// フレーム名・リング(オーバーレイの中)
// ------------------------------------------------------------

interface FrameChromeProps {
  page: PageFrameLayout;
  /** 名前を出すか(粗い倍率から親が判定する。全フレーム共通の条件 + このフレームの幅) */
  showLabel: boolean;
  /** 「別タブで開く」を出すか(名前の右。フレームが細いときは出さない) */
  showLink: boolean;
  /** リングと名前の強調(切替中はクリックしたページへ先に移る) */
  isSelected: boolean;
  isHover: boolean;
  /** 本文を読んでいる・エディタを組み直している */
  isBusy: boolean;
  onActivate: (id: string) => void;
  onZoomTo: (id: string) => void;
}

/**
 * オーバーレイは転写層と同じ transform(translate + scale)なので、ここで scale(1/倍率) を
 * 掛けて打ち消す。こうすると中身は画面上の大きさのまま、位置は紙面の座標で書ける
 * (段ごとに React を通さず、--ed-inv が変わるだけで動く)。
 * リングだけは画面上の寸法が要るので --ed-zoom から CSS で出す(段ごとに変わるのは 1〜2 個)
 */
const FrameChrome = memo(function FrameChrome({ page, showLabel, showLink, isSelected, isHover, isBusy, onActivate, onZoomTo }: FrameChromeProps) {
  const hasRing = isSelected || isHover;
  return (
    <div
      className="absolute left-0 top-0"
      data-frame-chrome={page.id}
      style={{
        transform: `translate(${page.position.x}px, ${page.position.y}px) scale(var(--ed-inv, 1))`,
        transformOrigin: '0 0',
        // 名前だけの小さな層にしておく(倍率が変わっても塗り直さずに動く)。
        // リングが出ているフレームはフレームと同じ大きさになるので層にしない(巨大な合成層を作らない)
        willChange: hasRing ? undefined : 'transform',
        ['--ed-fw' as string]: `${page.size.width}px`,
        ['--ed-fh' as string]: `${page.size.height}px`,
      }}
    >
      {/* フレーム名(Figma: フレームの左上、倍率に関係なく同じ大きさ)+ 別タブで開く(href があるとき) */}
      {showLabel && (
        <div className="ed-frame-label-row" style={{ top: -LABEL_HEIGHT, maxWidth: 'max(28px, calc(var(--ed-fw) * var(--ed-zoom, 1)))' }}>
          <button
            type="button"
            data-frame-label={page.id}
            className={cn('ed-frame-label', isSelected && 'ed-frame-label-active')}
            title={`${page.index + 1}. ${page.title || page.id}${isSelected ? '(編集中)' : ''}。ダブルクリックでこのページを画面に合わせる`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => (isSelected ? onZoomTo(page.id) : onActivate(page.id))}
            onDoubleClick={() => onZoomTo(page.id)}
          >
            <span className="ed-frame-label-index">{page.index + 1}</span>
            <span className="ed-frame-label-title">{page.title || page.id}</span>
            {page.isDirty && <span className="ed-frame-label-dirty" aria-label="未保存の変更" />}
            {/* 共同編集: このページに居る参加者の色の点(io.collab が無ければ何も出ない) */}
            <CollabPageDots contentId={page.id} />
            {isBusy && <span className="ed-frame-label-loading" aria-label="読み込み中" />}
          </button>
          {page.href && showLink && (
            <a
              className="ed-frame-label-link"
              data-frame-link={page.id}
              href={page.href}
              target="_blank"
              rel="noreferrer"
              title="別タブで開く(編集しない表示)"
              aria-label={`${page.title || page.id} を別タブで開く`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowUpRight aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      {/* リング(選択中 = 実線、ホバー = 淡い実線)。画面上の寸法 = 紙面の寸法 × 倍率 */}
      {hasRing && (
        <div
          className={cn('ed-frame-ring', isSelected ? 'ed-frame-ring-active' : 'ed-frame-ring-hover')}
          style={{ width: 'calc(var(--ed-fw) * var(--ed-zoom, 1))', height: 'calc(var(--ed-fh) * var(--ed-zoom, 1))' }}
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
    viewStore,
    registerContainer,
    shiftView,
    activatePage,
    activatingPageId,
    zoomToFit,
    zoomToPage,
    zoomToActual,
    rulersVisible,
    isInteracting,
    applyInitialView,
    getPreviewImageZoomCap,
    previewImageCapVersion,
  } = canvas;
  // 倍率・位置は購読しない(ホイール 1 段ごとにキャンバス全体が React を通ってしまう)。
  // 描画に要る「粗い倍率」だけを下の useLayoutEffect が間引いて渡す
  const activePageId = useCanvasActivePageId();
  const { setZoom, setFitZoom, activeTool, iframeReady } = useEditorContext();
  const theme = useContext(EditorAppearanceContext) ?? 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  // 左のパネルを出し入れする(部品パネルに替わる・幅をドラッグする・利用側のレールが変わるも同じ)と、
  // 容器の左端が動く。位置は容器の左上が基準なので、そのままでは紙面もパネルの幅だけ一緒に動く。
  // 動いた分だけ逆にずらして、紙面を画面上の同じ位置に留める(Figma と同じ。見える範囲が狭くなるだけ)。
  // 入口ごとには手当てせず、容器の位置の変化そのものを見る。左端は幅と一緒にしか動かないので ResizeObserver で拾える。
  // 呼ばれるのはレイアウトの後・描画の前で、viewStore は購読者(転写層の transform)へ同期で書くので、ずれた姿は描かれない
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last: { left: number; top: number } | null = null;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (last) shiftView(last.left - rect.left, last.top - rect.top);
      last = { left: rect.left, top: rect.top };
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [shiftView]);

  // 容器は overflow: hidden で、位置は transform が持つ。ところがフォーカスを移すと(部品パネルを閉じたときに
  // エディタへ戻す iframe.focus() など)、ブラウザは要素を見せようとして容器そのものをスクロールし、
  // 紙面がずれたまま戻らない(縮小した構成ラフで縦に 61px。直す前の版から)。容器のスクロールは常に 0 へ戻す
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const reset = () => {
      if (el.scrollTop) el.scrollTop = 0;
      if (el.scrollLeft) el.scrollLeft = 0;
    };
    el.addEventListener('scroll', reset);
    return () => el.removeEventListener('scroll', reset);
  }, []);

  // ---- 倍率・位置の反映(React を通さない)
  const [coarseZoom, setCoarseZoom] = useState(() => viewStore.get().canvasZoom);
  const coarseZoomRef = useRef(coarseZoom);
  coarseZoomRef.current = coarseZoom;

  useLayoutEffect(() => {
    let lastZoom = NaN;
    let coarseTimer: ReturnType<typeof setTimeout> | null = null;
    let coarseAt = 0;
    const pushCoarse = () => {
      coarseAt = performance.now();
      const z = viewStore.get().canvasZoom;
      if (coarseZoomRef.current === z) return;
      coarseZoomRef.current = z;
      setCoarseZoom(z);
    };
    const write = () => {
      const { canvasOffset: o, canvasZoom: z } = viewStore.get();
      const transform = `translate(${o.x}px, ${o.y}px) scale(${z})`;
      if (layerRef.current) layerRef.current.style.transform = transform;
      const overlay = overlayRef.current;
      if (overlay) overlay.style.transform = transform;
      if (z === lastZoom) return;
      lastZoom = z;
      if (overlay) {
        // 中身の scale(1/倍率) とリングの寸法に使う。この 1 要素だけが段ごとに変わる
        overlay.style.setProperty('--ed-zoom', String(z));
        overlay.style.setProperty('--ed-inv', String(1 / z));
      }
      // 検証スクリプトとヘッダーの表示が読む(四捨五入した %)
      const el = containerRef.current;
      const pct = String(Math.round(z * 100));
      if (el && el.getAttribute('data-canvas-zoom') !== pct) el.setAttribute('data-canvas-zoom', pct);
      // 縮小の途中でも 0.4 を割ったら、画像が読めている紙面は iframe を止めて画像を前に出す
      // (CSS が拾う。属性 1 つの書き換えで 26 枚がいっぺんに切り替わり、React は通らない)。
      // iframe を外してメモリを返すのは操作が止まってから(下の imageMode)。
      // 外す向き(画像 → iframe)もここではやらない ── 止まってから 0.5 以上で判定する
      if (el && z < getPreviewImageZoomCap() * PREVIEW_IMAGE_ZOOM_HYSTERESIS && el.getAttribute('data-canvas-preview-image') !== '1') {
        el.setAttribute('data-canvas-preview-image', '1');
      }
      // 粗い倍率: 150ms に 1 回まで。末尾のタイマーで操作の終わりに必ず追いつく
      if (coarseTimer) clearTimeout(coarseTimer);
      const elapsed = performance.now() - coarseAt;
      if (elapsed >= COARSE_ZOOM_MS) pushCoarse();
      else coarseTimer = setTimeout(() => { coarseTimer = null; pushCoarse(); }, COARSE_ZOOM_MS - elapsed);
    };
    write();
    const unsubscribe = viewStore.subscribe(write);
    return () => {
      unsubscribe();
      if (coarseTimer) clearTimeout(coarseTimer);
    };
  }, [viewStore, getPreviewImageZoomCap]);

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

  // 初回の表示: 容器の大きさとフレームの並びが揃ったところで 1 回(決め方は applyInitialView)
  useEffect(() => {
    if (pages.length === 0) return;
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return;
    applyInitialView();
  }, [pages.length, activePageId, applyInitialView]);

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

  // ---- 紙面を画像に落とすか(大きく縮小している間だけ)
  // 判定は操作が止まってからしか動かさない。縮小の途中で 26 枚の iframe を差し替えると、
  // 軽くするための切替そのものが重いフレームを作る
  const [imageMode, setImageMode] = useState(
    () => viewStore.get().canvasZoom < getPreviewImageZoomCap() * PREVIEW_IMAGE_ZOOM_HYSTERESIS,
  );
  const imageModeRef = useRef(imageMode);
  imageModeRef.current = imageMode;
  // previewImageCapVersion は「画像の解像度が分かって上限が動いた」きっかけ。
  // 止まったまま画像が読み終わった場合でも、ここで判定をやり直す
  useEffect(() => {
    if (isInteracting) return;
    const timer = setTimeout(() => {
      const z = viewStore.get().canvasZoom;
      const cap = getPreviewImageZoomCap();
      // ヒステリシス: 画像 → iframe は上限以上、iframe → 画像は上限 × 0.8 未満(境目で行き来しない)
      const next = imageModeRef.current ? z < cap : z < cap * PREVIEW_IMAGE_ZOOM_HYSTERESIS;
      if (next !== imageModeRef.current) setImageMode(next);
      // iframe に戻す向きに決まったら、縮小の途中で立てた掛け金も外す(iframe がまた見える)
      if (!next) containerRef.current?.removeAttribute('data-canvas-preview-image');
    }, PREVIEW_MODE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isInteracting, coarseZoom, viewStore, getPreviewImageZoomCap, previewImageCapVersion]);
  // 画像を裏で先に読んでおくか(粗い倍率なので、段ごとには変わらない真偽値)
  const preloadImage = coarseZoom < PREVIEW_IMAGE_PRELOAD_ZOOM;

  const cursor = isPanning ? 'grabbing' : isSpaceHeld || activeTool === 'move' ? 'grab' : undefined;
  // 行の隙間(画面上)に名前が収まらない倍率では名前を出さない。出すと下の行の名前が
  // 上の行のフレームに被り、フレームのクリックを奪う(150 枚の全体表示で実測)
  const labelsVisible = FRAME_GAP[canvas.editorMode].y * coarseZoom >= LABEL_HEIGHT + 6;

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      data-interacting={isInteracting ? 'true' : undefined}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'var(--ed-canvas, var(--ed-bg))', cursor, touchAction: 'none', overscrollBehavior: 'none' }}
      onMouseDown={onMarqueeMouseDown}
    >
      {/* 転写層(transform は useLayoutEffect が直接書く。React の style には入れない) */}
      <div
        ref={layerRef}
        data-canvas-transform-layer
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          willChange: isInteracting ? 'transform' : undefined,
        }}
      >
        {pages.map((page) => (
          <FrameShell
            key={page.id}
            page={page}
            isActive={page.id === activePageId}
            passThrough={passThrough}
            imageMode={imageMode}
            preloadImage={preloadImage}
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

      {/* フレームの枠線と階層の線(画面の座標の canvas)。転写層の中に置くと 1 段ごとに
          転写層まるごとが塗り直される ── 詳しくは CanvasFrameDecor の頭の注記 */}
      <CanvasFrameDecor theme={theme} />

      {/* オーバーレイ: フレーム名・リング。転写層と同じ transform を掛け、中身が scale(1/倍率) で戻す */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute left-0 top-0 z-10"
        data-canvas-overlay
        style={{ transformOrigin: '0 0', willChange: isInteracting ? 'transform' : undefined }}
      >
        {pages.map((page) => {
          const isSelected = page.id === selectedId;
          // 縮小してフレームが細くなったら名前は出さない(重ならない)。粗い倍率で判定する
          const screenWidth = page.size.width * coarseZoom;
          return (
            <FrameChrome
              key={page.id}
              page={page}
              showLabel={labelsVisible && screenWidth >= 28}
              showLink={screenWidth >= 96}
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
