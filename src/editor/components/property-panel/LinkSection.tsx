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
import { Link, ChevronRight, ExternalLink } from 'lucide-react';
import type { SelectedElementInfo } from '../../types';

interface LinkSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttributeChange: (attrs: Record<string, string>) => void;
}

const TARGET_OPTIONS = [
  { value: '_self', label: '同じタブ' },
  { value: '_blank', label: '新しいタブ' },
  { value: '_parent', label: '親フレーム' },
  { value: '_top', label: 'トップフレーム' },
];

export function LinkSection({
  selectedElement,
  open,
  onOpenChange,
  onAttributeChange,
}: LinkSectionProps) {
  if (!selectedElement.isLink) return null;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Link className="w-3.5 h-3.5" />
          リンク
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        {/* URL */}
        <div>
          <Label className="text-[10px] text-gray-500">URL</Label>
          <Input
            type="text"
            value={selectedElement.linkHref}
            onChange={(e) => onAttributeChange({ href: e.target.value })}
            placeholder="https://example.com"
            className="h-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
          />
        </div>

        {/* Title */}
        <div>
          <Label className="text-[10px] text-gray-500">タイトル</Label>
          <Input
            type="text"
            value={selectedElement.linkTitle}
            onChange={(e) => onAttributeChange({ title: e.target.value })}
            placeholder="リンクの説明"
            className="h-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
          />
        </div>

        {/* Target */}
        <div>
          <Label className="text-[10px] text-gray-500">開き方</Label>
          <Select
            value={selectedElement.linkTarget || '_self'}
            onValueChange={(value) => onAttributeChange({ target: value })}
          >
            <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-1.5">
                    {opt.value === '_blank' && <ExternalLink className="w-3 h-3" />}
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
