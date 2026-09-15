'use client';

/**
 * useKeepArtboardInPlace
 *
 * 1 ページ表示(マルチフレームでない EditorCanvas)で、キャンバスの容器の左端が動いても
 * 紙面を画面上の同じ位置に留める(Figma と同じ。見える範囲が狭くなるだけで、中身は動かない)。
 *
 * 左のパネルを出し入れする(部品パネルに替わる・幅をドラッグする・利用側のレールが変わるも同じ)と、
 * 容器(= iframe)の左端がパネルの幅だけ動く。紙面は iframe の中の #canvas-container のスクロールで
 * 置かれていて、その基準は iframe の左端なので、そのままでは紙面も一緒に動く。
 * 左端が動いた分だけ同じ向きへスクロールして打ち消す。
 *
 * 入口ごとには手当てせず、容器の位置の変化そのものを見る。左端は幅と一緒にしか動かないので
 * ResizeObserver で拾える。呼ばれるのはレイアウトの後・描画の前なので、ずれた姿は描かれない。
 *
 * [容器が広がったときのスクロール位置]
 * 広がるとスクロールできる上限が下がり、ブラウザはレイアウトの時点で(ResizeObserver より前に)
 * 位置を上限へ詰める。詰められる前の位置はもう読めないので、スクロールのたびに覚えておく。
 * 覚えるのは容器の幅が前回の ResizeObserver のときと同じ間だけ ── 幅が変わった後に届くスクロールは
 * 詰められた結果で、それを覚えると戻す先を失う
 *
 * マルチフレームのキャンバス(埋め込み)では使わない。位置はキャンバスの転写が持ち(MultiPageCanvasView)、
 * この容器は転写層の中でパンのたびに動く
 */

import { useEffect, useRef, type RefObject } from 'react';
import { scrollCanvasLeftTo } from '../utils/dom-utils';

interface Last {
  /** 容器の左端(親の画面の座標) */
  left: number;
  /** iframe の中の表示幅(documentElement.clientWidth)。スクロールを覚えてよいかの判定に使う */
  viewportWidth: number;
  /** #canvas-container の横のスクロール位置 */
  scrollLeft: number;
}

export function useKeepArtboardInPlace(
  containerRef: RefObject<HTMLDivElement | null>,
  getIframeDoc: () => Document | null,
  enabled: boolean,
  iframeReady: boolean,
): void {
  const lastRef = useRef<Last | null>(null);

  // 容器の位置
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const left = el.getBoundingClientRect().left;
      const doc = getIframeDoc();
      const scroller = doc?.getElementById('canvas-container') ?? null;
      const last = lastRef.current;
      if (doc && scroller && last && left !== last.left) {
        // 上限へ詰められていれば、覚えておいた位置から(詰められていなければ今の位置が正しい)
        const max = scroller.scrollWidth - scroller.clientWidth;
        const from = scroller.scrollLeft >= max - 1 && last.scrollLeft > scroller.scrollLeft ? last.scrollLeft : scroller.scrollLeft;
        scrollCanvasLeftTo(doc, from + (left - last.left));
      }
      lastRef.current = {
        left,
        viewportWidth: doc?.documentElement?.clientWidth ?? 0,
        scrollLeft: scroller?.scrollLeft ?? 0,
      };
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, containerRef, getIframeDoc]);

  // スクロール位置を覚える(文書ごと。ページを移ると iframe の文書が替わる)
  useEffect(() => {
    if (!enabled || !iframeReady) return;
    const doc = getIframeDoc();
    const scroller = doc?.getElementById('canvas-container');
    if (!doc || !scroller) return;
    const remember = () => {
      const last = lastRef.current;
      // ページを移る途中は文書が差し替わり、documentElement が無いことがある(⌘ クリックのリンク移動で実測)
      if (last && doc.documentElement && doc.documentElement.clientWidth === last.viewportWidth) last.scrollLeft = scroller.scrollLeft;
    };
    remember();
    scroller.addEventListener('scroll', remember, { passive: true });
    return () => scroller.removeEventListener('scroll', remember);
  }, [enabled, iframeReady, getIframeDoc]);
}
