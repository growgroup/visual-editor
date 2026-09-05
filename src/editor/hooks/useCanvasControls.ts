'use client';

/**
 * Figmaライクなキャンバス操作（ズーム、パン、ビューポート）を管理するHook
 *
 * 構造:
 * - iframe が編集領域の全面を覆う
 * - iframe 内は #canvas-container（overflow:auto = スクロール容器）
 *   > #canvas-scroll-area（flexで中央寄せ・サイズはJSで指定）
 *   > #artboard-wrapper（transform: scale() = ズーム）
 *   > #artboard（1920x1080 の紙面）
 * - ズームは #artboard-wrapper の scale、パンは #canvas-container の scroll で表現する
 *
 * 操作方法:
 * - Ctrl/Cmd + ホイール: カーソル位置を固定点にしたズーム
 * - ホイール: 縦スクロール / Shift + ホイール: 横スクロール（useTouchGestures 側）
 * - ピンチイン/アウト: 指の中心を固定点にしたズーム
 * - スペース + ドラッグ / ハンドツール(H) + ドラッグ: パン
 * - 拡大縮小ツール(K) + クリック: カーソル位置を中心に拡大
 *   / Alt+クリック: 縮小 / ドラッグ: 囲った範囲へズーム
 * - Cmd+0 / Cmd+1 / Cmd+2: 全体表示 / 100% / 選択範囲
 *   （キー判定は useEditorShortcuts が唯一の経路。ここは実処理を
 *     zoomToFit / zoomToActual / zoomToSelection として公開する側）
 * - キャンバスの余白（紙面の外）をダブルクリック: 全体表示
 *
 * [移植時の修正] 以前の実装が実機で動かなかった理由と、その直し方
 *  1. パンの mousedown を *親ウィンドウの containerRef* に張っていた。
 *     編集領域は iframe が覆っているので、その要素にマウスイベントは一切届かず
 *     スペース+ドラッグが完全に無反応だった（実測: scroll の変化 0px）。
 *     → iframe document 側にキャプチャフェーズで張り直した。
 *  2. ズーム倍率の計算が `zoom * (1 + -deltaY*0.002*10)` で、ホイール1回
 *     (deltaY=-300) が 51% → 357% に飛んでいた。→ 指数関数 + 1イベントの
 *     変化量に上限を設けた。
 *  3. ズーム中心が「選択要素があればその中心」になっていてカーソル位置が無視されていた。
 *     さらにスクロール補正の式が #canvas-scroll-area の余白と flex 中央寄せを
 *     考慮しておらず、実測で 600px 以上ずれていた。
 *     → #artboard の実測矩形から差分を求める方式に置き換えた（下記 settleAnchor）。
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorContext } from '../EditorContext';
import { useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';
import { applyCanvasZoomDom, applyOverlayScale, syncSelectionOverlayRects } from '../utils/dom-utils';
import { SLIDE_WIDTH, SLIDE_HEIGHT, WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT } from '../constants';

// ズーム設定
export const MIN_ZOOM = 10;    // 10%
export const MAX_ZOOM = 400;   // 400%

/**
 * ホイールズームの感度。newZoom = zoom * exp(-deltaY * K)
 * deltaY=100（マウスホイール1ノッチ相当）で約 1.16 倍。
 * 線形式だと deltaY の大きいデバイスで倍率が飛ぶので指数にしている。
 */
// ノッチ式マウスホイール用。1ノッチ(|deltaY|≈100)で約16%動く
const WHEEL_ZOOM_K = 0.0015;
/**
 * トラックパッドのピンチ用。
 * macOSのピンチは ctrlKey=true の wheel として、1イベント±数px の連続値で届く。
 * ノッチ用の係数で受けると1イベント1%未満しか動かず「感度が悪すぎる」になる
 * (ノッチ式と同じ距離を動かすのに20倍近いイベント数が要る)。
 * 1イベントの|deltaY|が小さいものを連続デバイスとみなして強い係数を使う。
 */
const PINCH_ZOOM_K = 0.008;
/** これ未満の|deltaY|は連続デバイス(ピンチ/精密トラックパッド)とみなす */
const CONTINUOUS_DELTA_MAX = 50;
/** 1イベントで変化してよい倍率の上限（暴れ防止） */
const MAX_STEP_FACTOR = 2;

/** 拡大縮小ツール(K)のクリック1回あたりの倍率 */
const ZOOM_TOOL_STEP = 1.25;

/**
 * ズーム操作の実処理レジストリ。
 *
 * [なぜモジュールレベルの ref か]
 * キーボードのディスパッチャ（useEditorShortcuts）に渡すコールバックは
 * FrontendVisualEditor が組み立てているが、ズームの実処理を持つこのフックは
 * EditorCanvas 側で呼ばれているため、戻り値を直接渡せない。
 * 既存の editorCancelDragRef（useKeyboardShortcuts.ts）と同じ方式で橋渡しし、
 * 「Cmd+0 で起きること」と「ヘッダーの全体表示で起きること」を1つの実装に揃える。
 */
export const editorZoomApiRef: {
  current: {
    fit: () => void;
    actual: () => void;
    selection: () => void;
  } | null;
} = { current: null };

/**
 * ズーム時に「画面上のこの位置に留めたい紙面上の点」
 * - vx, vy: iframe ビューポート座標
 * - lx, ly: 紙面（#artboard）の論理座標
 */
interface ZoomAnchor {
  vx: number;
  vy: number;
  lx: number;
  ly: number;
}

/**
 * テキスト入力中かどうか（realm をまたいでも壊れない判定）
 *
 * [移植時の修正] 元は `e.target instanceof HTMLInputElement` だった。
 * iframe 内の要素は別 realm なので親フレームの HTMLInputElement とは
 * instanceof が一致せず、常に false になる。このハンドラは iframe document にも
 * 張るため、そのままだと「テキスト編集中にスペースが打てない」不具合になる。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
  if (!el || typeof el !== 'object' || typeof el.tagName !== 'string') return false;

  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable === true) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
    return true;
  }
  if (typeof el.closest === 'function') {
    return !!el.closest('[contenteditable="true"], input, textarea, select');
  }
  return false;
}

/**
 * スペースキーで「押す」操作が割り当たっている要素かどうか。
 *
 * ヘッダーのボタンにフォーカスが残った状態でスペースを奪うと、
 * キーボードだけで操作している人がそのボタンを押せなくなる。
 * realm をまたいでも壊れないプロパティだけで判定する。
 */
function isSpaceActivatedControl(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
  if (!el || typeof el !== 'object' || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return true;
  if (typeof el.closest === 'function') {
    return !!el.closest('button, summary, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"]');
  }
  return false;
}

export function useCanvasControls() {
  const {
    containerRef,
    iframeRef,
    zoom,
    setZoom,
    fitZoom,
    setFitZoom,
    activeTool,
    getIframeDoc,
    editorMode,
  } = useEditorContext();

  // マルチページモード判定（マルチページモードではuseInfiniteCanvasが操作を管理）
  const multiPageCanvas = useMultiPageCanvasOptional();
  const isInMultiPageMode = !!multiPageCanvas?.isEnabled;

  // パン状態
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Webページモード用のコンテンツ高さ追跡
  const [contentHeight, setContentHeight] = useState(WEBPAGE_MIN_HEIGHT);

  // 初期ズーム設定済みフラグ
  const initialZoomSetRef = useRef(false);

  // パンモードが有効かどうか（スペースキーまたはハンドツール）
  const isPanModeActive = isSpacePressed || activeTool === 'move';

  // 拡大縮小ツール(K)が有効かどうか。
  // パン中はパンを優先するので、ここでは activeTool だけを見る。
  const isZoomToolActive = activeTool === 'scale';

  // iframe 内のキャンバス要素を取得するヘルパー
  const getCanvasContainer = useCallback((): HTMLElement | null => {
    return getIframeDoc()?.getElementById('canvas-container') ?? null;
  }, [getIframeDoc]);

  const getArtboard = useCallback((): HTMLElement | null => {
    return getIframeDoc()?.getElementById('artboard') ?? null;
  }, [getIframeDoc]);

  // キャンバスの寸法を計算（エディタモードによって異なる）
  const canvasWidth = editorMode === 'webpage' ? WEBPAGE_WIDTH : SLIDE_WIDTH;
  const canvasHeight = editorMode === 'webpage' ? contentHeight : SLIDE_HEIGHT;

  // ========================================================================
  // 座標変換：iframe ビューポート座標 ⇄ 紙面の論理座標
  // ========================================================================

  /**
   * 現在 DOM に載っている倍率で、iframe ビューポート座標を紙面の論理座標に変換する。
   *
   * 倍率は state の zoom ではなく #artboard の実測値から取る。
   * state と DOM の反映タイミングがずれても座標がずれないようにするため。
   */
  const clientToArtboard = useCallback(
    (vx: number, vy: number): ZoomAnchor | null => {
      const artboard = getArtboard();
      if (!artboard) return null;
      const rect = artboard.getBoundingClientRect();
      const scale = rect.width / (artboard.offsetWidth || 1) || 1;
      return { vx, vy, lx: (vx - rect.left) / scale, ly: (vy - rect.top) / scale };
    },
    [getArtboard]
  );

  /**
   * アンカー点が元の画面位置に戻るようにスクロールを補正する。
   *
   * #artboard-wrapper は transform-origin: center center、
   * #canvas-scroll-area は flex 中央寄せ + 200px の余白付き、と条件が入り組んでいるので、
   * 数式でスクロール量を組み立てず「実際に描画されている #artboard の矩形」から
   * ずれ量を直接測って引く。何度呼んでも同じ結果に収束する（べき等）。
   *
   * @param keepAutoCenter true のとき、紙面がその軸で容器に収まっているなら補正しない。
   *   収まっている軸は EditorCanvas 側が「中央寄せ」に固定するのが正しい挙動なので
   *   （全体表示＝Cmd+0 が中央に来る）、そこを奪い返さないための逃げ道。
   *   カーソル位置を固定したいホイールズームでは false（常にアンカー優先）。
   */
  const settleAnchor = useCallback(
    (anchor: ZoomAnchor, keepAutoCenter: boolean) => {
      const artboard = getArtboard();
      const container = getCanvasContainer();
      if (!artboard || !container) return;

      const rect = artboard.getBoundingClientRect();
      const scale = rect.width / (artboard.offsetWidth || 1) || 1;
      // いまアンカー点が描画されている画面位置
      const currentX = rect.left + anchor.lx * scale;
      const currentY = rect.top + anchor.ly * scale;
      // 本来あるべき位置との差。紙面を右に dx 動かす = scrollLeft を dx 減らす
      const dx = anchor.vx - currentX;
      const dy = anchor.vy - currentY;

      const fitsX = keepAutoCenter && rect.width <= container.clientWidth;
      const fitsY = keepAutoCenter && rect.height <= container.clientHeight;

      if (!fitsX && Math.abs(dx) > 0.01) container.scrollLeft -= dx;
      if (!fitsY && Math.abs(dy) > 0.01) container.scrollTop -= dy;
    },
    [getArtboard, getCanvasContainer]
  );

  // 次のズームで固定したい点。ホイール/ピンチが setZoom の直前に書き込む
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);

  /**
   * ズーム反映後にアンカーを合わせ直す。
   *
   * [なぜここに置くか]
   * このフックは EditorCanvas の先頭で呼ばれるので、この useEffect は
   * EditorCanvas 側の「#artboard-wrapper に transform を適用する useEffect」より
   * *先に* 走る。つまりこの時点の DOM はまだ変更前の倍率で、固定したい点の
   * 論理座標を正確に読める。実際の補正は倍率適用後に走らせたいので rAF に回す。
   *
   * [なぜ rAF を二重にするか]
   * EditorCanvas 側は「紙面が容器に収まる軸はスクロールを中央に寄せる」補正を
   * 別の rAF で行う。これは軸ごとの判定で、例えば 1056x910 の容器では
   * 横は倍率0.55以下、縦は0.843以下で発動する。つまり 0.55〜0.843 の帯では
   * 縦だけ後から上書きされる。settleAnchor はべき等なので、相手の補正の後に
   * もう一度走らせて上書きし返す。
   */
  useEffect(() => {
    if (isInMultiPageMode) return;
    if (!getCanvasContainer()) return;
    if (skipSettleOnceRef.current) {
      // 高速経路が既にDOMへ反映・補正済みの遅延コミット。二重補正しない
      skipSettleOnceRef.current = false;
      return;
    }

    let anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    // カーソル(指)の位置を固定したい操作か、そうでない外部からのズームか
    const hasPointerAnchor = anchor !== null;

    if (!anchor) {
      // ヘッダーの +/- や Cmd+0 / Cmd+1、プロパティパネルなど
      // 「カーソル位置を持たない」経路からのズーム。Figma と同じくビューポート中心を固定する
      // （紙面が丸ごと収まる倍率のときは中央寄せが優先される。settleAnchor 参照）
      const container = getCanvasContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      anchor = clientToArtboard(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    if (!anchor) return;

    const target = anchor;
    const keepAutoCenter = !hasPointerAnchor;
    requestAnimationFrame(() => {
      settleAnchor(target, keepAutoCenter);
      requestAnimationFrame(() => settleAnchor(target, keepAutoCenter));
    });
  }, [zoom, isInMultiPageMode, getCanvasContainer, clientToArtboard, settleAnchor]);

  // ========================================================================
  // ズーム
  // ========================================================================

  // ホイールが連続で来たとき、React の再レンダーを待たずに倍率を積み上げるための実値
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /**
   * 直前にホイール/ピンチで掴んだ固定点。連続操作の間だけ使い回す。
   *
   * [なぜ使い回すか]
   * パンもズーム補正も #canvas-container の scroll で表現しているが、
   * scrollLeft/Top は **整数に丸められる**（実測: 100.37 を代入 → 100）。
   * つまり1ステップにつき最大0.5pxだけ狙いからずれる。毎イベントで
   * 「いまカーソルの下にある論理座標」を読み直すと、そのズレを正として
   * 掴み直してしまうため誤差が積み上がる（実測: 5ステップで1.3px 流れる）。
   * 連続ズーム中は最初に掴んだ紙面上の点を固定し続けることで、
   * ズレを1ステップぶんの丸め誤差（1px未満）に閉じ込める。
   */
  const heldAnchorRef = useRef<{ anchor: ZoomAnchor; time: number } | null>(null);
  /** 連続ズームのReactコミットを間引くためのタイマーと、コミット時の再センタリング抑止 */
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSettleOnceRef = useRef(false);
  /** 連続操作とみなす間隔(ms)とカーソル移動の許容量(px) */
  const HOLD_MS = 700;
  const HOLD_TOLERANCE = 3;

  /**
   * 指定した iframe ビューポート座標を固定点にしてズームする
   * @param newZoom 目標倍率(%)
   * @param clientX iframe ビューポート座標
   * @param clientY iframe ビューポート座標
   * @param options.continuous ホイール/ピンチのように連打される操作か
   */
  const zoomAtPoint = useCallback(
    (newZoom: number, clientX: number, clientY: number, options?: { continuous?: boolean }) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (Math.abs(clamped - zoomRef.current) < 0.01) return;

      const now = Date.now();
      const held = heldAnchorRef.current;
      const canReuse =
        options?.continuous === true &&
        held !== null &&
        now - held.time < HOLD_MS &&
        Math.abs(held.anchor.vx - clientX) <= HOLD_TOLERANCE &&
        Math.abs(held.anchor.vy - clientY) <= HOLD_TOLERANCE;

      // 連続中は論理座標(lx, ly)を保持したまま、画面上の狙い位置だけ今のカーソルに更新する
      const anchor: ZoomAnchor | null = canReuse
        ? { lx: held.anchor.lx, ly: held.anchor.ly, vx: clientX, vy: clientY }
        : clientToArtboard(clientX, clientY);

      if (anchor) {
        heldAnchorRef.current = { anchor, time: now };
      }

      zoomRef.current = clamped;

      if (options?.continuous) {
        // ── 高速経路 ──
        // ホイール/ピンチは毎秒数十回来る。Reactを1ティックごとに回すと
        // サムネイル等の再レンダーで確実にガタつくため、DOMへ即時反映し、
        // 状態へのコミット(%表示などの追随)は操作が落ち着いてからにする
        const doc = getIframeDoc();
        if (doc) {
          applyCanvasZoomDom(doc, clamped);
          if (anchor) settleAnchor(anchor, false);
          applyOverlayScale(doc);
          syncSelectionOverlayRects(doc);
        }
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(() => {
          // コミットで走る補正エフェクトに「ビューポート中心へ寄せ直し」を
          // させない(直前まで固定していたカーソル位置から視点が飛ぶため)
          skipSettleOnceRef.current = true;
          setZoom(zoomRef.current);
        }, 160);
        return;
      }

      if (anchor) zoomAnchorRef.current = anchor;
      setZoom(clamped);
    },
    [clientToArtboard, setZoom, getIframeDoc, settleAnchor]
  );

  // ========================================================================
  // ズームAPI（Cmd+0 / Cmd+1 / Cmd+2、ヘッダーのメニュー、拡大縮小ツールから使う）
  //
  // [なぜ関数として公開するか]
  // 以前は「Cmd+0 を押す」も「ヘッダーの全体表示を押す」も、呼ぶ側がそれぞれ
  // setZoom(fitZoom) と書いていた。同じ操作の実装が散らばると、片方だけ
  // 固定点の扱いが違う（＝押す場所によって結果が変わる）状態になりやすい。
  // ズームの意味づけはこのフックに集約し、外からは名前で呼ぶ。
  // ========================================================================

  /**
   * 紙面の論理矩形が画面に収まる倍率にし、その中心をビューポート中心に置く
   * @param rect 紙面(#artboard)の論理座標系での矩形
   * @param margin 画面端に残す余白(px)
   */
  const zoomToRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, margin = 80) => {
      const container = getCanvasContainer();
      if (!container || rect.w <= 0 || rect.h <= 0) return;

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scale = Math.min((cw - margin) / rect.w, (ch - margin) / rect.h);
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(scale * 100)));

      const cRect = container.getBoundingClientRect();
      const anchor: ZoomAnchor = {
        vx: cRect.left + cw / 2,
        vy: cRect.top + ch / 2,
        lx: rect.x + rect.w / 2,
        ly: rect.y + rect.h / 2,
      };
      heldAnchorRef.current = null;

      // すでに同じ倍率なら setZoom しても再レンダーが起きない＝補正の useEffect も走らない。
      // 「押しても何も起きない」を作らないため、その場合はここで直接寄せる。
      if (Math.abs(next - zoomRef.current) < 0.01) {
        requestAnimationFrame(() => {
          settleAnchor(anchor, false);
          requestAnimationFrame(() => settleAnchor(anchor, false));
        });
        return;
      }

      zoomAnchorRef.current = anchor;
      zoomRef.current = next;
      setZoom(next);
    },
    [getCanvasContainer, settleAnchor, setZoom]
  );

  /** 全体表示（Cmd+0）。固定点を持たない＝ビューポート中心＋中央寄せに任せる */
  const zoomToFit = useCallback(() => {
    heldAnchorRef.current = null;
    zoomAnchorRef.current = null;
    zoomRef.current = fitZoom;
    setZoom(fitZoom);
  }, [fitZoom, setZoom]);

  /** 100%（Cmd+1） */
  const zoomToActual = useCallback(() => {
    heldAnchorRef.current = null;
    zoomAnchorRef.current = null;
    zoomRef.current = 100;
    setZoom(100);
  }, [setZoom]);

  /** 選択範囲にズーム（Cmd+2）。無選択のときは全体表示にフォールバックする */
  const zoomToSelection = useCallback(() => {
    const doc = getIframeDoc();
    const artboard = getArtboard();
    if (!doc || !artboard) return;

    const selected = Array.from(doc.querySelectorAll<HTMLElement>('.selected'));
    if (selected.length === 0) {
      zoomToFit();
      return;
    }

    const ab = artboard.getBoundingClientRect();
    const scale = ab.width / (artboard.offsetWidth || 1) || 1;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    selected.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    });
    if (!Number.isFinite(left) || right <= left || bottom <= top) {
      zoomToFit();
      return;
    }

    zoomToRect({
      x: (left - ab.left) / scale,
      y: (top - ab.top) / scale,
      w: (right - left) / scale,
      h: (bottom - top) / scale,
    });
  }, [getIframeDoc, getArtboard, zoomToFit, zoomToRect]);

  // ========================================================================
  // ビューポート管理（既存API維持）
  // ========================================================================

  // Webページモードでコンテンツ高さを更新する関数
  const updateContentHeight = useCallback(() => {
    if (editorMode !== 'webpage') return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const artboard = iframeDoc.getElementById('artboard');
    const targetElement = artboard || iframeDoc.body;

    const elements = targetElement.querySelectorAll('*');
    let maxBottom = 0;
    elements.forEach((el) => {
      const bottom = (el as HTMLElement).getBoundingClientRect().bottom;
      if (bottom > maxBottom) maxBottom = bottom;
    });

    const scrollHeight = targetElement.scrollHeight;
    const computedHeight = Math.max(scrollHeight, maxBottom);
    setContentHeight(Math.max(WEBPAGE_MIN_HEIGHT, computedHeight + 100));
  }, [editorMode, getIframeDoc]);

  // 初期表示時に中央にスクロール
  const centerSlide = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      left: (container.scrollWidth - container.clientWidth) / 2,
      // webpage は上端固定(#canvas-scroll-area が flex-start)。先頭から見せる
      top: editorMode === 'webpage' ? 0 : (container.scrollHeight - container.clientHeight) / 2,
      behavior: 'instant',
    });
  }, [containerRef, editorMode]);

  // ズームフィット計算
  const calculateFitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 100;

    const containerRect = container.getBoundingClientRect();
    const padding = 64;
    const scaleX = (containerRect.width - padding) / canvasWidth;
    const scaleY = (containerRect.height - padding) / canvasHeight;
    return Math.floor(Math.min(scaleX, scaleY) * 100);
  }, [containerRef, canvasWidth, canvasHeight]);

  // 初期化時とウィンドウリサイズ時にフィットズームを計算
  useEffect(() => {
    if (isInMultiPageMode) return;

    const updateFitZoomValue = () => {
      const newFitZoom = calculateFitZoom();
      setFitZoom(newFitZoom);
      if (!initialZoomSetRef.current) {
        setZoom(newFitZoom);
        initialZoomSetRef.current = true;
      }
    };

    const timer = setTimeout(updateFitZoomValue, 100);
    window.addEventListener('resize', updateFitZoomValue);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateFitZoomValue);
    };
  }, [calculateFitZoom, setFitZoom, setZoom, isInMultiPageMode]);

  // 初回マウント時に中央配置
  useEffect(() => {
    if (isInMultiPageMode) return;
    if (containerRef.current) {
      centerSlide();
      requestAnimationFrame(centerSlide);
      setTimeout(centerSlide, 50);
      setTimeout(centerSlide, 150);
      setTimeout(centerSlide, 300);
    }
  }, [centerSlide, isInMultiPageMode, containerRef]);

  // iframeロード後にも中央配置を実行
  useEffect(() => {
    if (isInMultiPageMode) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      requestAnimationFrame(centerSlide);
      setTimeout(centerSlide, 100);
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [iframeRef, centerSlide, isInMultiPageMode]);

  // ========================================================================
  // ブラウザのネイティブズーム防止
  // ========================================================================
  useEffect(() => {
    const isEditorOpen = () =>
      document.querySelector('[data-frontend-visual-editor="true"], [data-slide-visual-editor="true"]');

    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmdキーが押されている場合（トラックパッドのピンチを含む）はブラウザズームを止める
      if ((e.ctrlKey || e.metaKey) && isEditorOpen()) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    const handleGesture = (e: Event) => {
      if (isEditorOpen()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('gesturestart', handleGesture, { passive: false, capture: true });
    window.addEventListener('gesturechange', handleGesture, { passive: false, capture: true });
    window.addEventListener('gestureend', handleGesture, { passive: false, capture: true });
    document.addEventListener('gesturestart', handleGesture, { passive: false, capture: true });
    document.addEventListener('gesturechange', handleGesture, { passive: false, capture: true });
    document.addEventListener('gestureend', handleGesture, { passive: false, capture: true });

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2 && isEditorOpen()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && isEditorOpen()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });

    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      document.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('gesturestart', handleGesture, { capture: true });
      window.removeEventListener('gesturechange', handleGesture, { capture: true });
      window.removeEventListener('gestureend', handleGesture, { capture: true });
      document.removeEventListener('gesturestart', handleGesture, { capture: true });
      document.removeEventListener('gesturechange', handleGesture, { capture: true });
      document.removeEventListener('gestureend', handleGesture, { capture: true });
      window.removeEventListener('touchstart', handleTouchStart, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      document.removeEventListener('touchstart', handleTouchStart, { capture: true });
      document.removeEventListener('touchmove', handleTouchMove, { capture: true });
    };
  }, []);

  // ========================================================================
  // パン（スペース + ドラッグ / 移動ツール + ドラッグ）
  // ========================================================================

  // ドラッグ中の値。setState を挟むと mousemove に間に合わないので ref を正とする
  const panRef = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  /**
   * イベントの座標を親ウィンドウ基準に揃える。
   * iframe 内で起きたイベントは iframe ビューポート基準なので、iframe の位置を足す。
   * パンでは差分しか使わないが、始点と経過点で基準がずれると飛ぶので必ず通す。
   */
  const toParentClient = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const doc = (e.target as Node | null)?.ownerDocument;
      if (doc && doc !== document) {
        const rect = iframeRef.current?.getBoundingClientRect();
        if (rect) return { x: e.clientX + rect.left, y: e.clientY + rect.top };
      }
      return { x: e.clientX, y: e.clientY };
    },
    [iframeRef]
  );

  /**
   * イベントの座標を iframe ビューポート基準に揃える。
   * ズームの固定点（clientToArtboard / zoomAtPoint）は iframe 基準なので、
   * ドラッグが iframe の外に出たときもこちらに合わせる。
   */
  const toIframeClient = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const doc = (e.target as Node | null)?.ownerDocument;
      if (doc && doc !== document) return { x: e.clientX, y: e.clientY };
      const rect = iframeRef.current?.getBoundingClientRect();
      if (rect) return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      return { x: e.clientX, y: e.clientY };
    },
    [iframeRef]
  );

  // ========================================================================
  // 拡大縮小ツール(K)
  //
  // [方針] このツールは2つの役割を持たせている。
  //  - 選択中の要素のハンドルをドラッグ → オブジェクトの拡大縮小（useDragResize が担当）
  //  - それ以外の場所 → キャンバスのズーム（クリック=拡大 / Alt+クリック=縮小 / ドラッグ=範囲）
  // ハンドルの上ではイベントを一切奪わないので、既存のスケール操作は壊れない。
  // ========================================================================

  /** ドラッグ中の値。mousemove に間に合わせるため ref を正とする（iframe ビューポート座標） */
  const zoomDragRef = useRef({ active: false, sx: 0, sy: 0, x: 0, y: 0, moved: false, alt: false });
  /** 範囲ズームのラバーバンド要素 */
  const zoomBandRef = useRef<HTMLElement | null>(null);
  /** クリックとドラッグを分ける距離(px) */
  const ZOOM_DRAG_THRESHOLD = 6;

  /** ラバーバンドを描く（iframe ビューポート座標なので position: fixed で置く） */
  const drawZoomBand = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc?.body) return;
    let band = zoomBandRef.current;
    if (!band || !band.isConnected || band.ownerDocument !== doc) {
      band = doc.createElement('div');
      band.setAttribute('data-editor-ui', 'zoom-band');
      band.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483647;' +
        'border:1px solid #3b82f6;background:rgba(59,130,246,0.12);';
      doc.body.appendChild(band);
      zoomBandRef.current = band;
    }
    const d = zoomDragRef.current;
    band.style.left = `${Math.min(d.sx, d.x)}px`;
    band.style.top = `${Math.min(d.sy, d.y)}px`;
    band.style.width = `${Math.abs(d.x - d.sx)}px`;
    band.style.height = `${Math.abs(d.y - d.sy)}px`;
  }, [getIframeDoc]);

  const removeZoomBand = useCallback(() => {
    zoomBandRef.current?.remove();
    zoomBandRef.current = null;
  }, []);

  // 最新の実装をレンダーごとに差し替えるための箱。
  // 実際に addEventListener するのは下の stableHandlers（常に同じ関数オブジェクト）で、
  // 二重登録による二重発火が構造的に起きないようにしている。
  const implRef = useRef({
    onKeyDown: (_e: KeyboardEvent) => {},
    onKeyUp: (_e: KeyboardEvent) => {},
    onBlur: () => {},
    onMouseDown: (_e: MouseEvent) => {},
    onMouseMove: (_e: MouseEvent) => {},
    onMouseUp: (_e: MouseEvent) => {},
    onDblClick: (_e: MouseEvent) => {},
  });

  implRef.current.onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat) return;
    // テキスト入力中のスペースは本来の入力として通す
    if (isTypingTarget(e.target)) return;
    const doc = (e.target as Node | null)?.ownerDocument ?? null;
    const active = doc?.activeElement ?? null;
    if (isTypingTarget(active)) return;
    // ボタンにフォーカスが残っているときは、そのボタンを押す操作を優先する
    if (isSpaceActivatedControl(e.target) || isSpaceActivatedControl(active)) return;
    e.preventDefault();
    setIsSpacePressed(true);
  };

  implRef.current.onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    setIsSpacePressed(false);
    if (panRef.current.active) {
      panRef.current.active = false;
      setIsPanning(false);
    }
  };

  // Cmd+Tab などで keyup を取り逃してパンモードに張り付くのを防ぐ
  implRef.current.onBlur = () => {
    setIsSpacePressed(false);
    if (panRef.current.active) {
      panRef.current.active = false;
      setIsPanning(false);
    }
    // 範囲ズームのドラッグ中にウィンドウを離れたとき、
    // ラバーバンドが取り残されないようにする
    if (zoomDragRef.current.active) {
      zoomDragRef.current.active = false;
      removeZoomBand();
    }
  };

  implRef.current.onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;

    // パンが最優先（拡大縮小ツール中でもスペースを押せばパンできる）
    if (isPanModeActive) {
      const container = getCanvasContainer();
      if (!container) return;

      // 選択・マーキー・描画より先にイベントを止める（このハンドラはキャプチャで張っている）
      e.preventDefault();
      e.stopPropagation();

      const { x, y } = toParentClient(e);
      panRef.current = {
        active: true,
        startX: x,
        startY: y,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      setIsPanning(true);
      return;
    }

    if (!isZoomToolActive) return;

    // ハンドル/選択枠の上は「オブジェクトの拡大縮小」に渡す（イベントを奪わない）
    const target = e.target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
    if (typeof target?.closest === 'function' && target.closest('.resize-handle, .selection-box')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const pt = toIframeClient(e);
    zoomDragRef.current = {
      active: true,
      sx: pt.x,
      sy: pt.y,
      x: pt.x,
      y: pt.y,
      moved: false,
      alt: e.altKey,
    };
  };

  implRef.current.onMouseMove = (e: MouseEvent) => {
    if (panRef.current.active) {
      const container = getCanvasContainer();
      if (!container) return;
      e.preventDefault();
      const { x, y } = toParentClient(e);
      // 掴んだ紙面がカーソルに追従する = スクロールは逆方向
      container.scrollLeft = panRef.current.scrollLeft - (x - panRef.current.startX);
      container.scrollTop = panRef.current.scrollTop - (y - panRef.current.startY);
      return;
    }

    const drag = zoomDragRef.current;
    if (!drag.active) return;
    const pt = toIframeClient(e);
    drag.x = pt.x;
    drag.y = pt.y;
    if (!drag.moved && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > ZOOM_DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) drawZoomBand();
  };

  implRef.current.onMouseUp = (e: MouseEvent) => {
    if (panRef.current.active) {
      panRef.current.active = false;
      setIsPanning(false);
      return;
    }

    const drag = zoomDragRef.current;
    if (!drag.active) return;
    drag.active = false;
    removeZoomBand();

    if (drag.moved) {
      // 範囲ズーム: 囲った矩形が画面いっぱいに来るようにする
      const a = clientToArtboard(drag.sx, drag.sy);
      const b = clientToArtboard(drag.x, drag.y);
      const w = a && b ? Math.abs(b.lx - a.lx) : 0;
      const h = a && b ? Math.abs(b.ly - a.ly) : 0;
      // 真横/真下だけのドラッグは面積が 0 になり、範囲としては使えない。
      // ここで黙って何もしないと「バンドは出たのにズームしない」になるので、
      // クリックと同じ扱い（カーソル位置で拡大）にフォールバックする。
      if (a && b && w > 2 && h > 2) {
        zoomToRect({
          x: Math.min(a.lx, b.lx),
          y: Math.min(a.ly, b.ly),
          w,
          h,
        });
        return;
      }
    }

    // クリック = カーソル位置を固定点に拡大 / Alt+クリック = 縮小
    const zoomOut = e.altKey || drag.alt;
    zoomAtPoint(zoomRef.current * (zoomOut ? 1 / ZOOM_TOOL_STEP : ZOOM_TOOL_STEP), drag.x, drag.y);
  };

  /**
   * キャンバスの余白（紙面の外）をダブルクリックで全体表示。
   *
   * [移植時の修正] 以前は *親ウィンドウの* containerRef に dblclick を張り、
   * `e.target === iframe内の #canvas-container` と比較していた。
   * dblclick はフレーム境界を越えないので、この条件は永久に成立せず
   * 完全な死にコードだった（実測: 60%表示で余白をダブルクリック → 60%のまま）。
   * iframe document 側に張り直したうえで、判定も「e.target が何か」ではなく
   * 「編集可能な要素にヒットしたか」に変えている。ヒットしたときは
   * ダブルクリック＝1階層潜る（useElementSelection の担当）なので何もしない。
   */
  implRef.current.onDblClick = (e: MouseEvent) => {
    const target = e.target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
    if (typeof target?.closest === 'function') {
      if (target.closest('[data-editable="true"], [data-element-id]')) return;
      if (target.closest('.resize-handle, .selection-box')) return;
    }
    zoomToFit();
  };

  // 実際に登録する不変のハンドラ群
  const stableHandlersRef = useRef<{
    keyDown: (e: Event) => void;
    keyUp: (e: Event) => void;
    blur: () => void;
    mouseDown: (e: Event) => void;
    mouseMove: (e: Event) => void;
    mouseUp: (e: Event) => void;
    dblClick: (e: Event) => void;
  } | null>(null);
  if (!stableHandlersRef.current) {
    stableHandlersRef.current = {
      keyDown: (e) => implRef.current.onKeyDown(e as KeyboardEvent),
      keyUp: (e) => implRef.current.onKeyUp(e as KeyboardEvent),
      blur: () => implRef.current.onBlur(),
      mouseDown: (e) => implRef.current.onMouseDown(e as MouseEvent),
      mouseMove: (e) => implRef.current.onMouseMove(e as MouseEvent),
      mouseUp: (e) => implRef.current.onMouseUp(e as MouseEvent),
      dblClick: (e) => implRef.current.onDblClick(e as MouseEvent),
    };
  }

  /**
   * 親ウィンドウと iframe document の両方にパン用のリスナーを張る。
   *
   * iframe は差し替えのたびに document が作り直されるので、load とポーリングで
   * 最新の document に張り直す（キーボードディスパッチャと同じ方式）。
   * mousedown だけキャプチャフェーズにしているのは、iframe document に
   * バブリングで張られている選択ハンドラ(useElementSelection)より先に
   * 掴む必要があるため。
   */
  useEffect(() => {
    if (isInMultiPageMode) return;
    if (typeof window === 'undefined') return;
    const h = stableHandlersRef.current;
    if (!h) return;

    window.addEventListener('keydown', h.keyDown);
    window.addEventListener('keyup', h.keyUp);
    window.addEventListener('blur', h.blur);
    window.addEventListener('mousemove', h.mouseMove);
    window.addEventListener('mouseup', h.mouseUp);

    const attachedDocs = new Set<Document>();
    let watchedIframe: HTMLIFrameElement | null = null;

    const attach = (doc: Document) => {
      doc.addEventListener('keydown', h.keyDown);
      doc.addEventListener('keyup', h.keyUp);
      doc.addEventListener('mousedown', h.mouseDown, true);
      doc.addEventListener('mousemove', h.mouseMove);
      doc.addEventListener('mouseup', h.mouseUp);
      // ダブルクリックは「編集可能要素にヒットしなかったとき」だけ拾うので
      // 選択側(バブリング)より先に横取りしないよう、こちらもバブリングで張る
      doc.addEventListener('dblclick', h.dblClick);
      doc.defaultView?.addEventListener('blur', h.blur);
    };
    const detach = (doc: Document) => {
      try {
        doc.removeEventListener('keydown', h.keyDown);
        doc.removeEventListener('keyup', h.keyUp);
        doc.removeEventListener('mousedown', h.mouseDown, true);
        doc.removeEventListener('mousemove', h.mouseMove);
        doc.removeEventListener('mouseup', h.mouseUp);
        doc.removeEventListener('dblclick', h.dblClick);
        doc.defaultView?.removeEventListener('blur', h.blur);
      } catch {
        /* すでに破棄された document は無視 */
      }
    };

    const sync = () => {
      const el = iframeRef.current ?? null;
      if (el !== watchedIframe) {
        watchedIframe?.removeEventListener('load', sync);
        watchedIframe = el;
        watchedIframe?.addEventListener('load', sync);
      }
      let doc: Document | null = null;
      try {
        doc = el?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (doc && !attachedDocs.has(doc)) {
        attach(doc);
        attachedDocs.add(doc);
      }
      // 破棄済み document は保持しない
      attachedDocs.forEach((d) => {
        if (!d.defaultView) attachedDocs.delete(d);
      });
    };

    sync();
    const timer = window.setInterval(sync, 400);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', h.keyDown);
      window.removeEventListener('keyup', h.keyUp);
      window.removeEventListener('blur', h.blur);
      window.removeEventListener('mousemove', h.mouseMove);
      window.removeEventListener('mouseup', h.mouseUp);
      watchedIframe?.removeEventListener('load', sync);
      attachedDocs.forEach(detach);
      attachedDocs.clear();
    };
  }, [isInMultiPageMode, iframeRef]);

  /**
   * パン中のカーソル表示。
   * iframe 側は body の pan-mode / panning クラス（CSSは html-utils にある）、
   * 親ウィンドウ側は body の cursor で表現する。
   *
   * [移植時の修正] 以前はスペースキーの keydown 内でだけクラスを付けていたので、
   * 移動ツール(H)で入ったパンモードでは手のカーソルにならなかった。
   * isPanModeActive を唯一の情報源にして両方の入口をカバーする。
   */
  useEffect(() => {
    if (isInMultiPageMode) return;

    const iframeDoc = getIframeDoc();
    const body = iframeDoc?.body;

    if (isPanModeActive) {
      body?.classList.add('pan-mode');
      document.body.style.cursor = isPanning ? 'grabbing' : 'grab';
    } else {
      body?.classList.remove('pan-mode');
      document.body.style.cursor = '';
    }

    if (isPanning) body?.classList.add('panning');
    else body?.classList.remove('panning');

    return () => {
      // モード終了時にカーソルを残さない
      if (!isPanModeActive) document.body.style.cursor = '';
    };
  }, [isPanModeActive, isPanning, getIframeDoc, isInMultiPageMode]);

  // アンマウント時にカーソルとクラスを必ず戻す
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      const body = getIframeDoc()?.body;
      body?.classList.remove('pan-mode');
      body?.classList.remove('panning');
    };
  }, [getIframeDoc]);

  // キーボードディスパッチャ（Cmd+0 / Cmd+1 / Cmd+2）から呼べるように登録する
  useEffect(() => {
    if (isInMultiPageMode) return;
    editorZoomApiRef.current = {
      fit: zoomToFit,
      actual: zoomToActual,
      selection: zoomToSelection,
    };
    return () => {
      editorZoomApiRef.current = null;
    };
  }, [zoomToFit, zoomToActual, zoomToSelection, isInMultiPageMode]);

  // ========================================================================
  // 拡大縮小ツール中のカーソルと当たり判定
  //
  // ズーム操作であることが見て分かるように zoom-in / zoom-out カーソルにする。
  // 併せて [data-editable] の pointer-events を切り、クリックが要素の選択に
  // 化けないようにする（#artboard 自体は残すので .resize-handle は生きたまま＝
  // 選択済み要素のハンドルドラッグによる「オブジェクトの拡大縮小」は使える）。
  // ========================================================================
  useEffect(() => {
    if (isInMultiPageMode) return;

    const STYLE_ID = 'editor-zoom-tool-style';
    const apply = () => {
      const doc = getIframeDoc();
      const body = doc?.body;
      if (!doc || !body) return;

      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
          'body.zoom-tool { cursor: zoom-in !important; }',
          'body.zoom-tool.zoom-out { cursor: zoom-out !important; }',
          'body.zoom-tool [data-editable="true"] { pointer-events: none !important; }',
        ].join('\n');
        doc.head?.appendChild(style);
      }
      body.classList.toggle('zoom-tool', isZoomToolActive);
      if (!isZoomToolActive) body.classList.remove('zoom-out');
    };

    apply();
    if (!isZoomToolActive) {
      // ツールを離れたらドラッグ中のラバーバンドも残さない
      zoomDragRef.current.active = false;
      removeZoomBand();
    }
    // スライドを切り替えると iframe の document ごと作り直されてクラスが消えるので、
    // 他のリスナー再登録（sync）と同じ間隔で貼り直す
    const timer = window.setInterval(apply, 400);

    return () => {
      window.clearInterval(timer);
      getIframeDoc()?.body?.classList.remove('zoom-tool', 'zoom-out');
    };
  }, [isZoomToolActive, getIframeDoc, isInMultiPageMode, removeZoomBand]);

  // Alt キーで zoom-in / zoom-out カーソルを入れ替える（押した結果が事前に分かる状態にする）
  useEffect(() => {
    if (isInMultiPageMode || !isZoomToolActive) return;
    const sync = (e: KeyboardEvent) => {
      const body = getIframeDoc()?.body;
      if (!body) return;
      body.classList.toggle('zoom-out', e.altKey);
    };
    const clear = () => getIframeDoc()?.body?.classList.remove('zoom-out');

    const docs: Array<Document | Window> = [window];
    const iframeDoc = getIframeDoc();
    if (iframeDoc) docs.push(iframeDoc);
    docs.forEach((d) => {
      d.addEventListener('keydown', sync as EventListener);
      d.addEventListener('keyup', sync as EventListener);
    });
    window.addEventListener('blur', clear);
    return () => {
      docs.forEach((d) => {
        d.removeEventListener('keydown', sync as EventListener);
        d.removeEventListener('keyup', sync as EventListener);
      });
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [isZoomToolActive, getIframeDoc, isInMultiPageMode]);

  // ========================================================================
  // iframe からのホイール/ピンチイベント（useTouchGestures が postMessage で転送）
  // ========================================================================
  useEffect(() => {
    if (isInMultiPageMode) return;

    const handleMessage = (e: MessageEvent) => {
      // Ctrl/Cmd + ホイール。座標は iframe ビューポート基準で送られてくる
      if (e.data?.type === 'IFRAME_WHEEL_EVENT') {
        const { deltaY, clientX, clientY } = e.data as {
          deltaY: number;
          clientX: number;
          clientY: number;
        };
        if (typeof deltaY !== 'number') return;
        const k = Math.abs(deltaY) < CONTINUOUS_DELTA_MAX ? PINCH_ZOOM_K : WHEEL_ZOOM_K;
        let factor = Math.exp(-deltaY * k);
        factor = Math.max(1 / MAX_STEP_FACTOR, Math.min(MAX_STEP_FACTOR, factor));
        // continuous: 連打される操作。固定点を掴み直さない（丸め誤差の蓄積対策）
        zoomAtPoint(zoomRef.current * factor, clientX, clientY, { continuous: true });
      }

      // ピンチ。指の間隔の比率をそのまま倍率比にする
      if (e.data?.type === 'IFRAME_PINCH_EVENT') {
        const { previousDistance, currentDistance, centerX, centerY } = e.data as {
          previousDistance: number;
          currentDistance: number;
          centerX: number;
          centerY: number;
        };
        if (!previousDistance || !currentDistance) return;
        let factor = currentDistance / previousDistance;
        factor = Math.max(1 / MAX_STEP_FACTOR, Math.min(MAX_STEP_FACTOR, factor));
        zoomAtPoint(zoomRef.current * factor, centerX, centerY, { continuous: true });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [zoomAtPoint, isInMultiPageMode]);

  return {
    // パン状態
    isPanning,
    isSpacePressed,
    isPanModeActive,
    // ズーム
    zoomAtPoint,
    // ズームAPI（Cmd+0 / Cmd+1 / Cmd+2 やヘッダーのメニューから呼べる形で公開する）
    zoomToFit,
    zoomToActual,
    zoomToSelection,
    zoomToRect,
    isZoomToolActive,
    // ビューポート管理
    centerSlide,
    calculateFitZoom,
    updateContentHeight,
    // キャンバス寸法
    canvasWidth,
    canvasHeight,
    contentHeight,
  };
}
