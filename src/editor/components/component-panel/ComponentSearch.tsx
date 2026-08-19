'use client';

/**
 * ComponentSearch - Search input with filter for components
 *
 * Provides a search input field with a search icon and clear button.
 * Matches the dark theme of the editor.
 */

import React, { useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';

interface ComponentSearchProps {
  /** Current search value */
  value: string;
  /** Callback when search value changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
}

/**
 * Search input component for filtering components.
 * Supports keyboard navigation (Escape to clear).
 */
export function ComponentSearch({
  value,
  onChange,
  placeholder = 'コンポーネントを検索...',
  autoFocus = false,
}: ComponentSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onChange('');
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && value) {
        e.stopPropagation();
        handleClear();
      }
    },
    [value, handleClear]
  );

  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-7 text-xs pl-7 pr-7 bg-[#383838] border-[#444444] text-white placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-[#0d99ff]"
        aria-label="コンポーネントを検索"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500 hover:text-white hover:bg-transparent"
          onClick={handleClear}
          aria-label="検索をクリア"
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

export default ComponentSearch;
