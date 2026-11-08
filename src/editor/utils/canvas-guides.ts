/**
 * 定規から引いたガイド(キャンバス表示)の置き場。
 *
 * ページごとに、そのページの紙面の座標(アートボードの px)で持つ。保存はしない(読み込み直すと消える)。
 * 描くのは CanvasGuides、吸着の相手に加えるのは smart-guides の collectGuideCandidates。
 * 両者は別の木(殻とエディタ)にいるので、props ではなくこのモジュールで繋ぐ。
 * 吸着が見るのは「いま定規を出している、編集中のページ」のガイドだけ。
 */

export interface PageGuides {
  /** 縦のガイドの x(紙面の px) */
  xs: number[];
  /** 横のガイドの y(紙面の px) */
  ys: number[];
}

const EMPTY: PageGuides = { xs: [], ys: [] };
const byPage = new Map<string, PageGuides>();
const listeners = new Set<() => void>();
let activePageId: string | null = null;

export function getPageGuides(pageId: string | null): PageGuides {
  return (pageId && byPage.get(pageId)) || EMPTY;
}

export function setPageGuides(pageId: string, guides: PageGuides): void {
  byPage.set(pageId, guides);
  listeners.forEach((fn) => fn());
}

/** 定規を出している編集中のページ。定規を隠したら null(ガイドも見えないので吸着させない) */
export function setActiveGuidePage(pageId: string | null): void {
  activePageId = pageId;
}

/** 吸着の相手にするガイド(編集中のページのもの) */
export function getActiveCanvasGuides(): PageGuides {
  return getPageGuides(activePageId);
}

export function subscribeGuides(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
