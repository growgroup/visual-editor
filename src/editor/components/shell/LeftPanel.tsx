"use client";

/**
 * Figma風UIの左パネル。
 *
 * 既定は2段構成:
 *   上: ページ切替(PagesPanel。スライドのプレビュー付き)
 *   下: 現在ページのレイヤーツリー(EditorLayerPanel hideSlideList)
 *
 * `pagesSlot` を渡すと、その中身と レイヤーツリー をタブで出し分ける。
 * ページ一覧を利用側が持つ場合(Webページ・ページ数が固定のサイト等)に、
 * 左端へ独自パネルをもう1枚並べずに済ませるための口。左に2枚パネルが並ぶと
 * 「左=1枚 / 中央=キャンバス / 右=プロパティ」というFigmaの骨格が崩れる。
 *
 * 幅はこのラッパーが1本のハンドルで持つ。段ごとに幅・ハンドルを持たせると
 * 上下で幅が食い違ったり、リサイズが二重になったりするため。
 */

import { useState, type ReactNode } from 'react';
import { useEditorContext } from '../../EditorContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { EditorLayerPanel } from '../EditorLayerPanel';
import { PagesPanel } from './PagesPanel';
import { can } from '../../../io';

type LeftTab = 'pages' | 'layers';

export function LeftPanel({ page, pagesSlot }: { page: number; pagesSlot?: ReactNode }) {
  // 一覧のサムネイルは利用側が描く(io.renderContent)。描けないなら段ごと出さない。
  // Webページの用途ではページ切替を利用側のUIが持つことが多い
  const { editorMode } = useEditorContext();
  const showPages = can('renderContent') && editorMode !== 'webpage';
  const { width, isDragging, resizeHandleProps } = useResizablePanel({
    initialWidth: 256,
    minWidth: 180,
    maxWidth: 480,
    direction: 'right',
    storageKey: 'gg-editor:left-panel-width',
  });

  /**
   * 既定は「ページ」。レイヤーは要素を触りはじめてから使うもので、
   * 開いた直後に知りたいのは「どのページを見ているか」のため
   */
  const [tab, setTab] = useState<LeftTab>('pages');

  return (
    <div
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-[#444444] bg-[#2c2c2c]"
      style={{ width: `${width}px` }}
    >
      {pagesSlot ? (
        <>
          <div
            role="tablist"
            aria-label="左パネル"
            className="flex shrink-0 items-stretch gap-1 border-b border-[#444444] px-1"
          >
            {([
              ['pages', 'ページ'],
              ['layers', 'レイヤー'],
            ] as const).map(([key, label]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-left-tab={key}
                  onClick={() => setTab(key)}
                  className={`relative flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                    active ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {label}
                  {active && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#0d99ff]" />
                  )}
                </button>
              );
            })}
          </div>

          {/*
            両方をマウントしたまま出し分ける。片方を外すと、戻ったときに
            スクロール位置・検索語・展開状態が毎回初期化される
          */}
          <div className={`min-h-0 flex-1 flex-col ${tab === 'pages' ? 'flex' : 'hidden'}`}>
            {pagesSlot}
          </div>
          <div className={`min-h-0 flex-1 ${tab === 'layers' ? 'flex' : 'hidden'}`}>
            <EditorLayerPanel hideSlideList />
          </div>
        </>
      ) : (
        <>
          {showPages && <PagesPanel page={page} />}
          {/* 残りの高さいっぱいにレイヤーツリー(自前でスクロールする) */}
          <div className="flex min-h-0 flex-1">
            <EditorLayerPanel hideSlideList />
          </div>
        </>
      )}

      {/* リサイズハンドル(全高。上下どちらの段からでも掴める) */}
      <div {...resizeHandleProps} />
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  );
}
