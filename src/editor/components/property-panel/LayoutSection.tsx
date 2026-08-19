'use client';

import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { Layers, ChevronRight } from 'lucide-react';
import type { SelectedElementInfo } from '../../types';

interface LayoutSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
}

export function LayoutSection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
}: LayoutSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white">
        <span className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" />
          レイアウト
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">X</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.x)}
              onChange={(e) => onStyleChange({ left: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">Y</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.y)}
              onChange={(e) => onStyleChange({ top: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">幅</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.width)}
              onChange={(e) => onStyleChange({ width: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">高さ</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.height)}
              onChange={(e) => onStyleChange({ height: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">角丸</Label>
            <Input
              type="number"
              value={Math.round(selectedElement.borderRadius)}
              onChange={(e) => onStyleChange({ borderRadius: `${e.target.value}px` })}
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">不透明度</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={Math.round(selectedElement.opacity * 100)}
              onChange={(e) =>
                onStyleChange({ opacity: String(parseInt(e.target.value) / 100) })
              }
              className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
