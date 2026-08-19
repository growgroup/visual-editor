/**
 * マルチアートボードのグリッドレイアウト計算ユーティリティ
 */

import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../constants';

export interface ArtboardPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

export interface GridLayoutConfig {
  /** アートボードの幅 */
  artboardWidth: number;
  /** アートボードの高さ */
  artboardHeight: number;
  /** アートボード間の水平方向の間隔 */
  horizontalGap: number;
  /** アートボード間の垂直方向の間隔 */
  verticalGap: number;
  /** 1行あたりの最大アートボード数 */
  columnsPerRow: number;
  /** キャンバスの左パディング */
  paddingLeft: number;
  /** キャンバスの上パディング */
  paddingTop: number;
}

const DEFAULT_GRID_CONFIG: GridLayoutConfig = {
  artboardWidth: SLIDE_WIDTH,
  artboardHeight: SLIDE_HEIGHT,
  horizontalGap: 100,
  verticalGap: 100,
  columnsPerRow: 3,
  paddingLeft: 200,
  paddingTop: 200,
};

/**
 * アートボードIDの配列からグリッド位置を計算
 */
export function calculateGridPositions(
  artboardIds: string[],
  config: Partial<GridLayoutConfig> = {}
): ArtboardPosition[] {
  const cfg = { ...DEFAULT_GRID_CONFIG, ...config };

  return artboardIds.map((id, index) => {
    const row = Math.floor(index / cfg.columnsPerRow);
    const col = index % cfg.columnsPerRow;

    const x = cfg.paddingLeft + col * (cfg.artboardWidth + cfg.horizontalGap);
    const y = cfg.paddingTop + row * (cfg.artboardHeight + cfg.verticalGap);

    return {
      id,
      x,
      y,
      width: cfg.artboardWidth,
      height: cfg.artboardHeight,
      row,
      col,
    };
  });
}

/**
 * すべてのアートボードを含む境界ボックスを計算
 */
export function getContentBounds(
  positions: ArtboardPosition[],
  padding: number = 200
): { width: number; height: number; minX: number; minY: number; maxX: number; maxY: number } {
  if (positions.length === 0) {
    return { width: 0, height: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  positions.forEach(pos => {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  });

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * 指定した座標がどのアートボード上にあるかを判定
 */
export function getArtboardAtPosition(
  positions: ArtboardPosition[],
  x: number,
  y: number
): ArtboardPosition | null {
  for (const pos of positions) {
    if (
      x >= pos.x &&
      x <= pos.x + pos.width &&
      y >= pos.y &&
      y <= pos.y + pos.height
    ) {
      return pos;
    }
  }
  return null;
}

/**
 * ズームレベルに基づいてスクロール可能な領域サイズを計算
 */
export function calculateScrollableArea(
  bounds: ReturnType<typeof getContentBounds>,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  const scale = zoom / 100;
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;

  return {
    width: Math.max(scaledWidth, viewportWidth),
    height: Math.max(scaledHeight, viewportHeight),
  };
}

/**
 * 特定のアートボードを中央に表示するためのスクロール位置を計算
 */
export function calculateScrollToArtboard(
  position: ArtboardPosition,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { scrollX: number; scrollY: number } {
  const scale = zoom / 100;

  // アートボードの中心座標
  const centerX = (position.x + position.width / 2) * scale;
  const centerY = (position.y + position.height / 2) * scale;

  // ビューポートの中央にアートボードの中心が来るようにスクロール
  return {
    scrollX: centerX - viewportWidth / 2,
    scrollY: centerY - viewportHeight / 2,
  };
}

/**
 * フィットズームを計算（全アートボードがビューポート内に収まるように）
 */
export function calculateFitAllZoom(
  bounds: ReturnType<typeof getContentBounds>,
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number = 10,
  maxZoom: number = 200
): number {
  if (bounds.width === 0 || bounds.height === 0) {
    return 100;
  }

  const scaleX = viewportWidth / bounds.width;
  const scaleY = viewportHeight / bounds.height;
  const scale = Math.min(scaleX, scaleY);

  const zoom = Math.floor(scale * 100);
  return Math.max(minZoom, Math.min(maxZoom, zoom));
}

/**
 * 単一アートボードにフィットするズームを計算
 */
export function calculateFitSingleZoom(
  artboardWidth: number,
  artboardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 64,
  minZoom: number = 10,
  maxZoom: number = 200
): number {
  const availableWidth = viewportWidth - padding;
  const availableHeight = viewportHeight - padding;

  const scaleX = availableWidth / artboardWidth;
  const scaleY = availableHeight / artboardHeight;
  const scale = Math.min(scaleX, scaleY);

  const zoom = Math.floor(scale * 100);
  return Math.max(minZoom, Math.min(maxZoom, zoom));
}
