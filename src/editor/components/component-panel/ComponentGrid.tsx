'use client';

/**
 * ComponentGrid - Grid display for components in a category
 *
 * Displays components in a responsive grid layout.
 * Each component is shown as a draggable item.
 */

import React from 'react';
import type { MasterComponent } from '../../../types/editor-components';
import { ComponentItem } from './ComponentItem';

interface ComponentGridProps {
  /** Components to display */
  components: MasterComponent[];
  /** Number of columns in the grid */
  columns?: number;
  /** ID of the selected component (for highlighting) */
  selectedComponentId?: string | null;
  /** Callback when a component is double-clicked (to edit) */
  onEditComponent?: (component: MasterComponent) => void;
}

/**
 * ComponentGrid displays components in a grid layout.
 * Components can be dragged onto the canvas to create instances.
 */
export function ComponentGrid({ components, columns = 2, selectedComponentId, onEditComponent }: ComponentGridProps) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
      role="list"
      aria-label="コンポーネント"
    >
      {components.map((component) => (
        <ComponentItem
          key={component.id}
          component={component}
          isSelected={component.id === selectedComponentId}
          onDoubleClick={onEditComponent}
        />
      ))}
    </div>
  );
}

export default ComponentGrid;
