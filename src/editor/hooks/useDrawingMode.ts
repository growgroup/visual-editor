'use client';

/**
 * 描画ツールを管理するHook
 */

import { useEffect } from 'react';
import { useEditorContext } from '../EditorContext';
import { generateElementId } from '../utils/dom-utils';
import { inkStyle } from '../utils/ink-style';
import { pendingShape, shapeStyles as shapeLibStyles } from '../utils/shape-library';

/**
 * 描画ツールのイベントハンドリングを行うHook
 */
export function useDrawingMode() {
  const {
    iframeRef,
    activeTool,
    getIframeDoc,
    selectedElementIds,
    notifyIframeChange,
    lastUsedStylesRef,
    iframeReady,
  } = useEditorContext();

  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const drawingTools = ['rectangle', 'ellipse', 'line', 'arrow', 'pen', 'pencil', 'frame', 'text', 'shape'];
    if (!drawingTools.includes(activeTool)) return;

    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let previewElement: HTMLElement | null = null;
    let penPoints: { x: number; y: number }[] = [];

    // artboard相対座標を取得（ズームスケール考慮）
    const getArtboardRelativeCoords = (e: MouseEvent): { x: number; y: number } => {
      const artboard = iframeDoc.getElementById('artboard');
      if (!artboard) {
        return { x: e.pageX, y: e.pageY };
      }

      // artboardのビューポート座標を取得
      const artboardRect = artboard.getBoundingClientRect();

      // ズームスケールを取得
      const artboardWrapper = iframeDoc.getElementById('artboard-wrapper');
      let scale = 1;
      if (artboardWrapper) {
        let transform = artboardWrapper.style.transform;
        if (!transform) {
          const computedStyle = iframeDoc.defaultView?.getComputedStyle(artboardWrapper);
          transform = computedStyle?.transform || '';
        }
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        if (scaleMatch) {
          scale = parseFloat(scaleMatch[1]) || 1;
        } else {
          const matrixMatch = transform.match(/matrix\(([^,]+),/);
          if (matrixMatch) {
            scale = parseFloat(matrixMatch[1]) || 1;
          }
        }
      }

      // クライアント座標からartboard相対座標に変換（スケールで割る）
      const x = (e.clientX - artboardRect.left) / scale;
      const y = (e.clientY - artboardRect.top) / scale;

      return { x, y };
    };

    // 線/矢印SVGを生成
    const createLineSVG = (x1: number, y1: number, x2: number, y2: number, withArrow: boolean): string => {
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      const sx = x1 < x2 ? 0 : width;
      const sy = y1 < y2 ? 0 : height;
      const ex = x1 < x2 ? width : 0;
      const ey = y1 < y2 ? height : 0;

      // 最後に使用した線のスタイルを取得（常に最新値を参照）
      const lineStyles = lastUsedStylesRef.current.line;
      const strokeColor = lineStyles.stroke;
      const strokeWidth = lineStyles.strokeWidth;

      let arrowHead = '';
      if (withArrow) {
        const angle = Math.atan2(ey - sy, ex - sx);
        const arrowLength = 12;
        const arrowAngle = Math.PI / 6;
        const ax1 = ex - arrowLength * Math.cos(angle - arrowAngle);
        const ay1 = ey - arrowLength * Math.sin(angle - arrowAngle);
        const ax2 = ex - arrowLength * Math.cos(angle + arrowAngle);
        const ay2 = ey - arrowLength * Math.sin(angle + arrowAngle);
        arrowHead = `<polygon points="${ex},${ey} ${ax1},${ay1} ${ax2},${ay2}" fill="${strokeColor}"/>`;
      }

      return `<svg width="${width}" height="${height}" style="position:absolute;left:0;top:0;overflow:visible;">
        <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
        ${arrowHead}
      </svg>`;
    };

    // ペンSVGを生成
    const createPenSVG = (points: { x: number; y: number }[]): string => {
      if (points.length < 2) return '';
      const minX = Math.min(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxX = Math.max(...points.map(p => p.x));
      const maxY = Math.max(...points.map(p => p.y));
      const width = maxX - minX || 1;
      const height = maxY - minY || 1;

      const pathData = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - minX} ${p.y - minY}`)
        .join(' ');

      // ペン系はインク設定(ペンギャラリー)を参照。線/矢印とは独立
      return `<svg width="${width}" height="${height}" style="position:absolute;left:0;top:0;overflow:visible;">
        <path d="${pathData}" stroke="${inkStyle.color}" stroke-width="${inkStyle.width}" stroke-opacity="${inkStyle.opacity}" fill="none" stroke-linecap="${inkStyle.cap}" stroke-linejoin="round"/>
      </svg>`;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const bodyClasses = iframeDoc.body.classList;
      if (!bodyClasses.contains('draw-mode') && !bodyClasses.contains('text-mode')) return;

      e.preventDefault();
      isDrawing = true;
      const coords = getArtboardRelativeCoords(e);
      startX = coords.x;
      startY = coords.y;
      penPoints = [{ x: startX, y: startY }];

      // プレビュー要素を作成
      previewElement = iframeDoc.createElement('div');
      previewElement.className = 'drawing-preview';
      previewElement.style.cssText = `
        position: absolute;
        left: ${startX}px;
        top: ${startY}px;
        width: 0;
        height: 0;
      `;

      if (activeTool === 'shape') {
        // ギャラリーで選んだ図形は、ドラッグ中もその形で見せる
        const st = shapeLibStyles(pendingShape);
        previewElement.style.backgroundColor = 'rgba(58,122,87,0.35)';
        previewElement.style.border = '1px solid rgba(58,122,87,0.9)';
        if (st.clipPath) previewElement.style.clipPath = st.clipPath;
        if (st.borderRadius) previewElement.style.borderRadius = st.borderRadius;
      } else if (activeTool === 'ellipse') {
        previewElement.classList.add('ellipse');
      } else if (activeTool === 'frame') {
        previewElement.classList.add('frame');
      } else if (activeTool === 'text') {
        // テキストは即座に作成
        isDrawing = false;
        const textEl = iframeDoc.createElement('div');
        const textId = generateElementId('text');
        textEl.setAttribute('data-element-id', textId);
        textEl.setAttribute('data-shape-type', 'text');
        textEl.setAttribute('data-editable', 'true');
        textEl.setAttribute('contenteditable', 'true');

        // 最後に使用したテキストスタイルを適用
        const textStyles = lastUsedStylesRef.current.text;
        textEl.style.cssText = `
          position: absolute;
          left: ${startX}px;
          top: ${startY}px;
          min-width: 100px;
          min-height: 1.5em;
          font-size: ${textStyles.fontSize};
          color: ${textStyles.color};
          font-family: ${textStyles.fontFamily};
          font-weight: ${textStyles.fontWeight};
          line-height: ${textStyles.lineHeight};
          letter-spacing: ${textStyles.letterSpacing};
          text-align: ${textStyles.textAlign};
          outline: none;
          padding: 4px;
        `;
        textEl.textContent = 'テキストを入力';
        
        // 挿入位置の決定（#artboard内に挿入）
        const artboard = iframeDoc.getElementById('artboard') || iframeDoc.body;
        let inserted = false;
        if (selectedElementIds.length > 0) {
          const lastSelectedId = selectedElementIds[selectedElementIds.length - 1];
          const referenceNode = iframeDoc.querySelector(`[data-element-id="${lastSelectedId}"]`);
          if (referenceNode && referenceNode.parentNode === artboard) {
            referenceNode.insertAdjacentElement('afterend', textEl);
            inserted = true;
          }
        }

        if (!inserted) {
          artboard.appendChild(textEl);
        }

        textEl.focus();
        textEl.classList.add('selected', 'editing');

        const range = iframeDoc.createRange();
        range.selectNodeContents(textEl);
        const selection = iframeDoc.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        notifyIframeChange(true);
        window.postMessage({ type: 'TOOL_FINISHED' }, '*');
        return;
      }

      // プレビュー要素を#artboard内に追加
      const artboardForPreview = iframeDoc.getElementById('artboard') || iframeDoc.body;
      artboardForPreview.appendChild(previewElement);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing || !previewElement) return;

      const coords = getArtboardRelativeCoords(e);
      const currentX = coords.x;
      const currentY = coords.y;

      if (activeTool === 'pen' || activeTool === 'pencil') {
        penPoints.push({ x: currentX, y: currentY });
        previewElement.innerHTML = createPenSVG(penPoints);
        const minX = Math.min(...penPoints.map(p => p.x));
        const minY = Math.min(...penPoints.map(p => p.y));
        previewElement.style.left = `${minX}px`;
        previewElement.style.top = `${minY}px`;
      } else if (activeTool === 'line' || activeTool === 'arrow') {
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        previewElement.style.left = `${Math.min(startX, currentX)}px`;
        previewElement.style.top = `${Math.min(startY, currentY)}px`;
        previewElement.style.width = `${width}px`;
        previewElement.style.height = `${height}px`;
        previewElement.style.border = 'none';
        previewElement.style.backgroundColor = 'transparent';
        previewElement.innerHTML = createLineSVG(startX, startY, currentX, currentY, activeTool === 'arrow');
      } else {
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        previewElement.style.left = `${Math.min(startX, currentX)}px`;
        previewElement.style.top = `${Math.min(startY, currentY)}px`;
        previewElement.style.width = `${width}px`;
        previewElement.style.height = `${height}px`;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawing) return;
      isDrawing = false;

      const coords = getArtboardRelativeCoords(e);
      const currentX = coords.x;
      const currentY = coords.y;

      previewElement?.remove();
      previewElement = null;

      let width = Math.abs(currentX - startX);
      let height = Math.abs(currentY - startY);
      // PowerPointと同じく、ドラッグせずクリックしただけでも既定サイズで配置する。
      // 「図形を選んでクリックしたのに何も起きない」を無くすため
      if (activeTool !== 'pen' && activeTool !== 'pencil' && width < 5 && height < 5) {
        if (activeTool === 'line' || activeTool === 'arrow') {
          width = 240;
          height = 0;
        } else if (activeTool === 'text') {
          width = 320;
          height = 48;
        } else if (activeTool === 'shape') {
          width = pendingShape.w;
          height = pendingShape.h;
        } else {
          width = 200;
          height = 120;
        }
      }
      if ((activeTool === 'pen' || activeTool === 'pencil') && penPoints.length < 3) {
        return;
      }

      // 最終要素を作成
      const shapeEl = iframeDoc.createElement('div');
      const shapeId = generateElementId('shape');
      shapeEl.setAttribute('data-element-id', shapeId);
      shapeEl.setAttribute('data-shape-type', activeTool);
      shapeEl.setAttribute('data-editable', 'true');

      const left = Math.min(startX, startX + (currentX >= startX ? width : -width));
      const top = Math.min(startY, startY + (currentY >= startY ? height : -height));

      // 最後に使用した図形スタイルを取得
      const shapeStyles = lastUsedStylesRef.current.shape;

      if (activeTool === 'shape') {
        // ギャラリーの図形。塗り/枠/影は「図形の書式」タブから後で変えられる
        shapeEl.setAttribute('data-shape-type', 'shape');
        shapeEl.setAttribute('data-shape-id', pendingShape.id);
        shapeEl.style.position = 'absolute';
        shapeEl.style.left = `${left}px`;
        shapeEl.style.top = `${top}px`;
        shapeEl.style.width = `${width}px`;
        shapeEl.style.height = `${height}px`;
        const st = shapeLibStyles(pendingShape);
        for (const [k, v] of Object.entries(st)) {
          (shapeEl.style as unknown as Record<string, string>)[k] = v;
        }
      } else if (activeTool === 'rectangle') {
        shapeEl.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          background-color: ${shapeStyles.backgroundColor};
          border-radius: ${shapeStyles.borderRadius};
          border: ${shapeStyles.borderWidth} ${shapeStyles.borderStyle} ${shapeStyles.borderColor};
          opacity: ${shapeStyles.opacity};
        `;
      } else if (activeTool === 'ellipse') {
        shapeEl.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          background-color: ${shapeStyles.backgroundColor};
          border-radius: 50%;
          border: ${shapeStyles.borderWidth} ${shapeStyles.borderStyle} ${shapeStyles.borderColor};
          opacity: ${shapeStyles.opacity};
        `;
      } else if (activeTool === 'frame') {
        shapeEl.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          background-color: transparent;
          border: 1px dashed #9CA3AF;
        `;
      } else if (activeTool === 'line' || activeTool === 'arrow') {
        shapeEl.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          background-color: transparent;
        `;
        shapeEl.innerHTML = createLineSVG(startX, startY, currentX, currentY, activeTool === 'arrow');
      } else if (activeTool === 'pen' || activeTool === 'pencil') {
        const minX = Math.min(...penPoints.map(p => p.x));
        const minY = Math.min(...penPoints.map(p => p.y));
        const maxX = Math.max(...penPoints.map(p => p.x));
        const maxY = Math.max(...penPoints.map(p => p.y));
        shapeEl.style.cssText = `
          position: absolute;
          left: ${minX}px;
          top: ${minY}px;
          width: ${maxX - minX}px;
          height: ${maxY - minY}px;
          background-color: transparent;
        `;
        shapeEl.innerHTML = createPenSVG(penPoints);
      }

      // 挿入位置の決定（#artboard内に挿入）
      const artboard = iframeDoc.getElementById('artboard') || iframeDoc.body;
      let inserted = false;
      if (selectedElementIds.length > 0) {
        const lastSelectedId = selectedElementIds[selectedElementIds.length - 1];
        const referenceNode = iframeDoc.querySelector(`[data-element-id="${lastSelectedId}"]`);
        if (referenceNode && referenceNode.parentNode === artboard) {
          referenceNode.insertAdjacentElement('afterend', shapeEl);
          inserted = true;
        }
      }

      if (!inserted) {
        artboard.appendChild(shapeEl);
      }
      // ペン/鉛筆はストロークを続けて描けるようツールを維持する(Figma/PPTと同じ)。
      // 図形やテキストは1回置いたら選択ツールへ戻す。
      const continuous = activeTool === 'pen' || activeTool === 'pencil';
      if (!continuous) shapeEl.classList.add('selected');

      notifyIframeChange(true);
      if (!continuous) window.postMessage({ type: 'TOOL_FINISHED' }, '*');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.postMessage({ type: 'TOOL_FINISHED' }, '*');
    };

    iframeDoc.addEventListener('mousedown', handleMouseDown);
    iframeDoc.addEventListener('mousemove', handleMouseMove);
    iframeDoc.addEventListener('mouseup', handleMouseUp);
    iframeDoc.addEventListener('keydown', handleKeyDown);

    return () => {
      iframeDoc.removeEventListener('mousedown', handleMouseDown);
      iframeDoc.removeEventListener('mousemove', handleMouseMove);
      iframeDoc.removeEventListener('mouseup', handleMouseUp);
      iframeDoc.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTool, getIframeDoc, iframeRef, iframeReady]);

  // 消しゴム: ペン/鉛筆ストロークをクリックまたはなぞって丸ごと消す(PowerPointと同じ挙動)。
  // 選択処理より先に奪うため capture で受ける。Escで選択ツールへ戻る。
  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc || activeTool !== 'eraser') return;

    let erasing = false;

    const strokeAt = (e: MouseEvent): Element | null => {
      const t = e.target as Element | null;
      return t?.closest?.('[data-shape-type="pen"], [data-shape-type="pencil"]') ?? null;
    };

    const eraseAt = (e: MouseEvent) => {
      const stroke = strokeAt(e);
      if (stroke) {
        stroke.remove();
        notifyIframeChange(true);
      }
    };

    const down = (e: MouseEvent) => {
      erasing = true;
      e.preventDefault();
      e.stopPropagation();
      eraseAt(e);
    };
    const move = (e: MouseEvent) => {
      if (erasing) eraseAt(e);
    };
    const up = () => { erasing = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.postMessage({ type: 'TOOL_FINISHED' }, '*');
    };

    const prevCursor = iframeDoc.body.style.cursor;
    iframeDoc.body.style.cursor = 'crosshair';
    iframeDoc.addEventListener('mousedown', down, true);
    iframeDoc.addEventListener('mousemove', move, true);
    iframeDoc.addEventListener('mouseup', up, true);
    iframeDoc.addEventListener('keydown', key, true);

    return () => {
      iframeDoc.body.style.cursor = prevCursor;
      iframeDoc.removeEventListener('mousedown', down, true);
      iframeDoc.removeEventListener('mousemove', move, true);
      iframeDoc.removeEventListener('mouseup', up, true);
      iframeDoc.removeEventListener('keydown', key, true);
    };
  }, [activeTool, getIframeDoc, notifyIframeChange, iframeReady]);
}
