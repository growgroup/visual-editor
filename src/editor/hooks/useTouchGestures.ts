/**
 * キャンバス(iframe)側のホイール/タッチジェスチャー処理フック
 * - Ctrl/Cmd + ホイール → 親の useCanvasControls にズームを依頼
 * - Shift + ホイール → 横スクロール（パン）
 * - ピンチズーム（2本指）→ 親の useCanvasControls にズームを依頼
 * - Safari の gesture イベントの抑止
 *
 * [移植時の修正]
 * 以前はここで iframe ビューポート座標を親ウィンドウ座標に変換してから
 * postMessage し、受け手の useCanvasControls が再び iframe 座標へ戻していた。
 * 往復で2回とも iframeRef の実測に依存するうえ、どちらの座標系の値なのかが
 * 名前から読み取れず、ズーム中心のずれの温床になっていた。
 * 現在は **iframe ビューポート座標のまま** 送る（受け手もその前提）。
 */

import { useCallback, useRef } from 'react';
import { useEditorContext } from '../EditorContext';

/**
 * 2点間の距離を計算
 */
function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 2点の中心座標を計算
 */
function getTouchCenter(touches: TouchList): { x: number; y: number } {
  if (touches.length < 2) {
    return { x: touches[0].clientX, y: touches[0].clientY };
  }
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

/**
 * ホイールの delta を CSS ピクセル相当に正規化する。
 * deltaMode は 0=px / 1=行 / 2=ページ。デバイスによって単位が違うので揃える。
 */
function normalizeDelta(value: number, deltaMode: number): number {
  if (deltaMode === 1) return value * 16;
  if (deltaMode === 2) return value * 100;
  return value;
}

interface UseTouchGesturesReturn {
  /**
   * iframe ドキュメントにホイール/タッチジェスチャーリスナーをセットアップ
   * @returns クリーンアップ関数
   */
  setupTouchGestureListeners: (iframeDoc: Document) => () => void;
}

/**
 * ホイール/タッチジェスチャー処理フック
 *
 * iframe内のイベントを処理し、ズームは親ウィンドウの useCanvasControls に
 * postMessage で転送する（ズーム倍率の一元管理は親側の state が持つため）。
 */
export function useTouchGestures(): UseTouchGesturesReturn {
  useEditorContext();

  // ピンチズーム用の状態（クロージャ問題を避けるためrefを使用）
  const lastTouchDistanceRef = useRef<number | null>(null);

  const setupTouchGestureListeners = useCallback((iframeDoc: Document) => {
    // タッチアクションを無効化（ブラウザのデフォルトズームを防止）
    iframeDoc.documentElement.style.touchAction = 'none';
    iframeDoc.body.style.touchAction = 'none';

    /**
     * ホイール処理
     * - Ctrl/Cmd + ホイール: ズーム（親に転送）
     * - Shift + ホイール: 横スクロール
     * - それ以外: #canvas-container のネイティブスクロールに任せる
     */
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 座標は iframe ビューポート基準のまま送る
        window.postMessage(
          {
            type: 'IFRAME_WHEEL_EVENT',
            deltaY: normalizeDelta(e.deltaY, e.deltaMode),
            clientX: e.clientX,
            clientY: e.clientY,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
          },
          '*'
        );
        return;
      }

      // Shift + ホイールで横スクロール。
      // 合成イベントや一部デバイスではブラウザが縦→横の読み替えをしてくれないので、
      // deltaX が来ていないときだけ自前で横に流す（「無反応」を作らないため）。
      if (e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
        const container = iframeDoc.getElementById('canvas-container');
        if (container) {
          e.preventDefault();
          container.scrollLeft += normalizeDelta(e.deltaY, e.deltaMode);
        }
      }
    };

    /**
     * Safari gestureイベントを防止
     */
    const handleGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    /**
     * 2本指タッチ開始時の処理
     */
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        lastTouchDistanceRef.current = getTouchDistance(e.touches);
      }
    };

    /**
     * 2本指タッチ移動時の処理（ピンチズーム）
     */
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (lastTouchDistanceRef.current !== null) {
          const currentDistance = getTouchDistance(e.touches);
          const center = getTouchCenter(e.touches);

          // 座標は iframe ビューポート基準のまま送る
          window.postMessage(
            {
              type: 'IFRAME_PINCH_EVENT',
              previousDistance: lastTouchDistanceRef.current,
              currentDistance,
              centerX: center.x,
              centerY: center.y,
            },
            '*'
          );

          lastTouchDistanceRef.current = currentDistance;
        }
      }
    };

    /**
     * タッチ終了時の処理
     */
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastTouchDistanceRef.current = null;
      }
    };

    // イベントリスナーを登録
    const options = { passive: false, capture: true };
    iframeDoc.addEventListener('wheel', handleWheel, options);
    iframeDoc.addEventListener('gesturestart', handleGesture, options);
    iframeDoc.addEventListener('gesturechange', handleGesture, options);
    iframeDoc.addEventListener('gestureend', handleGesture, options);
    iframeDoc.addEventListener('touchstart', handleTouchStart, options);
    iframeDoc.addEventListener('touchmove', handleTouchMove, options);
    iframeDoc.addEventListener('touchend', handleTouchEnd, options);
    iframeDoc.addEventListener('touchcancel', handleTouchEnd, options);

    // クリーンアップ関数を返す
    return () => {
      iframeDoc.removeEventListener('wheel', handleWheel, options);
      iframeDoc.removeEventListener('gesturestart', handleGesture, options);
      iframeDoc.removeEventListener('gesturechange', handleGesture, options);
      iframeDoc.removeEventListener('gestureend', handleGesture, options);
      iframeDoc.removeEventListener('touchstart', handleTouchStart, options);
      iframeDoc.removeEventListener('touchmove', handleTouchMove, options);
      iframeDoc.removeEventListener('touchend', handleTouchEnd, options);
      iframeDoc.removeEventListener('touchcancel', handleTouchEnd, options);
    };
  }, []);

  return {
    setupTouchGestureListeners,
  };
}
