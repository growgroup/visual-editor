'use client';

/**
 * VariableAwareInput
 *
 * Figmaスタイルの変数対応入力コンポーネント
 * 入力欄から直接CSS変数を選択可能
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Search, X, ChevronDown, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useEditorVariables } from '../../EditorContext';
import type { CSSVariableDefinition, CSSVariableCategory } from '../../../types/css-variables';
import { isVariableReference, extractVariableName, generateVarReference } from '../../../types/css-variables';

// ============================================
// 型定義
// ============================================

export interface VariableAwareInputProps {
  /** 現在の値（数値または var(--xxx) 形式） */
  value: string | number;
  /** 値変更時のコールバック */
  onChange: (value: string) => void;
  /** フィルタするカテゴリ */
  category?: CSSVariableCategory | null;
  /** プレースホルダー */
  placeholder?: string;
  /** ラベル（入力欄の左に表示） */
  label?: string;
  /** 単位（入力欄の右に表示） */
  suffix?: string;
  /** 無効状態 */
  disabled?: boolean;
  /** クラス名 */
  className?: string;
  /** 数値のみ許可 */
  numericOnly?: boolean;
  /** 最小値（数値の場合） */
  min?: number;
  /** 最大値（数値の場合） */
  max?: number;
  /** コンパクトモード（パディング等の小さい入力用） */
  compact?: boolean;
}

// ============================================
// メインコンポーネント
// ============================================

export function VariableAwareInput({
  value,
  onChange,
  category,
  placeholder,
  label,
  suffix,
  disabled = false,
  className,
  numericOnly = true,
  min,
  max,
  compact = false,
}: VariableAwareInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [localValue, setLocalValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Scrubbing state
  const isScrubbing = useRef(false);
  const hasMoved = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // CSS変数を取得
  const { variables, addVariable } = useEditorVariables();

  // 現在の値がCSS変数参照かどうか
  const isLinked = useMemo(() => {
    return typeof value === 'string' && isVariableReference(value);
  }, [value]);

  // リンクされている変数を取得
  const linkedVariable = useMemo(() => {
    if (!isLinked || typeof value !== 'string') return null;
    const varName = extractVariableName(value);
    return variables.find(v => v.cssName === varName);
  }, [isLinked, value, variables]);

  // 表示値を計算
  const displayValue = useMemo(() => {
    if (isLinked && linkedVariable) {
      return linkedVariable.name;
    }
    return String(value);
  }, [isLinked, linkedVariable, value]);

  // ローカル値を同期
  useEffect(() => {
    if (!isLinked) {
      setLocalValue(String(value));
    }
  }, [value, isLinked]);

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

  // 変数を選択
  const handleSelectVariable = useCallback((variable: CSSVariableDefinition) => {
    const varRef = generateVarReference(variable);
    onChange(varRef);
    setIsOpen(false);
    setSearchQuery('');
    setIsCreating(false);
  }, [onChange]);

  // 現在の値から変数を作成
  const handleCreateVariable = useCallback(() => {
    if (!newVarName.trim() || !category || !addVariable) return;

    // 編集された値を使用（空の場合は現在の値を使う）
    let finalValue = newVarValue.trim();
    if (!finalValue) {
      if (typeof value === 'number') {
        finalValue = suffix ? `${value}${suffix}` : `${value}px`;
      } else if (isLinked) {
        return;
      } else {
        finalValue = String(value);
        if (numericOnly && !isNaN(parseFloat(finalValue)) && !finalValue.includes('px') && !finalValue.includes('%')) {
          finalValue = suffix ? `${finalValue}${suffix}` : `${finalValue}px`;
        }
      }
    }

    // 変数を作成
    const newVar = addVariable(newVarName.trim(), finalValue, category);

    // 作成した変数を選択
    const varRef = generateVarReference(newVar);
    onChange(varRef);

    // UIをリセット
    setNewVarName('');
    setNewVarValue('');
    setIsCreating(false);
    setIsOpen(false);
  }, [newVarName, newVarValue, value, suffix, category, addVariable, onChange, isLinked, numericOnly]);

  // 変数作成UIを開く
  const handleStartCreating = useCallback(() => {
    setIsCreating(true);
    setSearchQuery('');
    // 現在の値を初期値として設定
    if (typeof value === 'number') {
      setNewVarValue(suffix ? `${value}${suffix}` : `${value}px`);
    } else {
      setNewVarValue(String(value));
    }
    // 次のフレームでフォーカス
    setTimeout(() => createInputRef.current?.focus(), 0);
  }, [value, suffix]);

  // 変数作成をキャンセル
  const handleCancelCreating = useCallback(() => {
    setIsCreating(false);
    setNewVarName('');
    setNewVarValue('');
  }, []);

  // リンク解除
  const handleDetach = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (linkedVariable) {
      // リンクされた変数の実際の値を使用
      // 値が既に単位を含んでいる場合（例: "16px"）は数値部分のみ抽出
      let resolvedValue = linkedVariable.value;
      if (numericOnly) {
        const numMatch = resolvedValue.match(/^([\d.]+)/);
        if (numMatch) {
          resolvedValue = numMatch[1];
        }
      }
      onChange(resolvedValue);
    } else {
      // 変数が見つからない場合（削除された等）はデフォルト値を使用
      const defaultValue = numericOnly ? (min !== undefined ? String(min) : '0') : '';
      onChange(defaultValue);
    }
    setIsOpen(false);
  }, [linkedVariable, onChange, numericOnly, min]);

  // 入力値の変更
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    if (numericOnly) {
      const num = parseFloat(newValue);
      if (!isNaN(num)) {
        let clampedValue = num;
        if (min !== undefined) clampedValue = Math.max(min, clampedValue);
        if (max !== undefined) clampedValue = Math.min(max, clampedValue);
        onChange(String(clampedValue));
      }
    } else {
      onChange(newValue);
    }
  }, [onChange, numericOnly, min, max]);

  // キーボード操作
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' && !isOpen) {
      setIsOpen(true);
    } else if (numericOnly && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const currentNum = parseFloat(localValue) || 0;
      const step = e.shiftKey ? 10 : 1;
      const delta = e.key === 'ArrowUp' ? step : -step;
      let newVal = currentNum + delta;
      if (min !== undefined) newVal = Math.max(min, newVal);
      if (max !== undefined) newVal = Math.min(max, newVal);
      setLocalValue(String(newVal));
      onChange(String(newVal));
    }
  }, [isOpen, numericOnly, localValue, min, max, onChange]);

  // Scrubbing handler (horizontal drag to change value)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || isLinked || !numericOnly) return;
    // Don't start scrubbing if clicking on the dropdown button
    if ((e.target as HTMLElement).closest('button')) return;

    e.preventDefault();
    isScrubbing.current = true;
    hasMoved.current = false;
    startX.current = e.clientX;
    startValue.current = parseFloat(localValue) || 0;

    document.body.style.cursor = 'ew-resize';

    const handleMouseMove = (mmEvent: MouseEvent) => {
      if (!isScrubbing.current) return;

      const delta = mmEvent.clientX - startX.current;
      if (Math.abs(delta) < 3) return;

      hasMoved.current = true;

      let multiplier = 1;
      if (mmEvent.shiftKey) multiplier = 10;
      if (mmEvent.altKey) multiplier = 0.1;

      let newVal = startValue.current + Math.round(delta * multiplier);
      if (min !== undefined) newVal = Math.max(min, newVal);
      if (max !== undefined) newVal = Math.min(max, newVal);

      setLocalValue(String(newVal));
      onChange(String(newVal));
    };

    const handleMouseUp = () => {
      const didMove = hasMoved.current;
      isScrubbing.current = false;
      hasMoved.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      // If didn't move, focus the input for editing
      if (!didMove) {
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [disabled, isLinked, numericOnly, localValue, min, max, onChange]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          className={cn(
            'relative flex items-center bg-[#383838] border border-[#444444] rounded text-xs group/var-input overflow-hidden',
            'hover:border-[#5d5d5d] focus-within:border-[#0d99ff] focus-within:ring-1 focus-within:ring-[#0d99ff]',
            disabled && 'opacity-50 cursor-not-allowed',
            !disabled && !isLinked && numericOnly && 'cursor-ew-resize',
            compact ? 'h-5' : 'h-7',
            'min-w-0 w-full',
            className
          )}
        >
          {/* ラベル */}
          {label && (
            <span className={cn(
              "text-gray-500 select-none flex-shrink-0",
              compact ? "px-1 text-[10px]" : "px-2"
            )}>
              {label}
            </span>
          )}

          {/* 入力またはリンク表示 */}
          {isLinked ? (
            <div className={cn(
              "flex-1 flex items-center min-w-0 overflow-hidden",
              compact ? "px-0.5" : "px-1"
            )}>
              <div className={cn(
                "flex items-center gap-0.5 bg-[#2a2a2a] border border-[#4a4a4a] rounded min-w-0 max-w-full overflow-hidden",
                compact ? "px-1 py-0" : "px-1.5 py-0.5"
              )}>
                <span className={cn(
                  "text-white truncate font-medium min-w-0",
                  compact ? "text-[9px] max-w-[40px]" : "text-[10px]"
                )}>
                  {linkedVariable?.name || 'Unknown'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDetach(e);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className={cn(
                    "hover:text-red-400 transition-colors flex-shrink-0 flex items-center justify-center",
                    compact ? "p-0.5 -m-0.5" : "p-1 -m-0.5"
                  )}
                  title="変数を解除"
                >
                  <X className={cn(
                    "text-gray-400 hover:text-red-400",
                    compact ? "w-2.5 h-2.5" : "w-3 h-3"
                  )} />
                </button>
              </div>
            </div>
          ) : (
            <input
              ref={inputRef}
              type={numericOnly ? 'number' : 'text'}
              value={localValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                'flex-1 bg-transparent border-none outline-none text-white min-w-0 w-full',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                compact ? "text-[10px] px-1" : "text-xs px-2"
              )}
            />
          )}

          {/* サフィックスまたはドロップダウンアイコン */}
          {suffix && !isLinked && (
            <span className={cn(
              "text-gray-500 select-none flex-shrink-0",
              compact ? "px-0.5 text-[9px]" : "px-1.5"
            )}>
              {suffix}
            </span>
          )}

          {/* 変数インジケーター - コンパクトモードではホバー時のみ表示 */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(true);
            }}
            className={cn(
              'h-full flex items-center justify-center flex-shrink-0 text-gray-400',
              'hover:bg-[#4a4a4a] rounded-r transition-colors',
              isLinked && 'text-purple-400',
              compact ? 'px-0.5 opacity-0 group-hover/var-input:opacity-100' : 'px-1'
            )}
            title="CSS変数を選択"
          >
            <ChevronDown className={compact ? "w-2 h-2" : "w-3 h-3"} />
          </button>
        </div>
      </PopoverTrigger>

      <PopoverContent
        className={cn(
          "p-0 bg-[#2c2c2c] border-[#444444]",
          compact ? "w-48" : "w-64"
        )}
        align="start"
        side="bottom"
        sideOffset={4}
      >
        {/* 検索 */}
        <div className="p-2 border-b border-[#444444]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <Input
              type="text"
              placeholder="検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
              autoFocus
            />
          </div>
        </div>

        {/* カテゴリフィルター */}
        <div className="px-2 py-1.5 border-b border-[#444444] flex items-center justify-between">
          <span className="text-[10px] text-gray-500 uppercase">
            {category ? `${category} 変数` : 'すべての変数'}
          </span>
          {/* 変数作成ボタン（カテゴリがある場合のみ） */}
          {category && !isCreating && !isLinked && (
            <button
              type="button"
              onClick={handleStartCreating}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444] rounded transition-colors"
              title="現在の値から変数を作成"
            >
              <Plus className="w-3 h-3" />
              <span>作成</span>
            </button>
          )}
        </div>

        {/* 変数作成UI */}
        {isCreating && category && (
          <div className="p-2 border-b border-[#444444] bg-[#2a2a2a]">
            <div className="text-[10px] text-gray-400 mb-1.5">新しい変数を作成</div>
            <div className="space-y-2">
              {/* 変数名入力 */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 w-8 flex-shrink-0">名前</span>
                <Input
                  ref={createInputRef}
                  type="text"
                  placeholder="variable-name"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateVariable();
                    } else if (e.key === 'Escape') {
                      handleCancelCreating();
                    }
                  }}
                  className="h-6 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600 flex-1"
                />
              </div>
              {/* 値を編集 */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 w-8 flex-shrink-0">値</span>
                <Input
                  type="text"
                  placeholder="16px"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateVariable();
                    } else if (e.key === 'Escape') {
                      handleCancelCreating();
                    }
                  }}
                  className="h-6 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600 flex-1 font-mono"
                />
              </div>
              {/* 生成されるCSS変数名のプレビュー */}
              {newVarName.trim() && (
                <div className="text-[9px] text-gray-500 font-mono">
                  --{category}-{newVarName.trim().toLowerCase().replace(/\s+/g, '-')}
                </div>
              )}
              {/* ボタン */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateVariable}
                  disabled={!newVarName.trim()}
                  className="h-6 px-3 text-[10px] bg-purple-600 hover:bg-purple-700 text-white"
                >
                  作成
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelCreating}
                  className="h-6 px-3 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444]"
                >
                  キャンセル
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 変数リスト */}
        <ScrollArea className="max-h-48">
          {filteredVariables.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">
              {searchQuery ? '検索結果がありません' : '変数がありません'}
            </div>
          ) : (
            <div className="p-1">
              {filteredVariables.map((variable) => {
                const isSelected = linkedVariable?.id === variable.id;

                return (
                  <button
                    type="button"
                    key={variable.id}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectVariable(variable);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-white',
                      'hover:bg-[#444444] transition-colors',
                      isSelected && 'bg-purple-500/20'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* カラープレビュー */}
                      {variable.category === 'color' && (
                        <div
                          className="w-3 h-3 rounded border border-[#5d5d5d] flex-shrink-0"
                          style={{ backgroundColor: variable.value }}
                        />
                      )}
                      <span className="text-xs text-white truncate">
                        {variable.name}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono flex-shrink-0">
                      {variable.value}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default VariableAwareInput;
