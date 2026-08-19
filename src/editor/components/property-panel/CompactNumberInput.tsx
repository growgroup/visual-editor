"use client";

/**
 * CompactNumberInput - Figmaライクな数値入力コンポーネント
 *
 * 特徴:
 * - コンパクトなサイズでオーバーフローしない
 * - 空値も許容（削除可能）
 * - フォーカス時のみ編集可能、非フォーカス時は値表示
 * - 上下矢印キーで値を増減
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../../lib/utils";

interface CompactNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CompactNumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  placeholder = "0",
  className,
  disabled = false,
}: CompactNumberInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const isScrubbing = useRef(false);
  const hasMoved = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);

  // 外部値が変更されたら入力値を更新
  useEffect(() => {
    if (!isEditing && !isScrubbing.current) {
      setInputValue(String(value));
    }
  }, [value, isEditing]);

  // 値をクランプして変更を通知
  const commitValue = useCallback(
    (val: string) => {
      const parsed = parseFloat(val);
      if (isNaN(parsed)) {
        // 空の場合は0にリセット
        onChange(0);
        setInputValue("0");
      } else {
        const clamped = Math.max(min, Math.min(max, parsed));
        onChange(clamped);
        setInputValue(String(clamped));
      }
    },
    [onChange, min, max],
  );

  const handleFocus = () => {
    if (isScrubbing.current) return;
    setIsEditing(true);
    setInputValue(String(value));
    // 全選択
    setTimeout(() => {
      inputRef.current?.select();
    }, 0);
  };

  const handleBlur = () => {
    if (isScrubbing.current) return;
    setIsEditing(false);
    commitValue(inputValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // 数値、マイナス、小数点のみ許可
    if (val === "" || val === "-" || /^-?\d*\.?\d*$/.test(val)) {
      setInputValue(val);
      // 有効な数値ならリアルタイムで反映
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        const clamped = Math.max(min, Math.min(max, parsed));
        onChange(clamped);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitValue(inputValue);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setInputValue(String(value));
      inputRef.current?.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const amount = e.shiftKey ? step * 10 : step;
      const newVal = (parseFloat(inputValue) || 0) + amount;
      const clamped = Math.max(min, Math.min(max, newVal));
      setInputValue(String(clamped));
      onChange(clamped);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const amount = e.shiftKey ? step * 10 : step;
      const newVal = (parseFloat(inputValue) || 0) - amount;
      const clamped = Math.max(min, Math.min(max, newVal));
      setInputValue(String(clamped));
      onChange(clamped);
    }
  };

  // スクラブ操作のハンドラ
  const handleMouseDown = (e: React.MouseEvent) => {
    // 入力中はスクラブさせない
    if (isEditing) return;

    e.preventDefault();
    isScrubbing.current = true;
    hasMoved.current = false;
    startX.current = e.clientX;
    startValue.current = value;

    document.body.style.cursor = "ew-resize";

    const handleMouseMove = (mmEvent: MouseEvent) => {
      if (!isScrubbing.current) return;

      const delta = mmEvent.clientX - startX.current;
      // 小さな移動は無視（クリック判定のため）
      if (Math.abs(delta) < 3) return;

      hasMoved.current = true;

      // Shiftキーで10倍、Altキーで0.1倍
      let multiplier = 1;
      if (mmEvent.shiftKey) multiplier = 10;
      if (mmEvent.altKey) multiplier = 0.1;

      const change = Math.round(delta * step * multiplier);
      const newVal = startValue.current + change;
      const clamped = Math.max(min, Math.min(max, newVal));

      setInputValue(String(clamped));
      onChange(clamped);
    };

    const handleMouseUp = () => {
      const didMove = hasMoved.current;
      isScrubbing.current = false;
      hasMoved.current = false;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      // ドラッグしていなければ編集モードに入る（クリック扱い）
      if (!didMove) {
        setIsEditing(true);
        setInputValue(String(value));
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // ダブルクリックで編集モードに入る
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsEditing(true);
    setInputValue(String(value));
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  return (
    <div
      className={cn(
        "relative flex items-center bg-[#383838] rounded border border-[#444444] h-5 group",
        disabled && "opacity-50 cursor-not-allowed",
        !isEditing && !disabled && "cursor-ew-resize hover:border-[#555]",
        className,
      )}
      onMouseDown={!disabled ? handleMouseDown : undefined}
      onDoubleClick={!disabled ? handleDoubleClick : undefined}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={inputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "w-full h-full bg-transparent text-white text-center text-[10px] px-1 outline-none",
          "focus:ring-1 focus:ring-[#0d99ff] rounded",
          !isEditing &&
            !disabled &&
            "cursor-ew-resize selection:bg-transparent", // スクラブ中はカーソル変更＆選択無効
          suffix && "pr-4",
        )}
      />
      {suffix && (
        <span className="absolute right-1 text-[9px] text-gray-500 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default CompactNumberInput;
