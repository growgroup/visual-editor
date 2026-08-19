'use client';

/**
 * VariantMatrix - Grid display of all variant combinations
 *
 * Displays a matrix where:
 * - For 1 property: Shows a simple list of variants
 * - For 2 properties: Shows a 2D grid with rows and columns
 * - For 3+ properties: Shows a hierarchical grid with nested sections
 *
 * Cells show:
 * - Checkmark if variant exists
 * - Empty/dashed if variant is missing (clickable to create)
 * - Highlighted if currently selected
 */

import React, { useMemo, useCallback } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  VariantProperty,
  VariantDefinition,
} from '../../types/editor-components';
import {
  createVariantKey,
  createVariantMap,
  generateVariantCombinations,
} from '../utils/variant-resolver';

interface VariantMatrixProps {
  /** Array of variant property definitions */
  variantProperties: VariantProperty[];
  /** Array of existing variant definitions */
  variants: VariantDefinition[];
  /** Currently selected variant ID */
  selectedVariantId: string | null;
  /** Callback when a variant is selected */
  onSelectVariant: (variantId: string) => void;
  /** Optional callback to create a new variant (shows + icon for missing) */
  onCreateVariant?: (propertyValues: Record<string, string>) => void;
  /** Optional: compact mode for smaller displays */
  compact?: boolean;
}

/**
 * VariantMatrix displays all possible variant combinations in a grid format.
 * Supports 1D (list), 2D (grid), and multi-dimensional (nested) layouts.
 */
export function VariantMatrix({
  variantProperties,
  variants,
  selectedVariantId,
  onSelectVariant,
  onCreateVariant,
  compact = false,
}: VariantMatrixProps) {
  // Create a map for fast variant lookup by key
  const variantMap = useMemo(() => createVariantMap(variants), [variants]);

  // Get variant ID by property values
  const getVariantId = useCallback(
    (propertyValues: Record<string, string>): string | null => {
      const key = createVariantKey(propertyValues);
      return variantMap.get(key)?.id ?? null;
    },
    [variantMap]
  );

  // Check if a variant exists for given property values
  const hasVariant = useCallback(
    (propertyValues: Record<string, string>): boolean => {
      const key = createVariantKey(propertyValues);
      return variantMap.has(key);
    },
    [variantMap]
  );

  // Handle cell click
  const handleCellClick = useCallback(
    (propertyValues: Record<string, string>) => {
      const variantId = getVariantId(propertyValues);
      if (variantId) {
        onSelectVariant(variantId);
      } else if (onCreateVariant) {
        onCreateVariant(propertyValues);
      }
    },
    [getVariantId, onSelectVariant, onCreateVariant]
  );

  // Render based on number of properties
  if (variantProperties.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No variant properties defined
      </div>
    );
  }

  if (variantProperties.length === 1) {
    return (
      <SinglePropertyList
        property={variantProperties[0]}
        variantMap={variantMap}
        selectedVariantId={selectedVariantId}
        onCellClick={handleCellClick}
        hasVariant={hasVariant}
        canCreate={!!onCreateVariant}
        compact={compact}
      />
    );
  }

  if (variantProperties.length === 2) {
    return (
      <TwoPropertyGrid
        properties={variantProperties}
        variantMap={variantMap}
        selectedVariantId={selectedVariantId}
        onCellClick={handleCellClick}
        hasVariant={hasVariant}
        canCreate={!!onCreateVariant}
        compact={compact}
      />
    );
  }

  // For 3+ properties, use a multi-dimensional view
  return (
    <MultiPropertyGrid
      properties={variantProperties}
      variantMap={variantMap}
      selectedVariantId={selectedVariantId}
      onCellClick={handleCellClick}
      hasVariant={hasVariant}
      canCreate={!!onCreateVariant}
      compact={compact}
    />
  );
}

// =============================================================================
// Single Property List (1D)
// =============================================================================

interface SinglePropertyListProps {
  property: VariantProperty;
  variantMap: Map<string, VariantDefinition>;
  selectedVariantId: string | null;
  onCellClick: (propertyValues: Record<string, string>) => void;
  hasVariant: (propertyValues: Record<string, string>) => boolean;
  canCreate: boolean;
  compact: boolean;
}

function SinglePropertyList({
  property,
  variantMap,
  selectedVariantId,
  onCellClick,
  hasVariant,
  canCreate,
  compact,
}: SinglePropertyListProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-400 mb-2">
        {property.name}
      </div>
      <div className={cn('grid gap-1', compact ? 'grid-cols-4' : 'grid-cols-3')}>
        {property.values.map((value) => {
          const propertyValues = { [property.name]: value };
          const key = createVariantKey(propertyValues);
          const variant = variantMap.get(key);
          const isSelected = variant?.id === selectedVariantId;
          const exists = hasVariant(propertyValues);

          return (
            <VariantCell
              key={value}
              label={value}
              exists={exists}
              isSelected={isSelected}
              canCreate={canCreate}
              onClick={() => onCellClick(propertyValues)}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Two Property Grid (2D)
// =============================================================================

interface TwoPropertyGridProps {
  properties: VariantProperty[];
  variantMap: Map<string, VariantDefinition>;
  selectedVariantId: string | null;
  onCellClick: (propertyValues: Record<string, string>) => void;
  hasVariant: (propertyValues: Record<string, string>) => boolean;
  canCreate: boolean;
  compact: boolean;
}

function TwoPropertyGrid({
  properties,
  variantMap,
  selectedVariantId,
  onCellClick,
  hasVariant,
  canCreate,
  compact,
}: TwoPropertyGridProps) {
  const [rowProperty, colProperty] = properties;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="p-1.5 text-xs font-medium text-gray-500 text-left border-b border-[#444444]">
              {rowProperty.name} / {colProperty.name}
            </th>
            {colProperty.values.map((colValue) => (
              <th
                key={colValue}
                className="p-1.5 text-xs font-medium text-gray-400 text-center border-b border-[#444444]"
              >
                {colValue}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowProperty.values.map((rowValue) => (
            <tr key={rowValue}>
              <td className="p-1.5 text-xs font-medium text-gray-400 border-b border-[#444444]">
                {rowValue}
              </td>
              {colProperty.values.map((colValue) => {
                const propertyValues = {
                  [rowProperty.name]: rowValue,
                  [colProperty.name]: colValue,
                };
                const key = createVariantKey(propertyValues);
                const variant = variantMap.get(key);
                const isSelected = variant?.id === selectedVariantId;
                const exists = hasVariant(propertyValues);

                return (
                  <td
                    key={colValue}
                    className="p-1 text-center border-b border-[#444444]"
                  >
                    <VariantCell
                      exists={exists}
                      isSelected={isSelected}
                      canCreate={canCreate}
                      onClick={() => onCellClick(propertyValues)}
                      compact={compact}
                      isGridCell
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Multi Property Grid (3+ dimensions)
// =============================================================================

interface MultiPropertyGridProps {
  properties: VariantProperty[];
  variantMap: Map<string, VariantDefinition>;
  selectedVariantId: string | null;
  onCellClick: (propertyValues: Record<string, string>) => void;
  hasVariant: (propertyValues: Record<string, string>) => boolean;
  canCreate: boolean;
  compact: boolean;
}

function MultiPropertyGrid({
  properties,
  variantMap,
  selectedVariantId,
  onCellClick,
  hasVariant,
  canCreate,
  compact,
}: MultiPropertyGridProps) {
  // Generate all combinations
  const combinations = useMemo(
    () => generateVariantCombinations(properties),
    [properties]
  );

  // Group by the first property for organization
  const groupedByFirst = useMemo(() => {
    const groups = new Map<string, Record<string, string>[]>();
    const firstProp = properties[0];

    for (const combo of combinations) {
      const groupKey = combo[firstProp.name];
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(combo);
    }

    return groups;
  }, [combinations, properties]);

  return (
    <div className="space-y-4">
      {Array.from(groupedByFirst.entries()).map(([groupValue, combos]) => (
        <div key={groupValue} className="border border-[#444444] rounded-lg p-2">
          <div className="text-xs font-medium text-gray-400 mb-2 px-1">
            {properties[0].name}: {groupValue}
          </div>
          <div className={cn('grid gap-1', compact ? 'grid-cols-4' : 'grid-cols-3')}>
            {combos.map((combo) => {
              const key = createVariantKey(combo);
              const variant = variantMap.get(key);
              const isSelected = variant?.id === selectedVariantId;
              const exists = hasVariant(combo);

              // Create label from remaining properties
              const label = properties
                .slice(1)
                .map((p) => combo[p.name])
                .join(', ');

              return (
                <VariantCell
                  key={key}
                  label={label}
                  exists={exists}
                  isSelected={isSelected}
                  canCreate={canCreate}
                  onClick={() => onCellClick(combo)}
                  compact={compact}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Variant Cell Component
// =============================================================================

interface VariantCellProps {
  /** Optional label to display */
  label?: string;
  /** Whether the variant exists */
  exists: boolean;
  /** Whether this cell is selected */
  isSelected: boolean;
  /** Whether new variants can be created */
  canCreate: boolean;
  /** Click handler */
  onClick: () => void;
  /** Compact display mode */
  compact: boolean;
  /** Whether this is a grid cell (minimal styling) */
  isGridCell?: boolean;
}

function VariantCell({
  label,
  exists,
  isSelected,
  canCreate,
  onClick,
  compact,
  isGridCell = false,
}: VariantCellProps) {
  const baseClasses = cn(
    'flex items-center justify-center cursor-pointer transition-all',
    'rounded border',
    isGridCell
      ? 'w-8 h-8 mx-auto'
      : compact
        ? 'h-8 px-2'
        : 'h-10 px-3',
    // Exists state
    exists
      ? [
          'bg-[#2c2c2c] border-[#4a4a4a]',
          'hover:bg-[#444444] hover:border-[#5d5d5d]',
        ]
      : [
          'bg-transparent border-dashed border-[#4a4a4a]',
          canCreate
            ? 'hover:bg-[#2c2c2c] hover:border-[#5d5d5d]'
            : 'opacity-50 cursor-not-allowed',
        ],
    // Selected state
    isSelected && 'ring-2 ring-[#0d99ff] border-[#0d99ff]'
  );

  return (
    <button
      type="button"
      className={baseClasses}
      onClick={onClick}
      disabled={!exists && !canCreate}
      aria-label={
        label
          ? `Variant: ${label}${exists ? '' : ' (missing)'}${isSelected ? ' (selected)' : ''}`
          : exists
            ? 'Variant exists'
            : 'Variant missing'
      }
      aria-pressed={isSelected}
    >
      {exists ? (
        <>
          {isGridCell ? (
            <Check className="w-4 h-4 text-green-400" />
          ) : (
            <div className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              {label && (
                <span className="text-xs text-gray-300 truncate">{label}</span>
              )}
            </div>
          )}
        </>
      ) : canCreate ? (
        <>
          {isGridCell ? (
            <Plus className="w-4 h-4 text-gray-500" />
          ) : (
            <div className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              {label && (
                <span className="text-xs text-gray-500 truncate">{label}</span>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {!isGridCell && label && (
            <span className="text-xs text-gray-600 truncate">{label}</span>
          )}
        </>
      )}
    </button>
  );
}

// =============================================================================
// Stats Component
// =============================================================================

interface VariantMatrixStatsProps {
  variantProperties: VariantProperty[];
  variants: VariantDefinition[];
}

/**
 * Display statistics about the variant matrix.
 */
export function VariantMatrixStats({
  variantProperties,
  variants,
}: VariantMatrixStatsProps) {
  const totalPossible = useMemo(() => {
    return generateVariantCombinations(variantProperties).length;
  }, [variantProperties]);

  const defined = variants.length;
  const missing = totalPossible - defined;
  const percentage = totalPossible > 0 ? Math.round((defined / totalPossible) * 100) : 0;

  return (
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <span>
        <span className="text-green-400 font-medium">{defined}</span> / {totalPossible} variants
      </span>
      {missing > 0 && (
        <span className="text-amber-400">
          {missing} missing
        </span>
      )}
      <span>{percentage}% complete</span>
    </div>
  );
}

export default VariantMatrix;
