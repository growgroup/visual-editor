/**
 * ドラッグ・リサイズ処理フック
 * - 要素のドラッグ移動（単一・複数）
 * - リサイズハンドルによるサイズ変更
 * - 回転ハンドルによる回転
 * - Scale Toolによる拡大縮小
 * - 複数要素の一括リサイズ
 */

import { useCallback, useRef, useEffect, MutableRefObject } from 'react';
import { useEditorContext } from '../EditorContext';
import {
  getArtboardContent,
  getArtboardScale,
  convertDragTargetsToAbsolute,
  prepareElementDragOrigin,
  refreshSelectionOverlay,
  syncSelectionOverlayRects,
  getOverlayRect,
  setOverlayLabel,
} from '../utils/dom-utils';
import {
  DRAG_START_THRESHOLD,
  MIN_ELEMENT_SIZE,
  computeResizeGeometry,
  constrainAxis,
  handleDirection,
  isOutOfFlowPosition,
  measureStyleSize,
  roundPx,
} from '../utils/geometry';
import {
  shouldReorder,
  startReorder,
  computeInsertIndex,
  drawInsertIndicator,
  commitReorder,
  endReorder,
  type ReorderSession,
} from '../utils/flex-reorder';
import {
  collectGuideCandidates,
  snapToGuides,
  drawSmartGuides,
  clearSmartGuides,
  SNAP_THRESHOLD_SCREEN_PX,
  type GuideCandidates,
  type MovingRect,
} from '../utils/smart-guides';
import { extractElementInfo } from '../utils/style-utils';
import { convertInlineStylesToTailwind } from '../utils/tailwind-utils';
import { isAspectRatioLocked } from '../utils/aspect-lock';
import {
  getFlexContainerInfo,
  calculateDropIndex,
  hideFlexDropIndicator,
  endAutoLayoutDrag,
  cancelAutoLayoutDrag,
  removeDragGhost,
  type AutoLayoutDragState,
} from '../utils/flex-utils';
import type { DragState, ResizeState, EditorTool } from '../types';

// NOTE: zoom値はiframeロード時にイベントリスナーのクロージャに閉じ込められるため、
// refを使って最新値を参照する必要がある

interface UseDragResizeOptions {
  /** ドラッグ状態のref */
  dragStateRef: MutableRefObject<DragState>;
  /** リサイズ状態のref */
  resizeStateRef: MutableRefObject<ResizeState>;
  /** アクティブツールのref */
  activeToolRef: MutableRefObject<EditorTool>;
  /** レイアウトモードのref */
  layoutModeRef: MutableRefObject<'absolute' | 'auto'>;
  /** レイアウトヒント表示関数のref */
  setShowLayoutHintRef: MutableRefObject<(show: boolean) => void>;
}

interface UseDragResizeReturn {
  /**
   * ドラッグ・リサイズのマウス移動処理
   * @returns true if drag/resize was handled, false otherwise
   */
  handleDragResizeMouseMove: (e: MouseEvent, iframeDoc: Document) => boolean;

  /**
   * ドラッグ・リサイズのマウスアップ処理
   * @returns true if drag/resize was handled, false otherwise
   */
  handleDragResizeMouseUp: (iframeDoc: Document) => boolean;

  /**
   * 要素情報を親ウィンドウに送信
   */
  sendElementInfo: (element: HTMLElement, iframeDoc: Document) => void;

  /**
   * ドラッグ状態をリセット
   */
  resetDragState: () => void;

  /**
   * リサイズ状態をリセット
   */
  resetResizeState: () => void;

  /**
   * ドラッグ中の操作を取り消して開始位置へ戻す
   *
   * Esc のキーバインドはここでは張らない（キーボードの単一経路は
   * useKeyboardShortcuts 側が持つ）。呼び出し側から使えるように公開だけする。
   *
   * @param iframeDoc 省略時はドラッグ中要素の ownerDocument を使う
   * @returns 取り消すドラッグがあった場合 true
   */
  cancelDrag: (iframeDoc?: Document | null) => boolean;
}

/**
 * 初期ドラッグ状態
 */
const INITIAL_DRAG_STATE: DragState = {
  element: null,
  elements: [],
  startX: 0,
  startY: 0,
  origLeft: 0,
  origTop: 0,
  origPositions: [],
  isDragging: false,
  hasMoved: false,
  // Flex reorder mode (auto-layout)
  flexReorderMode: false,
  flexParent: null,
  originalIndex: -1,
  targetIndex: -1,
  // Enhanced auto-layout drag (hierarchy change support)
  autoLayoutDragMode: false,
  dragGhost: null,
  originalParent: null,
  currentDropTarget: null,
  dropPosition: null,
  dropIndex: -1,
};

/**
 * 初期リサイズ状態
 */
const INITIAL_RESIZE_STATE: ResizeState = {
  isResizing: false,
  isRotating: false,
  element: null,
  elements: [],
  handle: '',
  startX: 0,
  startY: 0,
  origLeft: 0,
  origTop: 0,
  origWidth: 0,
  origHeight: 0,
  origRadius: 0,
  selectionBounds: null,
  origElementStates: [],
  origScaleX: 1,
  origScaleY: 1,
  rotation: 0,
  rotationStartAngle: 0,
  centerX: 0,
  centerY: 0,
};

/**
 * ドラッグの種類
 * - free  : left/top を書いて自由に動かす（フローから外れている要素）
 * - ghost : ゴーストを掴んで flex 内を並べ替える（フローの中にいる要素）
 */
type DragMode = 'free' | 'ghost';

/**
 * リサイズの基準値スナップショット
 *
 * [なぜ mousedown 時の resizeState をそのまま使わないか]
 * resizeState.origLeft/origTop は `parseFloat(el.style.left) || 0` で採られている。
 * `absolute left-[96px]` のように Tailwind クラスだけで配置された要素は
 * インライン style を持たないため origin が 0 と誤読され、
 * nw/w ハンドルを掴んだ瞬間に要素が x=0 付近へ飛ぶ。
 * origWidth/origHeight も getBoundingClientRect / React側 zoom で割っており、
 * 実際の artboard スケールとズレる余地がある。
 * ここでリサイズ1フレーム目に offsetLeft/offsetTop/offsetWidth/offsetHeight で
 * 採り直し、以後のフレームはこの値だけを基準にする（誤差が蓄積しない）。
 */
interface ResizeSnapshot {
  element: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
  /** left/top を書いて対辺を固定できるか（フロー外 or 絶対配置モードで変換済み） */
  canWritePosition: boolean;
  /** リサイズ開始前のインライン width/height（無効だったとき元に戻すため） */
  prevInlineWidth: string;
  prevInlineHeight: string;
  /** 幅・高さの書き込みが描画に反映されるか検査済みか */
  widthChecked: boolean;
  heightChecked: boolean;
  /** 書いても描画が変わらない軸（flex:1 の子など） */
  widthInert: boolean;
  heightInert: boolean;
  /**
   * このドラッグ中に一度でも書き込んだ軸
   *
   * Shift（比率維持）で従属軸を書いた後に Shift を離すと、
   * 「その軸はもう動かさない」と判定されて書き込みが止まり、
   * 比率維持で作った値が取り残される。一度触った軸は
   * このドラッグが終わるまで責任を持って書き続ける。
   */
  wroteWidth: boolean;
  wroteHeight: boolean;
}

/**
 * 「効かないハンドル」を表す印
 *
 * flex:1（flex-basis:0）の子は inline width を書いても描画が変わらない。
 * 黙って空振りさせず、選択枠にこの印を付けて操作不能であることを示す。
 * 見た目のスタイルは constants.ts 側（EDITOR_IFRAME_STYLES）に用意される想定だが、
 * スタイルが無くても伝わるようにハンドルの cursor も直接落とす。
 */
const RESIZE_INERT_CLASS = 'resize-inert';
const RESIZE_INERT_ATTR = 'data-resize-inert';

/**
 * transform の中の指定した関数だけを差し替える(他の関数は順序を保って残す)
 *
 * [なぜ必要か]
 * 回転もScaleツールも `rotate(Xdeg) scale(Y)` と丸ごと書き直していたため、
 * 画像の反転(scaleX(-1))や translate が、回転させた瞬間に消えていた。
 * `scale(` は `scaleX(` に一致しないので、この置換なら反転は残る。
 *
 * @param value null を渡すとその関数を取り除くだけ
 */
function setTransformFn(transform: string, name: string, value: string | null): string {
  const rest = transform
    .replace(new RegExp(`${name}\\([^)]*\\)`, 'g'), '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!value) return rest;
  return rest ? `${value} ${rest}` : value;
}

/**
 * Scaleツール用。rotate と scale だけを差し替え、
 * 反転(scaleX/scaleY)や translate はそのまま残す
 */
function applyRotateScale(element: HTMLElement, rotation: number, scale: number): string {
  const withScale = setTransformFn(element.style.transform || '', 'scale', `scale(${scale})`);
  return setTransformFn(withScale, 'rotate', `rotate(${rotation}deg)`);
}

/** 複数要素の外接矩形をアートボード座標で返す(単一選択も要素1個の群として扱う) */
function unionOverlayRect(iframeDoc: Document, elements: HTMLElement[]): MovingRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = getOverlayRect(iframeDoc, el);
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** 角度の表示用。-180〜180 の範囲に畳む(atan2 の折り返しで 370° 等になるため) */
function normalizeAngle(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** 回転のスナップ角(Shift 押下中) */
const ROTATION_SNAP_DEG = 15;

/**
 * ドラッグ・リサイズ処理フック
 */
export function useDragResize(
  options: UseDragResizeOptions
): UseDragResizeReturn {
  const { setShowLayoutHint, zoom } = useEditorContext();

  const {
    dragStateRef,
    resizeStateRef,
    activeToolRef,
    layoutModeRef,
    setShowLayoutHintRef,
  } = options;

  // zoomをrefで管理（イベントリスナーのクロージャ問題を回避）
  // iframeロード時にイベントリスナーが設定され、その後zoom値が変わっても
  // クロージャ内の値は更新されないため、refを使って最新値を参照する
  const zoomRef = useRef(zoom);

  // Auto-layout drag state (placeholder-based approach)
  const autoLayoutDragStateRef = useRef<AutoLayoutDragState | null>(null);

  // ドラッグの種類は「最初に閾値を超えた1回」だけ決めてキャッシュする。
  // 毎フレーム getComputedStyle を読むと重いうえ、ドラッグ中に position を
  // 書き換えた瞬間に意味が変わってしまう（自由移動と並べ替えが途中で入れ替わる）。
  const dragModeRef = useRef<DragMode | null>(null);

  // リサイズの基準値（1フレーム目に採る）
  const resizeSnapshotRef = useRef<ResizeSnapshot | null>(null);

  // スマートガイドの候補座標と、動かす前の外接矩形（どちらもドラッグ開始時に1回だけ採る）。
  // 毎フレーム集め直すと数百要素で重くなるうえ、動かしている自分自身が候補に混ざる
  const guideCandidatesRef = useRef<GuideCandidates | null>(null);
  const dragBaseRectRef = useRef<MovingRect | null>(null);

  // フレックス内の並べ替え。動き出した最初の1回だけ作り、mouseupで畳む。
  // 並べ替え中は座標を書かないので、スマートガイドもXYバッジも出さない
  const reorderRef = useRef<ReorderSession | null>(null);
  const reorderIndexRef = useRef<number>(-1);

  // zoomが変更されたらrefを更新
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // 最新のsetShowLayoutHintをrefに同期
  useEffect(() => {
    setShowLayoutHintRef.current = setShowLayoutHint;
  }, [setShowLayoutHint, setShowLayoutHintRef]);

  /**
   * 要素情報を親ウィンドウに送信
   */
  const sendElementInfo = useCallback(
    (element: HTMLElement, iframeDoc: Document) => {
      const info = extractElementInfo(element, iframeDoc);
      if (info) {
        window.postMessage({ type: 'ELEMENT_SELECTED', element: info }, '*');
      }
    },
    []
  );

  /**
   * ドラッグ状態をリセット
   */
  const resetDragState = useCallback(() => {
    dragStateRef.current = { ...INITIAL_DRAG_STATE };
    dragModeRef.current = null;
    // 次のドラッグは別の要素・別の並びから始まるので、候補と基準は持ち越さない
    guideCandidatesRef.current = null;
    dragBaseRectRef.current = null;
    reorderRef.current = null;
    reorderIndexRef.current = -1;
  }, [dragStateRef]);

  /**
   * リサイズ状態をリセット
   */
  const resetResizeState = useCallback(() => {
    resizeStateRef.current = { ...INITIAL_RESIZE_STATE };
    resizeSnapshotRef.current = null;
  }, [resizeStateRef]);

  /**
   * ドラッグ・リサイズの移動量をCSS座標へ割り戻すためのスケールを返す
   *
   * [なぜ基準を一本化するか]
   * 選択枠は #artboard-wrapper の transform:scale() を基準に配置している。
   * 一方で移動量は React 側の zoom(%) から算出していたため、
   * 両者が乖離すると「枠と要素がズレる」「移動量が合わない」が起きる。
   * DOM上の実測値（getArtboardScale）を正とし、取得できない場合のみ zoom にフォールバックする。
   */
  const getDragScale = useCallback((iframeDoc: Document): number => {
    const artboardScale = getArtboardScale(iframeDoc);
    if (artboardScale > 0) return artboardScale;
    const zoomScale = (zoomRef.current || 100) / 100;
    return zoomScale > 0 ? zoomScale : 1;
  }, []);

  /**
   * 回転処理
   */
  const handleRotation = useCallback(
    (e: MouseEvent, iframeDoc: Document): boolean => {
      const resizeState = resizeStateRef.current;
      if (!resizeState.isRotating || !resizeState.element) {
        return false;
      }

      const element = resizeState.element;

      // 現在のマウス位置から中心への角度を計算
      const currentAngle =
        Math.atan2(
          e.clientY - resizeState.centerY,
          e.clientX - resizeState.centerX
        ) *
        (180 / Math.PI);

      // 回転差分を計算
      const angleDelta = currentAngle - resizeState.rotationStartAngle;
      let newRotation = resizeState.rotation + angleDelta;

      // Shift = 15°刻み(Figma/PowerPointと同じ逃げ道)
      if (e.shiftKey) {
        newRotation = Math.round(newRotation / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
      }

      // [修正] 以前は `rotate(x) scale(y)` と丸ごと書き直していたため、
      // 画像の反転(scaleX(-1))や translate が回転させた瞬間に消えていた。
      // rotate だけを差し替え、他の transform 関数はそのまま残す。
      element.style.transform = setTransformFn(
        element.style.transform || '',
        'rotate',
        `rotate(${Math.round(newRotation * 10) / 10}deg)`,
      );

      // 角度はサイズラベルと同じ場所に出す(何度回っているかを見ながら回せる)
      setOverlayLabel(`${Math.round(normalizeAngle(newRotation))}°`);

      // 選択枠は「選択セット全体」を同期する（1要素だけ作り直すと他の枠が消える）
      syncSelectionOverlayRects(iframeDoc);

      return true;
    },
    [resizeStateRef]
  );

  /**
   * Scale Toolによるリサイズ処理
   */
  const handleScaleResize = useCallback(
    (
      e: MouseEvent,
      iframeDoc: Document,
      deltaX: number,
      deltaY: number
    ): boolean => {
      const resizeState = resizeStateRef.current;
      if (activeToolRef.current !== 'scale' || !resizeState.element) {
        return false;
      }

      const element = resizeState.element;
      const handle = resizeState.handle;

      // 基準サイズ
      const origSize = resizeState.origWidth;
      if (origSize === 0) return true;

      // ハンドルによる方向係数
      let directionX = 1;
      let directionY = 1;

      if (handle.includes('w')) directionX = -1;
      if (handle.includes('n')) directionY = -1;

      let delta = deltaX * directionX;

      // 上下ハンドルの場合は高さの変化を使用
      if (handle === 'n' || handle === 's') {
        delta = deltaY * directionY;
        const baseScale = resizeState.origScaleY;
        const newScale =
          baseScale *
          ((resizeState.origHeight + delta) / resizeState.origHeight);
        element.style.transform = applyRotateScale(element, resizeState.rotation, newScale);
        syncSelectionOverlayRects(iframeDoc);
        return true;
      }

      const baseScale = resizeState.origScaleX;
      const newScale =
        baseScale *
        ((resizeState.origWidth + delta) / resizeState.origWidth);

      // アスペクト比維持で適用
      element.style.transform = applyRotateScale(element, resizeState.rotation, newScale);
      syncSelectionOverlayRects(iframeDoc);

      return true;
    },
    [resizeStateRef, activeToolRef]
  );

  /**
   * 複数要素のリサイズ処理（群バウンディングボックスの変形）
   *
   * [単一要素と同じ規則に揃える]
   * - 対辺固定・Shift（縦横比維持）・Alt（中心固定）は computeResizeGeometry に委ねる
   * - 最小サイズは 1px（従来は 10px でクランプしていた）
   * - left/top を書くかどうかはモードではなく各要素の computed position で決める
   *   （フローの中にいる要素に left を書いても描画は変わらないため、書かない）
   */
  const handleMultiElementResize = useCallback(
    (
      iframeDoc: Document,
      deltaX: number,
      deltaY: number,
      mods: { shiftKey: boolean; altKey: boolean }
    ): boolean => {
      const resizeState = resizeStateRef.current;
      if (
        !resizeState.elements ||
        resizeState.elements.length <= 1 ||
        !resizeState.selectionBounds
      ) {
        return false;
      }

      const bounds = resizeState.selectionBounds;
      const handle = resizeState.handle;

      // バウンディングボックスの新しい矩形（単一要素と同じ計算規則）
      const next = computeResizeGeometry(
        {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        handle,
        deltaX,
        deltaY,
        { shiftKey: mods.shiftKey, altKey: mods.altKey }
      );

      // スケール率を計算
      const scaleX = bounds.width > 0 ? next.width / bounds.width : 1;
      const scaleY = bounds.height > 0 ? next.height / bounds.height : 1;

      const win = iframeDoc.defaultView;

      // 各要素を更新
      resizeState.elements.forEach((el, index) => {
        const orig = resizeState.origElementStates[index];
        if (!orig) return;

        // 相対位置を維持して座標変換
        const relativeLeft = orig.left - bounds.left;
        const relativeTop = orig.top - bounds.top;

        const newElementWidth = Math.max(MIN_ELEMENT_SIZE, orig.width * scaleX);
        const newElementHeight = Math.max(MIN_ELEMENT_SIZE, orig.height * scaleY);
        const newElementLeft = next.left + relativeLeft * scaleX;
        const newElementTop = next.top + relativeTop * scaleY;

        // 位置を書けるのは「フローから外れている要素」だけ。
        // 絶対配置モードなら従来通り static → absolute へ倒して位置を持たせる。
        const position = win?.getComputedStyle(el).position;
        const outOfFlow = isOutOfFlowPosition(position);
        const canWritePosition = outOfFlow || layoutModeRef.current === 'absolute';

        if (canWritePosition) {
          // すでにフロー外なら position は触らない（fixed を absolute に落とさない）
          if (!outOfFlow) el.style.position = 'absolute';
          el.style.left = `${roundPx(newElementLeft)}px`;
          el.style.top = `${roundPx(newElementTop)}px`;
        }
        el.style.width = `${roundPx(newElementWidth)}px`;
        el.style.height = `${roundPx(newElementHeight)}px`;
      });

      // ループ内で1要素ずつ枠を作り直すと他の枠を巻き込んで壊すため、
      // 全要素を動かし終えてから選択セット全体を同期する
      syncSelectionOverlayRects(iframeDoc);

      return true;
    },
    [resizeStateRef, layoutModeRef]
  );

  /**
   * リサイズの基準値を実測して固定する（リサイズ1フレーム目に1度だけ）
   */
  const createResizeSnapshot = useCallback(
    (element: HTMLElement, iframeDoc: Document): ResizeSnapshot => {
      const win = iframeDoc.defaultView;
      const position = win?.getComputedStyle(element).position;
      const outOfFlow = isOutOfFlowPosition(position);

      // [リサイズでは絶対配置へ倒さない]
      // 大きさを変えるのに position:absolute は要らない。width/height を書けば足りる。
      // 倒すと要素が流れから外れ、**未選択の兄弟が空いた場所へ詰め上がって重なる**。
      // 実例: 縦に積んだ2枚のカードの上側の幅を変えただけで、下側が上へ来て重なった。
      //
      // その代わり、流れの中にいる要素は left/top を書いても効かない(下の canWritePosition)。
      // 左辺・上辺のハンドルは動かないので、markResizeInert が「効かないハンドル」として印を付ける。
      // 黙って版面を壊すより、効かないことが見えるほうがよい。
      const origin = prepareElementDragOrigin(element, iframeDoc, {
        convertToAbsolute: false,
      });

      const size = measureStyleSize(element, iframeDoc);

      return {
        element,
        left: origin.left,
        top: origin.top,
        width: size.width,
        height: size.height,
        canWritePosition: outOfFlow,
        prevInlineWidth: element.style.width,
        prevInlineHeight: element.style.height,
        widthChecked: false,
        heightChecked: false,
        widthInert: false,
        heightInert: false,
        wroteWidth: false,
        wroteHeight: false,
      };
    },
    [layoutModeRef]
  );

  /**
   * 「効かないハンドル」の印を選択枠に付ける
   *
   * 選択枠は操作のたびに作り直されるので、ドラッグ中と操作後の両方から呼べるようにしている。
   */
  const markResizeInert = useCallback(
    (
      element: HTMLElement,
      iframeDoc: Document,
      inert: { width: boolean; height: boolean }
    ): void => {
      if (!inert.width && !inert.height) return;

      const elementId = element.getAttribute('data-element-id') || '';
      const box = iframeDoc.querySelector<HTMLElement>(
        `.selection-box[data-for-element="${elementId}"]`
      );
      if (!box) return;

      box.classList.add(RESIZE_INERT_CLASS);
      const axes = [inert.width ? 'width' : '', inert.height ? 'height' : '']
        .filter(Boolean)
        .join(' ');
      box.setAttribute(RESIZE_INERT_ATTR, axes);

      // 無効表示のスタイルが未整備でも伝わるよう、該当軸のハンドルの cursor を落とす
      box.querySelectorAll<HTMLElement>('.resize-handle').forEach((handleEl) => {
        const name = handleEl.getAttribute('data-handle') || '';
        const affectsWidth = name.includes('e') || name.includes('w');
        const affectsHeight = name.includes('n') || name.includes('s');
        if (
          (inert.width && affectsWidth) ||
          (inert.height && affectsHeight)
        ) {
          handleEl.style.cursor = 'not-allowed';
        }
      });
    },
    []
  );

  /**
   * 「書いても描画が変わらない軸」を検出して、無効なインラインスタイルを残さない
   *
   * 例: flex:1（flex-basis:0）の子は inline width を書いても幅が変わらない。
   * 何も起きないまま inline width だけが残ると、保存HTMLに嘘のサイズが焼き付く
   * （終了時に Tailwind クラスへ変換されるので、嘘がクラスとして固定化する）。
   * 反映されなかった軸は元のインライン値へ戻し、ハンドルを操作不能として示す。
   */
  const verifyResizeEffect = useCallback(
    (
      snapshot: ResizeSnapshot,
      iframeDoc: Document,
      requested: { width: number; height: number },
      drives: { width: boolean; height: boolean }
    ): void => {
      if (snapshot.widthChecked && snapshot.heightChecked) return;

      const rendered = measureStyleSize(snapshot.element, iframeDoc);
      let found = false;

      // 丸めの都合で 1px 未満の要求は判定材料にならないため 2px 以上動かしたときだけ判定する
      if (
        drives.width &&
        !snapshot.widthChecked &&
        Math.abs(requested.width - snapshot.width) >= 2
      ) {
        snapshot.widthChecked = true;
        if (Math.abs(rendered.width - snapshot.width) < 0.5) {
          snapshot.widthInert = true;
          snapshot.element.style.width = snapshot.prevInlineWidth;
          found = true;
        }
      }
      if (
        drives.height &&
        !snapshot.heightChecked &&
        Math.abs(requested.height - snapshot.height) >= 2
      ) {
        snapshot.heightChecked = true;
        if (Math.abs(rendered.height - snapshot.height) < 0.5) {
          snapshot.heightInert = true;
          snapshot.element.style.height = snapshot.prevInlineHeight;
          found = true;
        }
      }

      if (!found) return;
      markResizeInert(snapshot.element, iframeDoc, {
        width: snapshot.widthInert,
        height: snapshot.heightInert,
      });
    },
    [markResizeInert]
  );

  /**
   * 単一要素のリサイズ処理
   *
   * [対辺固定をモードで分岐させない]
   * 従来は `layoutModeRef.current === 'absolute'` のときしか left/top を書かなかったため、
   * 既定のオートレイアウトモードでは nw/n/w/sw が対辺を固定できず、
   * 掴んだ辺ではなく反対側が伸びていた。
   * 位置を書けるかどうかは「モード」ではなく「その要素がフローから外れているか」で決まる。
   */
  const handleSingleElementResize = useCallback(
    (
      iframeDoc: Document,
      deltaX: number,
      deltaY: number,
      mods: { shiftKey: boolean; altKey: boolean }
    ): boolean => {
      const resizeState = resizeStateRef.current;
      if (!resizeState.element) return false;

      const element = resizeState.element;
      const handle = resizeState.handle;

      // border-radius調整
      if (handle === 'radius') {
        const maxRadius =
          Math.min(resizeState.origWidth, resizeState.origHeight) / 2;
        const newRadius = Math.max(
          0,
          Math.min(maxRadius, resizeState.origRadius - deltaX - deltaY)
        );
        element.style.borderRadius = `${roundPx(newRadius)}px`;
        syncSelectionOverlayRects(iframeDoc);
        return true;
      }

      // 1フレーム目に基準値を実測して固定する（以降のフレームは常にこの値が基準）
      let snapshot = resizeSnapshotRef.current;
      if (!snapshot || snapshot.element !== element) {
        snapshot = createResizeSnapshot(element, iframeDoc);
        resizeSnapshotRef.current = snapshot;
      }

      const next = computeResizeGeometry(
        {
          left: snapshot.left,
          top: snapshot.top,
          width: snapshot.width,
          height: snapshot.height,
        },
        handle,
        deltaX,
        deltaY,
        { shiftKey: mods.shiftKey, altKey: mods.altKey }
      );

      // 掴んだハンドルが実際に動かす軸だけを書く。
      // （例: e ハンドルで height まで書くと、触っていない高さが inline → Tailwind クラスへ
      //   焼き付いてしまう。Shift の比率維持のときだけ従属軸も動く）
      // 一度でも書いた軸は、途中で Shift を離しても書き続ける
      // （書くのをやめると比率維持で作った値が取り残されて元に戻らない）
      const dir = handleDirection(handle);
      const drives = {
        width:
          dir.x !== 0 || (!!mods.shiftKey && dir.y !== 0) || snapshot.wroteWidth,
        height:
          dir.y !== 0 || (!!mods.shiftKey && dir.x !== 0) || snapshot.wroteHeight,
      };

      // 位置（＝対辺の固定）はフローから外れている要素にだけ意味がある。
      // position 自体は snapshot 作成時（prepareElementDragOrigin）で確定済みなので
      // ここでは触らない（fixed の要素を absolute に書き換えて包含ブロックを変えないため）
      if (snapshot.canWritePosition) {
        element.style.left = `${next.left}px`;
        element.style.top = `${next.top}px`;
      }
      if (drives.width && !snapshot.widthInert) {
        element.style.width = `${next.width}px`;
        snapshot.wroteWidth = true;
      }
      if (drives.height && !snapshot.heightInert) {
        element.style.height = `${next.height}px`;
        snapshot.wroteHeight = true;
      }

      // 書いた結果が描画に反映されたかを1度だけ検査する
      verifyResizeEffect(snapshot, iframeDoc, next, drives);

      syncSelectionOverlayRects(iframeDoc);

      return true;
    },
    [resizeStateRef, createResizeSnapshot, verifyResizeEffect]
  );

  /**
   * ドラッグ対象の各要素と、その開始座標の組を返す
   * 単一選択も「要素1個の群」として同じ経路で扱い、選択数で意味が変わらないようにする
   */
  const getDragTargets = useCallback(
    (
      dragState: DragState
    ): { element: HTMLElement; origin: { left: number; top: number } }[] => {
      const elements =
        dragState.elements.length > 0
          ? dragState.elements
          : dragState.element
            ? [dragState.element]
            : [];

      return elements
        .map((element, i) => {
          const origin =
            dragState.origPositions[i] ??
            (i === 0
              ? { left: dragState.origLeft, top: dragState.origTop }
              : null);
          return origin ? { element, origin } : null;
        })
        .filter(
          (v): v is { element: HTMLElement; origin: { left: number; top: number } } =>
            v !== null
        );
    },
    []
  );

  /**
   * ドラッグの種類を決める
   *
   * [なぜ position で決めるか]
   * 従来は「選択数 > 1」と「レイアウトモード」で分岐していたため、
   * 既定のオートレイアウトモードでは 1個選ぶと ghost 並べ替えに入って
   * left/top を一切書かず（＝絶対配置の要素が動かない）、
   * 2個選ぶと自由移動になる、という一貫性のない状態になっていた。
   * 実際に何ができるかを決めるのは要素の computed position だけなので、それで判定する。
   * - absolute / fixed → left/top で自由移動（モードにも選択数にも依存しない）
   * - static など        → フローの中にいるので ghost で並べ替える
   */
  const resolveDragMode = useCallback(
    (): DragMode => {
      // [モード廃止] ドラッグは常に自由移動。
      // 以前は in-flow の要素を「ゴースト並べ替え」(ドロップ先へ再挿入)に振り分けていたが、
      // 開いた時の一括変換から漏れた要素がこれを踏むと、離した瞬間に別の場所へ
      // 再挿入されて「画面の外へ消える」ように見えていた。
      // in-flow の要素は動き始めに絶対配置へ倒して、同じ自由移動で扱う。
      return 'free';
    },
    []
  );

  /**
   * ドラッグ移動処理
   */
  const handleDrag = useCallback(
    (e: MouseEvent, iframeDoc: Document): boolean => {
      const dragState = dragStateRef.current;
      if (!dragState.isDragging || !dragState.element) {
        return false;
      }

      // 移動量をCSS座標へ割り戻す。基準は選択枠と同じ artboard のスケールに統一する
      const scale = getDragScale(iframeDoc);
      const rawDeltaX = (e.clientX - dragState.startX) / scale;
      const rawDeltaY = (e.clientY - dragState.startY) / scale;

      // クリックとドラッグの区別。閾値を超えた最初の1回だけ種類を決めてキャッシュする
      if (dragModeRef.current === null) {
        if (
          Math.abs(rawDeltaX) <= DRAG_START_THRESHOLD &&
          Math.abs(rawDeltaY) <= DRAG_START_THRESHOLD
        ) {
          return true;
        }
        dragModeRef.current = resolveDragMode();
      }

      // [モード廃止] ここにあった「ゴースト並べ替え」(フロー内の要素をドロップ先へ
      // 再挿入するオートレイアウトのドラッグ)は撤去した。in-flow の要素は下で
      // 絶対配置へ倒して自由移動する。並べ替えに入ると、離した位置のドロップ先へ
      // 要素が再挿入され「画面の外に消える」ように見えていた。

      // 自由移動。Shift の軸拘束は「押した瞬間」ではなく毎フレーム評価する
      const { dx, dy } = constrainAxis(rawDeltaX, rawDeltaY, e.shiftKey);

      // 動き出した最初の1回だけ、このドラッグの性格を決める。
      // オートレイアウト(flex)の子なら「並べ替え」、それ以外は従来どおり座標移動
      if (!dragState.hasMoved) {
        const targets = getDragTargets(dragState);
        const movingElements = targets.map((t) => t.element);
        const componentEdit = iframeDoc.body.classList.contains('component-edit-mode');

        // Cmd/Ctrl は「並べ替えから抜けて自由に動かす」逃げ道。
        // スナップの無効化と同じキーに揃える(押している間は座標がそのまま通る)
        const wantsFreeMove = e.metaKey || e.ctrlKey;

        if (
          !componentEdit &&
          !wantsFreeMove &&
          dragState.element &&
          shouldReorder(dragState.element, iframeDoc, movingElements.length)
        ) {
          // 並べ替え: 絶対配置へ倒さない。倒した瞬間にフレックスの設定が
          // 効かなくなり、右パネルのレイアウト指定が無意味になる
          reorderRef.current = startReorder(dragState.element, iframeDoc);
          reorderIndexRef.current = -1;
        }

        if (!reorderRef.current) {
          // in-flow の要素はここで初めて絶対配置へ変換する。
          // mousedown 時に変換すると、選んだだけで後続の兄弟が詰め上がって版面が動く。
          // コンポーネント編集中は変換しない(部品本来の並びを保つため)
          if (!componentEdit) {
            convertDragTargetsToAbsolute(targets, iframeDoc);
          }

          // スマートガイドの下ごしらえ。動き出した最初の1回だけ、
          // 「整列先の候補」と「動かす前の外接矩形」をアートボード座標で採る。
          // 以後のフレームは基準に delta を足すだけなので、要素数に関係なく軽い
          dragBaseRectRef.current = unionOverlayRect(iframeDoc, movingElements);
          guideCandidatesRef.current = collectGuideCandidates(iframeDoc, movingElements);
        }
      }

      dragState.hasMoved = true;

      // ── 並べ替えモード ──
      // 座標は一切書かない。DOMの順番だけを mouseup で変える。
      // 途中で並べ替えると掴んでいる要素が指の下から逃げるので、
      // ドラッグ中は「どこに入るか」を線で示すだけに留める
      const reorder = reorderRef.current;
      if (reorder) {
        const index = computeInsertIndex(reorder, e.clientX, e.clientY, iframeDoc);
        if (index !== reorder.lastIndex) {
          reorder.lastIndex = index;
          drawInsertIndicator(reorder, index, iframeDoc);
        }
        reorderIndexRef.current = index;
        return true;
      }

      // スナップ補正。Cmd/Ctrl を押している間は吸着しない(Figmaと同じ逃げ道)
      let snappedDx = dx;
      let snappedDy = dy;
      const candidates = guideCandidatesRef.current;
      const baseRect = dragBaseRectRef.current;
      if (!e.metaKey && !e.ctrlKey && candidates && baseRect) {
        // 吸着距離は「画面上で4px」。ズームで見た目の効きが変わらないよう割り戻す
        const threshold = SNAP_THRESHOLD_SCREEN_PX / (scale || 1);
        const snap = snapToGuides(
          candidates,
          {
            left: baseRect.left + dx,
            top: baseRect.top + dy,
            width: baseRect.width,
            height: baseRect.height,
          },
          threshold,
        );
        // 補正は delta として足す。origin(offsetLeft基準)とアートボード座標の
        // 原点がずれていても、差分なら基準の違いが打ち消し合う
        snappedDx = dx + snap.dx;
        snappedDy = dy + snap.dy;

        // Shift(軸拘束)中は、拘束した軸へスナップで動かさない。
        // constrainAxis が 0 にした側に補正を足すと、まっすぐ動かしたいのに
        // 斜めへずれる(拘束が破れる)
        let guideX = snap.guideX;
        let guideY = snap.guideY;
        if (e.shiftKey) {
          if (dx === 0) {
            snappedDx = 0;
            guideX = null;
          }
          if (dy === 0) {
            snappedDy = 0;
            guideY = null;
          }
        }
        drawSmartGuides(iframeDoc, guideX, guideY);
      } else {
        clearSmartGuides(iframeDoc);
      }

      // 単一選択も複数選択も、全要素に「同一の delta」を加算する（群ごと移動）。
      // origin は mousedown 時に offsetLeft/offsetTop で採ってあり、
      // 書き込む直前に Math.round を通すので、要素ごとに移動量がズレない。
      getDragTargets(dragState).forEach(({ element, origin }) => {
        element.classList.add('dragging');
        element.style.left = `${roundPx(origin.left + snappedDx)}px`;
        element.style.top = `${roundPx(origin.top + snappedDy)}px`;
      });

      // 移動中の X, Y をサイズラベルと同じ場所に出す(Figmaと同じ)
      if (baseRect) {
        setOverlayLabel(
          `${Math.round(baseRect.left + snappedDx)}, ${Math.round(baseRect.top + snappedDy)}`,
        );
      }

      // 選択枠（各要素の枠 + 群バウンディングボックス）を要素に追従させる。
      // 枠を作り直さず位置だけ同期するので、掴んでいるハンドルやパンくずの
      // イベントリスナーが失われない
      syncSelectionOverlayRects(iframeDoc);

      return true;
    },
    // zoomはzoomRefで参照するため依存配列から除外
    [dragStateRef, getDragScale, getDragTargets, resolveDragMode]
  );

  /**
   * ドラッグ中の操作を取り消して開始位置へ戻す
   *
   * Esc のキーバインドはここでは張らない（keydown の経路を1本に保つため）。
   * 呼び出し側（キーボード担当）から使えるように公開だけする。
   */
  const cancelDrag = useCallback(
    (iframeDoc?: Document | null): boolean => {
      const dragState = dragStateRef.current;
      if (!dragState.isDragging || !dragState.element) return false;

      const doc = iframeDoc ?? dragState.element.ownerDocument;
      if (!doc) return false;

      // 並べ替え中の取り消し: DOMの順番はまだ変えていないので、
      // 持ち上げの見た目と線を戻すだけで元の状態に戻る
      if (reorderRef.current) {
        endReorder(reorderRef.current, doc);
        resetDragState();
        refreshSelectionOverlay(doc);
        return true;
      }

      if (autoLayoutDragStateRef.current) {
        // ゴースト並べ替え中：DOMの並びは変えずにゴーストだけ畳む
        cancelAutoLayoutDrag(autoLayoutDragStateRef.current, doc);
        autoLayoutDragStateRef.current = null;
        hideFlexDropIndicator(doc);
      } else {
        // 自由移動中：開始座標へ戻す
        getDragTargets(dragState).forEach(({ element, origin }) => {
          element.classList.remove('dragging');
          element.style.left = `${roundPx(origin.left)}px`;
          element.style.top = `${roundPx(origin.top)}px`;
        });
      }

      // ガイド線と X, Y バッジは操作の道具なので、取り消しでも必ず片付ける
      clearSmartGuides(doc);
      setOverlayLabel(null);

      // 取り消しなので SLIDE_CONTENT_CHANGED は送らない（履歴を汚さない）
      resetDragState();
      refreshSelectionOverlay(doc);
      return true;
    },
    [dragStateRef, getDragTargets, resetDragState]
  );

  /**
   * ドラッグ・リサイズのマウス移動処理
   */
  const handleDragResizeMouseMove = useCallback(
    (e: MouseEvent, iframeDoc: Document): boolean => {
      // 回転中
      if (handleRotation(e, iframeDoc)) {
        return true;
      }

      // リサイズ中
      const resizeState = resizeStateRef.current;
      if (resizeState.isResizing && resizeState.element) {
        // 移動量をCSS座標へ割り戻す。基準は選択枠と同じ artboard のスケールに統一する
        const scale = getDragScale(iframeDoc);
        const deltaX = (e.clientX - resizeState.startX) / scale;
        const deltaY = (e.clientY - resizeState.startY) / scale;

        // 修飾キーは毎フレーム読む（押し直し・離しに即応させるため）
        // プロパティパネルの縦横比ロックは「Shift を押しっぱなし」と同義なので、
        // 別フラグを足さずに shiftKey へ畳み込む（従属軸を書く判定もそのまま効かせるため）。
        // ロック状態は React state ではなく関数で読む（このハンドラは古い値を掴むため）。
        const mods = {
          shiftKey: e.shiftKey || isAspectRatioLocked(),
          altKey: e.altKey,
        };

        // Scale Toolによるリサイズ
        if (handleScaleResize(e, iframeDoc, deltaX, deltaY)) {
          return true;
        }

        // 複数要素のリサイズ
        if (handleMultiElementResize(iframeDoc, deltaX, deltaY, mods)) {
          return true;
        }

        // 単一要素のリサイズ
        if (handleSingleElementResize(iframeDoc, deltaX, deltaY, mods)) {
          return true;
        }
      }

      // ドラッグ中
      if (handleDrag(e, iframeDoc)) {
        return true;
      }

      return false;
    },
    [
      handleRotation,
      handleScaleResize,
      handleMultiElementResize,
      handleSingleElementResize,
      handleDrag,
      resizeStateRef,
      getDragScale,
      // zoomはzoomRefで参照するため依存配列から除外
    ]
  );

  /**
   * ドラッグ・リサイズのマウスアップ処理
   */
  const handleDragResizeMouseUp = useCallback(
    (iframeDoc: Document): boolean => {
      const resizeState = resizeStateRef.current;
      const dragState = dragStateRef.current;

      // 回転終了
      if (resizeState.isRotating && resizeState.element) {
        iframeDoc.body.classList.remove('rotating');
        setOverlayLabel(null);

        window.postMessage(
          {
            type: 'SLIDE_CONTENT_CHANGED',
            html: getArtboardContent(iframeDoc),
          },
          '*'
        );

        sendElementInfo(resizeState.element, iframeDoc);
        refreshSelectionOverlay(iframeDoc);
        resetResizeState();
        return true;
      }

      // リサイズ終了
      if (resizeState.isResizing && resizeState.element) {
        // インラインスタイルをTailwindクラスに変換
        // リサイズ中はパフォーマンスのためインラインスタイルを使用し、
        // 終了時にTailwindクラスに変換する
        const resizeProperties = ['width', 'height', 'left', 'top', 'borderRadius'];
        if (resizeState.elements && resizeState.elements.length > 0) {
          resizeState.elements.forEach((el) => {
            convertInlineStylesToTailwind(el, resizeProperties);
          });
        } else {
          convertInlineStylesToTailwind(resizeState.element, resizeProperties);
        }

        window.postMessage(
          {
            type: 'SLIDE_CONTENT_CHANGED',
            html: getArtboardContent(iframeDoc),
          },
          '*'
        );

        // 複数選択時は全要素の情報を送信
        if (resizeState.elements && resizeState.elements.length > 0) {
          resizeState.elements.forEach((el) =>
            sendElementInfo(el, iframeDoc)
          );
        } else {
          sendElementInfo(resizeState.element, iframeDoc);
        }

        // Tailwindクラスへの丸め込みで実寸がわずかに変わるため、
        // 変換後に選択セット全体から枠を作り直して再同期する
        refreshSelectionOverlay(iframeDoc);

        // 枠を作り直すと「効かないハンドル」の印が消える。
        // 操作をやめた後も操作不能であることが分かるように付け直す
        const snapshot = resizeSnapshotRef.current;
        if (snapshot && (snapshot.widthInert || snapshot.heightInert)) {
          markResizeInert(snapshot.element, iframeDoc, {
            width: snapshot.widthInert,
            height: snapshot.heightInert,
          });
        }

        resetResizeState();
        return true;
      }

      // ドラッグ終了
      if (dragState.isDragging && dragState.element) {
        // ガイド線は #artboard 直下にあり、getArtboardContent は innerHTML を
        // そのまま返す。SLIDE_CONTENT_CHANGED を送る前に必ず消す
        clearSmartGuides(iframeDoc);
        setOverlayLabel(null);

        // ── 並べ替えの確定 ──
        // 座標(left/top)は書いていないので Tailwind への変換は通さない。
        // 変わったのは DOM の順番だけで、それは innerHTML にそのまま出る
        const reorder = reorderRef.current;
        if (reorder) {
          const changed = commitReorder(reorder, reorderIndexRef.current, iframeDoc);
          reorderRef.current = null;
          reorderIndexRef.current = -1;
          dragState.element.classList.remove('dragging');

          if (changed) {
            window.postMessage(
              {
                type: 'SLIDE_CONTENT_CHANGED',
                html: getArtboardContent(iframeDoc),
              },
              '*',
            );
          }
          // 並べ替えで要素の位置が変わるので、枠は作り直して合わせる
          refreshSelectionOverlay(iframeDoc);
          sendElementInfo(dragState.element, iframeDoc);
          resetDragState();
          return true;
        }

        // [モード廃止] ゴースト並べ替えのドロップ確定はここにあったが、
        // ドラッグが常に自由移動になったため撤去した。

        // [モード廃止] 旧flex並べ替え(flexReorderMode)もここにあったが、
        // これを立てるコードはもう存在しないため撤去した。

        // 通常のドラッグ終了処理
        // 複数選択時は全要素のdraggingクラスを削除
        if (dragState.elements.length > 1) {
          dragState.elements.forEach((el) => el.classList.remove('dragging'));
        } else {
          dragState.element.classList.remove('dragging');
        }

        // インラインスタイルをTailwindクラスに変換
        // ドラッグ中はパフォーマンスのためインラインスタイルを使用し、
        // 終了時にTailwindクラスに変換する
        if (dragState.hasMoved) {
          const dragProperties = ['left', 'top'];
          if (dragState.elements.length > 1) {
            dragState.elements.forEach((el) => {
              convertInlineStylesToTailwind(el, dragProperties);
            });
          } else {
            convertInlineStylesToTailwind(dragState.element, dragProperties);
          }

          window.postMessage(
            {
              type: 'SLIDE_CONTENT_CHANGED',
              html: getArtboardContent(iframeDoc),
            },
            '*'
          );
        }

        // [重要] convertInlineStylesToTailwind は left/top を `left-[142px]` のような
        // クラスへ丸め込むため、要素の実描画位置がわずかに変わる。
        // 変換後に選択セット全体から枠を作り直さないと、枠が古い位置に残る。
        refreshSelectionOverlay(iframeDoc);

        sendElementInfo(dragState.element, iframeDoc);
        resetDragState();
        return true;
      }

      return false;
    },
    [
      resizeStateRef,
      dragStateRef,
      sendElementInfo,
      resetResizeState,
      resetDragState,
      markResizeInert,
    ]
  );

  return {
    handleDragResizeMouseMove,
    handleDragResizeMouseUp,
    sendElementInfo,
    resetDragState,
    resetResizeState,
    cancelDrag,
  };
}
