"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { parseValueWithUnit, formatValueWithUnit, SPACING_UNITS } from "./unit-utils";

export interface UnitAwareNumberInputProps {
  /** CSS値文字列 (例: "16px", "1.5em", "100%") */
  value: string | number | undefined;
  /** 値変更時のコールバック */
  onChange: (value: string) => void;
  /** 使用可能な単位リスト */
  units?: readonly string[];
  /** デフォルト単位 */
  defaultUnit?: string;
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
  /** プレースホルダー */
  placeholder?: string;
}

/**
 * 単位選択付き数値入力コンポーネント
 * 既存のCompactNumberInputを置き換えずに、単位機能を追加した新しいコンポーネント
 */
export function UnitAwareNumberInput({
  value,
  onChange,
  units = SPACING_UNITS,
  defaultUnit = "px",
  min,
  max,
  step = 1,
  label,
  compact = false,
  disabled = false,
  className,
  enableScrubbing = true,
  placeholder,
}: UnitAwareNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; startValue: number } | null>(null);

  // 値をパース
  const parsed = useMemo(
    () => parseValueWithUnit(value, defaultUnit),
    [value, defaultUnit]
  );

  // 特殊値（var(...), auto等）の場合は元の値を表示
  const displayValue = parsed.isSpecial ? parsed.originalValue : parsed.numericValue;
  const currentUnit = parsed.isSpecial ? defaultUnit : parsed.unit;

  // 数値変更ハンドラ
  const handleNumberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;

      // 空の場合
      if (inputValue === "" || inputValue === "-") {
        onChange(formatValueWithUnit(0, currentUnit));
        return;
      }

      const newNum = parseFloat(inputValue);
      if (isNaN(newNum)) return;

      // 範囲チェック
      let clampedValue = newNum;
      if (min !== undefined && newNum < min) clampedValue = min;
      if (max !== undefined && newNum > max) clampedValue = max;

      onChange(formatValueWithUnit(clampedValue, currentUnit));
    },
    [onChange, currentUnit, min, max]
  );

  // 単位変更ハンドラ
  const handleUnitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newUnit = e.target.value;

      // autoの場合は特別処理
      if (newUnit === "auto") {
        onChange("auto");
        return;
      }

      // 特殊値の場合は単位変更のみ（数値は0）
      if (parsed.isSpecial) {
        onChange(formatValueWithUnit(0, newUnit));
        return;
      }

      onChange(formatValueWithUnit(parsed.numericValue, newUnit));
    },
    [onChange, parsed]
  );

  // スクラブ開始
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (!enableScrubbing || disabled || parsed.isSpecial) return;

      // 左クリックのみ
      if (e.button !== 0) return;

      // inputがフォーカスされている場合はスクラブしない
      if (document.activeElement === inputRef.current) return;

      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        startValue: parsed.numericValue,
      };

      // マウスイベントリスナーを追加
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const delta = moveEvent.clientX - dragStartRef.current.x;
        const sensitivity = moveEvent.shiftKey ? 0.1 : 1; // Shift押下で細かく調整
        let newValue = dragStartRef.current.startValue + delta * sensitivity * step;

        // 範囲チェック
        if (min !== undefined && newValue < min) newValue = min;
        if (max !== undefined && newValue > max) newValue = max;

        // 小数点以下を適切に丸める
        const precision = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
        newValue = Math.round(newValue * Math.pow(10, precision)) / Math.pow(10, precision);

        onChange(formatValueWithUnit(newValue, currentUnit));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        dragStartRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [enableScrubbing, disabled, parsed, step, min, max, currentUnit, onChange]
  );

  // キーボード操作
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled || parsed.isSpecial) return;

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

      // 範囲チェック
      if (min !== undefined && newValue < min) newValue = min;
      if (max !== undefined && newValue > max) newValue = max;

      onChange(formatValueWithUnit(newValue, currentUnit));
    },
    [disabled, parsed, step, min, max, currentUnit, onChange]
  );

  const inputWidth = compact ? "w-12" : "w-16";
  const selectWidth = "w-14";

  return (
    <div className={`flex items-center gap-0.5 ${className || ""}`}>
      {label && (
        <span className="text-[10px] text-gray-500 w-6 flex-shrink-0">{label}</span>
      )}
      <div className="flex items-center">
        <input
          ref={inputRef}
          type={parsed.isSpecial ? "text" : "number"}
          value={displayValue}
          onChange={handleNumberChange}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={placeholder}
          className={`${inputWidth} h-6 px-1.5 text-[11px] border border-r-0 rounded-l border-gray-200
            bg-white focus:outline-none focus:ring-1 focus:ring-[#0d99ff] focus:border-[#0d99ff]
            disabled:bg-gray-50 disabled:text-gray-400
            ${isDragging ? "cursor-ew-resize" : enableScrubbing && !parsed.isSpecial ? "cursor-ew-resize" : ""}
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          style={{ MozAppearance: "textfield" }}
        />
        <select
          value={parsed.isSpecial && parsed.originalValue === "auto" ? "auto" : currentUnit}
          onChange={handleUnitChange}
          disabled={disabled}
          className={`${selectWidth} h-6 px-1 text-[10px] border rounded-r border-gray-200
            bg-gray-50 text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#0d99ff]
            disabled:bg-gray-100 disabled:text-gray-400 cursor-pointer`}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default UnitAwareNumberInput;
