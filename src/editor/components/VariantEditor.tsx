'use client';

/**
 * VariantEditor - Dialog for editing variant properties of a master component
 *
 * Features:
 * - Edit variant properties (add/remove property values like size: sm/md/lg)
 * - View variant matrix showing all combinations
 * - Set default variant
 * - Create missing variants
 * - Delete unused variants
 *
 * Matches dark theme styling consistent with the editor.
 */

import React, { useState, useCallback, useMemo, useId } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import {
  Layers,
  Plus,
  Trash2,
  Save,
  X,
  Check,
  AlertTriangle,
  Grid3x3,
  Settings2,
  Star,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  MasterComponent,
  VariantProperty,
  VariantDefinition,
} from '../../types/editor-components';
import { VariantMatrix, VariantMatrixStats } from './VariantMatrix';
import {
  generateVariantCombinations,
  createVariantKey,
  generateVariantName,
  createVariantMap,
} from '../utils/variant-resolver';

// =============================================================================
// Types
// =============================================================================

interface VariantEditorProps {
  /** The master component being edited */
  master: MasterComponent;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback when changes are saved */
  onSave: (updates: {
    variantProperties: VariantProperty[];
    variants: VariantDefinition[];
    defaultVariantId: string;
  }) => void;
}

interface EditableVariantProperty extends VariantProperty {
  /** Flag for newly added properties */
  isNew?: boolean;
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * VariantEditor provides a comprehensive interface for managing
 * component variants and their properties.
 */
export function VariantEditor({
  master,
  open,
  onOpenChange,
  onSave,
}: VariantEditorProps) {
  const dialogId = useId();

  // Local state for editing
  const [properties, setProperties] = useState<EditableVariantProperty[]>(() =>
    (master.variantProperties ?? []).map((p) => ({ ...p }))
  );
  const [variants, setVariants] = useState<VariantDefinition[]>(() =>
    [...master.variants]
  );
  const [defaultVariantId, setDefaultVariantId] = useState<string>(
    master.defaultVariantId
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    master.defaultVariantId
  );

  // UI state
  const [activeSection, setActiveSection] = useState<string>('properties');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track changes
  const markChanged = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  // =============================================================================
  // Property Management
  // =============================================================================

  const handleAddProperty = useCallback(() => {
    const newId = `prop-${Date.now()}`;
    const newProperty: EditableVariantProperty = {
      id: newId,
      name: '',
      values: ['default'],
      defaultValue: 'default',
      isNew: true,
    };
    setProperties((prev) => [...prev, newProperty]);
    markChanged();
  }, [markChanged]);

  const handleUpdateProperty = useCallback(
    (propertyId: string, updates: Partial<VariantProperty>) => {
      setProperties((prev) =>
        prev.map((p) => (p.id === propertyId ? { ...p, ...updates } : p))
      );
      markChanged();
    },
    [markChanged]
  );

  const handleDeleteProperty = useCallback(
    (propertyId: string) => {
      setProperties((prev) => prev.filter((p) => p.id !== propertyId));
      // Also update variants to remove this property from their values
      setVariants((prev) =>
        prev.map((v) => {
          if (v.propertyValues) {
            const prop = properties.find((p) => p.id === propertyId);
            if (prop && v.propertyValues[prop.name]) {
              const { [prop.name]: _, ...rest } = v.propertyValues;
              return { ...v, propertyValues: rest };
            }
          }
          return v;
        })
      );
      markChanged();
    },
    [properties, markChanged]
  );

  const handleAddPropertyValue = useCallback(
    (propertyId: string, value: string) => {
      if (!value.trim()) return;
      setProperties((prev) =>
        prev.map((p) =>
          p.id === propertyId && !p.values.includes(value.trim())
            ? { ...p, values: [...p.values, value.trim()] }
            : p
        )
      );
      markChanged();
    },
    [markChanged]
  );

  const handleRemovePropertyValue = useCallback(
    (propertyId: string, value: string) => {
      setProperties((prev) =>
        prev.map((p) => {
          if (p.id !== propertyId) return p;
          const newValues = p.values.filter((v) => v !== value);
          // Ensure at least one value remains
          if (newValues.length === 0) {
            newValues.push('default');
          }
          // Update default if removed
          const newDefault = newValues.includes(p.defaultValue)
            ? p.defaultValue
            : newValues[0];
          return { ...p, values: newValues, defaultValue: newDefault };
        })
      );
      markChanged();
    },
    [markChanged]
  );

  // =============================================================================
  // Variant Management
  // =============================================================================

  const handleCreateVariant = useCallback(
    (propertyValues: Record<string, string>) => {
      // Clone the default variant's root element as a starting point
      const defaultVariant = variants.find((v) => v.id === defaultVariantId);
      const baseElement = defaultVariant?.rootElement ?? master.variants[0]?.rootElement;

      if (!baseElement) {
        console.error('No base element available for new variant');
        return;
      }

      const newId = `variant-${Date.now()}`;
      const newVariant: VariantDefinition = {
        id: newId,
        name: generateVariantName(propertyValues),
        propertyValues,
        rootElement: JSON.parse(JSON.stringify(baseElement)), // Deep clone
      };

      setVariants((prev) => [...prev, newVariant]);
      setSelectedVariantId(newId);
      markChanged();
    },
    [variants, defaultVariantId, master.variants, markChanged]
  );

  const handleDeleteVariant = useCallback(
    (variantId: string) => {
      // Prevent deleting the last variant
      if (variants.length <= 1) {
        return;
      }

      setVariants((prev) => prev.filter((v) => v.id !== variantId));

      // Update default if deleted
      if (defaultVariantId === variantId) {
        const remaining = variants.filter((v) => v.id !== variantId);
        setDefaultVariantId(remaining[0]?.id ?? '');
      }

      // Update selection
      if (selectedVariantId === variantId) {
        const remaining = variants.filter((v) => v.id !== variantId);
        setSelectedVariantId(remaining[0]?.id ?? null);
      }

      markChanged();
      setShowDeleteConfirm(null);
    },
    [variants, defaultVariantId, selectedVariantId, markChanged]
  );

  const handleSetDefaultVariant = useCallback(
    (variantId: string) => {
      setDefaultVariantId(variantId);
      markChanged();
    },
    [markChanged]
  );

  // =============================================================================
  // Save Handler
  // =============================================================================

  const handleSave = useCallback(() => {
    // Clean up properties (remove isNew flag, filter empty names)
    const cleanProperties: VariantProperty[] = properties
      .filter((p) => p.name.trim())
      .map(({ isNew, ...p }) => p);

    onSave({
      variantProperties: cleanProperties,
      variants,
      defaultVariantId,
    });

    setHasUnsavedChanges(false);
    onOpenChange(false);
  }, [properties, variants, defaultVariantId, onSave, onOpenChange]);

  // =============================================================================
  // Computed Values
  // =============================================================================

  const variantMap = useMemo(() => createVariantMap(variants), [variants]);

  const allCombinations = useMemo(
    () => generateVariantCombinations(properties),
    [properties]
  );

  const missingVariants = useMemo(() => {
    return allCombinations.filter((combo) => {
      const key = createVariantKey(combo);
      return !variantMap.has(key);
    });
  }, [allCombinations, variantMap]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId),
    [variants, selectedVariantId]
  );

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col bg-[#1e1e1e] border-[#444444] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Layers className="h-5 w-5 text-[#4fb8ff]" />
              Variant Editor: {master.name}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Manage variant properties and combinations for this component.
            </DialogDescription>
          </DialogHeader>

          <Accordion
            type="single"
            value={activeSection}
            onValueChange={setActiveSection}
            className="w-full"
          >
            {/* Properties Section */}
            <AccordionItem value="properties" className="border-[#444444]">
              <AccordionTrigger className="text-sm font-medium text-gray-300 hover:text-white hover:no-underline">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Variant Properties
                  <Badge variant="secondary" className="ml-2 bg-[#444444] text-gray-300">
                    {properties.length}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  {properties.map((property) => (
                    <PropertyEditor
                      key={property.id}
                      property={property}
                      onUpdate={(updates) =>
                        handleUpdateProperty(property.id, updates)
                      }
                      onDelete={() => handleDeleteProperty(property.id)}
                      onAddValue={(value) =>
                        handleAddPropertyValue(property.id, value)
                      }
                      onRemoveValue={(value) =>
                        handleRemovePropertyValue(property.id, value)
                      }
                    />
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddProperty}
                    className="w-full border-dashed border-[#4a4a4a] text-gray-400 hover:text-white hover:bg-[#2c2c2c]"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Property
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Variant Matrix Section */}
            <AccordionItem value="matrix" className="border-[#444444]">
              <AccordionTrigger className="text-sm font-medium text-gray-300 hover:text-white hover:no-underline">
                <div className="flex items-center gap-2">
                  <Grid3x3 className="h-4 w-4" />
                  Variant Matrix
                  {missingVariants.length > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {missingVariants.length} missing
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <VariantMatrixStats
                    variantProperties={properties}
                    variants={variants}
                  />

                  <ScrollArea className="max-h-[300px]">
                    <VariantMatrix
                      variantProperties={properties}
                      variants={variants}
                      selectedVariantId={selectedVariantId}
                      onSelectVariant={setSelectedVariantId}
                      onCreateVariant={handleCreateVariant}
                    />
                  </ScrollArea>

                  {/* Selected variant details */}
                  {selectedVariant && (
                    <div className="mt-4 p-3 bg-[#2c2c2c] rounded-lg border border-[#444444]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            {selectedVariant.name}
                          </span>
                          {selectedVariant.id === defaultVariantId && (
                            <Badge className="bg-amber-600 text-white">
                              <Star className="h-3 w-3 mr-1" />
                              Default
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedVariant.id !== defaultVariantId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleSetDefaultVariant(selectedVariant.id)
                              }
                              className="text-amber-400 hover:text-amber-300 hover:bg-[#444444]"
                            >
                              <Star className="h-4 w-4 mr-1" />
                              Set Default
                            </Button>
                          )}
                          {variants.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setShowDeleteConfirm(selectedVariant.id)
                              }
                              className="text-red-400 hover:text-red-300 hover:bg-[#444444]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {selectedVariant.propertyValues && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(selectedVariant.propertyValues).map(
                            ([key, value]) => (
                              <Badge
                                key={key}
                                variant="outline"
                                className="text-xs border-[#4a4a4a] text-gray-300"
                              >
                                {key}: {value}
                              </Badge>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-[#444444]">
            <div className="text-xs text-gray-500">
              {hasUnsavedChanges && (
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-[#4a4a4a] text-gray-300 hover:text-white hover:bg-[#2c2c2c]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                className="bg-[#0d99ff] hover:bg-[#0c8ce9]"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(null)}
      >
        <AlertDialogContent className="bg-[#1e1e1e] border-[#444444]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Delete Variant?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This will permanently delete this variant. Any instances using this
              variant will fall back to the default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#4a4a4a] text-gray-300 hover:text-white hover:bg-[#2c2c2c]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                showDeleteConfirm && handleDeleteVariant(showDeleteConfirm)
              }
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// =============================================================================
// Property Editor Sub-Component
// =============================================================================

interface PropertyEditorProps {
  property: EditableVariantProperty;
  onUpdate: (updates: Partial<VariantProperty>) => void;
  onDelete: () => void;
  onAddValue: (value: string) => void;
  onRemoveValue: (value: string) => void;
}

function PropertyEditor({
  property,
  onUpdate,
  onDelete,
  onAddValue,
  onRemoveValue,
}: PropertyEditorProps) {
  const [newValue, setNewValue] = useState('');

  const handleAddValue = useCallback(() => {
    if (newValue.trim() && !property.values.includes(newValue.trim())) {
      onAddValue(newValue.trim());
      setNewValue('');
    }
  }, [newValue, property.values, onAddValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddValue();
      }
    },
    [handleAddValue]
  );

  return (
    <div className="p-3 bg-[#2c2c2c] rounded-lg border border-[#444444]">
      <div className="flex items-start gap-3">
        {/* Property Name */}
        <div className="flex-1">
          <Label className="text-xs text-gray-400 mb-1 block">
            Property Name
          </Label>
          <Input
            value={property.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="e.g., size, state, variant"
            className="h-8 bg-[#1e1e1e] border-[#4a4a4a] text-white placeholder:text-gray-500"
          />
        </div>

        {/* Default Value Selector */}
        <div className="w-32">
          <Label className="text-xs text-gray-400 mb-1 block">Default</Label>
          <select
            value={property.defaultValue}
            onChange={(e) => onUpdate({ defaultValue: e.target.value })}
            className="h-8 w-full rounded-md bg-[#1e1e1e] border border-[#4a4a4a] text-white text-sm px-2"
          >
            {property.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* Delete Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-[#444444] mt-5"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Property Values */}
      <div className="mt-3">
        <Label className="text-xs text-gray-400 mb-2 block">Values</Label>
        <div className="flex flex-wrap gap-1.5">
          {property.values.map((value) => (
            <Badge
              key={value}
              variant="secondary"
              className={cn(
                'bg-[#444444] text-gray-200 hover:bg-[#4a4a4a] cursor-default',
                value === property.defaultValue && 'border border-amber-500'
              )}
            >
              {value}
              {property.values.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveValue(value)}
                  className="ml-1.5 hover:text-red-400 transition-colors"
                  aria-label={`Remove value: ${value}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}

          {/* Add Value Input */}
          <div className="flex items-center gap-1">
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add value..."
              className="h-6 w-24 bg-[#1e1e1e] border-[#4a4a4a] text-white text-xs placeholder:text-gray-500"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleAddValue}
              disabled={!newValue.trim()}
              className="h-6 w-6 text-gray-400 hover:text-green-400 hover:bg-[#444444]"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VariantEditor;
