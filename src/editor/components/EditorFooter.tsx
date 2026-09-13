'use client';

import { Keyboard } from 'lucide-react';
import { useEditorContext } from '../EditorContext';
import { BreakpointSelector } from './BreakpointSelector';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export function EditorFooter() {
  const { activeTool, editorMode, selectedElement, selectedElementIds } = useEditorContext();
  const cmd = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const hint = activeTool === 'move' ? 'ドラッグで紙面を移動 · V で選択に戻る'
    : activeTool === 'scale' ? 'ドラッグで拡大・縮小 · V で選択に戻る'
    : activeTool === 'comment' ? '紙面をドラッグして範囲を指定 · クリックで点 · Esc で選択に戻る'
    : activeTool !== 'select' ? 'ドラッグで追加 · Esc でキャンセル'
    : selectedElement || selectedElementIds.length ? 'ダブルクリックで文字を編集 · Esc で選択を解除'
    : 'クリックで選択 · Space＋ドラッグで紙面を移動';
  const shortcuts = [
    ['選択 / 移動 / 拡大・縮小', 'V / H / K'],
    ['コメント(範囲を指定)', 'C'],
    ['元に戻す / やり直し', `${cmd}Z / ${cmd}⇧Z`],
    ['保存', `${cmd}S`], ['複製', `${cmd}D`],
    ['全体表示 / 100% / 選択範囲', `${cmd}0 / ${cmd}1 / ${cmd}2`],
    ['複数選択', 'Shift＋クリック'], ['最下層の要素を選択', `${cmd}クリック`],
    ['選択・入力を終了', 'Esc'],
  ];
  return (
    <div className="ed-footer">
      <span className="ed-footer-hint">{hint}</span>
      <div className="flex shrink-0 items-center gap-4">
        {editorMode === 'webpage' && <BreakpointSelector />}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 rounded px-2 py-1" aria-label="キーボードショートカット">
              <Keyboard className="h-4 w-4" />ショートカット
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[400px]">
            <h2 className="mb-4 text-sm font-semibold">キーボードショートカット</h2>
            <dl className="space-y-3">
              {shortcuts.map(([label, key]) => <div key={label} className="flex items-center justify-between gap-4 text-xs">
                <dt>{label}</dt><dd className="m-0"><kbd className="rounded bg-muted px-2 py-1">{key}</kbd></dd>
              </div>)}
            </dl>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
