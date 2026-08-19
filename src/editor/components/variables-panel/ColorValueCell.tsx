'use client';

/**
 * カラー値セル
 * インラインでカラーピッカーを表示
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';

interface ColorValueCellProps {
  value: string;
  isEditing: boolean;
  isInherited?: boolean;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onValueChange: (value: string) => void;
}

// シンプルなカラーピッカー（後でFigmaColorPickerに置き換え可能）
function SimpleColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [inputValue, setInputValue] = useState(color);

  useEffect(() => {
    setInputValue(color);
  }, [color]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      onChange(value);
    }
  };

  return (
    <div className="p-2 space-y-2">
      {/* カラーパレット */}
      <input
        type="color"
        value={color.startsWith('#') ? color : '#000000'}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
        }}
        className="w-full h-24 rounded cursor-pointer border border-[#444444]"
      />

      {/* HEX入力 */}
      <Input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder="#000000"
        className="h-7 text-xs font-mono bg-[#383838] border-[#444444] text-white"
      />

      {/* プリセットカラー */}
      <div className="grid grid-cols-8 gap-1">
        {[
          '#ef4444', '#f97316', '#eab308', '#22c55e',
          '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
          '#1f2937', '#374151', '#6b7280', '#9ca3af',
          '#d1d5db', '#e5e7eb', '#f3f4f6', '#ffffff',
        ].map((preset) => (
          <button
            key={preset}
            onClick={() => {
              setInputValue(preset);
              onChange(preset);
            }}
            className={cn(
              'w-5 h-5 rounded border border-[#444444] cursor-pointer hover:ring-2 hover:ring-[#0d99ff]',
              color === preset && 'ring-2 ring-[#0d99ff]'
            )}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>
    </div>
  );
}

export function ColorValueCell({
  value,
  isEditing,
  isInherited = false,
  onStartEdit,
  onFinishEdit,
  onValueChange,
}: ColorValueCellProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (open) {
      onStartEdit();
    } else {
      onFinishEdit();
    }
  }, [onStartEdit, onFinishEdit]);

  return (
    <div
      className={cn(
        'flex items-center gap-2 h-7 group cursor-pointer',
        isInherited && 'opacity-50'
      )}
    >
      {/* カラースウォッチ */}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'w-5 h-5 rounded border border-[#444444] flex-shrink-0',
              'hover:ring-2 hover:ring-[#0d99ff] transition-shadow',
              isOpen && 'ring-2 ring-[#0d99ff]'
            )}
            style={{ backgroundColor: value }}
          />
        </PopoverTrigger>
        <PopoverContent
          className="w-48 p-0 bg-[#2c2c2c] border-[#444444]"
          align="start"
          side="bottom"
        >
          <SimpleColorPicker
            color={value}
            onChange={onValueChange}
          />
        </PopoverContent>
      </Popover>

      {/* HEX値 */}
      <span
        className={cn(
          'font-mono text-xs truncate',
          isInherited ? 'text-gray-500 italic' : 'text-gray-300'
        )}
        onClick={() => handleOpenChange(true)}
      >
        {value}
      </span>

      {/* 継承インジケーター */}
      {isInherited && (
        <span className="text-[10px] text-gray-600 ml-auto">継承</span>
      )}
    </div>
  );
}

export default ColorValueCell;
