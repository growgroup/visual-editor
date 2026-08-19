'use client';

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
import { Circle, ChevronRight } from 'lucide-react';
import { rgbToHex } from '../../utils/style-utils';
import { BORDER_STYLES } from '../../constants';
import type { SelectedElementInfo } from '../../types';

interface BorderSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
}

export function BorderSection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
}: BorderSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Circle className="w-3.5 h-3.5" />
          線
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">線幅</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.borderWidth)}
              onChange={(e) =>
                onStyleChange({
                  borderWidth: `${e.target.value}px`,
                  borderStyle:
                    selectedElement.borderStyle === 'none'
                      ? 'solid'
                      : selectedElement.borderStyle,
                })
              }
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">スタイル</Label>
            <Select
              value={selectedElement.borderStyle}
              onValueChange={(value) => onStyleChange({ borderStyle: value })}
            >
              <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BORDER_STYLES.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    {style.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">線色</Label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={rgbToHex(selectedElement.borderColor)}
              onChange={(e) => onStyleChange({ borderColor: e.target.value })}
              className="w-8 h-7 rounded border border-[#444444] bg-transparent cursor-pointer"
            />
            <Input
              type="text"
              value={rgbToHex(selectedElement.borderColor)}
              onChange={(e) => onStyleChange({ borderColor: e.target.value })}
              className="flex-1 h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
