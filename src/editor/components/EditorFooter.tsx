'use client';

import { Keyboard } from 'lucide-react';
import { useEditorContext } from '../EditorContext';
import { BreakpointSelector } from './BreakpointSelector';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export function EditorFooter() {
  const { activeTool, editorMode, selectedElement, selectedElementIds } = useEditorContext();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = isMac ? '⌘' : 'Ctrl+';
  const alt = isMac ? '⌥' : 'Alt+';
  const hint = activeTool === 'move' ? 'ドラッグで紙面を移動 · V で選択に戻る'
    : activeTool === 'scale' ? 'ドラッグで拡大・縮小 · V で選択に戻る'
    : activeTool === 'comment' ? '紙面をドラッグして範囲を指定 · クリックで点 · Esc で選択に戻る'
    : activeTool !== 'select' ? 'ドラッグで追加 · Esc でキャンセル'
    : selectedElement || selectedElementIds.length ? `ダブルクリック・Enter で内側へ · Esc で外側へ · ${alt}ドラッグで複製`
    : 'クリックで選択 · Space＋ドラッグで紙面を移動';
  const shift = isMac ? '⇧' : 'Shift+';
  const ctrl = isMac ? '⌃' : 'Ctrl+';
  // Figma の割り当てに合わせている(出典と差分は docs/figma-parity-2026-11.md)
  const shortcuts = [
    ['選択 / 移動 / 拡大・縮小', 'V / H / K'],
    ['コメント(範囲を指定)', 'C'],
    ['元に戻す / やり直し', `${cmd}Z / ${cmd}${shift}Z`],
    ['貼り付け(元と同じ位置。枠を選んでいれば中へ)', `${cmd}V / ${cmd}${shift}V`],
    ['保存', `${cmd}S`], ['複製(動かしてから押すと同じずれで続ける)', `${cmd}D / ${alt}ドラッグ`],
    ['全体表示 / 100% / 選択範囲', `${cmd}0 / ${cmd}1 / ${cmd}2`],
    ['複数選択', 'Shift＋クリック'], ['最下層の要素を選択', `${cmd}クリック`],
    ['子を選択 / 親を選択', `Enter / ${shift}Enter`],
    ['兄弟を順に選択', `Tab / ${shift}Tab`],
    ['同じ階層をすべて選択', `${cmd}A`],
    ['移動(1px / 10px)', `矢印 / ${shift}矢印`],
    ['サイズ変更(1px / 10px)', `${cmd}矢印 / ${cmd}${shift}矢印`],
    ['前面へ / 背面へ', `${cmd}] / ${cmd}[`],
    ['最前面へ / 最背面へ', isMac ? '⌥⌘] / ⌥⌘[' : 'Ctrl+Shift+] / ['],
    ['整列(左・右・上・下)', `${alt}A / ${alt}D / ${alt}W / ${alt}S`],
    ['整列(左右中央・上下中央)', `${alt}H / ${alt}V`],
    ['等間隔(横 / 縦)', `${shift}${alt}H / ${shift}${alt}V`],
    ['グループ化 / 解除', `${cmd}G / ${cmd}${shift}G`],
    ['隠す / ロック', `${cmd}${shift}H / ${cmd}${shift}L`],
    ['左右反転 / 上下反転', `${shift}H / ${shift}V`],
    ['レイヤー名を変える(紙面にフォーカスがあるときの ⌘R は、何も選んでいなくてもページを再読み込みしない)', `${cmd}R / 名前をダブルクリック`],
    ['UI を隠す / 出す', `${cmd}\\`],
    ['アウトライン表示', `${cmd}${shift}O`],
    ['書式のコピー / 貼り付け', `${alt}${cmd}C / ${alt}${cmd}V`],
    ['不透明度 10〜100%(2つ続けて 45% など)', '1〜9 / 0'],
    ['太字 / 斜体 / 下線(要素全体)', `${cmd}B / ${cmd}I / ${cmd}U`],
    ['文字を大きく / 小さく(1px)', `${cmd}${shift}> / ${cmd}${shift}<`],
    ['リンク先へ移動', `${alt}クリック`],
    ['選択・入力を終了', 'Esc'],
  ];  return (
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
          <PopoverContent side="top" align="end" className="max-h-[70vh] w-[400px] overflow-y-auto">
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
