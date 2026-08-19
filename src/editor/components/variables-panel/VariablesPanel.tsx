'use client';

/**
 * CSS変数管理パネル
 * Figmaスタイルのフローティングパネル
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ScrollArea } from '../../../components/ui/scroll-area';
import {
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
  X,
  Plus,
  Search,
  Save,
  GripVertical,
  Monitor,
  Tablet,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type {
  CSSVariableDefinition,
  CSSVariableCategory,
  BreakpointId,
} from '../../../types/css-variables';
import {
  CSS_VARIABLE_CATEGORIES,
  BREAKPOINT_CONFIGS,
  generateCSSName,
  generateVariableId,
  getValueForBreakpoint,
  setValueForBreakpoint,
} from '../../../types/css-variables';
import { ColorValueCell } from './ColorValueCell';
import { TextValueCell } from './TextValueCell';

// ============================================
// アイコンマッピング
// ============================================

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
};

const BREAKPOINT_ICONS: Record<string, LucideIcon> = {
  Monitor,
  Tablet,
  Smartphone,
  Watch: Smartphone, // fallback
};

// ============================================
// 型定義
// ============================================

interface VariablesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  variables: CSSVariableDefinition[];
  onAddVariable: (name: string, value: string, category: CSSVariableCategory, description?: string) => CSSVariableDefinition;
  onUpdateVariable: (id: string, updates: Partial<Omit<CSSVariableDefinition, 'id'>>) => void;
  onDeleteVariable: (id: string) => void;
  onSave: () => Promise<void>;
  isSaving?: boolean;
  hasChanges?: boolean;
}

interface PanelPosition {
  x: number;
  y: number;
}

// ============================================
// ドラッグフック
// ============================================

function useDraggable(initialPosition: PanelPosition) {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, [data-no-drag]')) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 500, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 400, e.clientY - dragOffset.current.y)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return { position, isDragging, handleMouseDown };
}

// ============================================
// メインコンポーネント
// ============================================

export function VariablesPanel({
  isOpen,
  onClose,
  variables,
  onAddVariable,
  onUpdateVariable,
  onDeleteVariable,
  onSave,
  isSaving = false,
  hasChanges = false,
}: VariablesPanelProps) {
  // パネル位置
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 100, y: 100 });

  // 状態
  const [activeCategory, setActiveCategory] = useState<CSSVariableCategory>('color');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState<{
    variableId: string;
    breakpoint: BreakpointId;
  } | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  // 表示するブレークポイント
  const [visibleBreakpoints] = useState<BreakpointId[]>(['default', 'tablet', 'mobile']);

  // カテゴリごとの変数カウント
  const categoryCounts = useMemo(() => {
    const counts: Record<CSSVariableCategory, number> = {
      color: 0,
      spacing: 0,
      typography: 0,
      border: 0,
      shadow: 0,
      other: 0,
    };
    variables.forEach(v => counts[v.category]++);
    return counts;
  }, [variables]);

  // フィルタリングされた変数
  const filteredVariables = useMemo(() => {
    return variables.filter(v => {
      if (v.category !== activeCategory) return false;
      if (searchQuery && !v.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [variables, activeCategory, searchQuery]);

  // 新しい変数を追加
  const handleAddVariable = useCallback(() => {
    if (!newVarName.trim()) return;

    const defaultValue = activeCategory === 'color' ? '#3b82f6' :
                        activeCategory === 'spacing' ? '16px' :
                        activeCategory === 'typography' ? '16px' :
                        activeCategory === 'border' ? '1px solid #e5e7eb' :
                        activeCategory === 'shadow' ? '0 1px 3px rgba(0,0,0,0.1)' : '';

    onAddVariable(newVarName.trim(), newVarValue || defaultValue, activeCategory);
    setNewVarName('');
    setNewVarValue('');
    setIsAddingNew(false);
  }, [newVarName, newVarValue, activeCategory, onAddVariable]);

  // 変数値を更新
  const handleUpdateValue = useCallback((variableId: string, breakpoint: BreakpointId, value: string) => {
    const variable = variables.find(v => v.id === variableId);
    if (!variable) return;

    if (breakpoint === 'default') {
      onUpdateVariable(variableId, { value });
    } else {
      const updated = setValueForBreakpoint(variable, breakpoint, value);
      onUpdateVariable(variableId, { breakpointValues: updated.breakpointValues });
    }
  }, [variables, onUpdateVariable]);

  // 変数名を更新
  const handleUpdateName = useCallback((variableId: string, name: string) => {
    const variable = variables.find(v => v.id === variableId);
    if (!variable) return;

    const newCssName = generateCSSName(name, variable.category);
    onUpdateVariable(variableId, { name, cssName: newCssName });
  }, [variables, onUpdateVariable]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed z-[1000] bg-[#2c2c2c] border border-[#444444] rounded-lg shadow-2xl',
        'flex flex-col',
        isDragging && 'cursor-grabbing select-none'
      )}
      style={{
        left: position.x,
        top: position.y,
        width: 600,
        maxHeight: 'calc(100vh - 100px)',
      }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-[#444444] cursor-grab"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <span className="text-sm font-medium text-white flex-1">CSS変数</span>

        {/* 検索 */}
        <div className="relative" data-no-drag>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <Input
            type="text"
            placeholder="検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-32 pl-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
          />
        </div>

        {/* 追加ボタン */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-400 hover:text-white"
          onClick={() => setIsAddingNew(true)}
          data-no-drag
        >
          <Plus className="w-4 h-4" />
        </Button>

        {/* 閉じるボタン */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-400 hover:text-white"
          onClick={onClose}
          data-no-drag
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* カテゴリタブ */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#444444] overflow-x-auto">
        {CSS_VARIABLE_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.icon] ?? Settings;
          const count = categoryCounts[cat.id];
          const isActive = activeCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-[#444444] text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[#444444]/50'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.label}</span>
              {count > 0 && (
                <span className={cn(
                  'text-[10px] px-1 rounded-full',
                  isActive ? 'bg-[#0d99ff] text-white' : 'bg-[#4a4a4a] text-gray-300'
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* テーブル */}
      <ScrollArea className="flex-1 min-h-0">
        <table className="w-full">
          {/* テーブルヘッダー */}
          <thead className="sticky top-0 bg-[#2c2c2c] z-10">
            <tr className="border-b border-[#444444]">
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase w-[180px]">
                名前
              </th>
              {BREAKPOINT_CONFIGS.filter(bp => visibleBreakpoints.includes(bp.id)).map((bp) => {
                const Icon = BREAKPOINT_ICONS[bp.icon] ?? Monitor;
                return (
                  <th key={bp.id} className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      <span>{bp.label}</span>
                    </div>
                  </th>
                );
              })}
              <th className="w-10" />
            </tr>
          </thead>

          <tbody>
            {filteredVariables.map((variable) => (
              <tr
                key={variable.id}
                className="border-b border-[#444444]/50 hover:bg-[#444444]/30"
              >
                {/* 名前セル */}
                <td className="px-3 py-1">
                  <TextValueCell
                    value={variable.name}
                    isEditing={editingCell?.variableId === variable.id && editingCell.breakpoint === 'default'}
                    onStartEdit={() => setEditingCell({ variableId: variable.id, breakpoint: 'default' })}
                    onFinishEdit={() => setEditingCell(null)}
                    onValueChange={(name) => handleUpdateName(variable.id, name)}
                    className="font-medium"
                    prefix={
                      activeCategory === 'color' ? (
                        <div
                          className="w-4 h-4 rounded border border-[#444444] flex-shrink-0"
                          style={{ backgroundColor: variable.value }}
                        />
                      ) : undefined
                    }
                  />
                </td>

                {/* 値セル（ブレークポイントごと） */}
                {BREAKPOINT_CONFIGS.filter(bp => visibleBreakpoints.includes(bp.id)).map((bp) => {
                  const value = getValueForBreakpoint(variable, bp.id);
                  const isInherited = bp.id !== 'default' && !variable.breakpointValues?.find(v => v.breakpoint === bp.id);
                  const isEditing = editingCell?.variableId === variable.id && editingCell.breakpoint === bp.id;

                  return (
                    <td key={bp.id} className="px-3 py-1">
                      {activeCategory === 'color' ? (
                        <ColorValueCell
                          value={value}
                          isEditing={isEditing}
                          isInherited={isInherited}
                          onStartEdit={() => setEditingCell({ variableId: variable.id, breakpoint: bp.id })}
                          onFinishEdit={() => setEditingCell(null)}
                          onValueChange={(newValue) => handleUpdateValue(variable.id, bp.id, newValue)}
                        />
                      ) : (
                        <TextValueCell
                          value={value}
                          isEditing={isEditing}
                          isInherited={isInherited}
                          onStartEdit={() => setEditingCell({ variableId: variable.id, breakpoint: bp.id })}
                          onFinishEdit={() => setEditingCell(null)}
                          onValueChange={(newValue) => handleUpdateValue(variable.id, bp.id, newValue)}
                          className="font-mono text-xs"
                        />
                      )}
                    </td>
                  );
                })}

                {/* 削除ボタン */}
                <td className="px-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-gray-500 hover:text-red-400"
                    onClick={() => onDeleteVariable(variable.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}

            {/* 新規追加行 */}
            {isAddingNew && (
              <tr className="border-b border-[#444444]/50 bg-[#444444]/20">
                <td className="px-3 py-2">
                  <Input
                    type="text"
                    placeholder="変数名"
                    value={newVarName}
                    onChange={(e) => setNewVarName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddVariable();
                      if (e.key === 'Escape') setIsAddingNew(false);
                    }}
                    autoFocus
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                  />
                </td>
                <td className="px-3 py-2" colSpan={visibleBreakpoints.length}>
                  <Input
                    type="text"
                    placeholder={activeCategory === 'color' ? '#3b82f6' : '値を入力'}
                    value={newVarValue}
                    onChange={(e) => setNewVarValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddVariable();
                      if (e.key === 'Escape') setIsAddingNew(false);
                    }}
                    className="h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
                  />
                </td>
                <td className="px-2">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-green-400 hover:text-green-300"
                      onClick={handleAddVariable}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-gray-500 hover:text-gray-300"
                      onClick={() => setIsAddingNew(false)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 変数がない場合 */}
        {filteredVariables.length === 0 && !isAddingNew && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <div className="text-sm mb-2">
              {searchQuery ? '検索結果がありません' : 'このカテゴリには変数がありません'}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddingNew(true)}
              className="text-xs bg-transparent border-[#444444] text-gray-400 hover:text-white hover:bg-[#444444]"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              新しい{CSS_VARIABLE_CATEGORIES.find(c => c.id === activeCategory)?.label}を追加
            </Button>
          </div>
        )}
      </ScrollArea>

      {/* フッター */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[#444444]">
        <div className="text-[10px] text-gray-500">
          {hasChanges && '未保存の変更があります'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onSave}
            disabled={isSaving || !hasChanges}
            className="h-7 text-xs"
          >
            {isSaving ? (
              <>
                <span className="animate-spin mr-1">⏳</span>
                保存中...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1" />
                保存
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default VariablesPanel;
