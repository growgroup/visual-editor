'use client';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Slider } from '../../../components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { Image, ChevronRight, Upload, Trash2 } from 'lucide-react';
import { IMAGE_FILL_MODES } from '../../constants';
import {
  getBackgroundSizeFromFillMode,
  getBackgroundRepeatFromFillMode,
} from '../../utils/style-utils';
import type { SelectedElementInfo, ImageFillMode } from '../../types';

interface ImageSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
}

export function ImageSection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
}: ImageSectionProps) {
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      onStyleChange({
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: getBackgroundSizeFromFillMode(selectedElement.imageFillMode),
        backgroundPosition: `${selectedElement.imagePositionX}% ${selectedElement.imagePositionY}%`,
        backgroundRepeat: getBackgroundRepeatFromFillMode(selectedElement.imageFillMode),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    onStyleChange({
      backgroundImage: 'none',
      backgroundSize: 'auto',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
  };

  const handleFillModeChange = (value: ImageFillMode) => {
    onStyleChange({
      backgroundSize: getBackgroundSizeFromFillMode(value),
      backgroundRepeat: getBackgroundRepeatFromFillMode(value),
    });
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Image className="w-3.5 h-3.5" />
          画像
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        {/* 画像アップロード */}
        <div>
          <Label className="text-[10px] text-gray-500">背景画像</Label>
          <div className="flex items-center gap-2 mt-1">
            <label className="flex-1 flex items-center justify-center gap-2 h-7 text-xs bg-[#383838] border border-[#444444] text-white rounded cursor-pointer hover:bg-[#4a4a4a]">
              <Upload className="h-3 w-3" />
              画像を選択
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-[#4a4a4a]"
              onClick={handleClearImage}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* フィルモード選択 */}
        {selectedElement.hasBackgroundImage && (
          <>
            <div>
              <Label className="text-[10px] text-gray-500">フィルモード</Label>
              <Select
                value={selectedElement.imageFillMode}
                onValueChange={handleFillModeChange}
              >
                <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_FILL_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 位置調整（タイルモード以外） */}
            {selectedElement.imageFillMode !== 'tile' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-gray-500">X位置</Label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[selectedElement.imagePositionX]}
                      onValueChange={([value]) => {
                        onStyleChange({
                          backgroundPosition: `${value}% ${selectedElement.imagePositionY}%`,
                        });
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-400 w-8">
                      {selectedElement.imagePositionX}%
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-gray-500">Y位置</Label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[selectedElement.imagePositionY]}
                      onValueChange={([value]) => {
                        onStyleChange({
                          backgroundPosition: `${selectedElement.imagePositionX}% ${value}%`,
                        });
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-400 w-8">
                      {selectedElement.imagePositionY}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* スケール（タイルモードのみ） */}
            {selectedElement.imageFillMode === 'tile' && (
              <div>
                <Label className="text-[10px] text-gray-500">スケール</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.imageScale]}
                    onValueChange={([value]) => {
                      onStyleChange({
                        backgroundSize: `${value}%`,
                      });
                    }}
                    min={10}
                    max={200}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.imageScale}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
