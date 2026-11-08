"use client";

import { useEffect, useState, type RefObject } from 'react';

/** 先読みの幅。上下 1.5 画面分(速くスクロールしても白い枠が見えにくい) */
const NEAR_MARGIN = '150% 0px';

/**
 * スクロールする一覧で、画面に近づいた行のキーを集める(一度入ったキーは外さない)。
 *
 * サムネイルの一覧(PagesPanel・PptThumbnails)は 150 枚すべてを DeckSlideRender で描くと、
 * 読み込み直後の DOM 13,124 のうち 10,224・img 554 枚が一覧になり、利用側の io も 150 枚分の
 * 本文とテンプレートを取りに行く(ヘッドレス実測)。近い行だけ描けば済む。
 * 描かない行も同じ大きさの枠は呼び出し側で置くので、スクロールの高さと位置は変わらない。
 *
 * 行は `[data-row-key]` の要素で見分ける。並べ替えでも描いた行が描き直されないよう、キーはページ番号でなく slide の id にする。
 *
 * @param rootRef スクロールする箱
 * @param rowKeys 今並んでいる行のキー(増減・並べ替えで見直す)
 * @param initialKeys 最初から描く行(編集中のページ)
 * @param enabled false の間は見ない(行の大きさが決まる前に見ると遠くの行まで「近い」と出る)
 */
export function useRowsNearViewport(
  rootRef: RefObject<HTMLElement | null>,
  rowKeys: readonly string[],
  initialKeys: readonly string[],
  enabled = true,
): ReadonlySet<string> {
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set(initialKeys));
  const keysSignature = rowKeys.join('\n');

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled) return;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setNear(new Set(keysSignature.split('\n')));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const keys = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.rowKey ?? '');
        if (keys.length === 0) return;
        setNear((prev) => {
          if (keys.every((k) => prev.has(k))) return prev;
          const next = new Set(prev);
          keys.forEach((k) => next.add(k));
          return next;
        });
      },
      { root, rootMargin: NEAR_MARGIN },
    );
    // 見始めるのはレイアウトが落ち着いてから(読み込み直後は箱の高さが決まっておらず、すぐ見ると
    // 150 行中 70〜79 行が「近い」と出た。2 フレーム後なら 26 行)
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => root.querySelectorAll<HTMLElement>('[data-row-key]').forEach((el) => observer.observe(el)));
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [rootRef, keysSignature, enabled]);

  return near;
}
