'use client';

/**
 * ComponentPanel - Main panel container for the component system
 *
 * Displays a searchable, categorized list of reusable components.
 * Components can be dragged onto the canvas to create instances.
 *
 * Layout:
 * ┌───────────────────────────────────┐
 * │ Components                    [x] │
 * ├───────────────────────────────────┤
 * │ Search components...              │
 * ├───────────────────────────────────┤
 * │ Categories with components...     │
 * └───────────────────────────────────┘
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Component } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { useEditorComponents } from '../../contexts/EditorComponentsContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ComponentSearch } from './ComponentSearch';
import { CategoryAccordion } from './CategoryAccordion';

interface ComponentPanelProps {
  /** Callback when the panel close button is clicked */
  onClose?: () => void;
  /** Whether to show the close button */
  showCloseButton?: boolean;
  /** Initial width of the panel */
  initialWidth?: number;
  /** Website ID for loading components */
  websiteId?: string;
  /** ID of the component to highlight (for "Go to Main Component" feature) */
  selectedComponentId?: string | null;
  /** Callback when selection is cleared */
  onClearSelection?: () => void;
  /** Callback when a component is double-clicked (to edit) */
  onEditComponent?: (componentId: string) => void;
}

/**
 * ComponentPanel displays a searchable list of reusable components
 * organized by category. Components can be dragged onto the canvas
 * to create new instances.
 */
export function ComponentPanel({
  onClose,
  showCloseButton = true,
  initialWidth = 280,
  websiteId,
  selectedComponentId,
  onClearSelection,
  onEditComponent,
}: ComponentPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );

  const {
    masterComponents,
    componentLibrary,
    isLoadingComponents,
    loadComponents,
  } = useEditorComponents();

  // Resizable panel
  const { width, isDragging, resizeHandleProps } = useResizablePanel({
    initialWidth,
    minWidth: 200,
    maxWidth: 400,
    direction: 'right',
    storageKey: 'editor-component-panel-width',
  });

  // Load components when websiteId changes
  useEffect(() => {
    if (websiteId) {
      loadComponents(websiteId);
    }
  }, [websiteId, loadComponents]);

  // Initialize expanded categories
  useEffect(() => {
    if (componentLibrary.length > 0 && expandedCategories.size === 0) {
      // Expand the first category by default
      setExpandedCategories(new Set([componentLibrary[0].id]));
    }
  }, [componentLibrary, expandedCategories.size]);

  // Expand category containing the selected component
  useEffect(() => {
    if (selectedComponentId && componentLibrary.length > 0) {
      const categoryWithComponent = componentLibrary.find(cat =>
        cat.componentIds.includes(selectedComponentId)
      );
      if (categoryWithComponent) {
        setExpandedCategories(prev => {
          const next = new Set(prev);
          next.add(categoryWithComponent.id);
          return next;
        });
      }
    }
  }, [selectedComponentId, componentLibrary]);

  // Filter components based on search query
  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) {
      return masterComponents;
    }

    const query = searchQuery.toLowerCase();
    const filtered = new Map(
      Array.from(masterComponents).filter(([_, component]) => {
        return (
          component.name.toLowerCase().includes(query) ||
          (component.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false)
        );
      })
    );

    return filtered;
  }, [masterComponents, searchQuery]);

  // Get components for a specific category
  const getComponentsForCategory = useCallback(
    (categoryId: string) => {
      const category = componentLibrary.find((cat) => cat.id === categoryId);
      if (!category) return [];

      return category.componentIds
        .map((id) => filteredComponents.get(id))
        .filter(Boolean);
    },
    [componentLibrary, filteredComponents]
  );

  // Toggle category expansion
  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle component edit (double-click)
  const handleEditComponent = useCallback(
    (component: { id: string }) => {
      onEditComponent?.(component.id);
    },
    [onEditComponent]
  );

  // Filter categories that have components matching the search
  const visibleCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return componentLibrary;
    }

    return componentLibrary.filter((category) => {
      const components = getComponentsForCategory(category.id);
      return components.length > 0;
    });
  }, [componentLibrary, searchQuery, getComponentsForCategory]);

  return (
    <div
      className="bg-[#2c2c2c] border-r border-[#444444] flex flex-col relative flex-shrink-0"
      style={{ width: `${width}px` }}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="コンポーネントパネル"
    >
      {/* Resize handle */}
      <div {...resizeHandleProps} />

      {/* Drag overlay for smooth resizing */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[#444444]">
        <div className="flex items-center gap-2">
          <Component className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-white">コンポーネント</span>
        </div>
        {showCloseButton && onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-gray-400 hover:text-white hover:bg-[#444444]"
            onClick={onClose}
            aria-label="コンポーネントパネルを閉じる"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="p-2 border-b border-[#444444]">
        <ComponentSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="コンポーネントを検索..."
        />
      </div>

      {/* Component list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoadingComponents ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-500 border-t-blue-500" />
            </div>
          ) : visibleCategories.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-gray-500">
                {searchQuery
                  ? '検索に一致するコンポーネントがありません'
                  : 'コンポーネントがありません'}
              </p>
            </div>
          ) : (
            visibleCategories.map((category) => (
              <CategoryAccordion
                key={category.id}
                category={category}
                components={getComponentsForCategory(category.id)}
                isExpanded={
                  expandedCategories.has(category.id) ||
                  (searchQuery.trim() !== '' &&
                    getComponentsForCategory(category.id).length > 0)
                }
                onToggle={() => toggleCategory(category.id)}
                selectedComponentId={selectedComponentId}
                onClearSelection={onClearSelection}
                onEditComponent={handleEditComponent}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer with component count */}
      <div className="px-3 py-2 border-t border-[#444444]">
        <p className="text-[10px] text-gray-500">
          {filteredComponents.size}個のコンポーネント
          {searchQuery && ` (「${searchQuery}」で検索中)`}
        </p>
      </div>
    </div>
  );
}

export default ComponentPanel;
