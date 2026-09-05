'use client';

/**
 * エディタツールバー
 *
 * Phase 2: パフォーマンス最適化
 * - React.memoでラップして不要な再レンダリングを防止
 * - 子コンポーネントもメモ化
 */

import React, { useState, useRef, useEffect, memo } from 'react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Minus,
  ArrowRight,
  Pen,
  Pencil,
  Eraser,
  Highlighter,
  Shapes,
  Type,
  Frame,
  Undo2,
  Redo2,
  Group,
  Ungroup,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Image,
  Sparkles,
  Scaling,
  ChevronDown,
  LucideIcon,
  Paintbrush,
  Component,
  Images,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import { PEN_PRESETS, inkStyle, setInkPreset } from './utils/ink-style';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { EditorTool, EditorToolbarProps, TOOL_CONFIGS } from '../types/editor';
import { cn } from '../lib/utils';

/**
 * [メディアライブラリ追加時の拡張]
 * EditorToolbarProps 本体は `src/types/editor.ts`(共有型)にあるため、
 * エディタ固有のプロパティはここでローカルに拡張する。
 */
export interface EditorToolbarExtendedProps extends EditorToolbarProps {
  /** メディアライブラリを開くコールバック */
  onOpenMediaLibrary?: () => void;
  /** <img> 選択中は「差し替え」表記にする */
  isMediaReplaceMode?: boolean;
}

// Icon mapping
const TOOL_ICONS: Record<EditorTool, LucideIcon> = {
  select: MousePointer2,
  scale: Scaling,
  move: Hand,
  frame: Frame,
  rectangle: Square,
  ellipse: Circle,
  line: Minus,
  arrow: ArrowRight,
  pen: Pen,
  pencil: Pencil,
  eraser: Eraser,
  shape: Shapes,
  text: Type,
};

interface ToolButtonProps {
  tool: EditorTool;
  isActive: boolean;
  onClick: () => void;
  shortcut: string;
  label: string;
}

/**
 * ツールボタン（メモ化）
 * isActiveが変更されない限り再レンダリングしない
 */
const ToolButton = memo(function ToolButton({ tool, isActive, onClick, shortcut, label }: ToolButtonProps) {
  const Icon = TOOL_ICONS[tool];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isActive ? 'default' : 'ghost'}
          size="icon"
          className={cn(
            'h-9 w-9',
            isActive && 'bg-[#0d99ff] hover:bg-[#0c8ce9] text-white'
          )}
          onClick={onClick}
          aria-label={label}
          aria-pressed={isActive}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{label}</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          {shortcut}
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
});

// [移植時の修正] ツール群ごとの分割ドロップダウンは、ツールバー整理により
// 単一の「追加」メニューへ統合したため削除した。

interface ActionButtonProps {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  tooltip: string;
  shortcut?: string;
  className?: string;
}

/**
 * アクションボタン（メモ化）
 * disabledが変更されない限り再レンダリングしない
 */
const ActionButton = memo(function ActionButton({ icon: Icon, onClick, disabled, tooltip, shortcut, className }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-9 w-9', className)}
          onClick={onClick}
          disabled={disabled}
          // アイコンのみのボタンなので、支援技術向けにツールチップ文言を名前として与える
          aria-label={tooltip}
        >
          <Icon className={cn('h-4 w-4', className)} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{tooltip}</span>
        {shortcut && (
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
});

/**
 * エディタツールバー（メモ化）
 *
 * propsが変更されない限り再レンダリングしない
 * - activeTool, selectedCount, canUndo, canRedoの変更時のみ再レンダリング
 */
export const EditorToolbar = memo(function EditorToolbar({
  activeTool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectedCount,
  onGroup,
  onUngroup,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onImageUpload,
  onAiRegenerate,
  onOpenVariables,
  hasVariables,
  onOpenComponents,
  hasComponents,
  onOpenMediaLibrary,
  isMediaReplaceMode,
}: EditorToolbarExtendedProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const cmdKey = isMac ? '⌘' : 'Ctrl+';


  // 各グループで最後に選択したツールを記憶
  // 「追加」メニューで最後に選んだ図形/描画ツールを覚えておく
  const [, setLastShapeTool] = useState<EditorTool>('rectangle');
  const [, setLastDrawingTool] = useState<EditorTool>('pen');

  // Group tools by category
  const selectionTools = TOOL_CONFIGS.filter(t => t.group === 'selection');
  const shapeTools = TOOL_CONFIGS.filter(t => t.group === 'shapes');
  const drawingTools = TOOL_CONFIGS.filter(t => t.group === 'drawing');
  const textTools = TOOL_CONFIGS.filter(t => t.group === 'text');
  const frameTools = TOOL_CONFIGS.filter(t => t.group === 'frame');

  return (
    <TooltipProvider delayDuration={300}>
      {/*
        [移植時の修正] ツールバーの整理。
        元は14個以上のアイコンと7本の区切りが常時1列に並んでいて煩雑だった。
        「常に使うもの(取り消し/選択/表示)」だけを出し、追加系は＋メニュー、
        選択中の副次操作(重ね順・グループ)は…メニューへ畳む。配色もビューアに合わせる。
      */}
      <div className="absolute bottom-5 left-1/2 z-50 max-w-[calc(100%-5rem)] -translate-x-1/2 px-0">
        <div className="ed-toolbar no-scrollbar flex items-center gap-1 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {/* 取り消し/やり直し */}
          <ActionButton icon={Undo2} onClick={onUndo} disabled={!canUndo} tooltip="元に戻す" shortcut={`${cmdKey}Z`} />
          <ActionButton icon={Redo2} onClick={onRedo} disabled={!canRedo} tooltip="やり直し" shortcut={`${cmdKey}⇧Z`} />

          <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />

          {/* 選択・移動系(常時) */}
          {selectionTools.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool.id}
              isActive={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
              shortcut={tool.shortcut}
              label={tool.label}
            />
          ))}

          <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />

          {/* 追加(フレーム・図形・描画・テキスト・画像をまとめる) */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-1 px-2.5 text-xs font-medium" aria-label="追加">
                    <Plus className="h-4 w-4" />
                    追加
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">要素を追加</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="center" className="w-52">
              {[...frameTools, ...textTools, ...shapeTools, ...drawingTools].map((tool) => {
                const Icon = TOOL_ICONS[tool.id];
                return (
                  <DropdownMenuItem
                    key={tool.id}
                    onSelect={() => {
                      onToolChange(tool.id);
                      if (shapeTools.some((t) => t.id === tool.id)) setLastShapeTool(tool.id);
                      if (drawingTools.some((t) => t.id === tool.id)) setLastDrawingTool(tool.id);
                    }}
                    className="gap-2 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="flex-1">{tool.label}</span>
                    <kbd className="font-mono text-[10px] text-muted-foreground">{tool.shortcut}</kbd>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              {/* ペンギャラリー(PowerPointの描画タブ相当)。選ぶとそのインクで描画開始 */}
              {PEN_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => { setInkPreset(p); onToolChange(p.tool); setLastDrawingTool(p.tool); }}
                  className="gap-2 text-xs"
                >
                  {p.cap === 'butt'
                    ? <Highlighter className="h-3.5 w-3.5" style={{ color: p.color }} />
                    : <Pencil className="h-3.5 w-3.5" style={{ color: p.color }} />}
                  <span className="flex-1">{p.label}</span>
                  <span className="h-[3px] w-5 rounded-full" style={{ backgroundColor: p.color, opacity: p.opacity }} />
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => onToolChange('eraser')} className="gap-2 text-xs">
                <Eraser className="h-3.5 w-3.5" />
                <span className="flex-1">消しゴム(ストローク削除)</span>
                <kbd className="font-mono text-[10px] text-muted-foreground">E</kbd>
              </DropdownMenuItem>
              {(onImageUpload || onOpenMediaLibrary) && <DropdownMenuSeparator />}
              {onOpenMediaLibrary && (
                <DropdownMenuItem onSelect={onOpenMediaLibrary} className="gap-2 text-xs">
                  <Images className="h-3.5 w-3.5" />
                  {isMediaReplaceMode ? 'メディアライブラリから差し替え' : 'メディアライブラリから挿入'}
                </DropdownMenuItem>
              )}
              {onImageUpload && (
                <DropdownMenuItem onSelect={onImageUpload} className="gap-2 text-xs">
                  <Image className="h-3.5 w-3.5" />
                  ファイルから画像を追加
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 描画中はペンの持ち替えチップを出す(Figmaのサブツールバー相当) */}
          {(activeTool === 'pen' || activeTool === 'pencil' || activeTool === 'eraser') && (
            <>
              <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />
              {PEN_PRESETS.map((p) => {
                const active = activeTool !== 'eraser' && inkStyle.presetId === p.id;
                return (
                  <Tooltip key={p.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => { setInkPreset(p); onToolChange(p.tool); }}
                        className={`flex h-9 w-8 items-center justify-center rounded-md ${active ? 'bg-white/20' : 'hover:bg-white/10'}`}
                      >
                        {p.cap === 'butt'
                          ? <Highlighter className="h-4 w-4" style={{ color: p.color }} />
                          : <Pencil className="h-4 w-4" style={{ color: p.color }} />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top"><span>{p.label}</span></TooltipContent>
                  </Tooltip>
                );
              })}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onToolChange('eraser')}
                    className={`flex h-9 w-8 items-center justify-center rounded-md ${activeTool === 'eraser' ? 'bg-white/20' : 'hover:bg-white/10'}`}
                  >
                    <Eraser className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top"><span>消しゴム (E)</span></TooltipContent>
              </Tooltip>
            </>
          )}

          {(onOpenVariables || onOpenComponents) && <>
            <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-9 gap-2 px-2 text-xs"><Component className="h-4 w-4" />パネル<ChevronDown className="h-3 w-3" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-52">
                {onOpenComponents && <DropdownMenuItem onSelect={onOpenComponents} className="gap-2"><Component className="h-4 w-4" />コンポーネント</DropdownMenuItem>}
                {onOpenVariables && <DropdownMenuItem onSelect={onOpenVariables} className="gap-2"><Paintbrush className="h-4 w-4" />CSS変数</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </>}

          {/* 選択中のみ: よく使う3つを出し、残りは…メニュー */}
          {selectedCount > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />
              {onDuplicate && (
                <ActionButton icon={Copy} onClick={onDuplicate} tooltip="複製" shortcut={`${cmdKey}D`} />
              )}
              {onDelete && (
                <ActionButton icon={Trash2} onClick={onDelete} tooltip="削除" shortcut="⌫" />
              )}
              {selectedCount === 1 && onAiRegenerate && (
                <ActionButton
                  icon={Sparkles}
                  onClick={onAiRegenerate}
                  tooltip="AIで再生成"
                  className="text-sky-400"
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="その他の操作">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-48">
                  {onBringForward && (
                    <DropdownMenuItem onSelect={onBringForward} className="gap-2 text-xs">
                      <ArrowUp className="h-3.5 w-3.5" />
                      <span className="flex-1">前面へ</span>
                      <kbd className="font-mono text-[10px] text-muted-foreground">{cmdKey}]</kbd>
                    </DropdownMenuItem>
                  )}
                  {onSendBackward && (
                    <DropdownMenuItem onSelect={onSendBackward} className="gap-2 text-xs">
                      <ArrowDown className="h-3.5 w-3.5" />
                      <span className="flex-1">背面へ</span>
                      <kbd className="font-mono text-[10px] text-muted-foreground">{cmdKey}[</kbd>
                    </DropdownMenuItem>
                  )}
                  {selectedCount > 1 && onGroup && (
                    <DropdownMenuItem onSelect={onGroup} className="gap-2 text-xs">
                      <Group className="h-3.5 w-3.5" />
                      <span className="flex-1">グループ化</span>
                      <kbd className="font-mono text-[10px] text-muted-foreground">{cmdKey}G</kbd>
                    </DropdownMenuItem>
                  )}
                  {onUngroup && (
                    <DropdownMenuItem onSelect={onUngroup} className="gap-2 text-xs">
                      <Ungroup className="h-3.5 w-3.5" />
                      <span className="flex-1">グループ解除</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});

export default EditorToolbar;

