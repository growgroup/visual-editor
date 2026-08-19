'use client';

/**
 * ComponentItem - Single component thumbnail item
 *
 * Displays a component with:
 * - Thumbnail preview (actual component rendering)
 * - Component name
 * - Drag start handler for drag-and-drop
 *
 * Supports keyboard navigation and accessibility.
 */

import React, { useCallback, useState, useRef, memo, useEffect } from 'react';
import { GripVertical, Component as ComponentIcon, ChevronDown, ChevronRight } from 'lucide-react';
import type { MasterComponent, ComponentElement } from '../../../types/editor-components';
import { createDOMElement } from '../../utils/component-renderer';
import { VariantList } from './VariantList';

interface ComponentItemProps {
  /** The component to display */
  component: MasterComponent;
  /** Callback when the component is clicked */
  onClick?: (component: MasterComponent) => void;
  /** Callback when the component is double-clicked (to edit) */
  onDoubleClick?: (component: MasterComponent) => void;
  /** Whether this component is selected (highlighted) */
  isSelected?: boolean;
  /** Whether variants are expanded (controlled) */
  variantsExpanded?: boolean;
  /** Callback when variants expansion is toggled */
  onToggleVariants?: (componentId: string) => void;
}

/**
 * Calculate the scale factor to fit the element within the container
 */
function calculateScale(
  elementWidth: number,
  elementHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 8
): number {
  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  const scaleX = availableWidth / elementWidth;
  const scaleY = availableHeight / elementHeight;

  // Use the smaller scale to ensure the element fits
  return Math.min(scaleX, scaleY, 1); // Cap at 1 to not enlarge small elements
}

/**
 * Render actual component preview using createDOMElement
 */
function ComponentThumbnail({
  component,
}: {
  component: MasterComponent;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Get the default variant's root element
  const defaultVariant = component.variants.find(
    (v) => v.id === component.defaultVariantId
  );
  const rootElement = defaultVariant?.rootElement;

  useEffect(() => {
    if (!containerRef.current || !rootElement) {
      setHasError(true);
      return;
    }

    setHasError(false);
    setIsReady(false);

    const container = containerRef.current;

    // Clear previous content
    container.innerHTML = '';

    try {
      // Create the DOM element from the component structure
      const domElement = createDOMElement(rootElement);

      // Create a wrapper for scaling
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
      `;

      // Create a scaling container
      const scaleContainer = document.createElement('div');
      scaleContainer.style.cssText = `
        transform-origin: center center;
        transition: transform 0.15s ease;
      `;

      // Reset some styles that might interfere with preview
      domElement.style.position = 'relative';
      domElement.style.left = 'auto';
      domElement.style.top = 'auto';
      domElement.style.right = 'auto';
      domElement.style.bottom = 'auto';
      domElement.style.transform = 'none';
      domElement.style.margin = '0';

      scaleContainer.appendChild(domElement);
      wrapper.appendChild(scaleContainer);
      container.appendChild(wrapper);

      // Wait for styles to apply, then calculate scale
      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();

        // [移植時の修正] スライド用の部品は実幅が1000px超のものがあり、
        // そのまま縮小するとサムネイルが線一本になって中身が判別できない。
        // プレビューのときだけ幅を詰めて、内容が見える縮尺に収める。
        if (domElement.getBoundingClientRect().width > 360) {
          domElement.style.width = '360px';
        }

        const elementRect = domElement.getBoundingClientRect();

        // Only scale if the element has dimensions
        if (elementRect.width > 0 && elementRect.height > 0) {
          const scale = calculateScale(
            elementRect.width,
            elementRect.height,
            containerRect.width,
            containerRect.height,
            4 // padding
          );
          scaleContainer.style.transform = `scale(${scale})`;
        }

        setIsReady(true);
      });
    } catch (error) {
      console.error('[ComponentThumbnail] Error creating preview:', error);
      setHasError(true);
    }

    // Cleanup
    return () => {
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [rootElement, component.id]);

  // Fallback for components without valid rootElement
  if (!rootElement || hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1e1e1e]">
        <ComponentIcon className="w-6 h-6 text-gray-600" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-white transition-opacity duration-200 ${
        isReady ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        // Provide a neutral background for previews
        background: 'linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
      }}
    />
  );
}

/**
 * ComponentItem displays a single draggable component.
 * Supports drag-and-drop to add components to the canvas.
 */
export const ComponentItem = memo(function ComponentItem({
  component,
  onClick,
  onDoubleClick,
  isSelected = false,
  variantsExpanded = false,
  onToggleVariants,
}: ComponentItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  // Use controlled or local expansion state
  const isVariantsExpanded = onToggleVariants !== undefined ? variantsExpanded : localExpanded;
  const hasMultipleVariants = component.variants.length > 1;

  // Toggle variants expansion
  const handleToggleVariants = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleVariants) {
      onToggleVariants(component.id);
    } else {
      setLocalExpanded(prev => !prev);
    }
  }, [component.id, onToggleVariants]);

  // Auto-scroll to selected component
  React.useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isSelected]);

  // Handle double click to edit
  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(component);
  }, [onDoubleClick, component]);

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsDragging(true);

      // Set drag data with component info
      e.dataTransfer.setData(
        'application/x-editor-component',
        JSON.stringify({
          type: 'component',
          componentId: component.id,
          componentName: component.name,
        })
      );
      e.dataTransfer.effectAllowed = 'copy';

      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.className =
        'bg-[#2c2c2c] border border-[#0d99ff] rounded px-2 py-1 text-xs text-white shadow-lg';
      dragImage.textContent = component.name;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);

      // Clean up drag image after a short delay
      setTimeout(() => {
        document.body.removeChild(dragImage);
      }, 0);
    },
    [component.id, component.name]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle click
  const handleClick = useCallback(() => {
    onClick?.(component);
  }, [onClick, component]);

  // Handle keyboard interaction
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(component);
      }
    },
    [onClick, component]
  );

  return (
    <div
      ref={itemRef}
      className={`
        group relative flex flex-col rounded border cursor-grab
        transition-all duration-150
        ${
          isDragging
            ? 'opacity-50 border-[#0d99ff] bg-[#0d99ff]/10'
            : isSelected
            ? 'border-[#0d99ff] bg-[#0d99ff]/20 ring-1 ring-[#0d99ff]'
            : 'border-[#444444] bg-[#2c2c2c] hover:border-gray-500 hover:bg-[#353535]'
        }
        focus:outline-none focus:ring-1 focus:ring-[#0d99ff]
      `}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listitem"
      aria-label={`${component.name}コンポーネント。ドラッグしてキャンバスに追加。ダブルクリックで編集。`}
    >
      {/* Drag handle indicator */}
      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-3 h-3 text-gray-500" />
      </div>

      {/* Thumbnail */}
      <div className="h-16 bg-[#1e1e1e] rounded-t overflow-hidden">
        <ComponentThumbnail component={component} />
      </div>

      {/* Component name and info */}
      <div className="px-2 py-1.5 border-t border-[#444444]">
        <div className="flex items-center gap-1">
          <p className="text-[10px] text-gray-300 truncate font-medium flex-1">
            {component.name}
          </p>
          {hasMultipleVariants && (
            <button
              onClick={handleToggleVariants}
              className="p-0.5 hover:bg-[#444444] rounded transition-colors flex-shrink-0"
              aria-label={isVariantsExpanded ? 'バリアントを閉じる' : 'バリアントを開く'}
              aria-expanded={isVariantsExpanded}
            >
              {isVariantsExpanded ? (
                <ChevronDown className="w-3 h-3 text-purple-400" />
              ) : (
                <ChevronRight className="w-3 h-3 text-purple-400" />
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {hasMultipleVariants && (
            <button
              onClick={handleToggleVariants}
              className="text-[8px] text-purple-400 bg-purple-500/20 px-1 rounded hover:bg-purple-500/30 transition-colors"
            >
              {component.variants.length}バリアント
            </button>
          )}
          {component.tags && component.tags.length > 0 && (
            <p className="text-[8px] text-gray-500 truncate flex-1">
              {component.tags.slice(0, 2).join(', ')}
            </p>
          )}
        </div>
      </div>

      {/* Variant List */}
      {hasMultipleVariants && isVariantsExpanded && (
        <div className="px-2 pb-2 border-t border-[#444444]">
          <VariantList component={component} isExpanded={true} />
        </div>
      )}
    </div>
  );
});

export default ComponentItem;
