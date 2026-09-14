'use client';

/**
 * VariableAwareSizeInput
 *
 * Figmaスタイルの変数対応サイズ入力コンポーネント（ダークテーマ）
 * サイズモード(fixed/fill/hug)、単位選択、変数選択を統合
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Ruler, Plus, Link2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { useEditorVariables } from '../../EditorContext';
import type { CSSVariableDefinition } from '../../../types/css-variables';
import { isVariableReference, extractVariableName, generateVarReference } from '../../../types/css-variables';
import { parseValueWithUnit, formatValueWithUnit, convertUnit, type UnitConversionContext } from './unit-utils';

export type SizeMode = 'fixed' | 'fill' | 'hug';

// Width用の単位
const WIDTH_UNITS = ['px', '%', 'vw', 'em', 'rem'] as const;
// Height用の単位
const HEIGHT_UNITS = ['px', '%', 'vh', 'em', 'rem'] as const;

interface VariableAwareSizeInputProps {
  value: number | string;
  mode: SizeMode;
  onChangeValue: (value: string) => void;
  onChangeMode: (mode: SizeMode) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  min?: number;
  max?: number;
  canFill?: boolean;
  canHug?: boolean;
  /** 'width' or 'height' - 単位リストを決定 */
  dimension?: 'width' | 'height';
  /** 単位変換コンテキスト */
  conversionContext?: UnitConversionContext;
}

export function VariableAwareSizeInput({
  value,
  mode,
  onChangeValue,
  onChangeMode,
  label,
  disabled = false,
  min = 0,
  max,
  canFill = false,
  canHug = false,
  dimension = 'width',
  conversionContext,
}: VariableAwareSizeInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [localValue, setLocalValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // 単位を独立して追跡（valueが数値に変わっても単位を保持）
  const [trackedUnit, setTrackedUnit] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<{ x: number; startValue: number } | null>(null);
  // ドラッグ開始のための移動閾値
  const DRAG_THRESHOLD = 3;

  // 単位リストを決定
  const unitList = dimension === 'height' ? HEIGHT_UNITS : WIDTH_UNITS;

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

  // 値と単位をパース
  const parsed = useMemo(() => {
    if (isLinked) {
      return { numericValue: 0, unit: 'px', isSpecial: true };
    }
    if (typeof value === 'number') {
      // 数値の場合、追跡中の単位があればそれを使用
      return { numericValue: value, unit: trackedUnit || 'px', isSpecial: false };
    }
    return parseValueWithUnit(value, 'px');
  }, [value, isLinked, trackedUnit]);

  // 文字列値から単位を追跡
  useEffect(() => {
    if (typeof value === 'string' && !isLinked) {
      const parsedValue = parseValueWithUnit(value, 'px');
      if (!parsedValue.isSpecial && parsedValue.unit !== trackedUnit) {
        setTrackedUnit(parsedValue.unit);
      }
    }
  }, [value, isLinked, trackedUnit]);

  const currentUnit = parsed.unit;

  // スペーシング変数のみフィルター
  const spacingVariables = useMemo(() => {
    let filtered = variables.filter(v => v.category === 'spacing');

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.name.toLowerCase().includes(query) ||
        v.cssName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [variables, searchQuery]);

  // 表示値
  const displayValue = useMemo(() => {
    if (isLinked && linkedVariable) {
      return linkedVariable.name;
    }
    return parsed.numericValue;
  }, [isLinked, linkedVariable, parsed]);

  // 変数を選択
  const handleSelectVariable = useCallback((variable: CSSVariableDefinition) => {
    const varReference = generateVarReference(variable);
    onChangeValue(varReference);
    setIsOpen(false);
    setSearchQuery('');
  }, [onChangeValue]);

  // リンク解除
  const handleDetach = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkedVariable) {
      onChangeValue(linkedVariable.value);
    } else {
      onChangeValue('auto');
    }
  }, [linkedVariable, onChangeValue]);

  // モード変更
  const handleModeChange = useCallback((newMode: SizeMode) => {
    onChangeMode(newMode);
    setIsOpen(false);
  }, [onChangeMode]);

  // 入力値の変更
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    const num = parseFloat(newValue);
    if (!isNaN(num)) {
      let clampedValue = num;
      if (min !== undefined) clampedValue = Math.max(min, clampedValue);
      if (max !== undefined) clampedValue = Math.min(max, clampedValue);
      onChangeValue(formatValueWithUnit(clampedValue, currentUnit));
    }
  }, [onChangeValue, min, max, currentUnit]);

  // 単位変更（値を変換）
  const handleUnitChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
    const context: UnitConversionContext = {
      ...conversionContext,
      property: dimension === 'height' ? 'height' : 'width',
    };
    const convertedValue = convertUnit(parsed.numericValue, currentUnit, newUnit, context);
    // 新しい単位を追跡
    setTrackedUnit(newUnit);
    onChangeValue(formatValueWithUnit(convertedValue, newUnit));
  }, [onChangeValue, parsed.numericValue, currentUnit, conversionContext, dimension]);

  // 入力のフォーカス時
  const handleInputFocus = useCallback(() => {
    if (!isLinked) {
      setLocalValue(String(Math.round(parsed.numericValue)));
    }
  }, [isLinked, parsed.numericValue]);

  // 現在の値から変数を作成
  const handleCreateVariable = useCallback(() => {
    if (!newVarName.trim() || !addVariable) return;

    let finalValue = newVarValue.trim();
    if (!finalValue) {
      finalValue = formatValueWithUnit(parsed.numericValue, currentUnit);
    }

    const newVar = addVariable(newVarName.trim(), finalValue, 'spacing');
    const varRef = generateVarReference(newVar);
    onChangeValue(varRef);

    setNewVarName('');
    setNewVarValue('');
    setIsCreating(false);
    setIsOpen(false);
  }, [newVarName, newVarValue, parsed, currentUnit, addVariable, onChangeValue]);

  // 変数作成UIを開く
  const handleStartCreating = useCallback(() => {
    setIsCreating(true);
    setSearchQuery('');
    setNewVarValue(formatValueWithUnit(parsed.numericValue, currentUnit));
    setTimeout(() => createInputRef.current?.focus(), 0);
  }, [parsed, currentUnit]);

  // 変数作成をキャンセル
  const handleCancelCreating = useCallback(() => {
    setIsCreating(false);
    setNewVarName('');
    setNewVarValue('');
  }, []);

  // スクラブ開始（ドラッグで値を変更）
  // 改善: クリックでフォーカスを許可し、ドラッグ閾値を超えた場合のみスクラブを開始
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (disabled || isLinked || mode !== 'fixed') return;
      if (e.button !== 0) return;
      // 既にフォーカスされている場合は通常の入力を許可
      if (document.activeElement === inputRef.current) return;

      const startX = e.clientX;
      const startValue = parsed.numericValue;
      let hasDragged = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;

        // ドラッグ閾値を超えるまでは何もしない
        if (!hasDragged && Math.abs(delta) < DRAG_THRESHOLD) {
          return;
        }

        // 閾値を超えたらドラッグモードに入る
        if (!hasDragged) {
          hasDragged = true;
          setIsDragging(true);
          // ドラッグ開始時にフォーカスを外す
          inputRef.current?.blur();
        }

        const sensitivity = moveEvent.shiftKey ? 0.1 : 1;
        let newValue = startValue + delta * sensitivity;

        if (min !== undefined && newValue < min) newValue = min;
        if (max !== undefined && newValue > max) newValue = max;

        newValue = Math.round(newValue);
        onChangeValue(formatValueWithUnit(newValue, currentUnit));
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        if (hasDragged) {
          setIsDragging(false);
        } else {
          // ドラッグしなかった場合はinputにフォーカスを当てる
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [disabled, isLinked, mode, parsed, min, max, currentUnit, onChangeValue]
  );

  // 単位の欄が付くのは固定値で変数に紐づいていないときだけ
  const hasUnit = mode === 'fixed' && !isLinked;

  return (
    // [.group] 外の group はパネルの共通の入力の見た目(高さ 32px・左右 8px の余白の塗り)を中に当てないための印。
    // 中の数値と単位は枠を持たず、箱(下の .group.h-5)が 1 つの入力として見える
    <div
      className="group flex items-center gap-1 min-w-0"
      data-size-field={dimension === 'height' ? 'h' : 'w'}
    >
      {/* Label area (W/H) */}
      {label && <div className="shrink-0">{label}</div>}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {/* [幅] 以前は固定値の箱を w-14(56px)に決め打ちし、その外に単位(40px)を置いていたため、
              数値に使える幅が 26px しか残らず「1499」「1820」が切れていた。
              箱はモードによらず列の残りをすべて使い、数値・単位・モード切替をこの中に並べる */}
          <div
            data-size-box
            className={cn(
              "group flex flex-1 min-w-0 items-center h-5 bg-[#383838] border border-[#4a4a4a] rounded cursor-pointer",
              "hover:border-[#5d5d5d]",
              disabled && "opacity-50 cursor-not-allowed",
              isOpen && "ring-1 ring-[#0d99ff] border-[#0d99ff]"
            )}
          >
            {/* コンテンツ */}
            <div className="flex-1 min-w-0 h-full flex items-center pl-1.5">
              {mode === 'fixed' ? (
                isLinked ? (
                  <div className="flex items-center gap-0.5 flex-1 min-w-0">
                    <Link2 className="w-2.5 h-2.5 text-purple-400 flex-shrink-0" />
                    <span className="text-purple-300 truncate text-[9px] font-medium">
                      {linkedVariable?.name || '?'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDetach(e);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-0.5 hover:text-red-400 transition-colors flex-shrink-0"
                      title="変数を解除"
                    >
                      <X className="w-2 h-2 text-gray-400 hover:text-red-400" />
                    </button>
                  </div>
                ) : (
                  <input
                    ref={inputRef}
                    type="number"
                    value={localValue || displayValue}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    onMouseDown={handleMouseDown}
                    onClick={(e) => e.stopPropagation()}
                    disabled={disabled}
                    className={cn(
                      "w-full min-w-0 p-0 bg-transparent border-none outline-none text-gray-200 text-[10px] tabular-nums",
                      "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                      isDragging ? "cursor-ew-resize" : "cursor-ew-resize"
                    )}
                  />
                )
              ) : mode === 'fill' ? (
                <span className="text-[8px] text-gray-400 truncate select-none">
                  Fill
                </span>
              ) : (
                <span className="text-[8px] text-gray-400 truncate select-none">
                  Hug
                </span>
              )}
            </div>

            {/* 単位セレクター（fixed モードで変数リンクがない場合のみ）。
                箱の中にあるので、押してもモード切替のメニューは開かない */}
            {hasUnit && (
              <select
                value={currentUnit}
                onChange={handleUnitChange}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={disabled}
                title="単位"
                data-size-unit
                className={cn(
                  "h-full shrink-0 px-0.5 appearance-none bg-transparent border-none outline-none",
                  "text-[9px] text-gray-400 hover:text-white cursor-pointer",
                  "disabled:text-gray-500"
                )}
              >
                {unitList.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            )}

            {/* ドロップダウンアイコン */}
            <button
              type="button"
              className="h-full w-4 shrink-0 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
              disabled={disabled}
            >
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </div>
        </PopoverTrigger>

        <PopoverContent
          className="w-52 p-0 bg-[#2c2c2c] border-[#444444]"
          align="start"
          side="bottom"
          sideOffset={4}
        >
          {/* 検索 */}
          <div className="p-2 border-b border-[#444444]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
              <Input
                type="text"
                placeholder="検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-6 pl-7 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
                autoFocus
              />
            </div>
          </div>

          <ScrollArea className="max-h-56">
            {/* リサイズモード */}
            <div className="p-1 border-b border-[#444444]">
              <div className="px-2 py-0.5 text-[9px] text-gray-500 uppercase">
                リサイズ
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleModeChange('fixed');
                }}
                className={cn(
                  "w-full flex items-center justify-between px-2 py-1 rounded text-[10px] text-white",
                  "hover:bg-[#444444] transition-colors",
                  mode === 'fixed' && "text-[#4fb8ff]"
                )}
              >
                <span>固定 (Fixed)</span>
                {mode === 'fixed' && <span>✓</span>}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (canFill) handleModeChange('fill');
                }}
                disabled={!canFill}
                className={cn(
                  "w-full flex items-center justify-between px-2 py-1 rounded text-[10px] text-white",
                  "hover:bg-[#444444] transition-colors",
                  !canFill && "opacity-50 cursor-not-allowed",
                  mode === 'fill' && "text-[#4fb8ff]"
                )}
              >
                <span>コンテナ (Fill)</span>
                {mode === 'fill' && <span>✓</span>}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (canHug) handleModeChange('hug');
                }}
                disabled={!canHug}
                className={cn(
                  "w-full flex items-center justify-between px-2 py-1 rounded text-[10px] text-white",
                  "hover:bg-[#444444] transition-colors",
                  !canHug && "opacity-50 cursor-not-allowed",
                  mode === 'hug' && "text-[#4fb8ff]"
                )}
              >
                <span>コンテンツ (Hug)</span>
                {mode === 'hug' && <span>✓</span>}
              </button>
            </div>

            {/* スペーシング変数 */}
            <div className="p-1">
              <div className="px-2 py-0.5 text-[9px] text-gray-500 uppercase flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Ruler className="w-2.5 h-2.5" />
                  変数
                </div>
                {!isCreating && !isLinked && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleStartCreating();
                    }}
                    className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] text-gray-400 hover:text-white hover:bg-[#444444] rounded transition-colors"
                    title="変数を作成"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

              {/* 変数作成UI */}
              {isCreating && (
                <div className="px-2 py-1.5 mb-1 bg-[#2a2a2a] rounded">
                  <div className="space-y-1.5">
                    <Input
                      ref={createInputRef}
                      type="text"
                      placeholder="変数名"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateVariable();
                        else if (e.key === 'Escape') handleCancelCreating();
                      }}
                      className="h-5 text-[9px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600"
                    />
                    <Input
                      type="text"
                      placeholder="値 (例: 16px)"
                      value={newVarValue}
                      onChange={(e) => setNewVarValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateVariable();
                        else if (e.key === 'Escape') handleCancelCreating();
                      }}
                      className="h-5 text-[9px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600"
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancelCreating}
                        className="h-5 px-2 text-[9px] text-gray-400 hover:text-white"
                      >
                        キャンセル
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCreateVariable}
                        disabled={!newVarName.trim()}
                        className="h-5 px-2 text-[9px] bg-[#0d99ff] hover:bg-[#0c8ce9]"
                      >
                        作成
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {spacingVariables.length === 0 ? (
                <div className="px-2 py-2 text-[9px] text-gray-500 text-center">
                  変数なし
                </div>
              ) : (
                spacingVariables.map((variable) => (
                  <button
                    key={variable.id}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectVariable(variable);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2 py-1 rounded text-[10px]",
                      "hover:bg-[#444444] transition-colors",
                      linkedVariable?.id === variable.id
                        ? "bg-purple-900/30 text-purple-300"
                        : "text-white"
                    )}
                  >
                    <span className="truncate">{variable.name}</span>
                    <span className="text-gray-500 font-mono text-[8px]">{variable.value}</span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

    </div>
  );
}
