'use client';

/**
 * プロパティパネル用のCSS変数ピッカー
 * Figmaスタイルでプロパティ値にCSS変数をリンク
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ScrollArea } from '../../../components/ui/scroll-area';
import {
  Settings2,
  Search,
  X,
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useEditorVariables } from '../../EditorContext';
import type { CSSVariableDefinition, CSSVariableCategory } from '../../../types/css-variables';
import { isVariableReference, extractVariableName } from '../../../types/css-variables';

// ============================================
// アイコンマッピング
// ============================================

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  color: Palette,
  spacing: Ruler,
  typography: Type,
  border: Square,
  shadow: Layers,
  other: Settings,
};

// ============================================
// 型定義
// ============================================

export interface PropertyVariablePickerProps {
  /** フィルタするカテゴリ（nullで全て表示） */
  category?: CSSVariableCategory | null;
  /** 現在の値（var(--xxx)形式の場合、リンク済みと判定） */
  currentValue?: string;
  /** 変数選択時のコールバック */
  onSelectVariable: (variable: CSSVariableDefinition) => void;
  /** リンク解除時のコールバック（解除後の値を渡す） */
  onDetach?: (resolvedValue: string) => void;
  /** ボタンのクラス */
  className?: string;
  /** 無効状態 */
  disabled?: boolean;
  /** サイズ */
  size?: 'sm' | 'default';
}

// ============================================
// メインコンポーネント
// ============================================

export function PropertyVariablePicker({
  category,
  currentValue,
  onSelectVariable,
  onDetach,
  className,
  disabled = false,
  size = 'sm',
}: PropertyVariablePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // CSS変数を取得
  const { variables } = useEditorVariables();

  // 現在の値がCSS変数参照かどうか
  const isLinked = useMemo(() => {
    return currentValue ? isVariableReference(currentValue) : false;
  }, [currentValue]);

  // リンクされている変数を取得
  const linkedVariable = useMemo(() => {
    if (!isLinked || !currentValue) return null;
    const varName = extractVariableName(currentValue);
    return variables.find(v => v.cssName === varName);
  }, [isLinked, currentValue, variables]);

  // フィルタリングされた変数
  const filteredVariables = useMemo(() => {
    let filtered = variables;

    // カテゴリでフィルタ
    if (category) {
      filtered = filtered.filter(v => v.category === category);
    }

    // 検索でフィルタ
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.name.toLowerCase().includes(query) ||
        v.cssName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [variables, category, searchQuery]);

  // カテゴリごとにグループ化
  const groupedVariables = useMemo(() => {
    const groups: Record<CSSVariableCategory, CSSVariableDefinition[]> = {
      color: [],
      spacing: [],
      typography: [],
      border: [],
      shadow: [],
      other: [],
    };

    filteredVariables.forEach(v => {
      groups[v.category].push(v);
    });

    return groups;
  }, [filteredVariables]);

  // 変数を選択
  const handleSelect = useCallback((variable: CSSVariableDefinition) => {
    onSelectVariable(variable);
    setIsOpen(false);
    setSearchQuery('');
  }, [onSelectVariable]);

  // リンク解除
  const handleDetach = useCallback(() => {
    if (onDetach) {
      if (linkedVariable) {
        onDetach(linkedVariable.value);
      } else {
        // 変数が見つからない場合はデフォルト値を使用
        // カテゴリに応じたデフォルト値を設定
        const defaultValue = category === 'color' ? '#000000' : '0';
        onDetach(defaultValue);
      }
    }
    setIsOpen(false);
  }, [linkedVariable, onDetach, category]);

  const buttonSize = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            buttonSize,
            'flex-shrink-0',
            isLinked
              ? 'text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20'
              : 'text-gray-500 hover:text-gray-300',
            className
          )}
          title={isLinked ? `変数: ${linkedVariable?.name}` : 'CSS変数を使用'}
        >
          <Settings2 className={iconSize} />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0 bg-[#2c2c2c] border-[#444444]"
        align="end"
        side="left"
      >
        {/* ヘッダー */}
        <div className="flex items-center gap-2 p-2 border-b border-[#444444]">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <Input
              type="text"
              placeholder="変数を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
            />
          </div>
          {isLinked && onDetach && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-white"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDetach();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title="変数を解除"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* リンク済みの場合の情報表示 */}
        {isLinked && linkedVariable && (
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border-b border-[#444444]">
            {linkedVariable.category === 'color' && (
              <div
                className="w-4 h-4 rounded border border-[#444444]"
                style={{ backgroundColor: linkedVariable.value }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white truncate">{linkedVariable.name}</div>
              <div className="text-[10px] text-gray-500 font-mono truncate">{linkedVariable.value}</div>
            </div>
          </div>
        )}

        {/* 変数リスト */}
        <ScrollArea className="max-h-64">
          {filteredVariables.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">
              {searchQuery ? '検索結果がありません' : 'CSS変数がありません'}
            </div>
          ) : (
            <div className="p-1">
              {(category ? [category] : (['color', 'spacing', 'typography', 'border', 'shadow', 'other'] as CSSVariableCategory[])).map((cat) => {
                const catVariables = groupedVariables[cat];
                if (catVariables.length === 0) return null;

                const Icon = CATEGORY_ICONS[cat];

                return (
                  <div key={cat} className="mb-1">
                    {/* カテゴリヘッダー（カテゴリ指定がない場合のみ表示） */}
                    {!category && (
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-gray-500 uppercase">
                        <Icon className="w-3 h-3" />
                        <span>{cat}</span>
                      </div>
                    )}

                    {/* 変数リスト */}
                    {catVariables.map((variable) => {
                      const isSelected = linkedVariable?.id === variable.id;

                      return (
                        <button
                          key={variable.id}
                          onClick={() => handleSelect(variable)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left',
                            'hover:bg-[#444444] transition-colors',
                            isSelected && 'bg-purple-500/20'
                          )}
                        >
                          {/* カラープレビュー */}
                          {variable.category === 'color' && (
                            <div
                              className="w-4 h-4 rounded border border-[#444444] flex-shrink-0"
                              style={{ backgroundColor: variable.value }}
                            />
                          )}

                          {/* 変数情報 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white truncate">{variable.name}</div>
                          </div>

                          {/* 値 */}
                          <div className="text-[10px] text-gray-500 font-mono truncate max-w-[80px]">
                            {variable.value}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default PropertyVariablePicker;
