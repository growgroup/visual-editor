'use client';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
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
import {
  Type,
  ChevronRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from 'lucide-react';
import { FONT_WEIGHTS } from '../../constants';
import { rgbToHex } from '../../utils/style-utils';
import { GoogleFontPicker } from './GoogleFontPicker';
import type { SelectedElementInfo } from '../../types';

interface TypographySectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
  iframeDoc?: Document | null;
}

export function TypographySection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
  iframeDoc,
}: TypographySectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Type className="w-3.5 h-3.5" />
          テキスト
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        <div>
          <Label className="text-[10px] text-gray-500">フォント</Label>
          <GoogleFontPicker
            value={selectedElement.fontFamily}
            onChange={(value) => onStyleChange({ fontFamily: value })}
            iframeDoc={iframeDoc}
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">ウェイト</Label>
            <Select
              value={selectedElement.fontWeight}
              onValueChange={(value) => onStyleChange({ fontWeight: value })}
            >
              <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHTS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">サイズ</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.fontSize)}
              onChange={(e) => onStyleChange({ fontSize: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">行高</Label>
            <Input
              type="text"
              value={selectedElement.lineHeight}
              onChange={(e) => onStyleChange({ lineHeight: e.target.value })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">字間</Label>
            <Input
              type="text"
              value={selectedElement.letterSpacing}
              onChange={(e) => onStyleChange({ letterSpacing: e.target.value })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">配置</Label>
          <div className="flex gap-1 mt-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onStyleChange({ textAlign: 'left' })}
              className={`h-7 w-7 ${
                selectedElement.textAlign === 'left' 
                  ? 'bg-[#0d99ff] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onStyleChange({ textAlign: 'center' })}
              className={`h-7 w-7 ${
                selectedElement.textAlign === 'center' 
                  ? 'bg-[#0d99ff] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onStyleChange({ textAlign: 'right' })}
              className={`h-7 w-7 ${
                selectedElement.textAlign === 'right' 
                  ? 'bg-[#0d99ff] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <AlignRight className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-7 bg-[#444444] mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                onStyleChange({
                  fontWeight: selectedElement.fontWeight === '700' ? '400' : '700',
                })
              }
              className={`h-7 w-7 ${
                selectedElement.fontWeight === '700' 
                  ? 'bg-[#0d99ff] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <Bold className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                onStyleChange({
                  fontStyle: selectedElement.fontStyle === 'italic' ? 'normal' : 'italic',
                })
              }
              className={`h-7 w-7 ${
                selectedElement.fontStyle === 'italic' 
                  ? 'bg-[#0d99ff] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <Italic className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                onStyleChange({
                  textDecoration: selectedElement.textDecoration.includes('underline')
                    ? 'none'
                    : 'underline',
                })
              }
              className={`h-7 w-7 ${
                selectedElement.textDecoration.includes('underline')
                  ? 'bg-[#0d99ff] text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
              }`}
            >
              <Underline className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">文字色</Label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={rgbToHex(selectedElement.color)}
              onChange={(e) => onStyleChange({ color: e.target.value })}
              className="w-8 h-7 rounded border border-[#444444] bg-transparent cursor-pointer"
            />
            <Input
              type="text"
              value={rgbToHex(selectedElement.color)}
              onChange={(e) => onStyleChange({ color: e.target.value })}
              className="flex-1 h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
