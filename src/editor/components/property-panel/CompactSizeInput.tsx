'use client';

import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../../../components/ui/dropdown-menu';
import { CompactNumberInput } from './CompactNumberInput';

export type SizeMode = 'fixed' | 'fill' | 'hug';

interface CompactSizeInputProps {
  value: number;
  mode: SizeMode;
  onChangeValue: (value: number) => void;
  onChangeMode: (mode: SizeMode) => void;
  label?: React.ReactNode; // W or H label component
  disabled?: boolean;
  min?: number;
  max?: number;
  canFill?: boolean; // "Fill container" is available
  canHug?: boolean;  // "Hug contents" is available
}

export function CompactSizeInput({
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
}: CompactSizeInputProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 表示するコンテンツの決定
  const renderContent = () => {
    if (mode === 'fixed') {
      return (
        <CompactNumberInput
          value={value}
          onChange={onChangeValue}
          min={min}
          max={max}
          className="flex-1 border-0 bg-transparent h-full"
          disabled={disabled}
        />
      );
    } else if (mode === 'fill') {
      return (
        <span className="flex-1 text-[9px] text-gray-400 px-1 truncate select-none flex items-center">
          コンテナに合わせて拡大
        </span>
      );
    } else if (mode === 'hug') {
      return (
        <span className="flex-1 text-[9px] text-gray-400 px-1 truncate select-none flex items-center">
          コンテンツを内包
        </span>
      );
    }
    return null;
  };

  return (
    <div className="flex items-center gap-1 group/size-input">
      {/* Label area (W/H) */}
      {label && <div className="shrink-0">{label}</div>}

      {/* Input / Display area + Dropdown trigger */}
      <div 
        className={cn(
          "flex-1 flex items-center h-7 bg-[#383838] border border-[#444444] rounded relative",
          disabled && "opacity-50 cursor-not-allowed",
          isOpen && "ring-1 ring-[#0d99ff] border-[#0d99ff]"
        )}
      >
        {/* Main Content */}
        <div className="flex-1 min-w-0 h-full flex flex-col justify-center">
          {renderContent()}
        </div>

        {/* Dropdown Trigger */}
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button 
              className={cn(
                "h-full px-1 flex items-center justify-center text-gray-500 hover:text-white transition-colors focus:outline-none",
                // Fixedモードの時はホバー時のみ表示、それ以外は常時表示っぽく見せるが、
                // デザイン的には右端に常に矢印があったほうがわかりやすいかも
              )}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-[#2c2c2c] border-[#444444] text-white">
            <DropdownMenuLabel className="text-[10px] text-gray-500 font-normal">
              リサイズ戦略
            </DropdownMenuLabel>
            
            <DropdownMenuSeparator className="bg-[#444444]" />

            <DropdownMenuItem 
              className="text-xs focus:bg-[#383838] focus:text-white cursor-pointer flex justify-between"
              onClick={() => onChangeMode('fixed')}
            >
              <span>幅を固定 (Fixed)</span>
              {mode === 'fixed' && <span className="text-[#4fb8ff]">✓</span>}
            </DropdownMenuItem>

            <DropdownMenuItem 
              className={cn(
                "text-xs focus:bg-[#383838] focus:text-white cursor-pointer flex justify-between",
                !canFill && "opacity-50 cursor-not-allowed text-gray-500"
              )}
              disabled={!canFill}
              onClick={() => canFill && onChangeMode('fill')}
            >
              <span>コンテナに合わせて拡大 (Fill)</span>
              {mode === 'fill' && <span className="text-[#4fb8ff]">✓</span>}
            </DropdownMenuItem>

            <DropdownMenuItem 
              className={cn(
                "text-xs focus:bg-[#383838] focus:text-white cursor-pointer flex justify-between",
                !canHug && "opacity-50 cursor-not-allowed text-gray-500"
              )}
              disabled={!canHug}
              onClick={() => canHug && onChangeMode('hug')}
            >
              <span>コンテンツを内包 (Hug)</span>
              {mode === 'hug' && <span className="text-[#4fb8ff]">✓</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
