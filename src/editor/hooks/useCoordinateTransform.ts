/**
 * 座標変換フック
 * - iframe座標 → 親ウィンドウ座標
 * - クライアント座標 → キャンバス座標
 * - ズームを考慮した座標変換
 */

import { useCallback } from 'react';
import { useEditorContext } from '../EditorContext';

interface Point {
  x: number;
  y: number;
}

interface UseCoordinateTransformReturn {
  /**
   * iframe座標を親ウィンドウ座標に変換
   * iframeがフルスクリーンの場合、オフセットを加えるだけ
   */
  transformIframeToWindow: (clientX: number, clientY: number) => Point;

  /**
   * 親ウィンドウ座標をiframe座標に変換
   */
  transformWindowToIframe: (windowX: number, windowY: number) => Point;

  /**
   * クライアント座標をキャンバス座標に変換（ズーム考慮）
   * @param clientX クライアントX座標
   * @param clientY クライアントY座標
   * @param iframeDoc iframe のドキュメント
   * @returns キャンバス座標
   */
  transformToCanvasCoords: (
    clientX: number,
    clientY: number,
    iframeDoc: Document
  ) => Point;

  /**
   * キャンバス座標をクライアント座標に変換（ズーム考慮）
   */
  transformFromCanvasCoords: (
    canvasX: number,
    canvasY: number,
    iframeDoc: Document
  ) => Point;

  /**
   * 座標変換関数を作成（iframeDoc固定版）
   * handleIframeLoad内で使用する
   */
  createCoordinateTransformer: (iframeDoc: Document) => {
    toWindow: (clientX: number, clientY: number) => Point;
    toCanvas: (clientX: number, clientY: number) => Point;
    fromCanvas: (canvasX: number, canvasY: number) => Point;
  };
}

/**
 * 座標変換フック
 *
 * iframe内の座標と親ウィンドウ座標の相互変換、
 * およびキャンバス座標系の変換を提供する
 */
export function useCoordinateTransform(): UseCoordinateTransformReturn {
  const { iframeRef, zoom } = useEditorContext();

  /**
   * iframe座標を親ウィンドウ座標に変換
   */
  const transformIframeToWindow = useCallback(
    (clientX: number, clientY: number): Point => {
      const iframe = iframeRef.current;
      const iframeRect = iframe?.getBoundingClientRect();
      if (!iframeRect) return { x: clientX, y: clientY };

      // iframe 要素が外側の transform で縮んでいる(マルチフレーム)ときは実測の倍率で掛ける。
      // 単独表示では iframe は等倍なので 1
      const outerScale = iframeRect.width / (iframe!.clientWidth || iframeRect.width) || 1;
      return {
        x: iframeRect.left + clientX * outerScale,
        y: iframeRect.top + clientY * outerScale,
      };
    },
    [iframeRef]
  );

  /**
   * 親ウィンドウ座標をiframe座標に変換
   */
  const transformWindowToIframe = useCallback(
    (windowX: number, windowY: number): Point => {
      const iframe = iframeRef.current;
      const iframeRect = iframe?.getBoundingClientRect();
      if (!iframeRect) return { x: windowX, y: windowY };

      const outerScale = iframeRect.width / (iframe!.clientWidth || iframeRect.width) || 1;
      return {
        x: (windowX - iframeRect.left) / outerScale,
        y: (windowY - iframeRect.top) / outerScale,
      };
    },
    [iframeRef]
  );

  /**
   * クライアント座標をキャンバス座標に変換
   */
  const transformToCanvasCoords = useCallback(
    (clientX: number, clientY: number, iframeDoc: Document): Point => {
      const artboard = iframeDoc.getElementById('artboard');
      if (!artboard) return { x: clientX, y: clientY };

      const artboardRect = artboard.getBoundingClientRect();
      const scale = zoom / 100;

      return {
        x: (clientX - artboardRect.left) / scale,
        y: (clientY - artboardRect.top) / scale,
      };
    },
    [zoom]
  );

  /**
   * キャンバス座標をクライアント座標に変換
   */
  const transformFromCanvasCoords = useCallback(
    (canvasX: number, canvasY: number, iframeDoc: Document): Point => {
      const artboard = iframeDoc.getElementById('artboard');
      if (!artboard) return { x: canvasX, y: canvasY };

      const artboardRect = artboard.getBoundingClientRect();
      const scale = zoom / 100;

      return {
        x: canvasX * scale + artboardRect.left,
        y: canvasY * scale + artboardRect.top,
      };
    },
    [zoom]
  );

  /**
   * 座標変換関数のファクトリー（iframeDoc固定版）
   */
  const createCoordinateTransformer = useCallback(
    (iframeDoc: Document) => {
      const iframe = iframeRef.current;

      return {
        /**
         * iframe内のクライアント座標を親ウィンドウ座標に変換
         */
        toWindow: (clientX: number, clientY: number): Point => {
          const iframeRect = iframe?.getBoundingClientRect();
          if (!iframeRect) return { x: clientX, y: clientY };
          const outerScale = iframeRect.width / (iframe!.clientWidth || iframeRect.width) || 1;
          return {
            x: iframeRect.left + clientX * outerScale,
            y: iframeRect.top + clientY * outerScale,
          };
        },

        /**
         * クライアント座標をキャンバス座標に変換
         */
        toCanvas: (clientX: number, clientY: number): Point => {
          const artboard = iframeDoc.getElementById('artboard');
          if (!artboard) return { x: clientX, y: clientY };

          const artboardRect = artboard.getBoundingClientRect();
          const scale = zoom / 100;

          return {
            x: (clientX - artboardRect.left) / scale,
            y: (clientY - artboardRect.top) / scale,
          };
        },

        /**
         * キャンバス座標をクライアント座標に変換
         */
        fromCanvas: (canvasX: number, canvasY: number): Point => {
          const artboard = iframeDoc.getElementById('artboard');
          if (!artboard) return { x: canvasX, y: canvasY };

          const artboardRect = artboard.getBoundingClientRect();
          const scale = zoom / 100;

          return {
            x: canvasX * scale + artboardRect.left,
            y: canvasY * scale + artboardRect.top,
          };
        },
      };
    },
    [iframeRef, zoom]
  );

  return {
    transformIframeToWindow,
    transformWindowToIframe,
    transformToCanvasCoords,
    transformFromCanvasCoords,
    createCoordinateTransformer,
  };
}
