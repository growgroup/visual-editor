'use client';

/**
 * スライド内で使用されている色を抽出するHook
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEditorContext } from '../EditorContext';

// RGB を HEX に変換
const rgbToHex = (rgb: string): string => {
  if (!rgb || rgb === 'transparent' || rgb === 'none') return '';
  if (rgb.startsWith('#')) return rgb.slice(0, 7).toLowerCase();
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '';
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
};

// グラデーションから色を抽出
const extractColorsFromGradient = (gradient: string): string[] => {
  const colors: string[] = [];
  const rgbaMatches = gradient.matchAll(/rgba?\([^)]+\)/g);
  for (const match of rgbaMatches) {
    const hex = rgbToHex(match[0]);
    if (hex) colors.push(hex);
  }
  const hexMatches = gradient.matchAll(/#[0-9a-fA-F]{6}/g);
  for (const match of hexMatches) {
    colors.push(match[0].toLowerCase());
  }
  return colors;
};

export interface EditorColorsResult {
  colors: string[];           // ユニークな色の配列
  backgroundColors: string[]; // 背景色
  textColors: string[];       // テキスト色
  borderColors: string[];     // 線色
  refresh: () => void;        // 色を再取得
}

export function useEditorColors(): EditorColorsResult {
  const { getIframeDoc } = useEditorContext();
  const [colorData, setColorData] = useState<{
    backgroundColors: string[];
    textColors: string[];
    borderColors: string[];
  }>({
    backgroundColors: [],
    textColors: [],
    borderColors: [],
  });

  const extractColors = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const backgroundColors = new Set<string>();
    const textColors = new Set<string>();
    const borderColors = new Set<string>();

    // すべての要素をスキャン
    const elements = iframeDoc.querySelectorAll('*');
    elements.forEach((element) => {
      const style = window.getComputedStyle(element);

      // 背景色
      const bgColor = style.backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        const hex = rgbToHex(bgColor);
        if (hex) backgroundColors.add(hex);
      }

      // 背景画像（グラデーション）
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        const gradientColors = extractColorsFromGradient(bgImage);
        gradientColors.forEach(c => backgroundColors.add(c));
      }

      // テキスト色
      const color = style.color;
      if (color) {
        const hex = rgbToHex(color);
        if (hex) textColors.add(hex);
      }

      // 線色
      const borderColor = style.borderColor;
      if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
        // borderColorは複数の値が返ることがある
        const colors = borderColor.split(/\s+(?=rgb)/);
        colors.forEach(c => {
          const hex = rgbToHex(c);
          if (hex) borderColors.add(hex);
        });
      }
    });

    setColorData({
      backgroundColors: Array.from(backgroundColors),
      textColors: Array.from(textColors),
      borderColors: Array.from(borderColors),
    });
  }, [getIframeDoc]);

  // 初期取得
  useEffect(() => {
    extractColors();
  }, [extractColors]);

  // すべての色をまとめてユニークにする
  const colors = useMemo(() => {
    const allColors = new Set([
      ...colorData.backgroundColors,
      ...colorData.textColors,
      ...colorData.borderColors,
    ]);
    
    // デフォルトの色を除外（白、黒、透明など）
    const filtered = Array.from(allColors).filter(c => 
      c && 
      c !== '#000000' && 
      c !== '#ffffff' && 
      c !== '#fff' &&
      c !== '#000'
    );

    // 使用頻度でソート（実装簡略化のためアルファベット順）
    // toSorted()でイミュータブルパターンを維持
    return filtered.toSorted();
  }, [colorData]);

  return {
    colors,
    backgroundColors: colorData.backgroundColors,
    textColors: colorData.textColors,
    borderColors: colorData.borderColors,
    refresh: extractColors,
  };
}
