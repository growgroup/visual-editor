'use client';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { Circle, ChevronRight } from 'lucide-react';
import { buildBoxShadow } from '../../utils/style-utils';
import { DEFAULT_SHADOW } from '../../constants';
import type { SelectedElementInfo } from '../../types';

interface EffectSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyleChange: (styles: Record<string, string>) => void;
}

export function EffectSection({
  selectedElement,
  open,
  onOpenChange,
  onStyleChange,
}: EffectSectionProps) {
  const toggleShadow = () => {
    if (selectedElement.hasShadow) {
      onStyleChange({ boxShadow: 'none' });
    } else {
      onStyleChange({
        boxShadow: buildBoxShadow(
          DEFAULT_SHADOW.color,
          DEFAULT_SHADOW.x,
          DEFAULT_SHADOW.y,
          DEFAULT_SHADOW.blur,
          DEFAULT_SHADOW.spread
        ),
      });
    }
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Circle className="w-3.5 h-3.5" />
          エフェクト
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500">ドロップシャドウ</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleShadow}
              className="h-5 text-[10px] text-gray-400 hover:text-white"
            >
              {selectedElement.hasShadow ? '削除' : '追加'}
            </Button>
          </div>
          {selectedElement.hasShadow && (
            <div className="space-y-2 mt-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-gray-500">X</Label>
                  <Input
                    type="number"
                    value={selectedElement.shadowX}
                    onChange={(e) => {
                      onStyleChange({
                        boxShadow: buildBoxShadow(
                          selectedElement.shadowColor,
                          parseInt(e.target.value) || 0,
                          selectedElement.shadowY,
                          selectedElement.shadowBlur,
                          selectedElement.shadowSpread
                        ),
                      });
                    }}
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-gray-500">Y</Label>
                  <Input
                    type="number"
                    value={selectedElement.shadowY}
                    onChange={(e) => {
                      onStyleChange({
                        boxShadow: buildBoxShadow(
                          selectedElement.shadowColor,
                          selectedElement.shadowX,
                          parseInt(e.target.value) || 0,
                          selectedElement.shadowBlur,
                          selectedElement.shadowSpread
                        ),
                      });
                    }}
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-gray-500">ぼかし</Label>
                  <Input
                    type="number"
                    value={selectedElement.shadowBlur}
                    onChange={(e) => {
                      onStyleChange({
                        boxShadow: buildBoxShadow(
                          selectedElement.shadowColor,
                          selectedElement.shadowX,
                          selectedElement.shadowY,
                          parseInt(e.target.value) || 0,
                          selectedElement.shadowSpread
                        ),
                      });
                    }}
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-gray-500">広がり</Label>
                  <Input
                    type="number"
                    value={selectedElement.shadowSpread}
                    onChange={(e) => {
                      onStyleChange({
                        boxShadow: buildBoxShadow(
                          selectedElement.shadowColor,
                          selectedElement.shadowX,
                          selectedElement.shadowY,
                          selectedElement.shadowBlur,
                          parseInt(e.target.value) || 0
                        ),
                      });
                    }}
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
