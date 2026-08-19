import React, { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

interface ScrubbableLabelProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  children: React.ReactNode;
  className?: string;
  cursorClass?: string;
}

export function ScrubbableLabel({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  children,
  className,
  cursorClass = 'cursor-ew-resize',
}: ScrubbableLabelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number>(0);
  const startValueRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startValueRef.current = value;

    // カーソルを強制的に変更
    document.body.style.cursor = 'ew-resize';
    document.body.classList.add('select-none'); // テキスト選択防止
  }, [value]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startXRef.current;
        
        // 修飾キーによるスピード調整
        let currentStep = step;
        if (e.shiftKey) currentStep *= 10;
        if (e.altKey) currentStep *= 0.1;

        const deltaValue = deltaX * currentStep;
        let newValue = startValueRef.current + deltaValue;

        // 最小値・最大値の制限
        newValue = Math.max(min, Math.min(max, newValue));

        // 整数に丸める場合（stepが整数の場合など、必要に応じて調整）
        // ここでは単純に渡すが、親側でMath.roundが必要なケースが多い
        
        onChange(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.classList.remove('select-none');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // クリーンアップ時にもカーソルリセット
      document.body.style.cursor = '';
      document.body.classList.remove('select-none');
    };
  }, [isDragging, onChange, step, min, max]);

  return (
    <Label
      onMouseDown={handleMouseDown}
      className={cn(
        cursorClass,
        'hover:text-blue-400 transition-colors select-none active:text-blue-500',
        className
      )}
      title="ドラッグして数値を変更"
    >
      {children}
    </Label>
  );
}
