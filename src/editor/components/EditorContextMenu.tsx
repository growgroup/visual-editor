'use client';

/**
 * エディタ用コンテキストメニュー
 * 右クリックで要素操作メニューを表示
 */

import { createPortal } from 'react-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { useEditorContext } from '../EditorContext';
import {
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  CopyPlus,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Group,
  Ungroup,
  Lock,
  Unlock,
  Sparkles,
  Code,
  Paintbrush,
  ClipboardPaste,
  ImageUp,
  Images,
  Component,
  ArrowUpRight,
  Unlink,
  RotateCcw,
  ArrowUpFromLine,
  Link2,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  Rows3,
  Columns3,
  Move,
  AlignVerticalJustifyStart,
  LayoutGrid,
  AlignJustify,
  ListTree,
  ListCollapse,
} from 'lucide-react';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  position: ContextMenuPosition | null;
  onClose: () => void;
  // 選択状態
  hasSelection: boolean;
  selectionCount: number;
  isGroup: boolean;
  hasStyleInClipboard?: boolean;
  // コンポーネント状態
  isComponentInstance?: boolean;
  hasOverrides?: boolean;
  // 部品(HTML template)状態
  /** io.loadParts が渡されている(「コンポーネントを作成」が「部品として保存」になる) */
  partsMode?: boolean;
  isPartInstance?: boolean;
  /** 「名前 vN」 */
  partLabel?: string;
  // アクション
  /** 画像の変更(選択が<img>のときのみ渡される) */
  onReplaceImageFromFile?: () => void;
  onReplaceImageFromLibrary?: () => void;
  onReplaceImageFromClipboard?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  /** 表の編集(右クリックしたセルが表の中のときだけ渡される) */
  onInsertRowAbove?: () => void;
  onInsertRowBelow?: () => void;
  onInsertColumnLeft?: () => void;
  onInsertColumnRight?: () => void;
  onDeleteRow?: () => void;
  onDeleteColumn?: () => void;
  /** リンク(href)の編集 */
  onEditLink?: () => void;
  // AI生成
  onAiRegenerate?: () => void;
  // HTML編集
  onEditHtml?: () => void;
  // コンポーネント操作
  onCreateComponent?: () => void;
  onGoToMainComponent?: () => void;
  onDetachInstance?: () => void;
  onResetOverrides?: () => void;
  onPushOverridesToMain?: () => void;
  // 部品操作
  onDetachPart?: () => void;
  onUpdatePart?: () => void;
  // 自由配置(webpage のみ。渡されたものだけ出す)
  /** 選んだ要素から下の箱を、入れ子まですべて絶対配置にする */
  onFreeLayoutTreeOn?: () => void;
  /** 選んだ要素から下の自由配置を、入れ子まですべて流し込みへ戻す */
  onFreeLayoutTreeOff?: () => void;
  /** 選んだ要素を器にして、直下の子だけを絶対配置にする */
  onFreeLayoutOn?: () => void;
  /** 1 段だけの器を流し込みへ戻す */
  onFreeLayoutOff?: () => void;
  /** ページの最上位セクションをまとめて自由配置にする */
  onPageFreeLayoutOn?: () => void;
  /** ページの自由配置をまとめて解除する */
  onPageFreeLayoutOff?: () => void;
  /** ページのどこかに自由配置の器があるか(解除項目の出し分け) */
  pageHasFreeLayout?: boolean;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function MenuItem({ icon, label, shortcut, onClick, disabled, danger }: MenuItemProps) {
  return (
    <DropdownMenuItem
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-xs
        ${disabled 
          ? 'text-gray-500 cursor-not-allowed' 
          : danger 
            ? 'text-red-400 hover:bg-red-500/20' 
            : 'text-gray-300 hover:bg-[#444444]'
        }
        transition-colors
      `}
      onSelect={(e) => {
        e.stopPropagation();
        if (!disabled && onClick) onClick();
      }}
      disabled={disabled}
    >
      <span className="w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-gray-500">{shortcut}</span>
      )}
    </DropdownMenuItem>
  );
}

function MenuDivider() {
  return <div className="h-px bg-[#444444] my-1" />;
}

export function EditorContextMenu({
  position,
  onClose,
  hasSelection,
  selectionCount,
  isGroup,
  hasStyleInClipboard,
  isComponentInstance,
  hasOverrides,
  partsMode,
  isPartInstance,
  partLabel,
  onDetachPart,
  onUpdatePart,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDuplicate,
  onReplaceImageFromFile,
  onReplaceImageFromLibrary,
  onReplaceImageFromClipboard,
  onCopyStyle,
  onPasteStyle,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onGroup,
  onUngroup,
  onInsertRowAbove,
  onInsertRowBelow,
  onInsertColumnLeft,
  onInsertColumnRight,
  onDeleteRow,
  onDeleteColumn,
  onEditLink,
  onAiRegenerate,
  onEditHtml,
  onCreateComponent,
  onGoToMainComponent,
  onDetachInstance,
  onResetOverrides,
  onPushOverridesToMain,
  onFreeLayoutTreeOn,
  onFreeLayoutTreeOff,
  onFreeLayoutOn,
  onFreeLayoutOff,
  onPageFreeLayoutOn,
  onPageFreeLayoutOff,
  pageHasFreeLayout,
}: ContextMenuProps) {
  const { restoreFocus } = useEditorContext();
  if (!position) return null;

  const handleAction = (action?: () => void) => {
    if (action) {
      action();
      onClose();
    }
  };

  // 見えない起点(右クリックの位置)。position は画面(viewport)の座標なので、document.body に出して
  // position: fixed の基準を viewport にする。エディタの木の中に置くと、利用側がエディタを transform の付いた
  // 器に入れているとき(構成ラフの殻の .wf-editor-main は translateZ(0))、fixed の基準がその器になり、
  // メニューが右クリックの位置から器の左端ぶん(左パネルの幅 248px)ずれていた(実測)
  const anchor = (
    <DropdownMenuTrigger asChild>
      <button tabIndex={-1} aria-label="要素の操作" style={{ position: 'fixed', left: position.x, top: position.y, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      {typeof document === 'undefined' ? anchor : createPortal(anchor, document.body)}
      <DropdownMenuContent align="start" sideOffset={0} collisionPadding={8} className="w-60"
        onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus(); }}>
      {/* クリップボード操作 */}
      <MenuItem
        icon={<Copy className="w-3.5 h-3.5" />}
        label="コピー"
        shortcut="⌘C"
        onClick={() => handleAction(onCopy)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<Scissors className="w-3.5 h-3.5" />}
        label="カット"
        shortcut="⌘X"
        onClick={() => handleAction(onCut)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<Clipboard className="w-3.5 h-3.5" />}
        label="ペースト"
        shortcut="⌘V"
        onClick={() => handleAction(onPaste)}
      />

      {(onReplaceImageFromFile || onReplaceImageFromLibrary || onReplaceImageFromClipboard) && (
        <>
          <MenuDivider />
          {/* 実機PowerPointの「画像の変更」。位置・サイズ・書式は保ったままsrcだけ替える */}
          <div className="px-3 pb-0.5 pt-1 text-[10px] text-gray-500">画像の変更</div>
          {onReplaceImageFromFile && (
            <MenuItem
              icon={<ImageUp className="w-3.5 h-3.5" />}
              label="ファイルから…"
              onClick={() => handleAction(onReplaceImageFromFile)}
            />
          )}
          {onReplaceImageFromLibrary && (
            <MenuItem
              icon={<Images className="w-3.5 h-3.5" />}
              label="メディアライブラリから…"
              onClick={() => handleAction(onReplaceImageFromLibrary)}
            />
          )}
          {onReplaceImageFromClipboard && (
            <MenuItem
              icon={<ClipboardPaste className="w-3.5 h-3.5" />}
              label="クリップボードから"
              onClick={() => handleAction(onReplaceImageFromClipboard)}
            />
          )}
        </>
      )}

      {/* 表の編集。右クリックしたセルを起点に行・列を足し引きする */}
      {onInsertRowAbove && (
        <>
          <MenuDivider />
          <div className="px-3 pb-0.5 pt-1 text-[10px] text-gray-500">表</div>
          <MenuItem
            icon={<BetweenHorizontalStart className="w-3.5 h-3.5" />}
            label="行を上に挿入"
            onClick={() => handleAction(onInsertRowAbove)}
          />
          <MenuItem
            icon={<BetweenHorizontalEnd className="w-3.5 h-3.5" />}
            label="行を下に挿入"
            onClick={() => handleAction(onInsertRowBelow)}
          />
          <MenuItem
            icon={<BetweenVerticalStart className="w-3.5 h-3.5" />}
            label="列を左に挿入"
            onClick={() => handleAction(onInsertColumnLeft)}
          />
          <MenuItem
            icon={<BetweenVerticalEnd className="w-3.5 h-3.5" />}
            label="列を右に挿入"
            onClick={() => handleAction(onInsertColumnRight)}
          />
          <MenuItem
            icon={<Rows3 className="w-3.5 h-3.5" />}
            label="行を削除"
            onClick={() => handleAction(onDeleteRow)}
            disabled={!onDeleteRow}
            danger
          />
          <MenuItem
            icon={<Columns3 className="w-3.5 h-3.5" />}
            label="列を削除"
            onClick={() => handleAction(onDeleteColumn)}
            disabled={!onDeleteColumn}
            danger
          />
        </>
      )}

      <MenuDivider />

      {/* 編集操作 */}
      <MenuItem
        icon={<CopyPlus className="w-3.5 h-3.5" />}
        label="複製"
        shortcut="⌘D"
        onClick={() => handleAction(onDuplicate)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<Trash2 className="w-3.5 h-3.5" />}
        label="削除"
        shortcut="⌫"
        onClick={() => handleAction(onDelete)}
        disabled={!hasSelection}
        danger
      />

      <MenuDivider />

      {/* スタイル操作 */}
      <MenuItem
        icon={<Paintbrush className="w-3.5 h-3.5" />}
        label="スタイルをコピー"
        shortcut="⌘⌥C"
        onClick={() => handleAction(onCopyStyle)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<ClipboardPaste className="w-3.5 h-3.5" />}
        label="スタイルをペースト"
        shortcut="⌘⌥V"
        onClick={() => handleAction(onPasteStyle)}
        disabled={!hasSelection || !hasStyleInClipboard}
      />

      <MenuDivider />

      {/* AI生成 */}
      <MenuItem
        icon={<Sparkles className="w-3.5 h-3.5 text-purple-400" />}
        label="AIで再生成"
        onClick={() => {
          if (onAiRegenerate) {
            onAiRegenerate();
            onClose();
          }
        }}
        disabled={!hasSelection || selectionCount > 1}
      />

      <MenuDivider />

      {/* リンク */}
      <MenuItem
        icon={<Link2 className="w-3.5 h-3.5" />}
        label="リンクを編集…"
        onClick={() => handleAction(onEditLink)}
        disabled={!onEditLink || !hasSelection || selectionCount > 1}
      />

      {/* HTML編集 */}
      <MenuItem
        icon={<Code className="w-3.5 h-3.5" />}
        label="HTMLを編集"
        onClick={() => handleAction(onEditHtml)}
        disabled={!hasSelection || selectionCount > 1}
      />

      {/* 自由配置(webpage のみ渡される)。
          広い範囲から順に「ツリーごと」→「直下の子だけ」→「ページ全体」と並べ、
          戻す道は同じ粒度の項目と入れ替わりで出す(戻せないと怖くて使えない) */}
      {(onFreeLayoutTreeOn || onFreeLayoutTreeOff || onFreeLayoutOn || onFreeLayoutOff || onPageFreeLayoutOn || onPageFreeLayoutOff) && (
        <>
          <MenuDivider />
          <div className="px-3 pb-0.5 pt-1 text-[10px] text-gray-500">配置</div>
          {onFreeLayoutTreeOn && (
            <MenuItem
              icon={<ListTree className="w-3.5 h-3.5" />}
              label="このツリーをすべて絶対配置にする"
              onClick={() => handleAction(onFreeLayoutTreeOn)}
            />
          )}
          {onFreeLayoutTreeOff && (
            <MenuItem
              icon={<ListCollapse className="w-3.5 h-3.5" />}
              label="このツリーの絶対配置を解除する"
              onClick={() => handleAction(onFreeLayoutTreeOff)}
            />
          )}
          {onFreeLayoutOn && (
            <MenuItem
              icon={<Move className="w-3.5 h-3.5" />}
              label="直下の子だけ絶対配置にする"
              onClick={() => handleAction(onFreeLayoutOn)}
            />
          )}
          {onFreeLayoutOff && (
            <MenuItem
              icon={<AlignVerticalJustifyStart className="w-3.5 h-3.5" />}
              label="流し込みに戻す"
              onClick={() => handleAction(onFreeLayoutOff)}
            />
          )}
          <MenuItem
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            label="このページを自由配置にする…"
            onClick={() => handleAction(onPageFreeLayoutOn)}
            disabled={!onPageFreeLayoutOn}
          />
          {pageHasFreeLayout && (
            <MenuItem
              icon={<AlignJustify className="w-3.5 h-3.5" />}
              label="ページを流し込みに戻す…"
              onClick={() => handleAction(onPageFreeLayoutOff)}
              disabled={!onPageFreeLayoutOff}
            />
          )}
        </>
      )}

      <MenuDivider />

      {/* レイヤー操作 */}
      <MenuItem
        icon={<ArrowUp className="w-3.5 h-3.5" />}
        label="前面へ"
        shortcut="⌘]"
        onClick={() => handleAction(onBringForward)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<ArrowDown className="w-3.5 h-3.5" />}
        label="背面へ"
        shortcut="⌘["
        onClick={() => handleAction(onSendBackward)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<ChevronsUp className="w-3.5 h-3.5" />}
        label="最前面へ"
        shortcut="⌘⇧]"
        onClick={() => handleAction(onBringToFront)}
        disabled={!hasSelection}
      />
      <MenuItem
        icon={<ChevronsDown className="w-3.5 h-3.5" />}
        label="最背面へ"
        shortcut="⌘⇧["
        onClick={() => handleAction(onSendToBack)}
        disabled={!hasSelection}
      />

      {/* グループ操作（複数選択時のみ表示） */}
      {(selectionCount > 1 || isGroup) && (
        <>
          <MenuDivider />
          {selectionCount > 1 && (
            <MenuItem
              icon={<Group className="w-3.5 h-3.5" />}
              label="グループ化"
              shortcut="⌘G"
              onClick={() => handleAction(onGroup)}
            />
          )}
          {isGroup && (
            <MenuItem
              icon={<Ungroup className="w-3.5 h-3.5" />}
              label="グループ解除"
              shortcut="⌘⇧G"
              onClick={() => handleAction(onUngroup)}
            />
          )}
        </>
      )}

      {/* コンポーネント操作 */}
      {hasSelection && selectionCount === 1 && (
        <>
          <MenuDivider />
          {/* 部品(data-part)のインスタンス: 更新・切り離し */}
          {isPartInstance && (
            <>
              <MenuItem
                icon={<Component className="w-3.5 h-3.5 text-purple-400" />}
                label={`部品: ${partLabel ?? ''}`}
                disabled
              />
              {onUpdatePart && (
                <MenuItem
                  icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
                  label="この姿で部品を更新"
                  onClick={() => handleAction(onUpdatePart)}
                />
              )}
              <MenuItem
                icon={<Unlink className="w-3.5 h-3.5" />}
                label="部品から切り離す"
                onClick={() => handleAction(onDetachPart)}
              />
            </>
          )}
          {/* 通常要素の場合: コンポーネント作成(部品モードでは「部品として保存」) */}
          {!isComponentInstance && !isPartInstance && (
            <MenuItem
              icon={<Component className="w-3.5 h-3.5 text-purple-400" />}
              label={partsMode ? '部品として保存' : 'コンポーネントを作成'}
              onClick={() => handleAction(onCreateComponent)}
            />
          )}
          {/* コンポーネントインスタンスの場合 */}
          {isComponentInstance && (
            <>
              <MenuItem
                icon={<ArrowUpRight className="w-3.5 h-3.5" />}
                label="メインコンポーネントへ移動"
                onClick={() => handleAction(onGoToMainComponent)}
              />
              <MenuItem
                icon={<Unlink className="w-3.5 h-3.5" />}
                label="インスタンスを解除"
                onClick={() => handleAction(onDetachInstance)}
              />
              {hasOverrides && (
                <>
                  <MenuItem
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    label="オーバーライドをリセット"
                    onClick={() => handleAction(onResetOverrides)}
                  />
                  <MenuItem
                    icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
                    label="メインに変更を適用"
                    onClick={() => handleAction(onPushOverridesToMain)}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
