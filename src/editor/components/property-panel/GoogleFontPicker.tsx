'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { ChevronDown, Search, Check, Loader2 } from 'lucide-react';
import {
  useGoogleFonts,
  useFilteredFonts,
  FONT_CATEGORIES,
  type FontCategory,
  type GoogleFont,
} from '../../hooks/useGoogleFonts';

interface GoogleFontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
  iframeDoc?: Document | null;
  className?: string;
}

/**
 * Google Fontsフォントピッカー
 * 検索、カテゴリフィルター、プレビュー付きのフォント選択コンポーネント
 */
export function GoogleFontPicker({
  value,
  onChange,
  iframeDoc,
  className = '',
}: GoogleFontPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<FontCategory>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { fonts, isLoading, loadFontInIframe, getFontPreviewStyle } = useGoogleFonts();
  const filteredFonts = useFilteredFonts(fonts, searchQuery, category);

  // ポップオーバーが開いたら検索フィールドにフォーカス
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // フォント選択ハンドラー
  const handleSelectFont = useCallback((font: GoogleFont) => {
    // デバイスフォントはOSで名前が違うので、スタックごと書き込む
    onChange(font.stack ?? font.family);

    // iframeにフォントをロード
    if (iframeDoc) {
      loadFontInIframe(font.family, iframeDoc, font.variants);
    }

    setOpen(false);
    setSearchQuery('');
  }, [onChange, iframeDoc, loadFontInIframe]);

  // プレビュー用にフォントをロード（ホバー時）
  const handleFontHover = useCallback((font: GoogleFont) => {
    // プレビュー用のlinkタグをメインドキュメントに追加
    const existingLink = document.querySelector(`link[data-font-preview="${font.family}"]`);
    if (existingLink) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@400&display=swap`;
    link.dataset.fontPreview = font.family;
    document.head.appendChild(link);
  }, []);

  // 表示する現在のフォント名
  const displayValue = value || 'フォントを選択';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`h-7 justify-between text-xs bg-[#383838] border-[#444444] text-white hover:bg-[#4c4c4c] hover:text-white ${className}`}
        >
          <span
            className="truncate"
            style={{
              // スタック(カンマ入り)が入っているときは二重引用しない
              fontFamily: value ? (value.includes(',') ? value : `"${value}", sans-serif`) : 'inherit',
            }}
          >
            {displayValue}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 bg-[#2c2c2c] border-[#444444]"
        align="start"
      >
        {/* 検索フィールド */}
        <div className="p-2 border-b border-[#444444]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <Input
              ref={searchInputRef}
              placeholder="フォントを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-8 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>

        {/* カテゴリタブ */}
        <div className="flex gap-1 p-2 border-b border-[#444444] overflow-x-auto">
          {FONT_CATEGORIES.map((cat) => (
            <Button
              key={cat.value}
              variant="ghost"
              size="sm"
              onClick={() => setCategory(cat.value)}
              className={`h-6 px-2 text-[10px] whitespace-nowrap ${
                category === cat.value
                  ? 'bg-[#0d99ff] text-white hover:bg-[#0c8ce9]'
                  : 'text-gray-400 hover:text-white hover:bg-[#383838]'
              }`}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {/* フォントリスト */}
        <ScrollArea className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : filteredFonts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-gray-500">
              フォントが見つかりません
            </div>
          ) : (
            <div className="p-1">
              {filteredFonts.map((font) => (
                <button
                  key={font.family}
                  onClick={() => handleSelectFont(font)}
                  onMouseEnter={() => handleFontHover(font)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 text-xs rounded transition-colors ${
                    value === font.family
                      ? 'bg-[#0d99ff] text-white'
                      : 'text-gray-300 hover:bg-[#383838] hover:text-white'
                  }`}
                >
                  <span
                    className="truncate"
                    style={getFontPreviewStyle(font.family)}
                  >
                    {font.family}
                  </span>
                  {value === font.family && (
                    <Check className="h-3.5 w-3.5 shrink-0 ml-2" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* フッター情報 */}
        <div className="p-2 border-t border-[#444444]">
          <p className="text-[10px] text-gray-500 text-center">
            {filteredFonts.length}件のフォント
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default GoogleFontPicker;
