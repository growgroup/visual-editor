"use client";

/**
 * Figma風UIの左パネル上段: プレビュー付きのページ切替。
 *
 * レイヤーツリーだけの左パネルでは「今どのページを触っているのか」「隣に何があるのか」が
 * 分からず、ページを移るのに一覧まで戻る必要があった。
 * PowerPoint風UIのサムネイルレール(PptThumbnails)と同じ考え方で、
 * デッキ(useDeck)の中身を DeckSlideRender で縮小描画する。
 *
 * 並べ替え・複製・削除まではここに載せない(PowerPoint風UIのレールが持つ)。
 * ここが担うのは「今のページの把握」と「ページの切替」だけ。
 */

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDeck } from '../../../components/viewer/useDeck';
import { DeckSlideRender } from '../../../components/DeckSlideRender';
import { flushAutoSave } from '../../autosave';

/**
 * スライド描画はメモ化する。パネル幅の変更や他ページの選択で親が再レンダーしても、
 * (page, template, edited) が同じReactツリーを組み直さないため
 */
const MemoSlideRender = memo(DeckSlideRender);

/** 行の内訳: 左右padding(8+8) + 番号列(16) + 間隔(6)。残りがサムネイルの実効幅 */
const ROW_CHROME_PX = 8 + 8 + 16 + 6;

export function PagesPanel({ page, height = '33vh' }: { page: number; height?: string }) {
  const deck = useDeck();
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  /**
   * サムネイルの実効幅。左パネルは幅を変えられるので、
   * 固定値で縮小すると幅を変えるたびに右と下へ隙間が出る。実測してから縮小率を決める
   */
  const [thumbWidth, setThumbWidth] = useState(0);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // プレビューはパネル幅いっぱいだと大きすぎる。上限を設けて余白はページ番号側に
    const measure = () => setThumbWidth(Math.min(128, Math.max(0, el.clientWidth - ROW_CHROME_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 編集中のページが視界の外にあると「今どこか」が分からないので追う
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page, deck.slides.length]);

  /** ページ切替。未保存があれば黙って保存してから移る(失敗したときだけ確認する) */
  const goto = async (n: number) => {
    if (n === page) return;
    if (!(await flushAutoSave())) {
      if (!window.confirm('保存に失敗しました。変更を破棄して移動しますか?')) return;
    }
    window.location.hash = `#/edit/${n}`;
  };

  return (
    <div
      ref={rootRef}
      data-pages-panel
      className="flex shrink-0 flex-col overflow-y-auto border-b border-[#444444] bg-[#2c2c2c]"
      style={{ height }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between bg-[#2c2c2c] px-2 py-1.5 text-[11px] font-medium text-gray-400">
        ページ
        <span className="tabular-nums text-gray-500">
          {page} / {deck.slides.length || '—'}
        </span>
      </div>
      {deck.slides.map((s, i) => {
        const n = i + 1;
        const current = n === page;
        return (
          <button
            key={s.id}
            ref={current ? currentRef : undefined}
            data-page-thumb={n}
            onClick={() => void goto(n)}
            className="flex w-full shrink-0 items-start gap-1.5 px-2 py-1 text-left"
            title={s.title ? `${n}. ${s.title}` : `${n}枚目`}
          >
            <span
              className="mt-0.5 w-4 shrink-0 text-right text-[10px] tabular-nums"
              style={{ color: current ? '#4fb8ff' : '#6b7280', fontWeight: current ? 700 : 400 }}
            >
              {n}
            </span>
            <span
              className="relative block aspect-video overflow-hidden rounded-[3px] bg-white"
              // w-full だとパネル幅に比例して巨大化する。実測幅(上限128px)で固定
              style={{
                width: thumbWidth || undefined,
                boxShadow: current ? '0 0 0 2px #0d99ff' : '0 0 0 1px #444444',
                opacity: s.hidden ? 0.45 : 1,
              }}
            >
              {thumbWidth > 0 && (
                <span
                  className="pointer-events-none absolute left-0 top-0 origin-top-left"
                  style={{ width: 1920, height: 1080, transform: `scale(${thumbWidth / 1920})` }}
                >
                  <MemoSlideRender page={n} template={s.template} edited={s.edited} />
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
