'use client';

/**
 * InstanceOverrideSection
 *
 * Property panel section for managing component instance overrides.
 * Displays current variant, list of overridden properties, and actions
 * to reset overrides, go to main component, or detach instance.
 */

import { useMemo, useCallback } from 'react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../../components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import {
  Component,
  ChevronRight,
  RotateCcw,
  ExternalLink,
  Unlink,
  Type,
  Palette,
  Square,
  Eye,
  Image,
  Code,
  Box,
  RefreshCw,
} from 'lucide-react';
import type {
  ComponentInstance,
  MasterComponent,
  ComponentOverride,
  OverrideType,
  ComponentVariant,
} from '../../../types/editor-components';
import { getOverrideTypeDisplayName } from '../../utils/override-apply';
import { findElementById } from '../../utils/override-detection';

interface InstanceOverrideSectionProps {
  /** The component instance being edited */
  instance: ComponentInstance;
  /** The master component this instance is based on */
  master: MasterComponent;
  /** Whether this section is open */
  open: boolean;
  /** Callback when section open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback to reset a specific override */
  onResetOverride: (overrideId: string) => void;
  /** Callback to reset all overrides */
  onResetAll: () => void;
  /** Callback to change the variant */
  onVariantChange: (variantId: string) => void;
  /** Callback to navigate to the main component */
  onGoToMainComponent: () => void;
  /** Callback to detach the instance from its master */
  onDetachInstance: () => void;
}

/**
 * Get icon for override type
 */
function getOverrideIcon(type: OverrideType): React.ReactNode {
  const iconClass = 'w-3 h-3';
  switch (type) {
    case 'text':
      return <Type className={iconClass} />;
    case 'fill':
      return <Palette className={iconClass} />;
    case 'stroke':
      return <Square className={iconClass} />;
    case 'visibility':
      return <Eye className={iconClass} />;
    case 'image':
      return <Image className={iconClass} />;
    case 'style':
    case 'attribute':
      return <Code className={iconClass} />;
    case 'children':
    case 'instanceSwap':
      return <Box className={iconClass} />;
    default:
      return <Code className={iconClass} />;
  }
}

/**
 * Format override value for display
 */
function formatOverrideValue(override: ComponentOverride): string {
  const { type, value } = override;

  if (typeof value === 'boolean') {
    return value ? '表示' : '非表示';
  }

  if (typeof value === 'string') {
    // Truncate long strings
    if (value.length > 20) {
      return value.substring(0, 20) + '...';
    }
    return value;
  }

  if (typeof value === 'object' && value !== null) {
    if ('url' in value) {
      const url = (value as { url: string }).url;
      const filename = url.split('/').pop() || url;
      return filename.length > 15 ? filename.substring(0, 15) + '...' : filename;
    }
    return 'カスタム値';
  }

  return String(value);
}

/**
 * Get element display name from master component
 */
function getElementDisplayName(
  master: MasterComponent,
  elementId: string,
  variantId: string
): string {
  const variant = master.variants.find((v) => v.id === variantId);
  if (!variant) return elementId;

  const element = findElementById(variant.rootElement, elementId);
  if (!element) return elementId;

  return element.displayName || `${element.tagName}#${element.id.substring(0, 8)}`;
}

export function InstanceOverrideSection({
  instance,
  master,
  open,
  onOpenChange,
  onResetOverride,
  onResetAll,
  onVariantChange,
  onGoToMainComponent,
  onDetachInstance,
}: InstanceOverrideSectionProps) {
  // Get current variant
  const currentVariant = useMemo<ComponentVariant | undefined>(() => {
    return master.variants.find((v) => v.id === instance.variantId);
  }, [master.variants, instance.variantId]);

  // Group overrides by element
  const groupedOverrides = useMemo(() => {
    const groups = new Map<string, ComponentOverride[]>();

    for (const override of instance.overrides) {
      // Both targetElementId and elementPath are strings in our type definition
      const elementId = override.targetElementId || override.elementPath || 'root';

      if (!groups.has(elementId)) {
        groups.set(elementId, []);
      }
      groups.get(elementId)!.push(override);
    }

    return groups;
  }, [instance.overrides]);

  // Handle variant change
  const handleVariantChange = useCallback(
    (variantId: string) => {
      onVariantChange(variantId);
    },
    [onVariantChange]
  );

  const hasOverrides = instance.overrides.length > 0;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <Component className="w-3.5 h-3.5" />
          コンポーネントインスタンス
          {hasOverrides && (
            <Badge
              variant="secondary"
              className="h-4 px-1.5 text-[9px] bg-purple-600/30 text-purple-300 border-purple-500/30"
            >
              {instance.overrides.length}
            </Badge>
          )}
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 pb-3">
        {/* Component Info */}
        <div className="px-1">
          <Label className="text-[10px] text-gray-500">メインコンポーネント</Label>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-white truncate flex-1">
              {master.name}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onGoToMainComponent}
                    className="h-6 w-6 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">メインコンポーネントを編集</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Variant Selector */}
        {master.variants.length > 1 && (
          <div className="px-1">
            <Label className="text-[10px] text-gray-500">バリアント</Label>
            <Select
              value={instance.variantId}
              onValueChange={handleVariantChange}
            >
              <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white mt-1">
                <SelectValue placeholder="バリアントを選択" />
              </SelectTrigger>
              <SelectContent>
                {master.variants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {variant.name}
                    {variant.isDefault && (
                      <span className="ml-2 text-gray-400">(デフォルト)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Overrides List */}
        {hasOverrides && (
          <div className="px-1 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-gray-500">オーバーライド</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onResetAll}
                      className="h-5 px-2 text-[10px] text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      すべてリセット
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">すべてのオーバーライドをリセット</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {Array.from(groupedOverrides.entries()).map(([elementId, overrides]) => (
                <div
                  key={elementId}
                  className="bg-[#2a2a2a] rounded-md p-2 border border-[#444444]"
                >
                  <div className="text-[10px] text-gray-400 mb-1.5 truncate">
                    {getElementDisplayName(master, elementId, instance.variantId)}
                  </div>
                  <div className="space-y-1">
                    {overrides.map((override) => (
                      <div
                        key={override.id}
                        className="flex items-center justify-between gap-2 group"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Purple indicator dot */}
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                          {/* Override type icon */}
                          <span className="text-purple-400 flex-shrink-0">
                            {getOverrideIcon(override.type)}
                          </span>
                          {/* Override type name */}
                          <span className="text-[10px] text-gray-300 flex-shrink-0">
                            {getOverrideTypeDisplayName(override.type)}
                          </span>
                          {/* Override value */}
                          <span className="text-[10px] text-gray-500 truncate">
                            {formatOverrideValue(override)}
                          </span>
                        </div>
                        {/* Reset button */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onResetOverride(override.id)}
                                className="h-5 w-5 text-gray-500 hover:text-white hover:bg-[#4a4a4a] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <p className="text-xs">リセット</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No overrides message */}
        {!hasOverrides && (
          <div className="px-1">
            <p className="text-[10px] text-gray-500 italic">
              オーバーライドはありません
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="px-1 pt-2 border-t border-[#444444] space-y-2">
          {/* Detach Instance Button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full h-7 text-xs justify-start text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
              >
                <Unlink className="w-3.5 h-3.5 mr-2" />
                インスタンスを解除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-[#2c2c2c] border-[#444444]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">
                  インスタンスを解除
                </AlertDialogTitle>
                <AlertDialogDescription className="text-gray-400">
                  この操作により、要素はメインコンポーネントから切り離されます。
                  メインコンポーネントへの変更は反映されなくなります。
                  この操作は元に戻せません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-[#383838] border-[#4a4a4a] text-white hover:bg-[#4a4a4a]">
                  キャンセル
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDetachInstance}
                  className="bg-red-600 hover:bg-red-700"
                >
                  解除する
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
