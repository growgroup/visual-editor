"use client";

/**
 * Figmaライクなカラーピッカーコンポーネント
 *
 * 機能:
 * - ソリッドカラー
 * - リニアグラデーション
 * - ラジアルグラデーション
 * - 画像
 * - スライド内で使用されているカラーのプリセット
 * - 透明度調整
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Paintbrush,
  Plus,
  Trash2,
  Image as ImageIcon,
  Upload,
  X,
  GripVertical,
  RotateCcw,
  Pipette,
  Unlink,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useImageUpload } from "../hooks/useImageUpload";
import { ScrubbableLabel } from "../../components/ui/scrubbable-label";
import { CompactNumberInput } from "./property-panel/CompactNumberInput";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Search } from "lucide-react";
import { useEditorVariables } from "../EditorContext";
import { isEyeDropperSupported, pickScreenColor } from "../utils/eyedropper";
import type { CSSVariableDefinition } from "../../types/css-variables";
import { isVariableReference, extractVariableName, generateVarReference } from "../../types/css-variables";

// 塗りのタイプ
export type FillType = "solid" | "linear" | "radial" | "image" | "variable" | "none";

// グラデーションストップ
export interface GradientStop {
  color: string;
  position: number; // 0-100
  opacity: number; // 0-100
}

// 塗りの設定
export interface FillConfig {
  type: FillType;
  // ソリッドカラー
  color?: string;
  opacity?: number;
  // グラデーション
  gradient?: {
    stops: GradientStop[];
    angle?: number; // リニア用（度）
  };
  // 画像
  image?: {
    url: string;
    size: "cover" | "contain" | "fill" | "tile" | "custom";
    position: string;
    positionX?: number; // パーセント（0-100）
    positionY?: number; // パーセント（0-100）
    customWidth?: number; // パーセント
    customHeight?: number; // パーセント
  };
  // 変数
  variable?: {
    id: string;
    name: string;
    cssName: string;
    value: string;
  };
}

interface FigmaColorPickerProps {
  value: FillConfig;
  onChange: (config: FillConfig) => void;
  presetColors?: string[];
  showImageTab?: boolean;
  showVariablesTab?: boolean;
  label?: string;
  className?: string;
  presentationId?: string;
  slideId?: string;
  /** ポップオーバーが閉じた時のコールバック（フォーカス復元用） */
  onClose?: () => void;
  /** 変数選択時に var(--xxx) 形式で直接返す（onChange の代わり） */
  onVariableSelect?: (varReference: string) => void;
}

// RGB を HEX に変換
const rgbToHex = (rgb: string): string => {
  if (!rgb || rgb === "transparent" || rgb === "none") return "#ffffff";
  if (rgb.startsWith("#")) return rgb.slice(0, 7);
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "#ffffff";
  const r = parseInt(match[1]).toString(16).padStart(2, "0");
  const g = parseInt(match[2]).toString(16).padStart(2, "0");
  const b = parseInt(match[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
};

// RGBA から opacity を抽出
// RGBA から opacity を抽出
export const extractOpacity = (color: string): number => {
  if (!color) return 100;
  // rgba(r, g, b, a) の形式だけをマッチさせる（カンマが3つあることを確認）
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (match && match[4]) {
    const value = parseFloat(match[4]);
    // 1より大きい場合はパーセント値として扱う（誤って保存された値の復旧）
    if (value > 1) {
      return Math.min(100, Math.round(value));
    }
    return Math.min(100, Math.max(0, Math.round(value * 100)));
  }
  return 100;
};

// HEX を RGBA に変換
const hexToRgba = (hex: string, opacity: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

// グラデーションストップをCSS文字列に変換
// toSorted()を使用して入力配列を変更しない（イミュータブル）
const stopsToGradientString = (stops: GradientStop[]): string => {
  return stops
    .toSorted((a, b) => a.position - b.position)
    .map((stop) => `${hexToRgba(stop.color, stop.opacity)} ${stop.position}%`)
    .join(", ");
};

// 塗り設定からCSS値を生成
export const fillConfigToCss = (
  config: FillConfig,
): {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
} => {
  if (config.type === "none") {
    return { backgroundColor: "transparent", backgroundImage: "none" };
  }

  if (config.type === "solid") {
    const color = config.color || "#ffffff";
    const opacity = config.opacity ?? 100;
    return {
      backgroundColor: opacity < 100 ? hexToRgba(color, opacity) : color,
      backgroundImage: "none",
    };
  }

  if (config.type === "variable" && config.variable) {
    // 変数の場合は解決された値をプレビュー用に使用
    return {
      backgroundColor: config.variable.value,
      backgroundImage: "none",
    };
  }

  if (config.type === "linear" && config.gradient) {
    const angle = config.gradient.angle ?? 180;
    const gradientStr = stopsToGradientString(config.gradient.stops);
    return {
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(${angle}deg, ${gradientStr})`,
    };
  }

  if (config.type === "radial" && config.gradient) {
    const gradientStr = stopsToGradientString(config.gradient.stops);
    return {
      backgroundColor: "transparent",
      backgroundImage: `radial-gradient(circle, ${gradientStr})`,
    };
  }

  if (config.type === "image" && config.image) {
    const sizeMap: Record<string, string> = {
      cover: "cover",
      contain: "contain",
      fill: "100% 100%",
      tile: "auto",
      custom: `${config.image.customWidth ?? 100}% ${config.image.customHeight ?? 100}%`,
    };

    // positionX/Yが設定されている場合はそれを使用、なければposition文字列を使用
    const posX = config.image.positionX ?? 50;
    const posY = config.image.positionY ?? 50;
    const position =
      config.image.positionX !== undefined ||
      config.image.positionY !== undefined
        ? `${posX}% ${posY}%`
        : config.image.position || "center";

    return {
      backgroundColor: "transparent",
      backgroundImage: `url('${config.image.url}')`,
      backgroundSize: sizeMap[config.image.size],
      backgroundPosition: position,
      backgroundRepeat: config.image.size === "tile" ? "repeat" : "no-repeat",
    };
  }

  return { backgroundColor: "transparent" };
};

// CSSから塗り設定を解析
// rawBackgroundColor: インラインスタイルの生の値（CSS変数検出用）
export const parseCssToFillConfig = (
  backgroundColor?: string,
  backgroundImage?: string,
  backgroundSize?: string,
  rawBackgroundColor?: string,
): FillConfig => {
  // CSS変数参照の場合（rawBackgroundColorにvar()が含まれている）
  if (rawBackgroundColor && isVariableReference(rawBackgroundColor)) {
    const varName = extractVariableName(rawBackgroundColor);
    if (varName) {
      return {
        type: "variable",
        variable: {
          id: varName,
          name: varName.replace('--', '').replace(/-/g, ' '),
          cssName: varName,
          value: backgroundColor || '',  // 解決済みの値
        },
      };
    }
  }

  // 画像の場合
  if (
    backgroundImage &&
    backgroundImage !== "none" &&
    backgroundImage.startsWith("url(")
  ) {
    const urlMatch = backgroundImage.match(/url\(['"]?([^'"()]+)['"]?\)/);
    const url = urlMatch ? urlMatch[1] : "";
    const size =
      backgroundSize === "cover"
        ? "cover"
        : backgroundSize === "contain"
          ? "contain"
          : backgroundSize === "100% 100%"
            ? "fill"
            : backgroundSize === "auto"
              ? "tile"
              : "cover";
    return {
      type: "image",
      image: { url, size, position: "center" },
    };
  }

  // リニアグラデーションの場合
  if (backgroundImage && backgroundImage.includes("linear-gradient")) {
    const angleMatch = backgroundImage.match(/linear-gradient\((\d+)deg/);
    const angle = angleMatch ? parseInt(angleMatch[1]) : 180;

    // ストップを解析
    const stopsMatch = backgroundImage.match(/rgba?\([^)]+\)\s*\d+%/g);
    const stops: GradientStop[] = stopsMatch?.map((stopStr) => {
      const colorMatch = stopStr.match(/(rgba?\([^)]+\))/);
      const posMatch = stopStr.match(/(\d+)%/);
      const color = colorMatch ? rgbToHex(colorMatch[1]) : "#ffffff";
      const opacity = extractOpacity(colorMatch?.[1] || "");
      return {
        color,
        position: posMatch ? parseInt(posMatch[1]) : 0,
        opacity,
      };
    }) || [
      { color: "#ffffff", position: 0, opacity: 100 },
      { color: "#000000", position: 100, opacity: 100 },
    ];

    return {
      type: "linear",
      gradient: { stops, angle },
    };
  }

  // ラジアルグラデーションの場合
  if (backgroundImage && backgroundImage.includes("radial-gradient")) {
    const stopsMatch = backgroundImage.match(/rgba?\([^)]+\)\s*\d+%/g);
    const stops: GradientStop[] = stopsMatch?.map((stopStr) => {
      const colorMatch = stopStr.match(/(rgba?\([^)]+\))/);
      const posMatch = stopStr.match(/(\d+)%/);
      const color = colorMatch ? rgbToHex(colorMatch[1]) : "#ffffff";
      const opacity = extractOpacity(colorMatch?.[1] || "");
      return {
        color,
        position: posMatch ? parseInt(posMatch[1]) : 0,
        opacity,
      };
    }) || [
      { color: "#ffffff", position: 0, opacity: 100 },
      { color: "#000000", position: 100, opacity: 100 },
    ];

    return {
      type: "radial",
      gradient: { stops },
    };
  }

  // ソリッドカラーの場合
  if (backgroundColor && backgroundColor !== "transparent") {
    return {
      type: "solid",
      color: rgbToHex(backgroundColor),
      opacity: extractOpacity(backgroundColor),
    };
  }

  return { type: "none" };
};

// デフォルトのプリセットカラー
const DEFAULT_PRESETS = [
  "#000000",
  "#333333",
  "#666666",
  "#999999",
  "#cccccc",
  "#ffffff",
  "#ff0000",
  "#ff6600",
  "#ffcc00",
  "#00ff00",
  "#00ccff",
  "#0066ff",
  "#6600ff",
  "#ff00ff",
  "#ff0066",
];

/**
 * プレビューサムネイル
 */
function FillPreview({
  config,
  className,
}: {
  config: FillConfig;
  className?: string;
}) {
  const style = useMemo(() => fillConfigToCss(config), [config]);

  return (
    <div
      className={cn(
        "w-full h-full rounded border border-[#444444]",
        config.type === "none" &&
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='4' height='4' fill='%23ccc'/%3E%3Crect x='4' y='4' width='4' height='4' fill='%23ccc'/%3E%3C/svg%3E\")]",
        className,
      )}
      style={config.type !== "none" ? style : undefined}
    />
  );
}

/**
 * カラースウォッチ
 */
function ColorSwatch({
  color,
  isSelected,
  onClick,
}: {
  color: string;
  isSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "w-6 h-6 rounded border-2 transition-all hover:scale-110",
        isSelected
          ? "border-[#0d99ff] ring-2 ring-[#0d99ff]/50"
          : "border-[#444444]",
      )}
      style={{ backgroundColor: color }}
      onClick={onClick}
    />
  );
}

/**
 * グラデーションストップエディター
 */
function GradientStopEditor({
  stops,
  selectedIndex,
  onStopsChange,
  onSelectStop,
}: {
  stops: GradientStop[];
  selectedIndex: number;
  onStopsChange: (stops: GradientStop[]) => void;
  onSelectStop: (index: number) => void;
}) {
  const gradientPreview = useMemo(() => {
    return stopsToGradientString(stops);
  }, [stops]);

  const handleStopPositionChange = (index: number, position: number) => {
    const newStops = [...stops];
    newStops[index] = { ...newStops[index], position };
    onStopsChange(newStops);
  };

  const handleAddStop = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const position = Math.round(((e.clientX - rect.left) / rect.width) * 100);

    // 近い2つのストップの間の色を補間
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);
    let newColor = "#888888";

    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (
        position >= sortedStops[i].position &&
        position <= sortedStops[i + 1].position
      ) {
        newColor = sortedStops[i].color;
        break;
      }
    }

    const newStops = [...stops, { color: newColor, position, opacity: 100 }];
    onStopsChange(newStops);
    onSelectStop(stops.length);
  };

  const handleRemoveStop = (index: number) => {
    if (stops.length <= 2) return; // 最低2つ必要
    const newStops = stops.filter((_, i) => i !== index);
    onStopsChange(newStops);
    if (selectedIndex >= newStops.length) {
      onSelectStop(newStops.length - 1);
    }
  };

  return (
    <div className="space-y-2">
      {/* グラデーションバー */}
      <div
        className="relative h-6 rounded cursor-crosshair"
        style={{ background: `linear-gradient(to right, ${gradientPreview})` }}
        onClick={handleAddStop}
      >
        {/* ストップハンドル */}
        {stops.map((stop, index) => (
          <div
            key={index}
            className={cn(
              "absolute top-0 w-3 h-full cursor-pointer transform -translate-x-1/2",
              "flex items-end justify-center",
            )}
            style={{ left: `${stop.position}%` }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectStop(index);
            }}
          >
            <div
              className={cn(
                "w-3 h-3 rounded-full border-2 shadow",
                selectedIndex === index ? "border-[#0d99ff]" : "border-white",
              )}
              style={{ backgroundColor: stop.color }}
            />
          </div>
        ))}
      </div>

      {/* 選択中のストップのコントロール */}
      {stops[selectedIndex] && (
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded border border-[#444444]"
            style={{ backgroundColor: stops[selectedIndex].color }}
          />
          <Input
            type="text"
            value={stops[selectedIndex].color}
            onChange={(e) => {
              const newStops = [...stops];
              newStops[selectedIndex] = {
                ...newStops[selectedIndex],
                color: e.target.value,
              };
              onStopsChange(newStops);
            }}
            className="flex-1 h-7 text-xs bg-[#383838] border-[#444444] text-white font-mono"
          />
          <CompactNumberInput
            value={stops[selectedIndex].position}
            onChange={(position) =>
              handleStopPositionChange(selectedIndex, position)
            }
            min={0}
            max={100}
            step={1}
            suffix="%"
            className="w-14"
          />
          {stops.length > 2 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveStop(selectedIndex)}
              className="h-7 w-7 text-gray-400 hover:text-red-400"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * メインコンポーネント
 */
// デフォルトのグラデーション設定
const DEFAULT_GRADIENT = {
  stops: [
    { color: "#ffffff", position: 0, opacity: 100 },
    { color: "#000000", position: 100, opacity: 100 },
  ],
  angle: 180,
};

export function FigmaColorPicker({
  value,
  onChange,
  presetColors = DEFAULT_PRESETS,
  showImageTab = true,
  showVariablesTab = true,
  label,
  className,
  presentationId,
  slideId,
  onClose,
  onVariableSelect,
}: FigmaColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FillType>(value.type || "solid");
  const [selectedGradientStop, setSelectedGradientStop] = useState(0);
  const [variableSearchQuery, setVariableSearchQuery] = useState("");
  const [isCreatingVariable, setIsCreatingVariable] = useState(false);
  const [newVariableName, setNewVariableName] = useState("");
  const [newVariableValue, setNewVariableValue] = useState("");
  const createVariableInputRef = useRef<HTMLInputElement>(null);

  // CSS変数を取得
  const { variables, addVariable } = useEditorVariables();

  // 画像アップロード
  const { isUploading, openFilePicker } = useImageUpload({
    presentationId,
    slideId,
  });

  // グラデーション設定（デフォルト値を含む）
  const gradientConfig = useMemo(() => {
    return value.gradient || DEFAULT_GRADIENT;
  }, [value.gradient]);

  // 現在の色（ソリッドまたはグラデーションの選択中ストップ）
  const currentColor = useMemo(() => {
    if (activeTab === "solid") {
      return value.color || "#ffffff";
    }
    if (activeTab === "linear" || activeTab === "radial") {
      return gradientConfig.stops[selectedGradientStop]?.color || "#ffffff";
    }
    return "#ffffff";
  }, [value.color, activeTab, gradientConfig, selectedGradientStop]);

  // 透明度
  const currentOpacity = useMemo(() => {
    if (activeTab === "solid") {
      return value.opacity ?? 100;
    }
    if (activeTab === "linear" || activeTab === "radial") {
      return gradientConfig.stops[selectedGradientStop]?.opacity ?? 100;
    }
    return 100;
  }, [value.opacity, activeTab, gradientConfig, selectedGradientStop]);

  // 色の変更
  const handleColorChange = useCallback(
    (newColor: string) => {
      if (activeTab === "solid") {
        // opacityを維持して更新
        onChange({ ...value, type: "solid", color: newColor, opacity: currentOpacity });
      } else if (activeTab === "linear" || activeTab === "radial") {
        const currentGradient = value.gradient || DEFAULT_GRADIENT;
        const newStops = [...currentGradient.stops];
        newStops[selectedGradientStop] = {
          ...newStops[selectedGradientStop],
          color: newColor,
        };
        onChange({
          ...value,
          type: activeTab,
          gradient: { ...currentGradient, stops: newStops },
        });
      }
    },
    [value, onChange, selectedGradientStop, activeTab, currentOpacity],
  );

  // 透明度の変更
  const handleOpacityChange = useCallback(
    (newOpacity: number) => {
      if (activeTab === "solid") {
        onChange({ ...value, type: "solid", opacity: newOpacity });
      } else if (activeTab === "linear" || activeTab === "radial") {
        const currentGradient = value.gradient || DEFAULT_GRADIENT;
        const newStops = [...currentGradient.stops];
        newStops[selectedGradientStop] = {
          ...newStops[selectedGradientStop],
          opacity: newOpacity,
        };
        onChange({
          ...value,
          type: activeTab,
          gradient: { ...currentGradient, stops: newStops },
        });
      }
    },
    [value, onChange, selectedGradientStop, activeTab],
  );

  // タブ変更時の初期化
  const handleTabChange = useCallback(
    (tab: string) => {
      const fillType = tab as FillType;
      setActiveTab(fillType);

      if (fillType === "solid") {
        onChange({
          type: "solid",
          color: value.color || "#ffffff",
          opacity: value.opacity ?? 100,
        });
      } else if (fillType === "linear") {
        onChange({
          type: "linear",
          gradient: value.gradient || {
            stops: [
              { color: "#ffffff", position: 0, opacity: 100 },
              { color: "#000000", position: 100, opacity: 100 },
            ],
            angle: 180,
          },
        });
      } else if (fillType === "radial") {
        onChange({
          type: "radial",
          gradient: value.gradient || {
            stops: [
              { color: "#ffffff", position: 0, opacity: 100 },
              { color: "#000000", position: 100, opacity: 100 },
            ],
          },
        });
      } else if (fillType === "image") {
        onChange({
          type: "image",
          image: value.image || { url: "", size: "cover", position: "center" },
        });
      } else if (fillType === "variable") {
        // 変数タブに切り替え（選択するまでは値は変更しない）
        // 既存の変数設定がある場合はそのまま維持
        if (!value.variable) {
          // 変数が選択されていない場合はタブ表示のみ
        }
      } else {
        onChange({ type: "none" });
      }
    },
    [onChange, value],
  );

  // 画像アップロード用のカスタムハンドラ
  const handleImageUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // FileReaderでDataURLに変換（ローカルプレビュー用）
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          onChange({
            type: "image",
            image: { url: dataUrl, size: "cover", position: "center" },
          });
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [onChange]);

  // スポイトツール(PPT風UIのリボンと同じ utils/eyedropper.ts を通す)
  const handleEyeDropper = useCallback(async () => {
    const hex = await pickScreenColor();
    if (hex) handleColorChange(hex);
  }, [handleColorChange]);

  const eyeDropperSupported = isEyeDropperSupported();

  // Popover開閉ハンドラ（閉じた時にonClose呼び出し）
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open && onClose) {
      requestAnimationFrame(() => {
        onClose();
      });
    }
  }, [onClose]);

  // 色変数のフィルタリング
  const filteredColorVariables = useMemo(() => {
    let filtered = variables.filter(v => v.category === "color");
    if (variableSearchQuery) {
      const query = variableSearchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.name.toLowerCase().includes(query) ||
        v.cssName.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [variables, variableSearchQuery]);

  // 現在の値が変数参照かどうかチェック
  const isVariableLinked = value.type === "variable" && value.variable;

  /**
   * バインドを外し、いまの見た目の実値(ソリッド)に戻す。Figmaのデタッチ。
   * 実値は登録簿の現在値を優先する(value.variable.value は選択時点の解決値で、
   * トークンを編集した後だと古いことがある)。
   */
  const handleDetachVariable = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!(value.type === "variable" && value.variable)) return;
      const registered = variables.find((v) => v.cssName === value.variable!.cssName);
      const resolved = registered?.value || value.variable.value || "#ffffff";
      onChange({ type: "solid", color: rgbToHex(resolved), opacity: 100 });
    },
    [value, variables, onChange],
  );

  // 変数選択ハンドラ
  const handleVariableSelect = useCallback((variable: CSSVariableDefinition) => {
    const varRef = generateVarReference(variable);
    console.log('[DEBUG FigmaColorPicker] handleVariableSelect:', {
      variable: { id: variable.id, name: variable.name, cssName: variable.cssName },
      generatedVarReference: varRef,
      hasOnVariableSelect: !!onVariableSelect,
    });
    if (onVariableSelect) {
      // var(--xxx) 形式で返す
      onVariableSelect(varRef);
    } else {
      // FillConfig形式で返す
      onChange({
        type: "variable",
        variable: {
          id: variable.id,
          name: variable.name,
          cssName: variable.cssName,
          value: variable.value,
        },
      });
    }
    setIsOpen(false);
  }, [onChange, onVariableSelect]);

  // 現在の色から変数を作成
  const handleCreateVariable = useCallback(() => {
    if (!newVariableName.trim() || !addVariable) return;

    // 既に変数がリンクされている場合は作成しない
    if (isVariableLinked) return;

    // 編集された値を使用（空の場合は現在の色を使う）
    const colorValue = newVariableValue.trim() || currentColor;

    // 変数を作成（カテゴリはcolor）
    const newVar = addVariable(newVariableName.trim(), colorValue, 'color');

    // 作成した変数を選択
    const varRef = generateVarReference(newVar);
    if (onVariableSelect) {
      onVariableSelect(varRef);
    } else {
      onChange({
        type: "variable",
        variable: {
          id: newVar.id,
          name: newVar.name,
          cssName: newVar.cssName,
          value: newVar.value,
        },
      });
    }

    // UIをリセット
    setNewVariableName('');
    setNewVariableValue('');
    setIsCreatingVariable(false);
    setIsOpen(false);
  }, [newVariableName, newVariableValue, addVariable, onChange, onVariableSelect, isVariableLinked, currentColor]);

  // 変数作成UIを開く
  const handleStartCreatingVariable = useCallback(() => {
    setIsCreatingVariable(true);
    setVariableSearchQuery('');
    // 現在の色を初期値として設定
    setNewVariableValue(currentColor);
    setTimeout(() => createVariableInputRef.current?.focus(), 0);
  }, [currentColor]);

  // 変数作成をキャンセル
  const handleCancelCreatingVariable = useCallback(() => {
    setIsCreatingVariable(false);
    setNewVariableName('');
    setNewVariableValue('');
  }, []);

  return (
    <div className={cn("space-y-1", className)}>
      {label && <Label className="text-[10px] text-gray-500">{label}</Label>}

      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="group/fill relative w-full h-8 p-1 justify-start gap-2 bg-[#383838] border border-[#444444] hover:bg-[#4a4a4a]"
          >
            <div className="w-6 h-6 flex-shrink-0">
              <FillPreview config={value} />
            </div>
            <span className={cn(
              "text-xs truncate",
              value.type === "variable" ? "text-purple-300" : "text-gray-300"
            )}>
              {value.type === "none"
                ? "なし"
                : value.type === "solid"
                  ? value.color
                  : value.type === "linear"
                    ? "リニアグラデーション"
                    : value.type === "radial"
                      ? "ラジアルグラデーション"
                      : value.type === "image"
                        ? "画像"
                        : value.type === "variable"
                          ? value.variable?.name || "変数"
                          : ""}
            </span>
            {isVariableLinked && (
              /* Figmaのデタッチ。ボタン内ボタンを避けるため span で受ける */
              <span
                role="button"
                tabIndex={0}
                title="変数の紐づけを解除(実値に戻す)"
                onClick={handleDetachVariable}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleDetachVariable(e as never);
                }}
                className="ml-auto mr-0.5 hidden rounded p-1 text-purple-300 hover:bg-white/10 hover:text-white group-hover/fill:block"
              >
                <Unlink className="h-3 w-3" />
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-72 p-0 bg-[#2c2c2c] border-[#444444]"
          align="start"
          side="left"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // スライダーのドラッグ中にポップオーバーが閉じないようにする
            const target = e.target as HTMLElement;
            if (target.closest('[role="slider"]')) {
              e.preventDefault();
            }
          }}
        >
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className={cn(
              "w-full grid h-9 bg-[#1e1e1e] rounded-none border-b border-[#444444]",
              showVariablesTab && showImageTab ? "grid-cols-6" :
              showVariablesTab || showImageTab ? "grid-cols-5" : "grid-cols-4"
            )}>
              <TabsTrigger
                value="solid"
                className="text-[10px] data-[state=active]:bg-[#383838]"
              >
                ソリッド
              </TabsTrigger>
              <TabsTrigger
                value="linear"
                className="text-[10px] data-[state=active]:bg-[#383838]"
              >
                リニア
              </TabsTrigger>
              <TabsTrigger
                value="radial"
                className="text-[10px] data-[state=active]:bg-[#383838]"
              >
                ラジアル
              </TabsTrigger>
              {showImageTab && (
                <TabsTrigger
                  value="image"
                  className="text-[10px] data-[state=active]:bg-[#383838]"
                >
                  画像
                </TabsTrigger>
              )}
              {showVariablesTab && (
                <TabsTrigger
                  value="variable"
                  className="text-[10px] data-[state=active]:bg-[#383838]"
                >
                  変数
                </TabsTrigger>
              )}
              <TabsTrigger
                value="none"
                className="text-[10px] data-[state=active]:bg-[#383838]"
              >
                なし
              </TabsTrigger>
            </TabsList>

            {/* ソリッドカラー */}
            <TabsContent value="solid" className="p-3 space-y-3 mt-0">
              <HexColorPicker
                color={currentColor}
                onChange={handleColorChange}
                style={{ width: "100%", height: 150 }}
              />

              {/* 色入力と透明度 */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="w-8 h-8 p-0 border-[#444444] bg-[#383838] hover:bg-[#4a4a4a]"
                  onClick={handleEyeDropper}
                  disabled={!eyeDropperSupported}
                  title={
                    eyeDropperSupported
                      ? "スポイト (画面から色を取得)"
                      : "このブラウザはスポイト機能をサポートしていません"
                  }
                >
                  <Pipette className="w-4 h-4 text-gray-300" />
                </Button>
                <div
                  className="w-8 h-8 rounded border border-[#444444]"
                  style={{
                    backgroundColor: hexToRgba(currentColor, currentOpacity),
                  }}
                />
                <HexColorInput
                  color={currentColor}
                  onChange={handleColorChange}
                  prefixed
                  className="flex-1 h-7 text-xs bg-[#383838] border border-[#444444] text-white font-mono px-2 rounded"
                />
              </div>

              {/* 透明度 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  透明度
                </Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[currentOpacity]}
                    onValueChange={([v]) => handleOpacityChange(v)}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={currentOpacity}
                    onChange={handleOpacityChange}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    className="w-14"
                  />
                </div>
              </div>

              {/* プリセットカラー */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-2 block">
                  プリセット
                </Label>
                <div className="flex flex-wrap gap-1">
                  {presetColors.map((color, i) => (
                    <ColorSwatch
                      key={i}
                      color={color}
                      isSelected={
                        currentColor.toLowerCase() === color.toLowerCase()
                      }
                      onClick={() => handleColorChange(color)}
                    />
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* リニアグラデーション */}
            <TabsContent value="linear" className="p-3 space-y-3 mt-0">
              <GradientStopEditor
                stops={gradientConfig.stops}
                selectedIndex={selectedGradientStop}
                onStopsChange={(stops) => {
                  onChange({
                    ...value,
                    type: "linear",
                    gradient: { ...gradientConfig, stops },
                  });
                }}
                onSelectStop={setSelectedGradientStop}
              />

              <HexColorPicker
                color={currentColor}
                onChange={handleColorChange}
                style={{ width: "100%", height: 120 }}
              />

              {/* 角度 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  角度
                </Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[gradientConfig.angle ?? 180]}
                    onValueChange={([v]) => {
                      onChange({
                        ...value,
                        type: "linear",
                        gradient: { ...gradientConfig, angle: v },
                      });
                    }}
                    min={0}
                    max={360}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={gradientConfig.angle ?? 180}
                    onChange={(angle) => {
                      onChange({
                        ...value,
                        type: "linear",
                        gradient: { ...gradientConfig, angle },
                      });
                    }}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    className="w-14"
                  />
                </div>
              </div>

              {/* 透明度 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  ストップ透明度
                </Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[currentOpacity]}
                    onValueChange={([v]) => handleOpacityChange(v)}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={currentOpacity}
                    onChange={handleOpacityChange}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    className="w-14"
                  />
                </div>
              </div>
            </TabsContent>

            {/* ラジアルグラデーション */}
            <TabsContent value="radial" className="p-3 space-y-3 mt-0">
              <GradientStopEditor
                stops={gradientConfig.stops}
                selectedIndex={selectedGradientStop}
                onStopsChange={(stops) => {
                  onChange({
                    ...value,
                    type: "radial",
                    gradient: { ...gradientConfig, stops },
                  });
                }}
                onSelectStop={setSelectedGradientStop}
              />

              <HexColorPicker
                color={currentColor}
                onChange={handleColorChange}
                style={{ width: "100%", height: 120 }}
              />

              {/* 透明度 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  ストップ透明度
                </Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[currentOpacity]}
                    onValueChange={([v]) => handleOpacityChange(v)}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={currentOpacity}
                    onChange={handleOpacityChange}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    className="w-14"
                  />
                </div>
              </div>
            </TabsContent>

            {/* 画像 */}
            {showImageTab && (
              <TabsContent value="image" className="p-3 space-y-3 mt-0">
                {value.image?.url ? (
                  <div className="space-y-3">
                    {/* プレビュー */}
                    <div
                      className="w-full h-24 rounded border border-[#444444] bg-cover bg-center"
                      style={{ backgroundImage: `url('${value.image.url}')` }}
                    />

                    {/* URL入力 */}
                    <div className="flex gap-1">
                      <Input
                        type="text"
                        value={
                          value.image.url.startsWith("data:")
                            ? "(アップロード画像)"
                            : value.image.url
                        }
                        onChange={(e) => {
                          onChange({
                            ...value,
                            image: { ...value.image!, url: e.target.value },
                          });
                        }}
                        placeholder="画像URL"
                        className="flex-1 h-7 text-xs bg-[#383838] border-[#444444] text-white"
                        readOnly={value.image.url.startsWith("data:")}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onChange({ type: "none" })}
                        className="h-7 w-7 text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* フィルモード */}
                    <div>
                      <Label className="text-[10px] text-gray-500 mb-1 block">
                        フィルモード
                      </Label>
                      <Select
                        value={value.image.size}
                        onValueChange={(
                          size:
                            | "cover"
                            | "contain"
                            | "fill"
                            | "tile"
                            | "custom",
                        ) => {
                          onChange({
                            ...value,
                            image: {
                              ...value.image!,
                              size,
                              // customの場合はデフォルト値を設定
                              ...(size === "custom" && {
                                customWidth: value.image!.customWidth ?? 100,
                                customHeight: value.image!.customHeight ?? 100,
                              }),
                            },
                          });
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cover">
                            トリミング（埋める）
                          </SelectItem>
                          <SelectItem value="contain">
                            自動（収める）
                          </SelectItem>
                          <SelectItem value="fill">
                            塗り（アスペクト比無視）
                          </SelectItem>
                          <SelectItem value="tile">
                            タイル（繰り返し）
                          </SelectItem>
                          <SelectItem value="custom">カスタムサイズ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* カスタムサイズ（customモード時のみ表示） */}
                    {value.image.size === "custom" && (
                      <div>
                        <Label className="text-[10px] text-gray-500 mb-1 block">
                          サイズ
                        </Label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 w-4">
                            W
                          </span>
                          <CompactNumberInput
                            value={value.image.customWidth ?? 100}
                            onChange={(customWidth) => {
                              onChange({
                                ...value,
                                image: { ...value.image!, customWidth },
                              });
                            }}
                            min={1}
                            max={500}
                            step={1}
                            suffix="%"
                            className="flex-1"
                          />
                          <span className="text-[10px] text-gray-500 w-4">
                            H
                          </span>
                          <CompactNumberInput
                            value={value.image.customHeight ?? 100}
                            onChange={(customHeight) => {
                              onChange({
                                ...value,
                                image: { ...value.image!, customHeight },
                              });
                            }}
                            min={1}
                            max={500}
                            step={1}
                            suffix="%"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    )}

                    {/* 位置 */}
                    <div>
                      <Label className="text-[10px] text-gray-500 mb-1 block">
                        位置
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-4">X</span>
                        <CompactNumberInput
                          value={value.image.positionX ?? 50}
                          onChange={(positionX) => {
                            onChange({
                              ...value,
                              image: { ...value.image!, positionX },
                            });
                          }}
                          min={0}
                          max={100}
                          step={1}
                          suffix="%"
                          className="flex-1"
                        />
                        <span className="text-[10px] text-gray-500 w-4">Y</span>
                        <CompactNumberInput
                          value={value.image.positionY ?? 50}
                          onChange={(positionY) => {
                            onChange({
                              ...value,
                              image: { ...value.image!, positionY },
                            });
                          }}
                          min={0}
                          max={100}
                          step={1}
                          suffix="%"
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      className="w-full h-20 border-dashed border-[#444444] hover:bg-[#383838]"
                      onClick={handleImageUpload}
                    >
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Upload className="w-6 h-6" />
                        <span className="text-xs">画像をアップロード</span>
                      </div>
                    </Button>

                    <div className="text-center text-[10px] text-gray-500">
                      または
                    </div>

                    <Input
                      type="text"
                      placeholder="画像URLを入力..."
                      onChange={(e) => {
                        if (e.target.value) {
                          onChange({
                            type: "image",
                            image: {
                              url: e.target.value,
                              size: "cover",
                              position: "center",
                            },
                          });
                        }
                      }}
                      className="h-7 text-xs bg-[#383838] border-[#444444] text-white"
                    />
                  </div>
                )}
              </TabsContent>
            )}

            {/* 変数 */}
            {showVariablesTab && (
              <TabsContent value="variable" className="p-0 mt-0">
                {/* 検索 */}
                <div className="p-2 border-b border-[#444444]">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input
                      type="text"
                      placeholder="変数を検索..."
                      value={variableSearchQuery}
                      onChange={(e) => setVariableSearchQuery(e.target.value)}
                      className="h-7 pl-7 text-xs bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
                    />
                  </div>
                </div>

                {/* カテゴリヘッダーと作成ボタン */}
                <div className="px-2 py-1.5 border-b border-[#444444] flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">カラー変数</span>
                  {!isCreatingVariable && !isVariableLinked && (
                    <button
                      type="button"
                      onClick={handleStartCreatingVariable}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444] rounded transition-colors"
                      title="現在の色から変数を作成"
                    >
                      <Plus className="w-3 h-3" />
                      <span>作成</span>
                    </button>
                  )}
                </div>

                {/* 変数作成UI */}
                {isCreatingVariable && (
                  <div className="p-2 border-b border-[#444444] bg-[#2a2a2a]">
                    <div className="text-[10px] text-gray-400 mb-1.5">新しい変数を作成</div>
                    <div className="space-y-2">
                      {/* 変数名入力 */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-500 w-8 flex-shrink-0">名前</span>
                        <Input
                          ref={createVariableInputRef}
                          type="text"
                          placeholder="variable-name"
                          value={newVariableName}
                          onChange={(e) => setNewVariableName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleCreateVariable();
                            } else if (e.key === 'Escape') {
                              handleCancelCreatingVariable();
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
                            style={{ backgroundColor: newVariableValue || currentColor }}
                          />
                          <Input
                            type="text"
                            placeholder="#ffffff"
                            value={newVariableValue}
                            onChange={(e) => setNewVariableValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCreateVariable();
                              } else if (e.key === 'Escape') {
                                handleCancelCreatingVariable();
                              }
                            }}
                            className="h-6 text-[10px] bg-[#383838] border-[#444444] text-white placeholder:text-gray-600 flex-1 font-mono"
                          />
                        </div>
                      </div>
                      {/* 生成されるCSS変数名のプレビュー */}
                      {newVariableName.trim() && (
                        <div className="text-[9px] text-gray-500 font-mono">
                          --color-{newVariableName.trim().toLowerCase().replace(/\s+/g, '-')}
                        </div>
                      )}
                      {/* ボタン */}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleCreateVariable}
                          disabled={!newVariableName.trim()}
                          className="h-6 px-3 text-[10px] bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          作成
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelCreatingVariable}
                          className="h-6 px-3 text-[10px] text-gray-400 hover:text-white hover:bg-[#444444]"
                        >
                          キャンセル
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 変数リスト */}
                <ScrollArea className="h-48">
                  {filteredColorVariables.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-500">
                      {variableSearchQuery ? "検索結果がありません" : "カラー変数がありません"}
                    </div>
                  ) : (
                    <div className="p-1">
                      {filteredColorVariables.map((variable) => {
                        const isSelected = value.variable?.id === variable.id;
                        return (
                          <button
                            key={variable.id}
                            onClick={() => handleVariableSelect(variable)}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left",
                              "hover:bg-[#444444] transition-colors",
                              isSelected && "bg-purple-500/20"
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
            )}

            {/* なし */}
            <TabsContent value="none" className="p-3 mt-0">
              <div className="text-center py-4 text-gray-500 text-xs">
                塗りなし（透明）
              </div>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default FigmaColorPicker;
