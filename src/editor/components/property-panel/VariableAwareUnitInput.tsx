"use client";

/**
 * VariableAwareUnitInput
 *
 * CSS変数と単位選択の両方をサポートする入力コンポーネント（ダークテーマ）
 * - 単位選択: px, %, em, rem, vw, vh
 * - CSS変数: var(--xxx) 形式での参照
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Button } from "../../../components/ui/button";
import { Search, X, Plus, Link2, Link2Off } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useEditorVariables } from "../../EditorContext";
import type { CSSVariableDefinition, CSSVariableCategory } from "../../../types/css-variables";
import { isVariableReference, extractVariableName, generateVarReference } from "../../../types/css-variables";
import { parseValueWithUnit, formatValueWithUnit, convertUnit, SPACING_UNITS, type UnitConversionContext } from "./unit-utils";

// ============================================
// 型定義
// ============================================

export interface VariableAwareUnitInputProps {
  /** CSS値文字列 (例: "16px", "1.5em", "100%", "var(--spacing)") */
  value: string | number | undefined;
  /** 値変更時のコールバック */
  onChange: (value: string) => void;
  /** 使用可能な単位リスト */
  units?: readonly string[];
  /** デフォルト単位 */
  defaultUnit?: string;
  /** フィルタするカテゴリ */
  category?: CSSVariableCategory | null;
  /** 最小値 */
  min?: number;
  /** 最大値 */
  max?: number;
  /** ステップ値 */
  step?: number;
  /** ラベル */
  label?: string;
  /** コンパクトモード */
  compact?: boolean;
  /** 無効化 */
  disabled?: boolean;
  /** 追加のクラス名 */
  className?: string;
  /** スクラブ機能を有効化 */
  enableScrubbing?: boolean;
  /** 変数リンクボタンを非表示 */
  hideVariableLink?: boolean;
  /** 単位変換コンテキスト */
  conversionContext?: UnitConversionContext;
}

// ============================================
// メインコンポーネント
// ============================================

export function VariableAwareUnitInput({
  value,
  onChange,
  units = SPACING_UNITS,
  defaultUnit = "px",
  category,
  min,
  max,
  step = 1,
  label,
  compact = false,
  disabled = false,
  className,
  enableScrubbing = true,
  hideVariableLink = false,
  conversionContext,
}: VariableAwareUnitInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  // 単位を独立して追跡（valueが数値に変わっても単位を保持）
  const [trackedUnit, setTrackedUnit] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; startValue: number } | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  // ドラッグ開始のための移動閾値
  const DRAG_THRESHOLD = 3;

  // CSS変数を取得
  const { variables, addVariable } = useEditorVariables();

  // 現在の値がCSS変数参照かどうか
  const isLinked = useMemo(() => {
    return typeof value === "string" && isVariableReference(value);
  }, [value]);

  // リンクされている変数を取得
  const linkedVariable = useMemo(() => {
    if (!isLinked || typeof value !== "string") return null;
    const varName = extractVariableName(value);
    return variables.find((v) => v.cssName === varName);
  }, [isLinked, value, variables]);

  // 値をパース（CSS変数以外の場合）
  const parsed = useMemo(() => {
    if (isLinked) {
      return {
        numericValue: 0,
        unit: defaultUnit,
        isSpecial: true,
        originalValue: typeof value === "string" ? value : "",
      };
    }
    const result = parseValueWithUnit(value, defaultUnit);
    // 数値が直接渡された場合、追跡中の単位があればそれを使用
    if (typeof value === 'number' && trackedUnit) {
      return { ...result, unit: trackedUnit };
    }
    return result;
  }, [value, defaultUnit, isLinked, trackedUnit]);

  // 文字列値から単位を追跡
  useEffect(() => {
    if (typeof value === 'string' && !isLinked) {
      const parsedValue = parseValueWithUnit(value, defaultUnit);
      if (!parsedValue.isSpecial && parsedValue.unit !== trackedUnit) {
        setTrackedUnit(parsedValue.unit);
      }
    }
  }, [value, isLinked, defaultUnit, trackedUnit]);

  const currentUnit = parsed.isSpecial ? defaultUnit : parsed.unit;

  // フィルタリングされた変数
  const filteredVariables = useMemo(() => {
    let filtered = variables;

    if (category) {
      filtered = filtered.filter((v) => v.category === category);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.name.toLowerCase().includes(query) ||
          v.cssName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [variables, category, searchQuery]);

  // 数値変更ハンドラ
  const handleNumberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;

      if (inputValue === "" || inputValue === "-") {
        onChange(formatValueWithUnit(0, currentUnit));
        return;
      }

      const newNum = parseFloat(inputValue);
      if (isNaN(newNum)) return;

      let clampedValue = newNum;
      if (min !== undefined && newNum < min) clampedValue = min;
      if (max !== undefined && newNum > max) clampedValue = max;

      onChange(formatValueWithUnit(clampedValue, currentUnit));
    },
    [onChange, currentUnit, min, max]
  );

  // 単位変更ハンドラ（値を変換）
  const handleUnitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newUnit = e.target.value;

      if (newUnit === "auto") {
        onChange("auto");
        return;
      }

      // 新しい単位を追跡
      setTrackedUnit(newUnit);

      if (parsed.isSpecial && !isLinked) {
        onChange(formatValueWithUnit(0, newUnit));
        return;
      }

      if (isLinked) {
        if (linkedVariable) {
          const numMatch = linkedVariable.value.match(/^([\d.]+)/);
          if (numMatch) {
            const convertedValue = convertUnit(parseFloat(numMatch[1]), currentUnit, newUnit, conversionContext || {});
            onChange(formatValueWithUnit(convertedValue, newUnit));
            return;
          }
        }
        onChange(formatValueWithUnit(0, newUnit));
        return;
      }

      // 単位変換を適用
      const convertedValue = convertUnit(parsed.numericValue, currentUnit, newUnit, conversionContext || {});
      onChange(formatValueWithUnit(convertedValue, newUnit));
    },
    [onChange, parsed, isLinked, linkedVariable, currentUnit, conversionContext]
  );

  // 変数を選択
  const handleSelectVariable = useCallback(
    (variable: CSSVariableDefinition) => {
      const varRef = generateVarReference(variable);
      onChange(varRef);
      setIsOpen(false);
      setSearchQuery("");
      setIsCreating(false);
    },
    [onChange]
  );

  // 変数作成
  const handleCreateVariable = useCallback(() => {
    if (!newVarName.trim() || !category || !addVariable) return;

    let finalValue: string;
    if (isLinked && linkedVariable) {
      finalValue = linkedVariable.value;
    } else {
      finalValue = formatValueWithUnit(parsed.numericValue, currentUnit);
    }

    const newVar = addVariable(newVarName.trim(), finalValue, category);
    const varRef = generateVarReference(newVar);
    onChange(varRef);

    setNewVarName("");
    setIsCreating(false);
    setIsOpen(false);
  }, [newVarName, category, addVariable, isLinked, linkedVariable, parsed, currentUnit, onChange]);

  // リンク解除
  const handleDetach = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (linkedVariable) {
        const parsedVar = parseValueWithUnit(linkedVariable.value, defaultUnit);
        onChange(formatValueWithUnit(parsedVar.numericValue, parsedVar.unit));
      } else {
        onChange(formatValueWithUnit(0, defaultUnit));
      }
      setIsOpen(false);
    },
    [linkedVariable, onChange, defaultUnit]
  );

  // スクラブ開始
  // 改善: クリックでフォーカスを許可し、ドラッグ閾値を超えた場合のみスクラブを開始
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (!enableScrubbing || disabled || isLinked) return;
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
        let newValue = startValue + delta * sensitivity * step;

        if (min !== undefined && newValue < min) newValue = min;
        if (max !== undefined && newValue > max) newValue = max;

        const precision = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
        newValue = Math.round(newValue * Math.pow(10, precision)) / Math.pow(10, precision);

        onChange(formatValueWithUnit(newValue, currentUnit));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        if (hasDragged) {
          setIsDragging(false);
        } else {
          // ドラッグしなかった場合はinputにフォーカスを当てる
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [enableScrubbing, disabled, isLinked, parsed, step, min, max, currentUnit, onChange]
  );

  // キーボード操作
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled || isLinked) return;

      const multiplier = e.shiftKey ? 10 : 1;
      let newValue = parsed.numericValue;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        newValue += step * multiplier;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        newValue -= step * multiplier;
      } else {
        return;
      }

      if (min !== undefined && newValue < min) newValue = min;
      if (max !== undefined && newValue > max) newValue = max;

      onChange(formatValueWithUnit(newValue, currentUnit));
    },
    [disabled, isLinked, parsed, step, min, max, currentUnit, onChange]
  );

  const inputWidth = compact ? "w-10" : "w-12";
  const selectWidth = "w-9";

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {label && (
        <span className="text-[10px] text-gray-500 w-5 flex-shrink-0">{label}</span>
      )}

      <div className="flex items-center relative">
        {/* 変数リンクボタン */}
        {!hideVariableLink && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  "h-5 w-4 flex items-center justify-center border border-r-0 rounded-l border-[#4a4a4a]",
                  isLinked
                    ? "bg-purple-900/50 text-purple-400"
                    : "bg-[#383838] text-gray-500 hover:text-gray-300 hover:bg-[#4a4a4a]",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                {isLinked ? <Link2 className="h-2.5 w-2.5" /> : <Link2Off className="h-2.5 w-2.5" />}
              </button>
            </PopoverTrigger>

            <PopoverContent className="w-56 p-0 bg-[#2a2a2a] border-[#4a4a4a]" align="start">
              <div className="p-2 border-b border-[#4a4a4a]">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-500" />
                  <input
                    type="text"
                    placeholder="変数を検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-7 pr-2 py-1 text-xs border border-[#4a4a4a] rounded bg-[#383838] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-[#0d99ff]"
                  />
                </div>
              </div>

              {isCreating ? (
                <div className="p-2 space-y-2">
                  <input
                    ref={createInputRef}
                    type="text"
                    placeholder="変数名を入力..."
                    value={newVarName}
                    onChange={(e) => setNewVarName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateVariable();
                      if (e.key === "Escape") setIsCreating(false);
                    }}
                    className="w-full px-2 py-1 text-xs border border-[#4a4a4a] rounded bg-[#383838] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-[#0d99ff]"
                    autoFocus
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsCreating(false)}
                      className="h-5 text-[10px] text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                    >
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreateVariable}
                      disabled={!newVarName.trim()}
                      className="h-5 text-[10px] bg-[#0d99ff] hover:bg-[#0c8ce9] text-white"
                    >
                      作成
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <ScrollArea className="max-h-40">
                    <div className="p-1">
                      {isLinked && linkedVariable && (
                        <button
                          onClick={handleDetach}
                          className="w-full flex items-center gap-2 px-2 py-1 text-[10px] rounded hover:bg-red-900/30 text-red-400"
                        >
                          <X className="h-3 w-3" />
                          リンクを解除
                        </button>
                      )}

                      {filteredVariables.length === 0 ? (
                        <div className="px-2 py-3 text-[10px] text-gray-500 text-center">
                          変数が見つかりません
                        </div>
                      ) : (
                        filteredVariables.map((variable) => (
                          <button
                            key={variable.id}
                            onClick={() => handleSelectVariable(variable)}
                            className={cn(
                              "w-full flex items-center justify-between px-2 py-1 text-[10px] rounded hover:bg-[#4a4a4a]",
                              linkedVariable?.id === variable.id && "bg-purple-900/30"
                            )}
                          >
                            <span className="font-medium text-gray-200">{variable.name}</span>
                            <span className="text-gray-500 font-mono text-[9px]">
                              {variable.value}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>

                  {category && (
                    <div className="p-1 border-t border-[#4a4a4a]">
                      <button
                        onClick={() => {
                          setIsCreating(true);
                          setTimeout(() => createInputRef.current?.focus(), 0);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1 text-[10px] rounded hover:bg-[#4a4a4a] text-gray-400"
                      >
                        <Plus className="h-3 w-3" />
                        新しい変数を作成
                      </button>
                    </div>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* 数値入力 */}
        <input
          ref={inputRef}
          type={isLinked ? "text" : "number"}
          value={isLinked ? (linkedVariable?.name ?? extractVariableName(String(value)) ?? "") : parsed.numericValue}
          onChange={handleNumberChange}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          min={min}
          max={max}
          step={step}
          disabled={disabled || isLinked}
          readOnly={isLinked}
          className={cn(
            `${inputWidth} h-5 px-1 text-[10px] border border-[#4a4a4a]`,
            hideVariableLink ? "rounded-l" : "",
            "bg-[#383838] text-gray-200 focus:outline-none focus:border-[#0d99ff]",
            "disabled:bg-[#2a2a2a] disabled:text-gray-500",
            isDragging ? "cursor-ew-resize" : enableScrubbing && !isLinked ? "cursor-ew-resize" : "",
            isLinked && "bg-purple-900/30 text-purple-300 font-medium text-[9px]",
            "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          )}
          style={{ MozAppearance: "textfield" }}
        />

        {/* 単位選択。
            [移植時の修正] compact(パディング/マージンの十字レイアウト)では隠す。
            入力9文字幅+単位9文字幅が3列×2ブロック並ぶとパネル幅を超えて中身がはみ出す。
            この用途は事実上pxしか使わないため、単位は固定で十分。 */}
        {!compact && (
        <select
          value={isLinked ? "" : currentUnit}
          onChange={handleUnitChange}
          disabled={disabled || isLinked}
          className={cn(
            `${selectWidth} h-5 px-0.5 text-[9px] border border-l-0 rounded-r border-[#4a4a4a]`,
            "bg-[#4a4a4a] text-gray-300 focus:outline-none focus:border-[#0d99ff]",
            "disabled:bg-[#383838] disabled:text-gray-500 cursor-pointer",
            isLinked && "opacity-50"
          )}
        >
          {isLinked && <option value="">--</option>}
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        )}
      </div>
    </div>
  );
}

export default VariableAwareUnitInput;
