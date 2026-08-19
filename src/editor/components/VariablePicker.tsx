'use client';

/**
 * CSS変数選択ポップオーバー
 * プロパティパネルから変数を選択・適用するためのUI
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Link2,
  Link2Off,
  Search,
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  CSSVariableDefinition,
  CSSVariableCategory,
  CSSVariableGroup,
} from '../../types/css-variables';
import { CSS_VARIABLE_CATEGORIES, generateVarReference } from '../../types/css-variables';

// ============================================
// アイコンマッピング
// ============================================

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
};

function getCategoryIcon(iconName: string): LucideIcon {
  return CATEGORY_ICONS[iconName] ?? Settings;
}

// ============================================
// 型定義
// ============================================

interface VariablePickerProps {
  /** 利用可能な変数リスト */
  variables: CSSVariableDefinition[];
  /** カテゴリでグループ化された変数 */
  variableGroups: CSSVariableGroup[];
  /** フィルタするカテゴリ（nullで全て表示） */
  filterCategory?: CSSVariableCategory | null;
  /** 現在の値（var(--xxx)形式の場合、リンク済みと判定） */
  currentValue?: string;
  /** 変数選択時のコールバック */
  onSelectVariable: (variable: CSSVariableDefinition) => void;
  /** リンク解除時のコールバック */
  onUnlink?: () => void;
  /** トリガーボタンのカスタムスタイル */
  triggerClassName?: string;
  /** ポップオーバーの配置 */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** ポップオーバーの整列 */
  align?: 'start' | 'center' | 'end';
  /** 無効状態 */
  disabled?: boolean;
}

// ============================================
// 変数アイテム
// ============================================

interface VariableItemProps {
  variable: CSSVariableDefinition;
  isSelected: boolean;
  onClick: () => void;
}

function VariableItem({ variable, isSelected, onClick }: VariableItemProps) {
  return (
    <button
      type="button"
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md text-sm',
        'hover:bg-gray-100 transition-colors',
        isSelected && 'bg-blue-50 text-blue-700'
      )}
      onClick={onClick}
    >
      {/* カラープレビュー */}
      {variable.category === 'color' ? (
        <div
          className="w-4 h-4 rounded border shadow-sm flex-shrink-0"
          style={{ backgroundColor: variable.value }}
        />
      ) : (
        <div className="w-4 h-4 rounded border bg-gray-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[6px] text-gray-500 font-mono">
            {variable.value.slice(0, 2)}
          </span>
        </div>
      )}

      {/* 変数情報 */}
      <div className="flex-1 min-w-0">
        <span className="font-mono text-xs truncate block">{variable.name}</span>
      </div>

      {/* 値 */}
      <span className="text-xs text-gray-400 font-mono truncate max-w-[80px]">
        {variable.value}
      </span>
    </button>
  );
}

// ============================================
// カテゴリグループ
// ============================================

interface CategoryGroupProps {
  group: CSSVariableGroup;
  selectedCssName: string | null;
  onSelectVariable: (variable: CSSVariableDefinition) => void;
}

function CategoryGroup({ group, selectedCssName, onSelectVariable }: CategoryGroupProps) {
  const config = CSS_VARIABLE_CATEGORIES.find(c => c.id === group.category);
  const Icon = getCategoryIcon(config?.icon ?? 'Settings');

  if (group.variables.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500">
        <Icon className="w-3 h-3" />
        <span>{config?.label ?? group.category}</span>
      </div>
      <div className="space-y-0.5">
        {group.variables.map(variable => (
          <VariableItem
            key={variable.id}
            variable={variable}
            isSelected={variable.cssName === selectedCssName}
            onClick={() => onSelectVariable(variable)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function VariablePicker({
  variables,
  variableGroups,
  filterCategory,
  currentValue,
  onSelectVariable,
  onUnlink,
  triggerClassName,
  side = 'left',
  align = 'start',
  disabled = false,
}: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 現在リンクされている変数を検出
  const linkedVariable = useMemo(() => {
    if (!currentValue) return null;
    const match = currentValue.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (!match) return null;
    return variables.find(v => v.cssName === match[1]) ?? null;
  }, [currentValue, variables]);

  const isLinked = linkedVariable !== null;

  // フィルタされた変数グループ
  const filteredGroups = useMemo(() => {
    let groups = variableGroups;

    // カテゴリフィルタ
    if (filterCategory) {
      groups = groups.filter(g => g.category === filterCategory);
    }

    // 検索フィルタ
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      groups = groups.map(g => ({
        ...g,
        variables: g.variables.filter(v =>
          v.name.toLowerCase().includes(query) ||
          v.cssName.toLowerCase().includes(query) ||
          v.value.toLowerCase().includes(query)
        ),
      })).filter(g => g.variables.length > 0);
    }

    return groups;
  }, [variableGroups, filterCategory, searchQuery]);

  // 変数選択ハンドラ
  const handleSelect = useCallback((variable: CSSVariableDefinition) => {
    onSelectVariable(variable);
    setOpen(false);
    setSearchQuery('');
  }, [onSelectVariable]);

  // リンク解除ハンドラ
  const handleUnlink = useCallback(() => {
    onUnlink?.();
    setOpen(false);
  }, [onUnlink]);

  // 変数が0件の場合のUI
  const isEmpty = variables.length === 0;
  const noResults = filteredGroups.every(g => g.variables.length === 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7',
            isLinked
              ? 'text-blue-500 hover:text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
            triggerClassName
          )}
          disabled={disabled || isEmpty}
          title={isLinked ? `リンク: ${linkedVariable?.cssName}` : '変数をリンク'}
        >
          {isLinked ? (
            <Link2 className="h-3.5 w-3.5" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0"
        side={side}
        align={align}
      >
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="変数を検索..."
              className="h-8 pl-7 text-sm"
              autoFocus
            />
          </div>
        </div>

        <ScrollArea className="h-[240px]">
          <div className="p-2 space-y-3">
            {noResults ? (
              <div className="text-center py-8 text-sm text-gray-500">
                {searchQuery ? '検索結果がありません' : '変数がありません'}
              </div>
            ) : (
              filteredGroups.map(group => (
                <CategoryGroup
                  key={group.category}
                  group={group}
                  selectedCssName={linkedVariable?.cssName ?? null}
                  onSelectVariable={handleSelect}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* リンク解除ボタン */}
        {isLinked && onUnlink && (
          <div className="p-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleUnlink}
            >
              <Link2Off className="h-3.5 w-3.5 mr-1.5" />
              リンクを解除
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// シンプルなリンクボタン（インライン用）
// ============================================

interface VariableLinkButtonProps {
  isLinked: boolean;
  linkedVariableName?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function VariableLinkButton({
  isLinked,
  linkedVariableName,
  onClick,
  disabled = false,
  className,
}: VariableLinkButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'h-7 w-7',
        isLinked
          ? 'text-blue-500 hover:text-blue-600 bg-blue-50 hover:bg-blue-100'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
        className
      )}
      disabled={disabled}
      onClick={onClick}
      title={isLinked ? `リンク: ${linkedVariableName}` : '変数をリンク'}
    >
      <Link2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export default VariablePicker;
