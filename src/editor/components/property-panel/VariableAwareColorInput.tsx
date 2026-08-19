'use client';

/**
 * VariableAwareColorInput
 *
 * Figmaスタイルの変数対応カラー入力コンポーネント
 * カラーピッカーから直接CSS変数を選択可能
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../components/ui/tabs';
import { Search, X, Plus, Pipette } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useEditorVariables } from '../../EditorContext';
import { isEyeDropperSupported, pickScreenColor } from '../../utils/eyedropper';
import type { CSSVariableDefinition } from '../../../types/css-variables';
import { isVariableReference, extractVariableName, generateVarReference } from '../../../types/css-variables';

// ============================================
// 型定義
// ============================================

export interface VariableAwareColorInputProps {
  /** ラベル */
  label: string;
  /** 現在の色の値（hex, rgb, または var(--xxx) 形式） */
  value: string;
  /** 値変更時のコールバック */
  onChange: (value: string) => void;
  /** 無効状態 */
  disabled?: boolean;
  /** クラス名 */
  className?: string;
  /** プリセットカラー */
  presetColors?: string[];
}

// RGB を HEX に変換
const rgbToHex = (rgb: string): string => {
  if (!rgb || rgb === 'transparent' || rgb === 'none') return '#ffffff';
  if (rgb.startsWith('#')) return rgb.slice(0, 7);
  if (rgb.startsWith('var(')) return '#ffffff';
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#ffffff';
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
};

// ============================================
// メインコンポーネント
// ============================================

export function VariableAwareColorInput({
  label,
  value,
  onChange,
  disabled = false,
  className,
  presetColors = [],
}: VariableAwareColorInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'solid' | 'variable'>('solid');
  const [isCreating, setIsCreating] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);

  // CSS変数を取得
  const { variables, addVariable } = useEditorVariables();

  // 現在の値がCSS変数参照かどうか
  const isLinked = useMemo(() => {
    return isVariableReference(value);
  }, [value]);

  // リンクされている変数を取得
  const linkedVariable = useMemo(() => {
    if (!isLinked) return null;
    const varName = extractVariableName(value);
    return variables.find(v => v.cssName === varName);
  }, [isLinked, value, variables]);

  // 表示用の色
  const displayColor = useMemo(() => {
    if (isLinked && linkedVariable) {
      return linkedVariable.value;
    }
    return rgbToHex(value);
  }, [isLinked, linkedVariable, value]);

  // 色変数のみフィルター
  const colorVariables = useMemo(() => {
    let filtered = variables.filter(v => v.category === 'color');

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.name.toLowerCase().includes(query) ||
        v.cssName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [variables, searchQuery]);

  // 変数を選択
  const handleSelectVariable = useCallback((variable: CSSVariableDefinition) => {
    onChange(generateVarReference(variable));
    setIsOpen(false);
    setSearchQuery('');
  }, [onChange]);

  // リンク解除
  const handleDetach = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkedVariable) {
      onChange(linkedVariable.value);
    } else {
      // 変数が見つからない場合はデフォルトの白色を使用
      onChange('#ffffff');
    }
  }, [linkedVariable, onChange]);

  // 色を直接選択
  const handleColorChange = useCallback((color: string) => {
    onChange(color);
  }, [onChange]);

  // スポイト(画面から色を拾う)。取り消し時は null が返るので何もしない
  const eyeDropperSupported = isEyeDropperSupported();
  const handleEyeDropper = useCallback(async () => {
    const hex = await pickScreenColor();
    if (hex) handleColorChange(hex);
  }, [handleColorChange]);

  // 現在の色から変数を作成
  const handleCreateVariable = useCallback(() => {
    if (!newVarName.trim() || !addVariable) return;

    // 既に変数がリンクされている場合は作成しない
    if (isLinked) return;

    // 編集された値を使用（空の場合は現在の色を使う）
    const finalValue = newVarValue.trim() || displayColor;

    // 変数を作成（カテゴリはcolor）
    const newVar = addVariable(newVarName.trim(), finalValue, 'color');

    // 作成した変数を選択
    const varRef = generateVarReference(newVar);
    onChange(varRef);

    // UIをリセット
    setNewVarName('');
    setNewVarValue('');
    setIsCreating(false);
    setIsOpen(false);
  }, [newVarName, newVarValue, addVariable, onChange, isLinked, displayColor]);

  // 変数作成UIを開く
  const handleStartCreating = useCallback(() => {
    setIsCreating(true);
    setSearchQuery('');
    // 現在の色を初期値として設定
    setNewVarValue(displayColor);
    setTimeout(() => createInputRef.current?.focus(), 0);
  }, [displayColor]);

  // 変数作成をキャンセル
  const handleCancelCreating = useCallback(() => {
    setIsCreating(false);
    setNewVarName('');
    setNewVarValue('');
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded',
            'bg-[#383838] border border-[#444444] hover:border-[#5d5d5d]',
            'text-xs text-left transition-colors',
            isLinked && 'border-purple-500/50',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          {/* カラースウォッチ */}
          <div
            className="w-5 h-5 rounded border border-[#5d5d5d] flex-shrink-0"
            style={{ backgroundColor: displayColor }}
          />

          {/* 値表示 */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
            {isLinked ? (
              <div className="flex items-center gap-1">
                <span className="text-purple-300 truncate text-xs">
                  {linkedVariable?.name || 'Unknown'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDetach(e);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="p-0.5 hover:bg-purple-500/20 rounded flex-shrink-0"
                  title="変数を解除"
                >
                  <X className="w-3 h-3 text-purple-400" />
                </button>
              </div>
            ) : (
              <span className="text-white text-xs uppercase">
                {displayColor}
              </span>
            )}
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0 bg-[#2c2c2c] border-[#444444]"
        align="start"
        side="left"
        sideOffset={8}
      >
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'solid' | 'variable')}>
          <TabsList className="w-full grid grid-cols-2 bg-[#1e1e1e] p-1 gap-1">
            <TabsTrigger
              value="solid"
              className="text-xs data-[state=active]:bg-[#383838] data-[state=active]:text-white"
            >
              カラー
            </TabsTrigger>
            <TabsTrigger
              value="variable"
              className="text-xs data-[state=active]:bg-[#383838] data-[state=active]:text-white"
            >
              変数
            </TabsTrigger>
          </TabsList>

          {/* カラータブ */}
          <TabsContent value="solid" className="p-3 space-y-3">
            {/* カラーピッカー */}
            <div>
              <input
                type="color"
                value={displayColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="w-full h-24 rounded cursor-pointer border border-[#444444]"
              />
            </div>

            {/* HEX入力 + スポイト(未対応ブラウザではボタンを出さない) */}
            <div className="flex items-center gap-2">
              {eyeDropperSupported && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0 p-0 border-[#444444] bg-[#383838] hover:bg-[#4a4a4a]"
                  onClick={handleEyeDropper}
                  title="スポイト (画面から色を取得)"
                >
                  <Pipette className="w-3.5 h-3.5 text-gray-300" />
                </Button>
              )}
              <Input
                type="text"
                value={displayColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
              />
            </div>

            {/* プリセット */}
            {presetColors.length > 0 && (
              <div>
                <div className="text-[10px] text-gray-500 mb-1.5">プリセット</div>
                <div className="grid grid-cols-8 gap-1">
                  {presetColors.slice(0, 16).map((color) => (
                    <button
                      key={color}
                      onClick={() => handleColorChange(color)}
                      className={cn(
                        'w-5 h-5 rounded border border-[#5d5d5d] hover:scale-110 transition-transform',
                        displayColor === color && 'ring-2 ring-[#0d99ff]'
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* 変数タブ */}
          <TabsContent value="variable" className="p-0">
            {/* 検索 */}
            <div className="p-2 border-b border-[#444444]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <Input
                  type="text"
                  placeholder="検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 pl-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
                />
              </div>
            </div>

            {/* カテゴリヘッダーと作成ボタン */}
            <div className="px-2 py-1.5 border-b border-[#444444] flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase">カラー変数</span>
              {!isCreating && !isLinked && (
                <button
                  type="button"
                  onClick={handleStartCreating}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444] rounded transition-colors"
                  title="現在の色から変数を作成"
                >
                  <Plus className="w-3 h-3" />
                  <span>作成</span>
                </button>
              )}
            </div>

            {/* 変数作成UI */}
            {isCreating && (
              <div className="p-2 border-b border-[#444444] bg-[#2a2a2a]">
                <div className="text-[10px] text-gray-400 mb-1.5">新しい変数を作成</div>
                <div className="space-y-2">
                  {/* 変数名入力 */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 w-8 flex-shrink-0">名前</span>
                    <Input
                      ref={createInputRef}
                      type="text"
                      placeholder="variable-name"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateVariable();
                        } else if (e.key === 'Escape') {
                          handleCancelCreating();
                        }
                      }}
                      className="h-6 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600 flex-1"
                    />
                  </div>
                  {/* 値を編集 */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 w-8 flex-shrink-0">値</span>
                    <div className="flex-1 flex items-center gap-1">
                      <div
                        className="w-6 h-6 rounded border border-[#5d5d5d] flex-shrink-0"
                        style={{ backgroundColor: newVarValue || displayColor }}
                      />
                      <Input
                        type="text"
                        placeholder="#ffffff"
                        value={newVarValue}
                        onChange={(e) => setNewVarValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCreateVariable();
                          } else if (e.key === 'Escape') {
                            handleCancelCreating();
                          }
                        }}
                        className="h-6 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600 flex-1 font-mono"
                      />
                    </div>
                  </div>
                  {/* 生成されるCSS変数名のプレビュー */}
                  {newVarName.trim() && (
                    <div className="text-[9px] text-gray-500 font-mono">
                      --color-{newVarName.trim().toLowerCase().replace(/\s+/g, '-')}
                    </div>
                  )}
                  {/* ボタン */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCreateVariable}
                      disabled={!newVarName.trim()}
                      className="h-6 px-3 text-[10px] bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      作成
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelCreating}
                      className="h-6 px-3 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444]"
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 変数リスト */}
            <ScrollArea className="max-h-48">
              {colorVariables.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500">
                  {searchQuery ? '検索結果がありません' : 'カラー変数がありません'}
                </div>
              ) : (
                <div className="p-1">
                  {colorVariables.map((variable) => {
                    const isSelected = linkedVariable?.id === variable.id;

                    return (
                      <button
                        key={variable.id}
                        onClick={() => handleSelectVariable(variable)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left',
                          'hover:bg-[#444444] transition-colors',
                          isSelected && 'bg-purple-500/20'
                        )}
                      >
                        <div
                          className="w-4 h-4 rounded border border-[#5d5d5d] flex-shrink-0"
                          style={{ backgroundColor: variable.value }}
                        />
                        <span className="text-xs text-white truncate flex-1">
                          {variable.name}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {variable.value}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

export default VariableAwareColorInput;
