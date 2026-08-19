'use client';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { Palette, ChevronRight, EyeOff } from 'lucide-react';
import { rgbToHex } from '../../utils/style-utils';
import type { SelectedElementInfo } from '../../types';

interface FillSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
}

export function FillSection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
}: FillSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Palette className="w-3.5 h-3.5" />
          塗り
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        <div>
          <Label className="text-[10px] text-gray-500">背景色</Label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={rgbToHex(selectedElement.backgroundColor)}
              onChange={(e) => onStyleChange({ backgroundColor: e.target.value })}
              className="w-8 h-7 rounded border border-[#444444] bg-transparent cursor-pointer"
            />
            <Input
              type="text"
              value={rgbToHex(selectedElement.backgroundColor)}
              onChange={(e) => onStyleChange({ backgroundColor: e.target.value })}
              className="flex-1 h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onStyleChange({ backgroundColor: 'transparent' })}
              className="h-7 w-7 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
              title="透明にする"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
