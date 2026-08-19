'use client';

/**
 * 要素操作（削除、複製、コピー、ペースト、レイヤー操作など）を管理するHook
 */

import { useCallback } from 'react';
import { useEditorContext, useEditorComponents } from '../EditorContext';
import {
  getIframeElement,
  generateElementId,
  refreshSelectionOverlay,
  convertSingleElementToAbsolute,
  canUngroup,
  hasEditableChildren,
  prepareElementDragOrigin,
} from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import { applyTailwindStyles, convertInlineStylesToTailwind } from '../utils/tailwind-utils';
import { copyElementsToFigma, isFigmaExportAvailable } from '../utils/figma-export';
import {
  hasViewportUnit,
  convertViewportToPx,
  getOriginalAttrName,
} from '../utils/viewport-utils';
import type { SerializedElement, BoundingBox, StyleClipboard, ClipboardData } from '../types';
import type { globalLastUsedStylesRef } from '../contexts/EditorRefsContext';

/**
 * 要素の種類を判定（shape / text / line）
 */
function getElementCategory(el: HTMLElement): 'shape' | 'text' | 'line' {
  const shapeType = el.getAttribute('data-shape-type');
  if (shapeType === 'text') return 'text';
  if (shapeType === 'line' || shapeType === 'arrow') return 'line';
  if (shapeType === 'pen' || shapeType === 'pencil') return 'line';

  // data-shape-typeがない場合はタグ名とスタイルで判定
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'p' || tagName === 'h1' || tagName === 'h2' || tagName === 'h3' ||
      tagName === 'h4' || tagName === 'h5' || tagName === 'h6' || tagName === 'span' ||
      el.getAttribute('contenteditable') === 'true') {
    return 'text';
  }

  // SVG要素は線として扱う
  if (tagName === 'svg' || el.querySelector('svg')) {
    return 'line';
  }

  return 'shape';
}

/**
 * 要素の「現在位置」を実測値から読む。
 *
 * [移植時の修正] 以前は `parseInt(el.style.left || '0') || 0` で読んでいたため、
 * インラインの left/top を持たない要素（このプロジェクトでは編集対象の大半）が
 * 原点0扱いになり、矢印キー1回で紙面の左上へ吹き飛んでいた。
 *
 * getComputedStyle の left/top は「位置指定された要素なら使用値(px)」を返す。
 * - インライン style が無くても正しい原点が得られる
 * - レイアウト値なので #artboard-wrapper の transform:scale() の影響を受けない
 *   （getBoundingClientRect のようにスケールで割り戻す必要がない）
 * position:static の場合は 'auto' が返るので、動かせないことがそのまま分かる。
 */
function readUsedOffset(view: Window, el: HTMLElement): { left: number; top: number } | null {
  const cs = view.getComputedStyle(el);
  if (cs.position === 'static') return null;
  const left = parseFloat(cs.left);
  const top = parseFloat(cs.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

/**
 * フロー外(絶対配置等)の要素を dx,dy だけ平行移動する。
 *
 * 左右（上下）両方にアンカーされている要素は left だけ書き換えると
 * 幅が変わってしまう（left+width+right が過剰制約になる）ため、
 * 実測して寸法が変わった場合のみ反対側のオフセットも同量ずらして見た目を保つ。
 * 「right/bottom 基準の要素が左上へ飛ぶ」現象への対処もこれで兼ねる。
 */
function translateOutOfFlowElement(view: Window, el: HTMLElement, dx: number, dy: number): boolean {
  const origin = readUsedOffset(view, el);
  if (!origin) return false;

  const before = el.getBoundingClientRect();

  if (dx !== 0) el.style.left = `${origin.left + dx}px`;
  if (dy !== 0) el.style.top = `${origin.top + dy}px`;

  const after = el.getBoundingClientRect();
  if (dx !== 0 && Math.abs(after.width - before.width) > 0.5) {
    const usedRight = parseFloat(view.getComputedStyle(el).right);
    if (Number.isFinite(usedRight)) el.style.right = `${usedRight - dx}px`;
  }
  if (dy !== 0 && Math.abs(after.height - before.height) > 0.5) {
    const usedBottom = parseFloat(view.getComputedStyle(el).bottom);
    if (Number.isFinite(usedBottom)) el.style.bottom = `${usedBottom - dy}px`;
  }
  return true;
}

/** 複製時にずらす量(px) */
const DUPLICATE_OFFSET = 20;

/**
 * 複製した要素を「元要素の見た目の位置 + offset」に置く。
 *
 * [移植時の修正] 以前は clone のインライン left/top を parseInt して +20 していたため、
 * インライン値を持たない要素（大半）と right/bottom 基準の要素は
 * left:20px / top:20px、つまり紙面の左上へ飛んでいた。群を複製すると
 * メンバーの相対関係も壊れていた。
 * clone を DOM に挿入した *後* に、元要素の使用値を基準に配置し直す。
 * フロー(static)要素は DOM 順で正しい位置に入るので何も書かない。
 */
function offsetDuplicate(
  iframeDoc: Document,
  original: HTMLElement,
  clone: HTMLElement,
  dx: number,
  dy: number
): void {
  const view = iframeDoc.defaultView;
  if (!view) return;

  const origin = readUsedOffset(view, original);
  if (!origin) return; // フロー要素: 位置指定しない

  const originalRect = original.getBoundingClientRect();
  clone.style.left = `${origin.left + dx}px`;
  clone.style.top = `${origin.top + dy}px`;

  // 左右／上下アンカーで幅・高さが変わってしまう場合は反対側も同量ずらす
  const cloneRect = clone.getBoundingClientRect();
  if (Math.abs(cloneRect.width - originalRect.width) > 0.5) {
    const usedRight = parseFloat(view.getComputedStyle(clone).right);
    if (Number.isFinite(usedRight)) clone.style.right = `${usedRight - dx}px`;
  }
  if (Math.abs(cloneRect.height - originalRect.height) > 0.5) {
    const usedBottom = parseFloat(view.getComputedStyle(clone).bottom);
    if (Number.isFinite(usedBottom)) clone.style.bottom = `${usedBottom - dy}px`;
  }
}

/** 矢印キー移動の結果。呼び出し側が「なぜ動かないか」を提示できるようにする */
export interface MoveElementResult {
  /** 実際に動かした要素数 */
  moved: number;
  /** 動かせなかった理由。null なら成功 */
  blocked: null | 'no-selection' | 'flow';
}

/**
 * 最後に使用したスタイルをキャプチャ
 */
function captureLastUsedStyles(
  el: HTMLElement,
  styles: Record<string, string>,
  lastUsedStylesRef: typeof globalLastUsedStylesRef
) {
  const category = getElementCategory(el);
  console.log('[captureLastUsedStyles] Category:', category, 'Styles:', styles);

  if (category === 'shape') {
    const shapeStyles: Partial<typeof lastUsedStylesRef.current.shape> = {};
    if (styles.backgroundColor) shapeStyles.backgroundColor = styles.backgroundColor;
    if (styles.borderRadius) shapeStyles.borderRadius = styles.borderRadius;
    if (styles.borderColor) shapeStyles.borderColor = styles.borderColor;
    if (styles.borderWidth) shapeStyles.borderWidth = styles.borderWidth;
    if (styles.borderStyle) shapeStyles.borderStyle = styles.borderStyle;
    if (styles.opacity) shapeStyles.opacity = styles.opacity;
    if (Object.keys(shapeStyles).length > 0) {
      lastUsedStylesRef.updateShape(shapeStyles);
      console.log('[captureLastUsedStyles] Updated shape styles:', shapeStyles);
    }
  } else if (category === 'text') {
    const textStyles: Partial<typeof lastUsedStylesRef.current.text> = {};
    if (styles.color) textStyles.color = styles.color;
    if (styles.fontSize) textStyles.fontSize = styles.fontSize;
    if (styles.fontFamily) textStyles.fontFamily = styles.fontFamily;
    if (styles.fontWeight) textStyles.fontWeight = styles.fontWeight;
    if (styles.lineHeight) textStyles.lineHeight = styles.lineHeight;
    if (styles.letterSpacing) textStyles.letterSpacing = styles.letterSpacing;
    if (styles.textAlign) textStyles.textAlign = styles.textAlign;
    if (Object.keys(textStyles).length > 0) {
      lastUsedStylesRef.updateText(textStyles);
      console.log('[captureLastUsedStyles] Updated text styles:', textStyles);
    }
  } else if (category === 'line') {
    const lineStyles: Partial<typeof lastUsedStylesRef.current.line> = {};
    if (styles.stroke) lineStyles.stroke = styles.stroke;
    if (styles.strokeWidth) lineStyles.strokeWidth = styles.strokeWidth;
    if (Object.keys(lineStyles).length > 0) {
      lastUsedStylesRef.updateLine(lineStyles);
      console.log('[captureLastUsedStyles] Updated line styles:', lineStyles);
    }
  }
}

/**
 * 要素操作のアクションを提供するHook
 */
export function useElementActions() {
  const {
    selectedElement,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
    clipboardRef,
    styleClipboardRef,
    lastUsedStylesRef,
    notifyIframeChange,
    getIframeDoc,
    layoutMode,
    editorMode,
    viewportWidth,
  } = useEditorContext();

  // コンポーネント管理
  const {
    getInstanceByDomId,
    getMasterComponent,
    createInstance,
    deleteInstance,
  } = useEditorComponents();

  const SLIDE_WIDTH = 1920; // 定数化すべきだが一旦ここに
  const SLIDE_HEIGHT = 1080;

  /**
   * viewport単位の変換に使用するキャンバス/アートボードの寸法を取得
   * - slideモード: 固定の1920x1080
   * - webpageモード: viewportWidth（選択されたブレークポイント）と計算された高さ
   */
  const getCanvasDimensions = useCallback(() => {
    if (editorMode === 'webpage') {
      // webpageモードでは選択されたviewportWidthを使用
      const iframeDoc = getIframeDoc();
      const artboard = iframeDoc?.getElementById('artboard');
      const artboardHeight = artboard?.scrollHeight || 1080;
      return {
        width: viewportWidth || 1920,
        height: artboardHeight,
      };
    }
    // slideモードでは固定サイズ
    return {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
    };
  }, [editorMode, viewportWidth, getIframeDoc]);

  // 整列機能
  const alignElements = useCallback((type: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'distribute-h' | 'distribute-v') => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    
    // 処理対象の要素を取得
    const targetIds = selectedElementIds.length > 0 
      ? selectedElementIds 
      : selectedElement ? [selectedElement.id] : [];
      
    if (targetIds.length === 0) return;

    const elements = targetIds.map(id => getIframeElement(iframeDoc, id)).filter(el => el) as HTMLElement[];
    if (elements.length === 0) return;

    // バウンディングボックスと親情報の取得
    const bounds = elements.map(el => {
      const rect = el.getBoundingClientRect();
      const style = iframeDoc.defaultView?.getComputedStyle(el);
      const matrix = new DOMMatrix(style?.transform);
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      return { el, rect, left, top, width: rect.width, height: rect.height };
    });

    // 基準となる領域の計算
    let referenceBounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, width: 0, height: 0, centerX: 0, centerY: 0 };
    
    if (elements.length > 1) {
      // 複数選択: 選択範囲全体を基準
      bounds.forEach(b => {
        referenceBounds.left = Math.min(referenceBounds.left, b.left);
        referenceBounds.top = Math.min(referenceBounds.top, b.top);
        referenceBounds.right = Math.max(referenceBounds.right, b.left + b.width);
        referenceBounds.bottom = Math.max(referenceBounds.bottom, b.top + b.height);
      });
      referenceBounds.width = referenceBounds.right - referenceBounds.left;
      referenceBounds.height = referenceBounds.bottom - referenceBounds.top;
      referenceBounds.centerX = referenceBounds.left + referenceBounds.width / 2;
      referenceBounds.centerY = referenceBounds.top + referenceBounds.height / 2;
    } else {
      // 単一選択: 親要素を基準
      const el = elements[0];
      const parent = el.parentElement;
      
      if (parent && parent !== iframeDoc.body) {
         // 親が要素の場合（グループなど）
         const parentStyle = iframeDoc.defaultView?.getComputedStyle(parent);
         const parentRect = parent.getBoundingClientRect();
         // 相対座標系での親サイズと見なす
         const pW = parseFloat(parentStyle?.width || '0') || parentRect.width;
         const pH = parseFloat(parentStyle?.height || '0') || parentRect.height;
         referenceBounds = {
            left: 0, top: 0, right: pW, bottom: pH, width: pW, height: pH,
            centerX: pW / 2, centerY: pH / 2
         };
      } else {
         // 親がSlide直下の場合
         referenceBounds = {
            left: 0, top: 0, right: SLIDE_WIDTH, bottom: SLIDE_HEIGHT, width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
            centerX: SLIDE_WIDTH / 2, centerY: SLIDE_HEIGHT / 2
         };
      }
    }

    // 配置の適用
    const updates: Record<string, string> = {};

    if (type === 'distribute-h' || type === 'distribute-v') {
       if (elements.length < 3) return; // 3つ以上必要

       // 位置でソート
       const sorted = [...bounds].sort((a, b) => 
         type === 'distribute-h' ? a.left - b.left : a.top - b.top
       );
       
       const first = sorted[0];
       const last = sorted[sorted.length - 1];
       const totalSpan = (type === 'distribute-h' ? last.left : last.top) - (type === 'distribute-h' ? first.left : first.top);
       const gap = totalSpan / (sorted.length - 1); // ここは単純な中心間距離ではなく、スペースの均等化なら計算が違うが、FigmaのTidy UpではなくDistributeは通常「端から端を等分」

       // Distribute centers? Usually distribute left/top edges or centers. 
       // Figma "Distribute horizontal spacing" makes gaps equal. "Distribute left" makes left edges equal distance?
       // Let's implement "Distribute Horizontal Spacing" (equal gaps) if possible, or simpler "Distribute Centers".
       // Figma: "Distribute horizontal spacing" -> Equal gaps between elements.
       
       // 等間隔（スペース）の実装
       const totalWidth = sorted.reduce((sum, b) => sum + (type === 'distribute-h' ? b.width : b.height), 0);
       const availableSpace = (type === 'distribute-h' ? (last.left + last.width) - first.left : (last.top + last.height) - first.top) - totalWidth;
       // これは両端固定で間を埋める場合。
       
       // 単純化: 両端の要素位置を固定し、その間を等距離（中心基準ではなく、要素間スペース基準が望ましいが複雑）
       // ここでは「等間隔（中心基準）」ではなく「等間隔（スペース）」を目指すが、まずは安全に「範囲内での均等配置」
       // FigmaのDistributeは「両端のオブジェクトを基準に、その間のオブジェクトを均等に配置」
       
       // 簡易実装: 中心座標を均等に配置（Distribute Horizontal Centers）ではなく、Spaceを均等にする
       // Space Based:
       // First el fixed. Last el fixed.
       // Span = (Last Right) - (First Left)
       // Total Object Width = sum(widths)
       // Total Gap = Span - Total Object Width
       // Gap per space = Total Gap / (n - 1)
       
        // 再計算: 最初と最後の要素の位置はそのまま
        const startPos = type === 'distribute-h' ? first.left : first.top;
        const endPos = type === 'distribute-h' ? (last.left + last.width) : (last.top + last.height);
        const totalObjectSize = sorted.map(b => type === 'distribute-h' ? b.width : b.height).reduce((a, b) => a + b, 0) - (type === 'distribute-h' ? first.width + last.width : first.height + last.height);
        // 間にあるオブジェクトのサイズの合計
        
        // 正確には: (Last Left - (First Left + First Width)) / (count - 1)? No.
        
        // Distribute spacing logic:
        // sort elements.
        // let currentPos = first.right + gap
        // loop 1 to n-2.
        
        // Calculate Gap
        const fullDistance = (type === 'distribute-h' ? last.left : last.top) - (type === 'distribute-h' ? (first.left + first.width) : (first.top + first.height));
        // 中間の要素の幅合計
        const innerWidthSum = sorted.slice(1, -1).reduce((sum, b) => sum + (type === 'distribute-h' ? b.width : b.height), 0);
        
        const gapCount = sorted.length - 1;
        // スペース自体の合計 = (Last Left - First Right) - Inner Widths
        // 実は単純に「要素の左端」を等間隔にする "Distribute Left" と、「スペース」を等間隔にする "Distribute Spacing" がある。
        // Figmaのアイコンは "Distribute Horizontal Spacing" (縦棒グラフみたいなの)
        // ここでは Spacing を実装する。
        
        const totalGap = fullDistance - innerWidthSum;
        const singleGap = totalGap / gapCount;
        
        let currentPos = (type === 'distribute-h' ? (first.left + first.width) : (first.top + first.height));
        
        sorted.forEach((b, i) => {
          if (i === 0) return; // 先頭は動かさない
          if (i === sorted.length - 1) return; // 末尾は動かさない（誤差吸収のため最後は何もしない手もあるが）
          
          currentPos += singleGap;
          // 位置適用
          b.el.style[type === 'distribute-h' ? 'left' : 'top'] = `${currentPos}px`;
          
          currentPos += (type === 'distribute-h' ? b.width : b.height);
        });
        
    } else {
       // 通常の整列
       bounds.forEach(b => {
         let newValue = 0;
         switch (type) {
           case 'left':
             newValue = referenceBounds.left;
             b.el.style.left = `${newValue}px`;
             break;
           case 'center-h':
             newValue = referenceBounds.centerX - (b.width / 2);
             b.el.style.left = `${newValue}px`;
             break;
           case 'right':
             newValue = referenceBounds.right - b.width;
             b.el.style.left = `${newValue}px`;
             break;
           case 'top':
             newValue = referenceBounds.top;
             b.el.style.top = `${newValue}px`;
             break;
           case 'center-v':
             newValue = referenceBounds.centerY - (b.height / 2);
             b.el.style.top = `${newValue}px`;
             break;
           case 'bottom':
             newValue = referenceBounds.bottom - b.height;
             b.el.style.top = `${newValue}px`;
             break;
         }
       });
    }

    // インラインスタイルをTailwindクラスに変換
    const positionProperties = ['left', 'top'];
    elements.forEach(el => {
      convertInlineStylesToTailwind(el, positionProperties);
    });

    notifyIframeChange();
    // 選択ボックス更新（選択セット全体から作り直す ＝ 群バウンディングボックスも更新される）
    requestAnimationFrame(() => {
        refreshSelectionOverlay(iframeDoc);
    });

  }, [selectedElementIds, selectedElement, getIframeDoc, notifyIframeChange]);
  const updateElementStyle = useCallback((styles: Record<string, string>) => {


    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      return;
    }

    // キャンバス/アートボードの寸法を取得（viewport単位の変換用）
    // iframeWindow.innerWidthではなく、アートボードの設計寸法を使用
    const canvasDimensions = getCanvasDimensions();
    const canvasWidth = canvasDimensions.width;
    const canvasHeight = canvasDimensions.height;


    /**
     * 要素にスタイルを適用（viewport単位を考慮）
     * - viewport単位（vw, vh, vmin, vmax）を検出した場合:
     *   - 元の値をdata-original-*属性に保存
     *   - キャンバス寸法に基づいてpxに変換して適用
     * - それ以外は通常通りTailwindスタイルを適用
     */
    const applyStylesWithViewportHandling = (el: HTMLElement, stylesToApply: Record<string, string>) => {
      const processedStyles: Record<string, string> = {};

      Object.entries(stylesToApply).forEach(([property, value]) => {
        if (hasViewportUnit(value)) {
          // viewport単位が含まれる場合
          // 元の値をdata属性に保存
          const attrName = getOriginalAttrName(property);
          el.setAttribute(attrName, value);

          // pxに変換（キャンバス寸法を基準に）
          const pxValue = convertViewportToPx(value, canvasWidth, canvasHeight);
          processedStyles[property] = pxValue;
        } else {
          // viewport単位でない場合は元のdata属性を削除
          const attrName = getOriginalAttrName(property);
          if (el.hasAttribute(attrName)) {
            el.removeAttribute(attrName);
          }
          processedStyles[property] = value;
        }
      });

      // 処理済みのスタイルを適用
      applyTailwindStyles(el, processedStyles);
    };

    // 複数選択されている場合は全て更新
    if (selectedElementIds.length > 0) {
      console.log('[DEBUG useElementActions] Applying styles to', selectedElementIds.length, 'elements');
      selectedElementIds.forEach(id => {
        const el = getIframeElement(iframeDoc, id);
        if (el) {
          console.log('[DEBUG useElementActions] Applying to element:', id);
          applyStylesWithViewportHandling(el, styles);
        }
      });
      notifyIframeChange();

      // 最後に使用したスタイルを保存（最初の要素の種類で判断）
      const firstEl = getIframeElement(iframeDoc, selectedElementIds[0]);
      if (firstEl) {
        captureLastUsedStyles(firstEl, styles, lastUsedStylesRef);
      }

      // 最後の選択要素の情報を更新
      if (selectedElement) {
        const el = getIframeElement(iframeDoc, selectedElement.id);
        if (el) {
          const info = extractElementInfo(el, iframeDoc);
          if (info) setSelectedElement(info);

          // 選択ボックスを更新（レイアウト反映待ち）
          requestAnimationFrame(() => {
            refreshSelectionOverlay(iframeDoc);
          });
        }
      }
      return;
    }

    // 単一選択の場合（後方互換）
    if (!selectedElement) return;
    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (el) {
      applyStylesWithViewportHandling(el, styles);
      notifyIframeChange();

      // 最後に使用したスタイルを保存
      captureLastUsedStyles(el, styles, lastUsedStylesRef);

      // 更新後の要素情報を再取得
      const info = extractElementInfo(el, iframeDoc);
      if (info) setSelectedElement(info);

      // 選択ボックスを更新（レイアウト反映待ち）
      // 1要素だけ作り直すと複数選択中に他の枠が消えるため全体を再構築する
      requestAnimationFrame(() => {
        refreshSelectionOverlay(iframeDoc);
      });
    }
  }, [selectedElement, selectedElementIds, getIframeDoc, notifyIframeChange, setSelectedElement, lastUsedStylesRef, getCanvasDimensions, editorMode]);

  // 要素削除（複数選択対応）
  const deleteElement = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    
    // 複数選択されている場合は全て削除
    if (selectedElementIds.length > 0) {
      selectedElementIds.forEach(id => {
        const el = getIframeElement(iframeDoc, id);
        if (el) {
          el.remove();
        }
      });
      // 選択ボックスも全て削除
      iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
      setSelectedElementIds([]);
      setSelectedElement(null);
      notifyIframeChange();
      return;
    }
    
    // 単一選択の場合
    if (!selectedElement) return;
    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (el) {
      el.remove();
      notifyIframeChange();
      setSelectedElement(null);
      setSelectedElementIds([]);
    }
  }, [selectedElement, selectedElementIds, getIframeDoc, notifyIframeChange, setSelectedElement, setSelectedElementIds]);

  // 要素複製（複数選択対応）- コンポーネントインスタンス対応
  const duplicateElement = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 既存の選択ボックスをクリア
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
    iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    /**
     * 複製された要素ツリー内の全ての data-element-id を再生成する
     * また、元のIDを data-master-element-id に保存してオーバーライド検出用に使用する
     * これにより、複製されたインスタンスが元のインスタンスと同じIDを持たなくなる
     */
    const regenerateAllElementIds = (element: HTMLElement, idMap: Map<string, string>): void => {
      // 現在の要素のIDを更新
      const oldId = element.getAttribute('data-element-id');
      if (oldId) {
        const newId = generateElementId('dup');
        // 元のIDをマスター参照用に保存（オーバーライド検出に使用）
        element.setAttribute('data-master-element-id', oldId);
        element.setAttribute('data-element-id', newId);
        idMap.set(oldId, newId);
      }

      // 全ての子要素を再帰的に処理
      const children = element.querySelectorAll('[data-element-id]');
      children.forEach((child) => {
        const childOldId = child.getAttribute('data-element-id');
        if (childOldId) {
          const childNewId = generateElementId('dup');
          // 元のIDをマスター参照用に保存
          child.setAttribute('data-master-element-id', childOldId);
          child.setAttribute('data-element-id', childNewId);
          idMap.set(childOldId, childNewId);
        }
      });
    };

    /**
     * 要素を複製するヘルパー関数
     * コンポーネントインスタンスの場合は新しいインスタンスを作成する
     */
    const cloneElementWithInstance = (el: HTMLElement): { clone: HTMLElement; newId: string } => {
      const clone = el.cloneNode(true) as HTMLElement;

      // ID再生成マップ（オーバーライドのターゲットID更新用）
      const idMap = new Map<string, string>();

      // 全ての要素IDを再生成
      regenerateAllElementIds(clone, idMap);

      // 新しいルートIDを取得
      const newId = clone.getAttribute('data-element-id') || generateElementId('dup');
      clone.classList.remove('selected');

      // コンポーネントインスタンスかどうかをチェック
      const instanceId = el.getAttribute('data-component-instance');
      const masterId = el.getAttribute('data-component-master');

      if (instanceId && masterId) {
        // 元のインスタンス情報を取得
        const originalInstance = getInstanceByDomId(el.getAttribute('data-element-id') || '');

        if (originalInstance) {
          // 新しいインスタンスを作成（元のオーバーライド、バリアント、プロパティ値を継承）
          try {
            const newInstance = createInstance(
              masterId,
              originalInstance.variantId,
              undefined, // instancePageId - use default from context
              undefined, // providedMaster - get from state
              newId,     // customDomElementId
              originalInstance.overrides,
              originalInstance.propertyValues
            );

            if (newInstance) {
              // 新しいインスタンスIDで属性を更新
              clone.setAttribute('data-component-instance', newInstance.id);
              console.log('[duplicateElement] Created new component instance:', newInstance.id, 'from:', instanceId);
            }
          } catch (error) {
            // インスタンス作成に失敗した場合、コンポーネント属性を削除（通常要素として複製）
            console.warn('[duplicateElement] Failed to create instance, duplicating as regular element:', error);
            clone.removeAttribute('data-component-instance');
            clone.removeAttribute('data-component-master');
          }
        } else {
          // 元のインスタンスが見つからない場合も通常要素として複製
          console.warn('[duplicateElement] Original instance not found, duplicating as regular element');
          clone.removeAttribute('data-component-instance');
          clone.removeAttribute('data-component-master');
        }
      }

      return { clone, newId };
    };

    // 複数選択されている場合は全て複製
    if (selectedElementIds.length > 0) {
      const newIds: string[] = [];
      const newElements: HTMLElement[] = [];
      selectedElementIds.forEach(id => {
        const el = getIframeElement(iframeDoc, id);
        if (el) {
          const { clone, newId } = cloneElementWithInstance(el);
          // 位置指定は「DOMに入れてから」元要素の実測位置を基準に行う（後述の理由）
          el.parentNode?.insertBefore(clone, el.nextSibling);
          offsetDuplicate(iframeDoc, el, clone, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
          newIds.push(newId);
          newElements.push(clone);
        }
      });

      // 新しい要素を選択
      setSelectedElementIds(newIds);
      newElements.forEach(el => {
        el.classList.add('selected');
      });
      refreshSelectionOverlay(iframeDoc);
      if (newElements.length > 0) {
        const info = extractElementInfo(newElements[0], iframeDoc);
        if (info) setSelectedElement(info);
      }

      notifyIframeChange();
      return;
    }

    // 単一選択の場合
    if (!selectedElement) return;
    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (el) {
      const { clone, newId } = cloneElementWithInstance(el);
      el.parentNode?.insertBefore(clone, el.nextSibling);
      offsetDuplicate(iframeDoc, el, clone, DUPLICATE_OFFSET, DUPLICATE_OFFSET);

      // 新しい要素を選択
      clone.classList.add('selected');
      refreshSelectionOverlay(iframeDoc);
      setSelectedElementIds([newId]);
      const info = extractElementInfo(clone, iframeDoc);
      if (info) setSelectedElement(info);

      notifyIframeChange();
    }
  }, [selectedElement, selectedElementIds, getIframeDoc, notifyIframeChange, setSelectedElement, setSelectedElementIds, getInstanceByDomId, createInstance]);

  // 要素シリアライズ
  const serializeElement = useCallback((el: HTMLElement): SerializedElement => {
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (!['contenteditable', 'data-editable'].includes(attr.name)) {
        attributes[attr.name] = attr.value;
      }
    }
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.getAttribute('data-element-id') || '',
      className: el.className,
      style: el.getAttribute('style') || '',
      innerHTML: el.innerHTML,
      attributes,
    };
  }, []);

  // 要素デシリアライズ
  const deserializeElement = useCallback((serialized: SerializedElement): HTMLElement | null => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return null;

    const el = iframeDoc.createElement(serialized.tagName);
    el.className = serialized.className;
    el.setAttribute('style', serialized.style);
    el.innerHTML = serialized.innerHTML;
    for (const [key, value] of Object.entries(serialized.attributes)) {
      if (key !== 'class' && key !== 'style') {
        el.setAttribute(key, value);
      }
    }
    el.setAttribute('data-editable', 'true');
    return el;
  }, [getIframeDoc]);

  // コピー（複数選択対応）
  /**
   * コピー内容をOSクリップボードにも書く。
   * これによりスライドを移っても(エディタを開き直しても)貼り付けられる。
   * ペイロードは text/html の data 属性に埋める(コメントはブラウザの
   * サニタイズで剥がされることがあるため使わない)。text/plain には
   * 文字内容を入れ、メモ帳等への貼り付けはテキストとして自然に振る舞う。
   */
  const writeToOsClipboard = useCallback((clip: ClipboardData) => {
    clip.osWritten = false;
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify(clip.elements))));
      const html = `<div data-gg-clipboard="v1" data-gg-payload="${payload}">${
        clip.elements.map(e => `<${e.tagName} class="${e.className}" style="${e.style}">${e.innerHTML}</${e.tagName}>`).join('')
      }</div>`;
      const text = clip.elements
        .map(e => {
          const tmp = document.createElement('div');
          tmp.innerHTML = e.innerHTML;
          return tmp.textContent || '';
        })
        .join('\n');
      void navigator.clipboard
        .write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ])
        .then(() => {
          if (clipboardRef.current) clipboardRef.current.osWritten = true;
        })
        .catch(() => {
          // 権限が無い環境では内部クリップボードだけで動く(同一スライド内は可)
        });
    } catch {
      // ClipboardItem 非対応環境も同様
    }
  }, [clipboardRef]);

  const copyElements = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    
    // 複数選択されている場合
    if (selectedElementIds.length > 0) {
      const serialized = selectedElementIds
        .map(id => getIframeElement(iframeDoc, id))
        .filter((el): el is HTMLElement => el !== null)
        .map(el => serializeElement(el));
      
      if (serialized.length > 0) {
        clipboardRef.current = {
          elements: serialized,
          offset: { x: 10, y: 10 },
        };
        writeToOsClipboard(clipboardRef.current);
      }
      return;
    }
    
    // 単一選択の場合
    if (!selectedElement) return;
    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el) return;

    clipboardRef.current = {
      elements: [serializeElement(el)],
      offset: { x: 10, y: 10 },
    };
    writeToOsClipboard(clipboardRef.current);
  }, [selectedElement, selectedElementIds, getIframeDoc, serializeElement, clipboardRef, writeToOsClipboard]);

  // カット（複数選択対応）
  const cutElements = useCallback(() => {
    copyElements();
    deleteElement();
  }, [copyElements, deleteElement]);

  /**
   * serialized の配列を貼り付ける本体。
   * 内部クリップボード(同一エディタ内)と、OSクリップボード経由
   * (スライド跨ぎ。pasteイベントがペイロードを取り出して渡す)の両方から使う。
   */
  const pasteSerializedElements = useCallback((list: SerializedElement[], offset?: { x: number; y: number }) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc || list.length === 0) return;
    const off = offset ?? { x: 10, y: 10 };

    // 既存の選択ボックスをクリア
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
    iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    // 挿入先を決定: 選択要素がある場合はその直後、なければbodyの末尾
    let insertAfterElement: HTMLElement | null = null;
    if (selectedElement) {
      insertAfterElement = getIframeElement(iframeDoc, selectedElement.id);
    }

    const pastedIds: string[] = [];
    const pastedElements: HTMLElement[] = [];

    list.forEach(serialized => {
      const el = deserializeElement(serialized);
      if (!el) return;
      
      const newId = generateElementId('paste');
      el.setAttribute('data-element-id', newId);
      const left = parseInt(el.style.left || '0') || 0;
      const top = parseInt(el.style.top || '0') || 0;
      el.style.left = `${left + off.x}px`;
      el.style.top = `${top + off.y}px`;
      
      // 挿入先に応じて挿入
      if (insertAfterElement && insertAfterElement.parentNode) {
        // 選択要素の直後に挿入
        insertAfterElement.parentNode.insertBefore(el, insertAfterElement.nextSibling);
        // 次のペースト要素のために更新
        insertAfterElement = el;
      } else {
        // 版面(スライドのルート)の末尾へ。body に貼ると版面の外に落ちて見えない
        const root =
          (iframeDoc.querySelector('#artboard > [data-editable]') as HTMLElement | null) ??
          (iframeDoc.getElementById('artboard') as HTMLElement | null) ??
          iframeDoc.body;
        root.appendChild(el);
      }
      
      pastedIds.push(newId);
      pastedElements.push(el);
    });

    notifyIframeChange();
    
    // ペーストした要素を選択し、選択ボックスを更新
    if (pastedIds.length > 0) {
      setSelectedElementIds(pastedIds);
      pastedElements.forEach(el => {
        el.classList.add('selected');
      });
      refreshSelectionOverlay(iframeDoc);
      // 単一要素の場合は selectedElement も更新
      if (pastedElements.length > 0) {
        const info = extractElementInfo(pastedElements[0], iframeDoc);
        if (info) setSelectedElement(info);
      }
    }
  }, [getIframeDoc, deserializeElement, notifyIframeChange, selectedElement, setSelectedElementIds, setSelectedElement]);

  // 内部クリップボードからのペースト(pasteイベント側のフォールバック用)
  const pasteElements = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip) return;
    pasteSerializedElements(clip.elements, clip.offset);
    clip.offset.x += 10;
    clip.offset.y += 10;
  }, [clipboardRef, pasteSerializedElements]);

  /**
   * OSクリップボードにggペイロードが無いときのフォールバック判断。
   * OS書込みに失敗した環境でだけ内部クリップボードを貼る。
   * OS書込みが成功しているのにペイロードが無い = ユーザーが後から別のものを
   * コピーしたということなので、内部の古い要素を貼ってはいけない
   */
  const pasteFromInternalIfFresh = useCallback((): boolean => {
    const clip = clipboardRef.current;
    if (!clip || clip.osWritten) return false;
    pasteElements();
    return true;
  }, [clipboardRef, pasteElements]);

  // 順序変更後の選択状態を更新するヘルパー
  const updateSelectionAfterReorder = useCallback((el: HTMLElement, iframeDoc: Document) => {
    // DOM変更後のレイアウト再計算を待ってから選択ボックスを更新
    requestAnimationFrame(() => {
      refreshSelectionOverlay(iframeDoc);
      const info = extractElementInfo(el, iframeDoc);
      if (info) {
        setSelectedElement(info);
      }
    });
  }, [setSelectedElement]);

  // 前面へ
  const bringForward = useCallback(() => {
    if (!selectedElement) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el || !el.nextElementSibling) return;
    el.parentElement?.insertBefore(el.nextElementSibling, el);
    notifyIframeChange();
    updateSelectionAfterReorder(el, iframeDoc);
  }, [selectedElement, getIframeDoc, notifyIframeChange, updateSelectionAfterReorder]);

  // 背面へ
  const sendBackward = useCallback(() => {
    if (!selectedElement) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el || !el.previousElementSibling) return;
    el.parentElement?.insertBefore(el, el.previousElementSibling);
    notifyIframeChange();
    updateSelectionAfterReorder(el, iframeDoc);
  }, [selectedElement, getIframeDoc, notifyIframeChange, updateSelectionAfterReorder]);

  // 最前面へ
  const bringToFront = useCallback(() => {
    if (!selectedElement) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el) return;
    el.parentElement?.appendChild(el);
    notifyIframeChange();
    updateSelectionAfterReorder(el, iframeDoc);
  }, [selectedElement, getIframeDoc, notifyIframeChange, updateSelectionAfterReorder]);

  // 最背面へ
  const sendToBack = useCallback(() => {
    if (!selectedElement) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el || !el.parentElement) return;
    el.parentElement.insertBefore(el, el.parentElement.firstChild);
    notifyIframeChange();
    updateSelectionAfterReorder(el, iframeDoc);
  }, [selectedElement, getIframeDoc, notifyIframeChange, updateSelectionAfterReorder]);

  // バウンディングボックス計算
  /**
   * 選択要素を囲む矩形(CSSピクセル)を求める
   *
   * [移植時の修正] 位置を inline style から読むのをやめ、使用値から読む。
   * さらにサイズも getBoundingClientRect ではなく使用値(cs.width/height)を使う。
   * rect はキャンバスのズーム(transform:scale)が掛かった値なので、
   * CSSピクセルの left/top と足すとズーム倍率のぶんだけ矩形が縮んでいた。
   */
  const calculateBoundingBox = useCallback((elements: HTMLElement[]): BoundingBox => {
    let minLeft = Infinity, minTop = Infinity;
    let maxRight = -Infinity, maxBottom = -Infinity;

    elements.forEach(el => {
      const view = el.ownerDocument.defaultView;
      const rect = el.getBoundingClientRect();
      const origin = view ? readUsedOffset(view, el) : null;
      const left = origin ? origin.left : (parseFloat(el.style.left) || 0);
      const top = origin ? origin.top : (parseFloat(el.style.top) || 0);
      const cs = view?.getComputedStyle(el);
      const width = parseFloat(cs?.width ?? '') || rect.width;
      const height = parseFloat(cs?.height ?? '') || rect.height;
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, left + width);
      maxBottom = Math.max(maxBottom, top + height);
    });

    return {
      left: minLeft,
      top: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
      right: maxRight,
      bottom: maxBottom,
    };
  }, []);

  // グループ化
  const groupElements = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // [移植時の修正] 単一選択でもグループ化できるようにする。
    // Cmd+Shift+G（解除）は1要素で効くのに Cmd+G は2要素以上必須で非対称だった。
    const ids = selectedElementIds.length > 0
      ? selectedElementIds
      : selectedElement
        ? [selectedElement.id]
        : [];
    if (ids.length < 1) return;

    const elements = ids
      .map(id => getIframeElement(iframeDoc, id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length < 1) return;

    const bounds = calculateBoundingBox(elements);

    // グループコンテナ作成
    const group = iframeDoc.createElement('div');
    const groupId = generateElementId('group');
    group.setAttribute('data-element-id', groupId);
    group.setAttribute('data-is-group', 'true');
    group.setAttribute('data-editable', 'true');
    
    // オートレイアウトモードかどうかで異なるスタイルを適用
    if (layoutMode === 'auto') {
      // オートレイアウトモード: position absoluteなし、サイズのみ設定
      group.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;
    } else {
      // 絶対配置モード: position absoluteで配置
      group.style.cssText = `
        position: absolute;
        left: ${bounds.left}px;
        top: ${bounds.top}px;
        width: ${bounds.width}px;
        height: ${bounds.height}px;
      `;
    }

    // 最初の選択要素の親を取得（グループは同じ階層に挿入）
    const firstElement = elements[0];
    const parentElement = firstElement.parentElement || iframeDoc.body;
    
    // 子要素をグループに移動（オートレイアウトモードでは位置変換なし）
    elements.forEach(el => {
      if (layoutMode !== 'auto') {
        // 絶対配置モード: 相対位置に変換。
        // 位置は inline ではなく使用値から読む（inline を持たない要素が0扱いで飛ぶため）。
        // フロー要素はここでは触らず、後段の convertSingleElementToAbsolute に任せる。
        const origin = readUsedOffset(iframeDoc.defaultView!, el);
        if (origin) {
          el.style.left = `${origin.left - bounds.left}px`;
          el.style.top = `${origin.top - bounds.top}px`;
        }
      } else {
        // オートレイアウトモード: position absoluteを解除
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
      }
      group.appendChild(el);
    });

    // 最初の選択要素があった位置にグループを挿入
    parentElement.appendChild(group);

    // グループコンテナの選択ボックスを削除
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());

    // フォントの読み込みを待ってから子要素を絶対配置に変換（絶対配置モードのみ）
    const convertChildrenToAbsolute = async () => {
      // オートレイアウトモードの場合は変換をスキップ
      if (layoutMode === 'auto') {
        console.log('[groupElements] Auto layout mode - skipping absolute positioning conversion');
        return;
      }

      try {
        // フォント読み込み待機
        if (iframeDoc.fonts?.ready) {
          await iframeDoc.fonts.ready;
        }
        await new Promise(resolve => setTimeout(resolve, 50));

        // グループ内の子要素を絶対配置に変換
        elements.forEach(el => {
          convertSingleElementToAbsolute(iframeDoc, el);
        });

        console.log('[groupElements] Converted', elements.length, 'child elements to absolute positioning');
        notifyIframeChange();
      } catch (err) {
        console.error('[groupElements] Error converting children:', err);
      }
    };

    convertChildrenToAbsolute();

    // 作ったグループを選択状態にする（枠・プロパティパネルもグループを指す）
    iframeDoc.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    group.classList.add('selected');
    setSelectedElementIds([groupId]);
    refreshSelectionOverlay(iframeDoc);
    const groupInfo = extractElementInfo(group, iframeDoc);
    if (groupInfo) setSelectedElement(groupInfo);
    notifyIframeChange();
  }, [selectedElement, selectedElementIds, getIframeDoc, calculateBoundingBox, setSelectedElementIds, setSelectedElement, notifyIframeChange, layoutMode]);

  // グループ解除（親要素を削除し、子要素を展開）
  // canUngroup関数で詳細な条件を判定
  const ungroupElements = useCallback(() => {
    if (!selectedElement) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const parent = getIframeElement(iframeDoc, selectedElement.id);
    if (!parent) return;

    // グループ解除可能かどうかを判定（詳細な条件をチェック）
    if (!canUngroup(parent)) {
      console.log('[ungroupElements] Element cannot be ungrouped:', parent.tagName);
      return;
    }

    // 編集可能な子要素を取得
    const children = Array.from(parent.children).filter(child => {
      const el = child as HTMLElement;
      // UI要素は除外
      if (el.classList?.contains('selection-box') ||
          el.classList?.contains('resize-handle') ||
          el.tagName === 'SCRIPT' ||
          el.tagName === 'STYLE') {
        return false;
      }
      // 編集可能な子要素のみ対象
      return el.getAttribute('data-editable') === 'true' ||
             el.hasAttribute('data-element-id');
    });

    if (children.length === 0) {
      console.log('[ungroupElements] No editable children to ungroup');
      return;
    }

    // 親要素の位置を取得
    const parentRect = parent.getBoundingClientRect();
    const parentLeft = parseInt(parent.style.left || '0') || 0;
    const parentTop = parseInt(parent.style.top || '0') || 0;
    const parentComputedStyle = iframeDoc.defaultView!.getComputedStyle(parent);
    const parentBorderLeft = parseFloat(parentComputedStyle.borderLeftWidth) || 0;
    const parentBorderTop = parseFloat(parentComputedStyle.borderTopWidth) || 0;

    const childIds: string[] = [];
    const childElements: HTMLElement[] = [];

    // 子要素を親の親に移動（またはbodyに）
    const grandParent = parent.parentElement || iframeDoc.body;

    children.forEach(child => {
      const el = child as HTMLElement;
      
      // data-element-idがない場合は付与
      if (!el.getAttribute('data-element-id')) {
        el.setAttribute('data-element-id', generateElementId('ungrouped'));
      }
      
      // data-editableを付与
      if (!el.getAttribute('data-editable')) {
        el.setAttribute('data-editable', 'true');
      }

      // 子要素の現在の位置を取得
      const childRect = el.getBoundingClientRect();
      const childLeft = parseInt(el.style.left || '0') || 0;
      const childTop = parseInt(el.style.top || '0') || 0;

      // 親の位置を考慮して新しい位置を計算
      let newLeft: number;
      let newTop: number;

      const childComputedStyle = iframeDoc.defaultView!.getComputedStyle(el);
      const isChildAbsolute = childComputedStyle.position === 'absolute' || childComputedStyle.position === 'fixed';

      if (isChildAbsolute) {
        // すでに絶対配置の場合、親の位置を加算
        newLeft = parentLeft + childLeft + parentBorderLeft;
        newTop = parentTop + childTop + parentBorderTop;
      } else {
        // 相対配置やstaticの場合、getBoundingClientRectから計算
        const bodyRect = iframeDoc.body.getBoundingClientRect();
        newLeft = childRect.left - bodyRect.left;
        newTop = childRect.top - bodyRect.top;
      }

      // 位置とサイズを設定
      el.style.position = 'absolute';
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      el.style.width = `${childRect.width}px`;
      el.style.height = `${childRect.height}px`;
      el.style.margin = '0';

      grandParent.appendChild(el);
      
      const childId = el.getAttribute('data-element-id');
      if (childId) {
        childIds.push(childId);
        childElements.push(el);
      }
    });

    // 親要素を削除
    parent.remove();

    // 選択ボックスをクリア
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());

    // フォントの読み込みを待ってから再度絶対配置に変換（レイアウト確定後）
    const finalizePositioning = async () => {
      // オートレイアウトモードの場合は変換をスキップ
      if (layoutMode === 'auto') {
        console.log('[ungroupElements] Auto layout mode - skipping absolute positioning conversion');
        return;
      }

      try {
        if (iframeDoc.fonts?.ready) {
          await iframeDoc.fonts.ready;
        }
        await new Promise(resolve => setTimeout(resolve, 50));

        // 子要素を再度絶対配置に変換
        childElements.forEach(el => {
          convertSingleElementToAbsolute(iframeDoc, el);
        });

        console.log('[ungroupElements] Converted', childElements.length, 'elements to absolute positioning');
        notifyIframeChange();
      } catch (err) {
        console.error('[ungroupElements] Error finalizing positions:', err);
      }
    };

    finalizePositioning();

    setSelectedElementIds(childIds);
    setSelectedElement(null);
    notifyIframeChange();

    console.log('[ungroupElements] Ungrouped', childIds.length, 'elements from', selectedElement.id);
  }, [selectedElement, getIframeDoc, setSelectedElementIds, setSelectedElement, notifyIframeChange]);

  /**
   * 要素移動（矢印キー用）
   *
   * [移植時の修正]
   * 1. 現在位置は inline style ではなく使用値(getComputedStyle)から読む。
   *    → inline left/top を持たない要素が (0,0) へワープする問題の解消。
   * 2. position:static（フロー）の要素には left/top を書かない。
   *    書いても見た目は動かないのに DOM と「未保存」だけが汚れていたため。
   * 3. 選択の中に1つでも動かせない要素があれば **誰も動かさない**（all-or-nothing）。
   *    一部だけ動くと群がバラけるので、Figma と同じく群は必ず一体で動く。
   * 4. 移動後は必ず選択枠とプロパティパネルを更新する。
   */
  const moveElement = useCallback((dx: number, dy: number): MoveElementResult => {
    const iframeDoc = getIframeDoc();
    const view = iframeDoc?.defaultView;
    if (!iframeDoc || !view) return { moved: 0, blocked: 'no-selection' };

    const ids = selectedElementIds.length > 0
      ? selectedElementIds
      : selectedElement
        ? [selectedElement.id]
        : [];
    if (ids.length === 0) return { moved: 0, blocked: 'no-selection' };

    const elements = ids
      .map(id => getIframeElement(iframeDoc, id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return { moved: 0, blocked: 'no-selection' };

    // [モード廃止] フロー内の要素は「動かせない」で終わらせず、その要素だけを
    // 絶対配置へ変換してから動かす(ドラッグと同じ遅延変換)。
    // 以前はここで弾いていたため、矢印キーが無反応になっていた。
    elements.forEach(el => {
      if (readUsedOffset(view, el) === null) {
        prepareElementDragOrigin(el, iframeDoc, { convertToAbsolute: true });
      }
    });
    const movable = elements.every(el => readUsedOffset(view, el) !== null);
    if (!movable) return { moved: 0, blocked: 'flow' };

    elements.forEach(el => translateOutOfFlowElement(view, el, dx, dy));

    notifyIframeChange();

    // 枠とプロパティパネルをその場で追従させる
    refreshSelectionOverlay(iframeDoc);
    const anchor = selectedElement
      ? getIframeElement(iframeDoc, selectedElement.id) ?? elements[0]
      : elements[0];
    const info = extractElementInfo(anchor, iframeDoc);
    if (info) setSelectedElement(info);

    return { moved: elements.length, blocked: null };
  }, [selectedElement, selectedElementIds, getIframeDoc, notifyIframeChange, setSelectedElement]);

  /**
   * 選択中の全要素の寸法を変える(キーボードリサイズ用)。
   * Figmaと同じく左上を固定し、複数選択なら各要素がそれぞれ同じ量だけ変わる
   * (群としての比例スケールではない。それはハンドルの群リサイズが担う)。
   */
  const resizeElements = useCallback((dw: number, dh: number): MoveElementResult => {
    const iframeDoc = getIframeDoc();
    const view = iframeDoc?.defaultView;
    if (!iframeDoc || !view) return { moved: 0, blocked: 'no-selection' };

    const ids = selectedElementIds.length > 0
      ? selectedElementIds
      : selectedElement
        ? [selectedElement.id]
        : [];
    const elements = ids
      .map(id => getIframeElement(iframeDoc, id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return { moved: 0, blocked: 'no-selection' };

    // フロー内の要素は移動と同じ遅延変換で絶対配置へ倒してから触る
    elements.forEach(el => {
      if (readUsedOffset(view, el) === null) {
        prepareElementDragOrigin(el, iframeDoc, { convertToAbsolute: true });
      }
    });

    elements.forEach(el => {
      if (dw !== 0) el.style.width = `${Math.max(8, el.offsetWidth + dw)}px`;
      if (dh !== 0) el.style.height = `${Math.max(8, el.offsetHeight + dh)}px`;
    });

    notifyIframeChange();
    refreshSelectionOverlay(iframeDoc);
    const anchor = selectedElement
      ? getIframeElement(iframeDoc, selectedElement.id) ?? elements[0]
      : elements[0];
    const info = extractElementInfo(anchor, iframeDoc);
    if (info) setSelectedElement(info);
    return { moved: elements.length, blocked: null };
  }, [selectedElement, selectedElementIds, getIframeDoc, notifyIframeChange, setSelectedElement]);

  // 移動用の個別関数（Shift+矢印=10px は呼び出し側が amount で指定する）
  const moveUp = useCallback((amount: number = 1) => moveElement(0, -amount), [moveElement]);
  const moveDown = useCallback((amount: number = 1) => moveElement(0, amount), [moveElement]);
  const moveLeft = useCallback((amount: number = 1) => moveElement(-amount, 0), [moveElement]);
  const moveRight = useCallback((amount: number = 1) => moveElement(amount, 0), [moveElement]);

  // リンク属性更新（<a>タグのhref, target, title等）
  const updateLinkAttribute = useCallback((attrs: Record<string, string>) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc || !selectedElement) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el) return;

    // 要素自体が<a>タグの場合
    let anchor: HTMLAnchorElement | null = null;
    if (el.tagName === 'A') {
      anchor = el as HTMLAnchorElement;
    } else {
      // 親に<a>タグがある場合
      anchor = el.closest('a');
    }

    if (!anchor) return;

    // 属性を更新
    Object.entries(attrs).forEach(([attr, value]) => {
      if (value === '' || value === null) {
        anchor!.removeAttribute(attr);
      } else {
        anchor!.setAttribute(attr, value);
      }
    });

    notifyIframeChange();

    // 更新後の要素情報を再取得
    const info = extractElementInfo(el, iframeDoc);
    if (info) setSelectedElement(info);
  }, [selectedElement, getIframeDoc, notifyIframeChange, setSelectedElement]);

  /**
   * [移植時の追加] 選択中の要素自身の属性を更新する(汎用)。
   * updateLinkAttribute は <a> を探して適用する専用実装のため、
   * <img> の src 差し替えなどには使えなかった。
   */
  const updateElementAttribute = useCallback((attrs: Record<string, string>) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc || !selectedElement) return;

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el) return;

    Object.entries(attrs).forEach(([attr, value]) => {
      if (value === '' || value === null || value === undefined) {
        el.removeAttribute(attr);
      } else {
        el.setAttribute(attr, value);
      }
    });

    notifyIframeChange();

    const info = extractElementInfo(el, iframeDoc);
    if (info) setSelectedElement(info);
  }, [selectedElement, getIframeDoc, notifyIframeChange, setSelectedElement]);

  /**
   * 選択中の要素からスタイルをコピー（Figmaライク）
   * Ctrl/Cmd + Alt + C
   */
  const copyStyle = useCallback(() => {
    console.log('[copyStyle] Called, selectedElement:', selectedElement?.id);
    const iframeDoc = getIframeDoc();
    if (!iframeDoc || !selectedElement) {
      console.log('[copyStyle] No element selected or no iframeDoc');
      return false;
    }

    const el = getIframeElement(iframeDoc, selectedElement.id);
    if (!el) return false;

    const computedStyle = iframeDoc.defaultView?.getComputedStyle(el);
    if (!computedStyle) return false;

    // スタイルを抽出（位置・サイズ以外）
    const styleData: StyleClipboard = {
      // タイポグラフィ
      fontSize: parseFloat(computedStyle.fontSize) || undefined,
      fontFamily: computedStyle.fontFamily?.split(',')[0]?.replace(/['"]/g, '').trim() || undefined,
      fontWeight: computedStyle.fontWeight || undefined,
      lineHeight: computedStyle.lineHeight || undefined,
      letterSpacing: computedStyle.letterSpacing || undefined,
      textAlign: computedStyle.textAlign || undefined,
      textDecoration: computedStyle.textDecoration !== 'none' ? computedStyle.textDecoration : undefined,
      fontStyle: computedStyle.fontStyle !== 'normal' ? computedStyle.fontStyle : undefined,
      color: computedStyle.color || undefined,

      // 背景・塗り
      backgroundColor: computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && computedStyle.backgroundColor !== 'transparent'
        ? computedStyle.backgroundColor : undefined,
      backgroundImage: computedStyle.backgroundImage !== 'none' ? computedStyle.backgroundImage : undefined,
      backgroundSize: computedStyle.backgroundSize || undefined,
      backgroundPosition: computedStyle.backgroundPosition || undefined,
      backgroundRepeat: computedStyle.backgroundRepeat || undefined,
      opacity: parseFloat(computedStyle.opacity) !== 1 ? parseFloat(computedStyle.opacity) : undefined,

      // ボーダー
      borderWidth: parseFloat(computedStyle.borderWidth) || undefined,
      borderColor: computedStyle.borderColor !== 'rgba(0, 0, 0, 0)' && computedStyle.borderColor !== 'transparent'
        ? computedStyle.borderColor : undefined,
      borderStyle: computedStyle.borderStyle !== 'none' ? computedStyle.borderStyle : undefined,
      borderRadius: parseFloat(computedStyle.borderRadius) || undefined,
      borderRadiusTopLeft: parseFloat(computedStyle.borderTopLeftRadius) || undefined,
      borderRadiusTopRight: parseFloat(computedStyle.borderTopRightRadius) || undefined,
      borderRadiusBottomRight: parseFloat(computedStyle.borderBottomRightRadius) || undefined,
      borderRadiusBottomLeft: parseFloat(computedStyle.borderBottomLeftRadius) || undefined,

      // シャドウ
      boxShadow: computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : undefined,

      // フィルター
      filter: computedStyle.filter !== 'none' ? computedStyle.filter : undefined,
      mixBlendMode: computedStyle.mixBlendMode !== 'normal' ? computedStyle.mixBlendMode : undefined,
      backdropFilter: computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : undefined,

      // パディング
      paddingTop: parseFloat(computedStyle.paddingTop) || undefined,
      paddingRight: parseFloat(computedStyle.paddingRight) || undefined,
      paddingBottom: parseFloat(computedStyle.paddingBottom) || undefined,
      paddingLeft: parseFloat(computedStyle.paddingLeft) || undefined,

      // Flexbox（オートレイアウト）
      display: computedStyle.display === 'flex' || computedStyle.display === 'grid' ? computedStyle.display : undefined,
      flexDirection: computedStyle.flexDirection || undefined,
      flexWrap: computedStyle.flexWrap || undefined,
      justifyContent: computedStyle.justifyContent || undefined,
      alignItems: computedStyle.alignItems || undefined,
      gap: parseFloat(computedStyle.gap) || undefined,
    };

    // undefinedのプロパティを削除
    const cleanedStyle = Object.fromEntries(
      Object.entries(styleData).filter(([, v]) => v !== undefined)
    ) as StyleClipboard;

    styleClipboardRef.current = cleanedStyle;
    console.log('[copyStyle] Style copied:', cleanedStyle);
    console.log('[copyStyle] Clipboard after setting:', styleClipboardRef.current);
    return true;
  }, [selectedElement, getIframeDoc, styleClipboardRef]);

  /**
   * コピーしたスタイルを選択中の要素に貼り付け（Figmaライク）
   * Ctrl/Cmd + Alt + V
   */
  const pasteStyle = useCallback(() => {
    console.log('[pasteStyle] Called');
    console.log('[pasteStyle] styleClipboardRef.current:', styleClipboardRef.current);
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      console.log('[pasteStyle] No iframeDoc');
      return false;
    }

    const copiedStyle = styleClipboardRef.current;
    if (!copiedStyle || Object.keys(copiedStyle).length === 0) {
      console.log('[pasteStyle] No style in clipboard');
      return false;
    }

    // 対象要素を取得（複数選択対応）
    const targetIds = selectedElementIds.length > 0
      ? selectedElementIds
      : selectedElement ? [selectedElement.id] : [];

    if (targetIds.length === 0) {
      console.log('[pasteStyle] No element selected');
      return false;
    }

    // スタイルをCSS形式に変換
    const styles: Record<string, string> = {};

    // タイポグラフィ
    if (copiedStyle.fontSize) styles.fontSize = `${copiedStyle.fontSize}px`;
    if (copiedStyle.fontFamily) styles.fontFamily = copiedStyle.fontFamily;
    if (copiedStyle.fontWeight) styles.fontWeight = copiedStyle.fontWeight;
    if (copiedStyle.lineHeight) styles.lineHeight = copiedStyle.lineHeight;
    if (copiedStyle.letterSpacing) styles.letterSpacing = copiedStyle.letterSpacing;
    if (copiedStyle.textAlign) styles.textAlign = copiedStyle.textAlign;
    if (copiedStyle.textDecoration) styles.textDecoration = copiedStyle.textDecoration;
    if (copiedStyle.fontStyle) styles.fontStyle = copiedStyle.fontStyle;
    if (copiedStyle.color) styles.color = copiedStyle.color;

    // 背景・塗り
    if (copiedStyle.backgroundColor) styles.backgroundColor = copiedStyle.backgroundColor;
    if (copiedStyle.backgroundImage) styles.backgroundImage = copiedStyle.backgroundImage;
    if (copiedStyle.backgroundSize) styles.backgroundSize = copiedStyle.backgroundSize;
    if (copiedStyle.backgroundPosition) styles.backgroundPosition = copiedStyle.backgroundPosition;
    if (copiedStyle.backgroundRepeat) styles.backgroundRepeat = copiedStyle.backgroundRepeat;
    if (copiedStyle.opacity !== undefined) styles.opacity = String(copiedStyle.opacity);

    // ボーダー
    if (copiedStyle.borderWidth) styles.borderWidth = `${copiedStyle.borderWidth}px`;
    if (copiedStyle.borderColor) styles.borderColor = copiedStyle.borderColor;
    if (copiedStyle.borderStyle) styles.borderStyle = copiedStyle.borderStyle;
    if (copiedStyle.borderRadius) styles.borderRadius = `${copiedStyle.borderRadius}px`;
    if (copiedStyle.borderRadiusTopLeft) styles.borderTopLeftRadius = `${copiedStyle.borderRadiusTopLeft}px`;
    if (copiedStyle.borderRadiusTopRight) styles.borderTopRightRadius = `${copiedStyle.borderRadiusTopRight}px`;
    if (copiedStyle.borderRadiusBottomRight) styles.borderBottomRightRadius = `${copiedStyle.borderRadiusBottomRight}px`;
    if (copiedStyle.borderRadiusBottomLeft) styles.borderBottomLeftRadius = `${copiedStyle.borderRadiusBottomLeft}px`;

    // シャドウ
    if (copiedStyle.boxShadow) styles.boxShadow = copiedStyle.boxShadow;

    // フィルター
    if (copiedStyle.filter) styles.filter = copiedStyle.filter;
    if (copiedStyle.mixBlendMode) styles.mixBlendMode = copiedStyle.mixBlendMode;
    if (copiedStyle.backdropFilter) styles.backdropFilter = copiedStyle.backdropFilter;

    // パディング
    if (copiedStyle.paddingTop) styles.paddingTop = `${copiedStyle.paddingTop}px`;
    if (copiedStyle.paddingRight) styles.paddingRight = `${copiedStyle.paddingRight}px`;
    if (copiedStyle.paddingBottom) styles.paddingBottom = `${copiedStyle.paddingBottom}px`;
    if (copiedStyle.paddingLeft) styles.paddingLeft = `${copiedStyle.paddingLeft}px`;

    // Flexbox
    if (copiedStyle.display) styles.display = copiedStyle.display;
    if (copiedStyle.flexDirection) styles.flexDirection = copiedStyle.flexDirection;
    if (copiedStyle.flexWrap) styles.flexWrap = copiedStyle.flexWrap;
    if (copiedStyle.justifyContent) styles.justifyContent = copiedStyle.justifyContent;
    if (copiedStyle.alignItems) styles.alignItems = copiedStyle.alignItems;
    if (copiedStyle.gap) styles.gap = `${copiedStyle.gap}px`;

    // 各要素にスタイルを適用
    targetIds.forEach(id => {
      const el = getIframeElement(iframeDoc, id);
      if (el) {
        applyTailwindStyles(el, styles);
      }
    });

    notifyIframeChange();

    // 選択要素の情報を更新
    if (selectedElement) {
      const el = getIframeElement(iframeDoc, selectedElement.id);
      if (el) {
        const info = extractElementInfo(el, iframeDoc);
        if (info) setSelectedElement(info);
      }
    }

    console.log('[pasteStyle] Style pasted to', targetIds.length, 'element(s)');
    return true;
  }, [selectedElement, selectedElementIds, getIframeDoc, styleClipboardRef, notifyIframeChange, setSelectedElement]);

  /**
   * スタイルクリップボードにスタイルがあるかどうか
   */
  const hasStyleInClipboard = useCallback(() => {
    return styleClipboardRef.current !== null && Object.keys(styleClipboardRef.current).length > 0;
  }, [styleClipboardRef]);

  /**
   * 選択中の要素をFigma形式でクリップボードにコピー
   * Figmaに貼り付け可能な形式で出力する
   * Ctrl/Cmd + Shift + C
   */
  const copyToFigma = useCallback(async (): Promise<{ success: boolean; error?: string; nodeCount?: number }> => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) {
      return { success: false, error: 'No iframe document available' };
    }

    // Figmaエクスポートが利用可能か確認（スキーマがキャッシュされているか）
    if (!isFigmaExportAvailable()) {
      return {
        success: false,
        error: 'Figma export not available. Please paste from Figma first to initialize the schema.'
      };
    }

    // 対象要素を取得
    const targetIds = selectedElementIds.length > 0
      ? selectedElementIds
      : selectedElement ? [selectedElement.id] : [];

    if (targetIds.length === 0) {
      return { success: false, error: 'No element selected' };
    }

    const elements = targetIds
      .map(id => getIframeElement(iframeDoc, id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) {
      return { success: false, error: 'Selected elements not found in document' };
    }

    console.log('[copyToFigma] Copying', elements.length, 'element(s) to Figma format');

    try {
      const result = await copyElementsToFigma(elements);

      if (result.success) {
        console.log('[copyToFigma] Successfully copied', result.nodeCount, 'nodes to clipboard');
        return { success: true, nodeCount: result.nodeCount };
      } else {
        console.error('[copyToFigma] Failed:', result.error);
        return { success: false, error: result.error };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[copyToFigma] Error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [selectedElement, selectedElementIds, getIframeDoc]);

  /**
   * Figmaエクスポートが利用可能かどうか
   */
  const canCopyToFigma = useCallback(() => {
    return isFigmaExportAvailable();
  }, []);

  return {
    updateElementStyle,
    updateLinkAttribute,
    updateElementAttribute,
    deleteElement,
    duplicateElement,
    copyElements,
    cutElements,
    pasteElements,
    pasteSerializedElements,
    pasteFromInternalIfFresh,
    copyStyle,
    pasteStyle,
    hasStyleInClipboard,
    copyToFigma,
    canCopyToFigma,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    groupElements,
    ungroupElements,
    moveElement,
    resizeElements,
    moveUp,
    moveDown,
    moveLeft,
    moveRight,
    alignElements,
  };
}
