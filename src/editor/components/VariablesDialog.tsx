'use client';

/**
 * CSS変数管理ダイアログ
 * FigmaライクなCSS変数（デザイントークン）の定義・編集UI
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Palette,
  Ruler,
  Type,
  Square,
  Layers,
  Settings,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Save,
  X,
  Check,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  CSSVariableDefinition,
  CSSVariableCategory,
  CSSVariableGroup,
} from '../../types/css-variables';
import {
  CSS_VARIABLE_CATEGORIES,
  generateCSSName,
  generateVariableId,
} from '../../types/css-variables';

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

function getCategoryIcon(iconName: string): LucideIcon {
  return CATEGORY_ICONS[iconName] ?? Settings;
}

// ============================================
// 型定義
// ============================================

interface VariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: CSSVariableDefinition[];
  variableGroups: CSSVariableGroup[];
  isLoading?: boolean;
  isSaving?: boolean;
  hasChanges?: boolean;
  onAddVariable: (name: string, value: string, category: CSSVariableCategory, description?: string) => CSSVariableDefinition;
  onUpdateVariable: (id: string, updates: Partial<Omit<CSSVariableDefinition, 'id'>>) => void;
  onDeleteVariable: (id: string) => void;
  onSave: () => Promise<void>;
  onSyncFromTheme?: () => void;
}

// ============================================
// 変数編集フォーム
// ============================================

interface VariableEditorFormProps {
  variable?: CSSVariableDefinition;
  category: CSSVariableCategory;
  onSubmit: (data: { name: string; value: string; category: CSSVariableCategory; description?: string }) => void;
  onCancel: () => void;
  isNew?: boolean;
}

function VariableEditorForm({
  variable,
  category: initialCategory,
  onSubmit,
  onCancel,
  isNew = false,
}: VariableEditorFormProps) {
  const [name, setName] = useState(variable?.name ?? '');
  const [value, setValue] = useState(variable?.value ?? '');
  const [category, setCategory] = useState<CSSVariableCategory>(variable?.category ?? initialCategory);
  const [description, setDescription] = useState(variable?.description ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;
    onSubmit({ name: name.trim(), value: value.trim(), category, description: description.trim() || undefined });
  };

  const cssName = useMemo(() => generateCSSName(name, category), [name, category]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-gray-50 rounded-lg border">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">
          {isNew ? '新しい変数を追加' : '変数を編集'}
        </h4>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel} aria-label="閉じる">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3">
        {/* カテゴリ選択 */}
        <div className="grid gap-1.5">
          <Label className="text-xs">カテゴリ</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as CSSVariableCategory)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CSS_VARIABLE_CATEGORIES.map((cat) => {
                const Icon = getCategoryIcon(cat.icon);
                return (
                  <SelectItem key={cat.id} value={cat.id}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{cat.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* 名前 */}
        <div className="grid gap-1.5">
          <Label className="text-xs">名前</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="primary"
            className="h-8 text-sm"
          />
          {name && (
            <p className="text-xs text-gray-500 font-mono">{cssName}</p>
          )}
        </div>

        {/* 値 */}
        <div className="grid gap-1.5">
          <Label className="text-xs">値</Label>
          <div className="flex gap-2">
            {category === 'color' && (
              <input
                type="color"
                value={value.startsWith('#') ? value : '#000000'}
                onChange={(e) => setValue(e.target.value)}
                className="w-8 h-8 rounded border cursor-pointer"
              />
            )}
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={category === 'color' ? '#3b82f6' : '16px'}
              className="h-8 text-sm font-mono flex-1"
            />
          </div>
        </div>

        {/* 説明 */}
        <div className="grid gap-1.5">
          <Label className="text-xs">説明（オプション）</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="変数の説明..."
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim() || !value.trim()}>
          <Check className="h-3.5 w-3.5 mr-1" />
          {isNew ? '追加' : '更新'}
        </Button>
      </div>
    </form>
  );
}

// ============================================
// 変数アイテム表示
// ============================================

interface VariableItemProps {
  variable: CSSVariableDefinition;
  onEdit: () => void;
  onDelete: () => void;
}

function VariableItem({ variable, onEdit, onDelete }: VariableItemProps) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-gray-50 rounded-lg group">
      {/* カラープレビュー */}
      {variable.category === 'color' && (
        <div
          className="w-6 h-6 rounded border shadow-sm flex-shrink-0"
          style={{ backgroundColor: variable.value }}
        />
      )}
      {variable.category !== 'color' && (
        <div className="w-6 h-6 rounded border bg-gray-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[8px] text-gray-500 font-mono">
            {variable.value.slice(0, 3)}
          </span>
        </div>
      )}

      {/* 変数情報 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-700 truncate">
            {variable.cssName}
          </span>
        </div>
        <span className="font-mono text-xs text-gray-500 truncate block">
          {variable.value}
        </span>
      </div>

      {/* アクション */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-400 hover:text-gray-600"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-400 hover:text-red-600"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================
// カテゴリセクション
// ============================================

interface CategorySectionProps {
  group: CSSVariableGroup;
  isOpen: boolean;
  onToggle: () => void;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onUpdateVariable: (id: string, updates: Partial<Omit<CSSVariableDefinition, 'id'>>) => void;
  onDeleteVariable: (id: string) => void;
  onAddVariable: (name: string, value: string, category: CSSVariableCategory, description?: string) => void;
  showAddForm: boolean;
  onToggleAddForm: () => void;
}

function CategorySection({
  group,
  isOpen,
  onToggle,
  editingId,
  onStartEdit,
  onCancelEdit,
  onUpdateVariable,
  onDeleteVariable,
  onAddVariable,
  showAddForm,
  onToggleAddForm,
}: CategorySectionProps) {
  const config = CSS_VARIABLE_CATEGORIES.find(c => c.id === group.category);
  const Icon = getCategoryIcon(config?.icon ?? 'Settings');

  const handleAdd = (data: { name: string; value: string; category: CSSVariableCategory; description?: string }) => {
    onAddVariable(data.name, data.value, data.category, data.description);
    onToggleAddForm();
  };

  const handleUpdate = (id: string, data: { name: string; value: string; category: CSSVariableCategory; description?: string }) => {
    onUpdateVariable(id, data);
    onCancelEdit();
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2.5 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
        <span className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          {config?.label ?? group.category}
          <span className="text-xs text-gray-400 font-normal">
            ({group.variables.length})
          </span>
        </span>
        <ChevronRight
          className={cn('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-90')}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-2">
        <div className="space-y-1 py-1">
          {group.variables.map((variable) => (
            editingId === variable.id ? (
              <VariableEditorForm
                key={variable.id}
                variable={variable}
                category={variable.category}
                onSubmit={(data) => handleUpdate(variable.id, data)}
                onCancel={onCancelEdit}
              />
            ) : (
              <VariableItem
                key={variable.id}
                variable={variable}
                onEdit={() => onStartEdit(variable.id)}
                onDelete={() => onDeleteVariable(variable.id)}
              />
            )
          ))}

          {/* 追加フォーム */}
          {showAddForm && (
            <VariableEditorForm
              category={group.category}
              onSubmit={handleAdd}
              onCancel={onToggleAddForm}
              isNew
            />
          )}

          {/* 追加ボタン */}
          {!showAddForm && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-gray-500 hover:text-gray-700 mt-1"
              onClick={onToggleAddForm}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {config?.label}を追加
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================
// メインダイアログ
// ============================================

export function VariablesDialog({
  open,
  onOpenChange,
  variables,
  variableGroups,
  isLoading = false,
  isSaving = false,
  hasChanges = false,
  onAddVariable,
  onUpdateVariable,
  onDeleteVariable,
  onSave,
  onSyncFromTheme,
}: VariablesDialogProps) {
  // 開いているセクション
  const [openSections, setOpenSections] = useState<Set<CSSVariableCategory>>(
    new Set(['color', 'spacing'])
  );

  // 編集中の変数ID
  const [editingId, setEditingId] = useState<string | null>(null);

  // 追加フォーム表示中のカテゴリ
  const [addingCategory, setAddingCategory] = useState<CSSVariableCategory | null>(null);

  // セクショントグル
  const toggleSection = useCallback((category: CSSVariableCategory) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // 変数追加ハンドラ
  const handleAdd = useCallback((
    name: string,
    value: string,
    category: CSSVariableCategory,
    description?: string
  ) => {
    onAddVariable(name, value, category, description);
  }, [onAddVariable]);

  // 保存ハンドラ
  const handleSave = useCallback(async () => {
    try {
      await onSave();
    } catch (error) {
      console.error('Failed to save variables:', error);
    }
  }, [onSave]);

  // 空のカテゴリも含めた全カテゴリリスト
  const allCategories = useMemo(() => {
    return CSS_VARIABLE_CATEGORIES.map(config => {
      const group = variableGroups.find(g => g.category === config.id);
      return {
        category: config.id,
        label: config.label,
        icon: config.icon,
        variables: group?.variables ?? [],
      } as CSSVariableGroup;
    });
  }, [variableGroups]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            CSS変数管理
          </DialogTitle>
          <DialogDescription>
            デザイントークン（カラー、スペーシング、タイポグラフィ等）を定義・管理します。
            定義した変数はプロジェクト全体で使用できます。
          </DialogDescription>
        </DialogHeader>

        {/* ツールバー */}
        <div className="flex items-center justify-between gap-2 py-2 border-b">
          <div className="flex items-center gap-2">
            {onSyncFromTheme && (
              <Button
                variant="outline"
                size="sm"
                onClick={onSyncFromTheme}
                disabled={isLoading || isSaving}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                テーマから同期
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {variables.length} 個の変数
            </span>
            {hasChanges && (
              <span className="text-xs text-amber-600">未保存の変更あり</span>
            )}
          </div>
        </div>

        {/* 変数リスト */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {allCategories.map((group) => (
                <CategorySection
                  key={group.category}
                  group={group}
                  isOpen={openSections.has(group.category)}
                  onToggle={() => toggleSection(group.category)}
                  editingId={editingId}
                  onStartEdit={setEditingId}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdateVariable={onUpdateVariable}
                  onDeleteVariable={onDeleteVariable}
                  onAddVariable={handleAdd}
                  showAddForm={addingCategory === group.category}
                  onToggleAddForm={() => setAddingCategory(
                    addingCategory === group.category ? null : group.category
                  )}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1.5" />
                保存
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default VariablesDialog;
