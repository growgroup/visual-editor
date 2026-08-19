"use client";

/**
 * Figma風UIの左パネル(2段構成)。
 *   上: ページ切替(PagesPanel。スライドのプレビュー付き)
 *   下: 現在ページのレイヤーツリー(EditorLayerPanel hideSlideList)
 *
 * 幅はこのラッパーが1本のハンドルで持つ。段ごとに幅・ハンドルを持たせると
 * 上下で幅が食い違ったり、リサイズが二重になったりするため。
 */

import { useEditorContext } from '../../EditorContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { EditorLayerPanel } from '../EditorLayerPanel';
import { PagesPanel } from './PagesPanel';
import { can } from '../../../io';

export function LeftPanel({ page }: { page: number }) {
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

  return (
    <div
      className="relative flex shrink-0 flex-col overflow-hidden"
      style={{ width: `${width}px` }}
    >
      {showPages && <PagesPanel page={page} />}
      {/* 残りの高さいっぱいにレイヤーツリー(自前でスクロールする) */}
      <div className="flex min-h-0 flex-1">
        <EditorLayerPanel hideSlideList />
      </div>

      {/* リサイズハンドル(全高。上下どちらの段からでも掴める) */}
      <div {...resizeHandleProps} />
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  );
}
