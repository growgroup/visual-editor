/**
 * マーキー選択（範囲選択）処理フック
 * - ドラッグによる複数要素の範囲選択
 * - 閾値ベースのアクティベーション
 * - リアルタイムホバープレビュー
 * - Ctrl/Cmd+クリックでのリーフ選択
 */

import { useCallback, useRef, useEffect, MutableRefObject } from 'react';
import { useEditorContext } from '../EditorContext';
import {
  refreshSelectionOverlay,
  createMarqueeBox,
  updateMarqueeBox,
  hideMarqueeBox,
  getMarqueeBounds,
} from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import { MARQUEE_DRAG_THRESHOLD } from '../constants';
import type { MarqueeState } from '../types';

interface UseMarqueeSelectionOptions {
  /** マーキー選択の開始保留フラグ */
  marqueeStartPendingRef: MutableRefObject<boolean>;
  /** マーキークリック対象の要素 */
  marqueeClickTargetRef: MutableRefObject<HTMLElement | null>;
  /** Shift+マーキー（既存選択への加算）かどうか */
  marqueeAdditiveRef?: MutableRefObject<boolean>;
  /**
   * マーキー矩形の同期的な保持先（mousedown 側と共有）。
   * React state は反映が1レンダ遅れるため、速いドラッグでは
   * 始点が (0,0) のまま読まれて矩形がずれる／確定処理が走らない。
   */
  marqueeGeomRef?: MutableRefObject<MarqueeState>;
}

/**
 * マーキー矩形と「交差」する要素のIDを集める
 *
 * [なぜ完全包含をやめたか]
 * dom-utils の findElementsInMarquee は完全包含判定なので、
 * 要素をまたぐ帯（横一直線のドラッグ）では何も選ばれなかった。
 * Figma と同じく交差判定にする。
 * ※ dom-utils は他の修正項目と共有しているため、ここにローカル実装を置く。
 */
function findElementsIntersectingMarquee(
  iframeDoc: Document,
  marquee: { left: number; top: number; right: number; bottom: number }
): HTMLElement[] {
  const result: HTMLElement[] = [];
  iframeDoc.querySelectorAll<HTMLElement>('[data-element-id]').forEach((el) => {
    if (
      el.classList.contains('selection-box') ||
      el.classList.contains('marquee-selection-box') ||
      el.classList.contains('drawing-preview') ||
      el.closest('.selection-box')
    ) {
      return;
    }
    const rect = el.getBoundingClientRect();
    // 面積0の要素（非表示・空ラッパー）は拾わない
    if (rect.width <= 0 || rect.height <= 0) return;
    const intersects =
      rect.left < marquee.right &&
      rect.right > marquee.left &&
      rect.top < marquee.bottom &&
      rect.bottom > marquee.top;
    if (intersects) result.push(el);
  });
  return result;
}

/**
 * 選択結果を「最上位ノードのみ」に畳む
 *
 * [なぜ必要か]
 * 交差判定にすると、カード1枚を囲んだだけでその中の子孫まで全部入り
 * （実測40件・ハンドル520個）、群バウンディングボックスも群ドラッグも破綻する。
 * 祖先が入っているなら子孫は落とす。
 * ※ dom-utils の collapseToParentIfAllChildrenSelected は
 *   「全ての子が選択されたときだけ親に畳む」別のルールなので使わない。
 */
function collapseToTopMost(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el))
  );
}

interface UseMarqueeSelectionReturn {
  /** マーキーボックスのref */
  marqueeBoxRef: MutableRefObject<HTMLDivElement | null>;

  /**
   * マーキー選択のマウス移動処理
   * @returns true if marquee was handled, false otherwise
   */
  handleMarqueeMouseMove: (e: MouseEvent, iframeDoc: Document) => boolean;

  /**
   * マーキー選択のマウスアップ処理
   * @returns true if marquee was handled, false otherwise
   */
  handleMarqueeMouseUp: (iframeDoc: Document) => boolean;

  /**
   * マーキーボックスを初期化（iframeロード時に呼ぶ）
   */
  initMarqueeBox: (iframeDoc: Document) => void;
}

/**
 * マーキー選択処理フック
 */
export function useMarqueeSelection(
  options: UseMarqueeSelectionOptions
): UseMarqueeSelectionReturn {
  const {
    marqueeState,
    setMarqueeState,
    setSelectedElementIds,
  } = useEditorContext();

  const {
    marqueeStartPendingRef,
    marqueeClickTargetRef,
    marqueeAdditiveRef,
    marqueeGeomRef,
  } = options;

  // マーキーボックスのref
  const marqueeBoxRef = useRef<HTMLDivElement | null>(null);

  // クロージャ問題回避のためのref
  const fallbackGeomRef = useRef<MarqueeState>(marqueeState);
  // 判定に使う矩形は同期 ref を正とする（共有 ref が無い場合のみ state 追従にフォールバック）
  const marqueeStateRef = marqueeGeomRef ?? fallbackGeomRef;
  const setMarqueeStateRef = useRef(setMarqueeState);
  const setSelectedElementIdsRef = useRef(setSelectedElementIds);

  // refを最新値に同期（フォールバック用。共有 ref を使うときは同期書き込みが優先される）
  useEffect(() => {
    if (!marqueeGeomRef) fallbackGeomRef.current = marqueeState;
  }, [marqueeState, marqueeGeomRef]);

  useEffect(() => {
    setMarqueeStateRef.current = setMarqueeState;
    setSelectedElementIdsRef.current = setSelectedElementIds;
  }, [setMarqueeState, setSelectedElementIds]);

  /**
   * 要素情報を親ウィンドウに送信
   */
  const sendElementInfo = useCallback((element: HTMLElement, iframeDoc: Document) => {
    const info = extractElementInfo(element, iframeDoc);
    if (info) {
      window.postMessage({ type: 'ELEMENT_SELECTED', element: info }, '*');
    }
  }, []);

  /**
   * マーキーボックスを初期化
   */
  const initMarqueeBox = useCallback((iframeDoc: Document) => {
    if (!marqueeBoxRef.current) {
      marqueeBoxRef.current = createMarqueeBox(iframeDoc);
    }
  }, []);

  /**
   * マーキー選択のマウス移動処理
   */
  const handleMarqueeMouseMove = useCallback(
    (e: MouseEvent, iframeDoc: Document): boolean => {
      const currentMarqueeState = marqueeStateRef.current;
      if (!marqueeStartPendingRef.current && !currentMarqueeState.isActive) {
        return false;
      }

      const dx = Math.abs(e.clientX - currentMarqueeState.startX);
      const dy = Math.abs(e.clientY - currentMarqueeState.startY);

      // ペンディング状態で閾値超え → アクティブに
      if (
        marqueeStartPendingRef.current &&
        (dx > MARQUEE_DRAG_THRESHOLD || dy > MARQUEE_DRAG_THRESHOLD)
      ) {
        marqueeStartPendingRef.current = false;
        // 同期 ref を先に立てる。ここが React state だけだと、
        // 反映前に mouseup が来て「マーキーではなくクリック」と誤判定される
        currentMarqueeState.isActive = true;
        setMarqueeStateRef.current((prev) => ({ ...prev, isActive: true }));
        // マーキー中はホバー予告を止める（輪郭が踊るのを防ぐ）
        iframeDoc.body.classList.add('marquee-active');
      }

      const isNowActive =
        !marqueeStartPendingRef.current &&
        (currentMarqueeState.isActive ||
          dx > MARQUEE_DRAG_THRESHOLD ||
          dy > MARQUEE_DRAG_THRESHOLD);

      if (isNowActive) {
        // 状態を更新（同期 ref → React state の順）
        currentMarqueeState.isActive = true;
        currentMarqueeState.currentX = e.clientX;
        currentMarqueeState.currentY = e.clientY;
        setMarqueeStateRef.current((prev) => ({
          ...prev,
          isActive: true,
          currentX: e.clientX,
          currentY: e.clientY,
        }));

        // マーキーボックスを更新
        if (marqueeBoxRef.current) {
          updateMarqueeBox(
            marqueeBoxRef.current,
            currentMarqueeState.startX,
            currentMarqueeState.startY,
            e.clientX,
            e.clientY
          );
        }

        // リアルタイムで選択状態をプレビュー
        // 交差 → 最上位のみに畳む、で mouseup 時とまったく同じ結果を出す
        const bounds = getMarqueeBounds({
          isActive: true,
          startX: currentMarqueeState.startX,
          startY: currentMarqueeState.startY,
          currentX: e.clientX,
          currentY: e.clientY,
        });
        const hovered = new Set(
          collapseToTopMost(findElementsIntersectingMarquee(iframeDoc, bounds))
        );

        // 全要素のホバー状態を更新
        iframeDoc.querySelectorAll('[data-element-id]').forEach((el) => {
          const htmlEl = el as HTMLElement;
          if (hovered.has(htmlEl)) {
            htmlEl.classList.add('marquee-hover');
          } else {
            htmlEl.classList.remove('marquee-hover');
          }
        });
      }

      return true;
    },
    [marqueeStartPendingRef]
  );

  /**
   * マーキー選択のマウスアップ処理
   */
  const handleMarqueeMouseUp = useCallback(
    (iframeDoc: Document): boolean => {
      const currentMarqueeState = marqueeStateRef.current;

      // マーキー選択完了
      if (currentMarqueeState.isActive) {
        // ホバー状態をクリア
        iframeDoc
          .querySelectorAll('.marquee-hover')
          .forEach((el) => el.classList.remove('marquee-hover'));
        iframeDoc.body.classList.remove('marquee-active');

        const additive = marqueeAdditiveRef?.current === true;
        const bounds = getMarqueeBounds(currentMarqueeState);

        // Shift+マーキーは既存選択への加算。
        // 加算してから畳むことで、祖先と子孫が同時に残ることがない。
        const existing = additive
          ? Array.from(
              iframeDoc.querySelectorAll<HTMLElement>(
                '[data-element-id].selected'
              )
            )
          : [];
        const hit = findElementsIntersectingMarquee(iframeDoc, bounds);
        const merged = collapseToTopMost(
          Array.from(new Set<HTMLElement>([...existing, ...hit]))
        );

        // 既存の選択をクリアしてから、畳んだ結果を適用する
        iframeDoc
          .querySelectorAll('.selected')
          .forEach((el) => el.classList.remove('selected'));
        merged.forEach((el) => el.classList.add('selected'));

        // 枠は選択セット全体から作り直す。
        // 複数選択のときはここで群バウンディングボックスも描かれる
        // （1要素ずつ updateSelectionBox すると群枠が出ない）
        refreshSelectionOverlay(iframeDoc);

        const selectedIds = merged
          .map((el) => el.getAttribute('data-element-id') || '')
          .filter(Boolean);
        setSelectedElementIdsRef.current(selectedIds);

        if (merged.length > 0) {
          sendElementInfo(merged[0], iframeDoc);
        } else {
          window.postMessage({ type: 'ELEMENT_DESELECTED' }, '*');
        }

        console.log(
          '[Canvas] Marquee selected',
          selectedIds.length,
          additive ? '(additive)' : '',
          selectedIds
        );

        // マーキーボックスを非表示
        if (marqueeBoxRef.current) {
          hideMarqueeBox(marqueeBoxRef.current);
        }

        // 状態リセット
        marqueeClickTargetRef.current = null;
        if (marqueeAdditiveRef) marqueeAdditiveRef.current = false;
        // 同期 ref も必ず畳む（残っていると次のドラッグが古い矩形を引き継ぐ）
        Object.assign(marqueeStateRef.current, {
          isActive: false,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        });
        setMarqueeStateRef.current({
          isActive: false,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        });
        marqueeStartPendingRef.current = false;
        return true;
      }

      // 閾値未満で離した ＝ 空白の「クリック」。
      // 選択解除は mousedown 時点で済んでいる（Figma と同じ）ので、
      // ここでは保留状態を畳むだけ。
      if (marqueeStartPendingRef.current) {
        marqueeStartPendingRef.current = false;
        iframeDoc
          .querySelectorAll('.marquee-hover')
          .forEach((el) => el.classList.remove('marquee-hover'));
        iframeDoc.body.classList.remove('marquee-active');

        marqueeClickTargetRef.current = null;
        if (marqueeAdditiveRef) marqueeAdditiveRef.current = false;
        // 同期 ref も必ず畳む（残っていると次のドラッグが古い矩形を引き継ぐ）
        Object.assign(marqueeStateRef.current, {
          isActive: false,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        });
        setMarqueeStateRef.current({
          isActive: false,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        });
        return true;
      }

      return false;
    },
    [
      marqueeStartPendingRef,
      marqueeClickTargetRef,
      marqueeAdditiveRef,
      sendElementInfo,
    ]
  );

  return {
    marqueeBoxRef,
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
    initMarqueeBox,
  };
}
