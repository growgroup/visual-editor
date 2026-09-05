'use client';

/**
 * LayerTreeItem - レイヤーパネルのツリーアイテム
 *
 * Phase 2: パフォーマンス最適化
 * - React.memoでラップして不要な再レンダリングを防止
 * - カスタム比較関数で必要な変更のみ検知
 */

import React, { memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Eye,
  EyeOff,
  GripVertical,
  Paintbrush,
  ClipboardPaste,
  Component,
  Type,
  Heading,
  Image as ImageIcon,
  Star,
  MousePointerClick,
  Link as LinkIcon,
  TextCursorInput,
  List as ListIcon,
  Table as TableIcon,
  Square,
  Minus,
  Frame,
} from 'lucide-react';
import type { DOMTreeNode } from '../types';

/**
 * レイヤーの種別。
 * 「div .absolute」のような機械的な表示をやめ、Figma のように
 * アイコン＋人が読める名前で中身が分かるようにするための分類。
 */
export type LayerKind =
  | 'heading'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'link'
  | 'input'
  | 'list'
  | 'table'
  | 'line'
  | 'shape'
  | 'group';

/** 種別 → アイコン。名前だけだと同名が並ぶので、形でも見分けられるようにする */
const KIND_ICONS: Record<LayerKind, React.ComponentType<{ className?: string }>> = {
  heading: Heading,
  text: Type,
  image: ImageIcon,
  icon: Star,
  button: MousePointerClick,
  link: LinkIcon,
  input: TextCursorInput,
  list: ListIcon,
  table: TableIcon,
  line: Minus,
  shape: Square,
  group: Frame,
};

export interface LayerTreeItemProps {
  node: DOMTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dragOverPosition: 'before' | 'after' | 'inside' | null;
  isHidden: boolean;
  hasStyleInClipboard: boolean;
  /** 行に出す人が読める名前（実 DOM から生成） */
  label: string;
  /** レイヤー種別（アイコン用） */
  kind: LayerKind;
  /** キャンバス or レイヤー行のホバー対象がこの行か */
  isHovered: boolean;
  /** 選択状態が変わったことを検知するためのキー（selectedElementIds.join(',')など） */
  selectionKey: string;
  /** 展開状態が変わったことを検知するためのキー */
  expandedKey: string;
  /**
   * ホバー対象が変わったことを検知するためのキー。
   * この行自身の isHovered が変わらなくても、深い階層にいる別の行の
   * isHovered を更新するには「親も再レンダリングされる」必要があるため、
   * selectionKey と同じ理由で全行に配る。
   */
  hoverKey: string;
  /** ラベルが変わったことを検知するためのキー（テキスト編集で名前が変わる） */
  labelKey: string;
  // Event handlers
  onToggleExpand: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  onNodeClick: (e: React.MouseEvent | React.KeyboardEvent, nodeId: string) => void;
  /** 行ホバー開始（キャンバス側をハイライトする） */
  onRowMouseEnter: (nodeId: string) => void;
  /** 行ホバー終了 */
  onRowMouseLeave: () => void;
  onDragStart: (e: React.DragEvent, nodeId: string) => void;
  onDragOver: (e: React.DragEvent, nodeId: string, rect: DOMRect) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, nodeId: string) => void;
  onDragEnd: () => void;
  // Context menu actions
  onSelectForContextMenu: (nodeId: string) => void;
  onDuplicate: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  onBringToFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
  // Ref for scrolling
  nodeRef: (ref: HTMLDivElement | null) => void;
  // Children renderer (for recursive rendering)
  renderChildren: () => React.ReactNode;
}

/**
 * メモ化されたレイヤーツリーアイテム
 *
 * 以下の条件でのみ再レンダリング:
 * - node.id が変更
 * - isExpanded, isSelected, isDragging, isDragOver, isHidden が変更
 * - dragOverPosition が変更
 */
export const LayerTreeItem = memo(function LayerTreeItem({
  node,
  depth,
  isExpanded,
  isSelected,
  isDragging,
  isDragOver,
  dragOverPosition,
  isHidden,
  hasStyleInClipboard,
  label,
  kind,
  isHovered,
  selectionKey: _selectionKey, // 比較用のみ、レンダリングには使用しない
  expandedKey: _expandedKey, // 比較用のみ、レンダリングには使用しない
  hoverKey: _hoverKey, // 比較用のみ、レンダリングには使用しない
  labelKey: _labelKey, // 比較用のみ、レンダリングには使用しない
  onToggleExpand,
  onToggleVisibility,
  onNodeClick,
  onRowMouseEnter,
  onRowMouseLeave,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onSelectForContextMenu,
  onDuplicate,
  onCopyStyle,
  onPasteStyle,
  onBringToFront,
  onBringForward,
  onSendBackward,
  onSendToBack,
  onDelete,
  nodeRef,
  renderChildren,
}: LayerTreeItemProps) {
  const hasChildren = node.children.length > 0;
  const KindIcon = KIND_ICONS[kind] ?? Frame;

  return (
    <div className={isDragging ? 'opacity-50' : ''}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={nodeRef}
            data-layer-row={node.id}
            role="button"
            tabIndex={0}
            aria-label={`${label}（${node.tagName}）`}
            aria-pressed={isSelected}
            aria-expanded={hasChildren ? isExpanded : undefined}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); onNodeClick(e, node.id);
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault(); e.stopPropagation();
                if (hasChildren && isExpanded !== (e.key === 'ArrowRight')) onToggleExpand(node.id);
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault(); e.stopPropagation();
                const rows = Array.from(e.currentTarget.closest('.ed-layer-panel')?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? []);
                const index = rows.indexOf(e.currentTarget);
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1);
                rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
              }
            }}
            className={`flex items-center gap-1 min-h-8 py-1 px-1 rounded cursor-pointer text-xs group transition-colors ${
              isSelected
                ? 'ed-layer-selected bg-[#0d99ff]/15 text-[#4fb8ff]'
                : isHovered
                ? // キャンバス側のホバーと連動した薄いハイライト
                  'text-gray-100 bg-[#37373d] ring-1 ring-inset ring-[#0d99ff]/50'
                : 'text-gray-300 hover:bg-[#444444]'
            } ${
              isDragOver && dragOverPosition === 'before'
                ? 'border-t-2 border-[#0d99ff]'
                : ''
            } ${
              isDragOver && dragOverPosition === 'after'
                ? 'border-b-2 border-[#0d99ff]'
                : ''
            } ${
              isDragOver && dragOverPosition === 'inside'
                ? 'bg-[#0d99ff]/20'
                : ''
            }`}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            draggable
            onDragStart={(e) => onDragStart(e, node.id)}
            onDragOver={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onDragOver(e, node.id, rect);
            }}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, node.id)}
            onDragEnd={onDragEnd}
            onClick={(e) => onNodeClick(e, node.id)}
            // ハンドラは親で useCallback 済みの安定参照なので、
            // memo で再レンダリングされない行でも古いクロージャにならない
            onMouseEnter={() => onRowMouseEnter(node.id)}
            onMouseLeave={onRowMouseLeave}
          >
            {/* ドラッグハンドル */}
            <GripVertical
              className={`w-3 h-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 cursor-grab ${
                isSelected ? 'text-white' : 'text-gray-500'
              }`}
            />

            {/* 展開/折りたたみ */}
            {hasChildren ? (
              <button
                aria-label={isExpanded ? "子要素を折り畳む" : "子要素を表示"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(node.id);
                }}
                className={`p-0.5 rounded ${
                  isSelected ? 'hover:bg-[#0d99ff]' : 'hover:bg-gray-600'
                }`}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}

            {/* 表示/非表示アイコン */}
            <button
              aria-label={isHidden ? "要素を表示" : "要素を非表示"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(node.id);
              }}
              className={`p-0.5 rounded ${
                isHidden
                  ? 'text-gray-500'
                  : isSelected
                  ? 'text-white'
                  : 'text-gray-400'
              } opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${
                isSelected ? 'hover:bg-[#0d99ff]' : 'hover:bg-gray-600'
              }`}
            >
              {isHidden ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
            </button>

            {/* コンポーネントインスタンスアイコン */}
            {node.componentInstanceId && (
              <Component
                className={`w-3 h-3 flex-shrink-0 ${
                  isSelected ? 'text-purple-200' : 'text-purple-400'
                }`}
                // React 18 の @types/react では SVGAttributes に title が無く lucide のアイコンに直接渡せないため、
                // DOM にはそのまま出力される title 属性を spread 経由で渡す（描画結果は変わらない）
                {...({ title: 'コンポーネントインスタンス' } as { title?: string })}
              />
            )}

            {/*
              [レイヤー名] 「<div .absolute>」のような機械的な表示をやめ、
              実 DOM から作った人が読める名前（見出し文言・alt・種別名）を主役にする。
              タグ名は識別のために右端へ薄く逃がす。
            */}
            <KindIcon
              className={`w-3 h-3 flex-shrink-0 ${
                isHidden
                  ? 'text-gray-600'
                  : isSelected
                  ? 'text-blue-100'
                  : 'text-gray-500'
              }`}
            />
            <span
              className={`truncate flex-1 min-w-0 ${
                isHidden
                  ? 'text-gray-500'
                  : isSelected
                  ? 'text-white'
                  : 'text-gray-200'
              }`}
              title={`${label} (${node.tagName})`}
            >
              {label}
            </span>
            <span
              className={`text-[10px] flex-shrink-0 tabular-nums ${
                isSelected ? 'text-blue-200' : 'text-gray-600'
              }`}
            >
              {node.tagName}
            </span>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-48 bg-[#2c2c2c] border-[#444444]">
          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onDuplicate(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <Copy className="w-3.5 h-3.5 mr-2" />
            複製
            <span className="ml-auto text-gray-500">⌘D</span>
          </ContextMenuItem>

          <ContextMenuSeparator className="bg-[#444444]" />

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onCopyStyle(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <Paintbrush className="w-3.5 h-3.5 mr-2" />
            スタイルをコピー
            <span className="ml-auto text-gray-500">⌘⌥C</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onPasteStyle(), 50);
            }}
            disabled={!hasStyleInClipboard}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ClipboardPaste className="w-3.5 h-3.5 mr-2" />
            スタイルをペースト
            <span className="ml-auto text-gray-500">⌘⌥V</span>
          </ContextMenuItem>

          <ContextMenuSeparator className="bg-[#444444]" />

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onBringToFront(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <ChevronsUp className="w-3.5 h-3.5 mr-2" />
            最前面へ
            <span className="ml-auto text-gray-500">⌘⇧]</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onBringForward(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <ArrowUp className="w-3.5 h-3.5 mr-2" />
            前面へ
            <span className="ml-auto text-gray-500">⌘]</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onSendBackward(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <ArrowDown className="w-3.5 h-3.5 mr-2" />
            背面へ
            <span className="ml-auto text-gray-500">⌘[</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onSendToBack(), 50);
            }}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            <ChevronsDown className="w-3.5 h-3.5 mr-2" />
            最背面へ
            <span className="ml-auto text-gray-500">⌘⇧[</span>
          </ContextMenuItem>

          <ContextMenuSeparator className="bg-[#444444]" />

          <ContextMenuItem
            onClick={() => onToggleVisibility(node.id)}
            className="text-xs text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
          >
            {isHidden ? (
              <>
                <Eye className="w-3.5 h-3.5 mr-2" />
                表示
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 mr-2" />
                非表示
              </>
            )}
          </ContextMenuItem>

          <ContextMenuSeparator className="bg-[#444444]" />

          <ContextMenuItem
            onClick={() => {
              onSelectForContextMenu(node.id);
              setTimeout(() => onDelete(), 50);
            }}
            className="text-xs text-red-400 hover:bg-gray-700 focus:bg-gray-700"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            削除
            <span className="ml-auto text-gray-500">⌫</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 子要素のレンダリング */}
      {hasChildren && isExpanded && <div>{renderChildren()}</div>}
    </div>
  );
}, (prevProps, nextProps) => {
  // カスタム比較関数: 以下の条件が全て同じなら再レンダリングしない
  //
  // [重要] この比較関数はプロパティを列挙している。ここに書き忘れたプロパティは
  // 「変わっていない」と判定されて画面に反映されない。ホバー連動を足すときに
  // hoverKey / isHovered を入れ忘れると、深い階層の行が永遠に光らなくなる。
  return (
    prevProps.node.id === nextProps.node.id &&
    prevProps.node.tagName === nextProps.node.tagName &&
    prevProps.node.children.length === nextProps.node.children.length &&
    // className/text は表示しなくなったので、代わりに表示名そのものを比較する
    prevProps.label === nextProps.label &&
    prevProps.kind === nextProps.kind &&
    prevProps.depth === nextProps.depth &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.isDragOver === nextProps.isDragOver &&
    prevProps.dragOverPosition === nextProps.dragOverPosition &&
    prevProps.isHidden === nextProps.isHidden &&
    prevProps.hasStyleInClipboard === nextProps.hasStyleInClipboard &&
    // selectionKeyが変わると子要素も再レンダリングが必要
    prevProps.selectionKey === nextProps.selectionKey &&
    // expandedKeyが変わると子要素も再レンダリングが必要
    prevProps.expandedKey === nextProps.expandedKey &&
    // hoverKey / labelKey も同じ理由（子孫の isHovered / label を届けるため）
    prevProps.hoverKey === nextProps.hoverKey &&
    prevProps.labelKey === nextProps.labelKey
  );
});

export default LayerTreeItem;
