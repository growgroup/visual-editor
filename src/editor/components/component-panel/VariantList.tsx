'use client';

/**
 * VariantList - Display variants of a component
 *
 * Shows all variants of a component with thumbnails.
 * Each variant can be dragged to the canvas separately.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import type { MasterComponent, VariantDefinition } from '../../../types/editor-components';
import { createDOMElement } from '../../utils/component-renderer';

interface VariantListProps {
  /** The component containing the variants */
  component: MasterComponent;
  /** Whether the variant list is expanded */
  isExpanded: boolean;
}

/**
 * Calculate the scale factor to fit the element within the container
 */
function calculateScale(
  elementWidth: number,
  elementHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 4
): number {
  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  const scaleX = availableWidth / elementWidth;
  const scaleY = availableHeight / elementHeight;

  return Math.min(scaleX, scaleY, 1);
}

/**
 * VariantThumbnail - Renders a preview of a specific variant
 */
function VariantThumbnail({
  variant,
  componentId,
}: {
  variant: VariantDefinition;
  componentId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !variant.rootElement) return;

    setIsReady(false);
    const container = containerRef.current;
    container.innerHTML = '';

    try {
      const domElement = createDOMElement(variant.rootElement);

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

      const scaleContainer = document.createElement('div');
      scaleContainer.style.cssText = `
        transform-origin: center center;
        transition: transform 0.15s ease;
      `;

      domElement.style.position = 'relative';
      domElement.style.left = 'auto';
      domElement.style.top = 'auto';
      domElement.style.transform = 'none';
      domElement.style.margin = '0';

      scaleContainer.appendChild(domElement);
      wrapper.appendChild(scaleContainer);
      container.appendChild(wrapper);

      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const elementRect = domElement.getBoundingClientRect();

        if (elementRect.width > 0 && elementRect.height > 0) {
          const scale = calculateScale(
            elementRect.width,
            elementRect.height,
            containerRect.width,
            containerRect.height,
            2
          );
          scaleContainer.style.transform = `scale(${scale})`;
        }

        setIsReady(true);
      });
    } catch (error) {
      console.error('[VariantThumbnail] Error:', error);
    }

    return () => {
      if (container) container.innerHTML = '';
    };
  }, [variant, componentId]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-white transition-opacity duration-200 ${
        isReady ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        background: 'linear-gradient(45deg, #f8f8f8 25%, transparent 25%), linear-gradient(-45deg, #f8f8f8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8f8f8 75%), linear-gradient(-45deg, transparent 75%, #f8f8f8 75%)',
        backgroundSize: '6px 6px',
        backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
      }}
    />
  );
}

/**
 * VariantItem - Single variant item with drag support
 */
function VariantItem({
  component,
  variant,
  isDefault,
}: {
  component: MasterComponent;
  variant: VariantDefinition;
  isDefault: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsDragging(true);

      e.dataTransfer.setData(
        'application/x-editor-component',
        JSON.stringify({
          type: 'component',
          componentId: component.id,
          componentName: component.name,
          variantId: variant.id,
          variantName: variant.name,
        })
      );
      e.dataTransfer.effectAllowed = 'copy';

      // Custom drag image
      const dragImage = document.createElement('div');
      dragImage.className =
        'bg-[#2c2c2c] border border-purple-500 rounded px-2 py-1 text-xs text-white shadow-lg';
      dragImage.textContent = `${component.name} - ${variant.name}`;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);

      setTimeout(() => {
        document.body.removeChild(dragImage);
      }, 0);
    },
    [component, variant]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Get variant property values display
  const propertyDisplay = variant.propertyValues
    ? Object.entries(variant.propertyValues)
        .map(([key, value]) => `${value}`)
        .join(', ')
    : null;

  return (
    <div
      className={`
        flex items-center gap-2 p-1.5 rounded border cursor-grab
        transition-all duration-150
        ${isDragging
          ? 'opacity-50 border-purple-500 bg-purple-500/10'
          : 'border-[#444444] bg-[#2a2a2a] hover:border-gray-500 hover:bg-[#333]'
        }
      `}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      title={`${variant.name}${variant.description ? `: ${variant.description}` : ''}`}
    >
      {/* Thumbnail */}
      <div className="w-10 h-8 rounded overflow-hidden flex-shrink-0 border border-[#444444]">
        <VariantThumbnail variant={variant} componentId={component.id} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-300 truncate">
            {variant.name}
          </span>
          {isDefault && (
            <span className="text-[7px] text-[#4fb8ff] bg-[#0d99ff]/20 px-1 rounded">
              デフォルト
            </span>
          )}
        </div>
        {propertyDisplay && (
          <p className="text-[8px] text-gray-500 truncate">
            {propertyDisplay}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * VariantList displays all variants of a component
 */
export function VariantList({ component, isExpanded }: VariantListProps) {
  if (!isExpanded || component.variants.length <= 1) {
    return null;
  }

  return (
    <div className="mt-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-center gap-1 px-1 text-[9px] text-gray-500">
        <Layers className="w-3 h-3" />
        <span>バリアント</span>
      </div>
      <div className="space-y-1">
        {component.variants.map((variant) => (
          <VariantItem
            key={variant.id}
            component={component}
            variant={variant}
            isDefault={variant.id === component.defaultVariantId}
          />
        ))}
      </div>
    </div>
  );
}

export default VariantList;
