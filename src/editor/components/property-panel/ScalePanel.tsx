'use client';

import { useMemo } from 'react';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { MousePointer2, Scaling, Check } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { useElementActions } from '../../hooks';
import { buildTransformString } from '../../utils/style-utils';

export function ScalePanel() {
  const { selectedElement, setActiveTool } = useEditorContext();
  const { updateElementStyle } = useElementActions();

  // 現在のスケール値を取得（デフォルト1）
  const currentScale = useMemo(() => {
    if (!selectedElement) return { x: 1, y: 1 };
    return {
      x: selectedElement.scaleX || 1,
      y: selectedElement.scaleY || 1,
    };
  }, [selectedElement]);

  // 見た目のサイズを計算
  const visualSize = useMemo(() => {
    if (!selectedElement) return { w: 0, h: 0 };
    return {
      w: Math.round(selectedElement.width * currentScale.x),
      h: Math.round(selectedElement.height * currentScale.y),
    };
  }, [selectedElement, currentScale]);

  // アンカーポイントの変換（CSS <-> UI）
  const currentAnchor = useMemo(() => {
    if (!selectedElement?.transformOrigin) return 'center center';
    // 数値の場合はキーワードに変換（簡易対応）
    const origin = selectedElement.transformOrigin;
    if (origin.includes('50% 50%')) return 'center center';
    return origin;
  }, [selectedElement]);

  const handleScaleChange = (newScale: number) => {
    if (!selectedElement) return;
    updateElementStyle({
      transform: buildTransformString({
        rotation: selectedElement.rotation,
        scaleX: newScale,
        scaleY: newScale, // アスペクト比維持のため両方変更
      }),
    });
  };

  const handleSizeChange = (dimension: 'w' | 'h', value: number) => {
    if (!selectedElement) return;
    
    // スケール前の元のサイズ
    const originalSize = dimension === 'w' ? selectedElement.width : selectedElement.height;
    if (originalSize === 0) return;

    // 新しいスケールを計算 (NewVisualSize / OriginalSize)
    const newScale = value / originalSize;

    updateElementStyle({
      transform: buildTransformString({
        rotation: selectedElement.rotation,
        scaleX: newScale,
        scaleY: newScale, // アスペクト比維持
      }),
    });
  };

  const anchorPoints = [
    { id: 'left top', label: '左上' },
    { id: 'center top', label: '中上' },
    { id: 'right top', label: '右上' },
    { id: 'left center', label: '左中' },
    { id: 'center center', label: '中心' },
    { id: 'right center', label: '右中' },
    { id: 'left bottom', label: '左下' },
    { id: 'center bottom', label: '中下' },
    { id: 'right bottom', label: '右下' },
  ];

  if (!selectedElement) {
    return (
      <div className="w-72 bg-[#2c2c2c] border-l border-[#444444] flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-gray-500 text-xs">
            <MousePointer2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>要素を選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 bg-[#2c2c2c] border-l border-[#444444] flex flex-col overflow-hidden">
      <div className="p-3 space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Scaling className="w-4 h-4 text-[#4fb8ff]" />
            <h3 className="text-sm font-medium text-white">拡大縮小</h3>
          </div>
          <button
            onClick={() => setActiveTool('select')}
            className="p-1 hover:bg-[#444444] rounded text-gray-400 hover:text-white transition-colors"
            title="完了 (選択ツールに戻る)"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>

        {/* 幅・高さ */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-gray-500">幅 (W)</Label>
            <div className="relative">
              <span className="absolute left-2 top-1.5 text-xs text-gray-500 font-mono">W</span>
              <Input
                type="number"
                value={visualSize.w}
                onChange={(e) => handleSizeChange('w', parseFloat(e.target.value) || 0)}
                className="h-8 pl-6 text-xs bg-[#383838] border-[#444444] text-white font-mono"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">高さ (H)</Label>
            <div className="relative">
              <span className="absolute left-2 top-1.5 text-xs text-gray-500 font-mono">H</span>
              <Input
                type="number"
                value={visualSize.h}
                onChange={(e) => handleSizeChange('h', parseFloat(e.target.value) || 0)}
                className="h-8 pl-6 text-xs bg-[#383838] border-[#444444] text-white font-mono"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 拡大率 */}
          <div>
            <Label className="text-[10px] text-gray-500 mb-1 block">拡大縮小</Label>
            <div className="flex gap-1">
              <div className="relative flex-1">
                 <Scaling className="absolute left-2 top-2 w-3.5 h-3.5 text-gray-500" />
                 <Input
                   type="text"
                   value={`${Math.round(currentScale.x * 100) / 100}x`}
                   onChange={(e) => {
                     const val = parseFloat(e.target.value.replace('x', ''));
                     if (!isNaN(val)) handleScaleChange(val);
                   }}
                   className="h-8 pl-7 text-xs bg-[#383838] border-[#444444] text-[#4fb8ff] font-bold border-[#0d99ff]/50"
                 />
              </div>
              <Select
                value={String(currentScale.x)}
                onValueChange={(val) => handleScaleChange(parseFloat(val))}
              >
                <SelectTrigger className="w-8 h-8 p-0 bg-[#383838] border-[#444444]">
                  <span className="sr-only">倍率を選択</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="4">4x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* アンカーポイント */}
          <div>
            <Label className="text-[10px] text-gray-500 mb-1 block">アンカーポイント</Label>
            <div className="grid grid-cols-3 gap-1 w-[72px] h-[72px] p-1 bg-[#2e2e2e] rounded-md border border-[#444444]">
              {anchorPoints.map((point) => (
                <button
                  key={point.id}
                  onClick={() => updateElementStyle({ transformOrigin: point.id })}
                  className={`w-4 h-4 rounded-sm flex items-center justify-center transition-colors ${
                    (selectedElement?.transformOrigin || 'center center') === point.id
                      ? 'bg-[#0d99ff]'
                      : 'bg-[#4a4a4a] hover:bg-[#5d5d5d]'
                  }`}
                  title={point.label}
                >
                  <div className={`w-0.5 h-0.5 rounded-full ${
                     (selectedElement?.transformOrigin || 'center center') === point.id
                      ? 'bg-white'
                      : 'bg-gray-400'
                  }`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
