'use client';

/**
 * テキスト値セル
 * インラインで編集可能なテキストセル
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';

interface TextValueCellProps {
  value: string;
  isEditing: boolean;
  isInherited?: boolean;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onValueChange: (value: string) => void;
  className?: string;
  prefix?: React.ReactNode;
}

export function TextValueCell({
  value,
  isEditing,
  isInherited = false,
  onStartEdit,
  onFinishEdit,
  onValueChange,
  className,
  prefix,
}: TextValueCellProps) {
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // 外部の値が変わったら内部の値も更新
  useEffect(() => {
    if (!isEditing) {
      setInputValue(value);
    }
  }, [value, isEditing]);

  // 編集開始時にフォーカス
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onValueChange(inputValue);
      onFinishEdit();
    } else if (e.key === 'Escape') {
      setInputValue(value);
      onFinishEdit();
    }
  }, [inputValue, value, onValueChange, onFinishEdit]);

  const handleBlur = useCallback(() => {
    if (inputValue !== value) {
      onValueChange(inputValue);
    }
    onFinishEdit();
  }, [inputValue, value, onValueChange, onFinishEdit]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 h-7">
        {prefix}
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={cn(
            'h-7 text-xs bg-[#383838] border-[#444444] text-white flex-1',
            className
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 h-7 cursor-pointer group',
        'hover:bg-[#444444]/50 rounded px-1 -mx-1',
        isInherited && 'opacity-50'
      )}
      onClick={onStartEdit}
    >
      {prefix}
      <span
        className={cn(
          'truncate text-xs',
          isInherited ? 'text-gray-500 italic' : 'text-gray-300',
          className
        )}
      >
        {value || <span className="text-gray-600">空</span>}
      </span>

      {/* 継承インジケーター */}
      {isInherited && (
        <span className="text-[10px] text-gray-600 ml-auto">継承</span>
      )}
    </div>
  );
}

export default TextValueCell;
