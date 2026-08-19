'use client';

/**
 * CategoryAccordion - Collapsible category section for components
 *
 * Displays a category header that can be expanded/collapsed
 * to show the components within that category.
 */

import React, { useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type {
  ComponentLibraryCategory,
  MasterComponent,
} from '../../../types/editor-components';
import { ComponentGrid } from './ComponentGrid';

interface CategoryAccordionProps {
  /** The category to display */
  category: ComponentLibraryCategory;
  /** Components in this category */
  components: (MasterComponent | undefined)[];
  /** Whether the category is expanded */
  isExpanded: boolean;
  /** Callback to toggle expansion */
  onToggle: () => void;
  /** ID of the selected component (for highlighting) */
  selectedComponentId?: string | null;
  /** Callback when selection is cleared */
  onClearSelection?: () => void;
  /** Callback when a component is double-clicked (to edit) */
  onEditComponent?: (component: MasterComponent) => void;
}

/**
 * Get icon component for category
 */
function getCategoryIcon(iconName: string): string {
  const iconMap: Record<string, string> = {
    layout: '#3b82f6',
    navigation: '#10b981',
    content: '#f59e0b',
    'form-input': '#ef4444',
    form: '#ef4444',
    image: '#8b5cf6',
    media: '#8b5cf6',
  };
  return iconMap[iconName] || '#6b7280';
}

/**
 * CategoryAccordion displays a collapsible section for a component category.
 * Supports keyboard navigation and accessibility.
 */
export function CategoryAccordion({
  category,
  components,
  isExpanded,
  onToggle,
  selectedComponentId,
  onClearSelection,
  onEditComponent,
}: CategoryAccordionProps) {
  const validComponents = components.filter(
    (c): c is MasterComponent => c !== undefined
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
    [onToggle]
  );

  const iconColor = category.color || getCategoryIcon(category.icon || 'default');

  return (
    <div className="mb-1">
      {/* Category Header */}
      <button
        className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-xs text-gray-300 hover:bg-[#444444] transition-colors focus:outline-none focus:ring-1 focus:ring-[#0d99ff]"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-controls={`category-content-${category.id}`}
      >
        {/* Expand/Collapse Icon */}
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
        )}

        {/* Category Color Indicator */}
        <div
          className="w-2 h-2 rounded-sm flex-shrink-0"
          style={{ backgroundColor: iconColor }}
        />

        {/* Category Name */}
        <span className="font-medium flex-1 text-left">{category.name}</span>

        {/* Component Count */}
        <span className="text-[10px] text-gray-500 tabular-nums">
          {validComponents.length}
        </span>
      </button>

      {/* Category Content */}
      {isExpanded && (
        <div
          id={`category-content-${category.id}`}
          className="mt-1 ml-4 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200"
          role="region"
          aria-label={`${category.name}のコンポーネント`}
        >
          {validComponents.length > 0 ? (
            <ComponentGrid
              components={validComponents}
              selectedComponentId={selectedComponentId}
              onEditComponent={onEditComponent}
            />
          ) : (
            <div className="py-3 text-center">
              <p className="text-[10px] text-gray-500">
                このカテゴリにコンポーネントがありません
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CategoryAccordion;
