'use client';

/**
 * ブレイクポイントセレクター
 * Webページモードでレスポンシブプレビュー用のビューポート幅を切り替える
 */

import { useState, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Monitor, Laptop, Tablet, Smartphone } from 'lucide-react';
import { useEditorContext } from '../EditorContext';
import { BREAKPOINT_PRESETS, type BreakpointIcon } from '../constants';

// ビューポート幅の制限
const MIN_VIEWPORT_WIDTH = 320;
const MAX_VIEWPORT_WIDTH = 1920;

// アイコンマッピング
const ICON_MAP: Record<BreakpointIcon, React.ComponentType<{ className?: string }>> = {
  'monitor': Monitor,
  'laptop': Laptop,
  'tablet': Tablet,
  'mobile': Smartphone,
  'mobile-small': Smartphone,
};

/**
 * ブレイクポイントセレクターコンポーネント
 * webpageモード専用（slideモードでは非表示）
 */
export function BreakpointSelector() {
  const { viewportWidth, setViewportWidth, editorMode, restoreFocus } = useEditorContext();
  const [isOpen, setIsOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState(viewportWidth.toString());

  // viewportWidthが外部から変更された場合にcustomWidthを同期
  useEffect(() => {
    setCustomWidth(viewportWidth.toString());
  }, [viewportWidth]);

  // webpageモード以外では表示しない
  if (editorMode !== 'webpage') return null;

  // 現在のプリセットを特定（カスタム値の場合はnull）
  const activePreset = BREAKPOINT_PRESETS.find(p => p.width === viewportWidth);

  // カスタム値かどうかを判定
  const isCustomWidth = !activePreset;

  // トリガーボタン用のアイコン（カスタム値の場合はMonitor）
  const TriggerIcon = activePreset ? ICON_MAP[activePreset.icon] : Monitor;

  const handlePresetSelect = (width: number) => {
    setViewportWidth(width);
    setCustomWidth(width.toString());
  };

  const handleCustomWidthChange = (value: string) => {
    setCustomWidth(value);
  };

  const handleCustomWidthBlur = () => {
    const width = parseInt(customWidth, 10);
    if (!isNaN(width)) {
      const clampedWidth = Math.max(MIN_VIEWPORT_WIDTH, Math.min(MAX_VIEWPORT_WIDTH, width));
      setViewportWidth(clampedWidth);
      setCustomWidth(clampedWidth.toString());
    } else {
      // 無効な値の場合は現在のviewportWidthに戻す
      setCustomWidth(viewportWidth.toString());
    }
  };

  const handleCustomWidthKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomWidthBlur();
    }
  };

  const handleDone = () => {
    setIsOpen(false);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    // ポップオーバーが閉じた時にフォーカスを復元
    if (!open) {
      requestAnimationFrame(() => {
        restoreFocus();
      });
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-gray-400 hover:text-white hover:bg-[#444444] gap-1.5"
        >
          <TriggerIcon className="h-4 w-4" />
          <span>{viewportWidth}px</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-4 bg-[#1e1e1e] border-[#444444]"
        side="top"
        align="center"
      >
        {/* ブレイクポイントオプション */}
        <div className="flex items-center gap-2 mb-4">
          {BREAKPOINT_PRESETS.map((preset) => {
            const Icon = ICON_MAP[preset.icon];
            const isActive = viewportWidth === preset.width;
            return (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.width)}
                className={`flex flex-col items-center p-3 rounded-lg transition-colors min-w-[60px]
                  ${isActive
                    ? 'bg-green-600 text-white'
                    : 'hover:bg-[#444444] text-gray-400 hover:text-white'
                  }`}
              >
                <Icon className={`h-6 w-6 mb-1 ${preset.icon === 'mobile-small' ? 'scale-75' : ''}`} />
                <span className="text-[10px] font-medium mb-0.5">{preset.name}</span>
                <span className="text-xs">{preset.width}</span>
              </button>
            );
          })}
        </div>

        {/* 範囲テキスト */}
        {activePreset ? (
          <p className="text-xs text-gray-500 mb-4 text-center">
            {activePreset.name}設定サイズ: {activePreset.minRange} ~ {activePreset.maxRange} px
          </p>
        ) : (
          <p className="text-xs text-gray-500 mb-4 text-center">
            カスタムサイズ: {viewportWidth}px
          </p>
        )}

        {/* カスタム幅入力 */}
        <div className="flex items-center gap-2 mb-4">
          <label className="text-xs text-gray-400 whitespace-nowrap">カスタム幅:</label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={customWidth}
              onChange={(e) => handleCustomWidthChange(e.target.value)}
              onBlur={handleCustomWidthBlur}
              onKeyDown={handleCustomWidthKeyDown}
              min={MIN_VIEWPORT_WIDTH}
              max={MAX_VIEWPORT_WIDTH}
              className={`w-20 h-8 text-xs bg-[#2c2c2c] border-[#444444] text-white text-center
                ${isCustomWidth ? 'border-green-600' : ''}`}
            />
            <span className="text-xs text-gray-500">px</span>
          </div>
          <span className="text-[10px] text-gray-600">({MIN_VIEWPORT_WIDTH}-{MAX_VIEWPORT_WIDTH})</span>
        </div>

        {/* 完了ボタン */}
        <Button
          onClick={handleDone}
          className="w-full bg-[#444444] hover:bg-[#4a4a4a] text-white"
          size="sm"
        >
          完了
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export default BreakpointSelector;
