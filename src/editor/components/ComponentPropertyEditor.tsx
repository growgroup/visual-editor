'use client';

/**
 * ComponentPropertyEditor - Editor for individual component properties
 *
 * Allows adding/editing ComponentProperty definitions for master components.
 * Supports boolean, text, and instanceSwap property types.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';
import {
  X,
  Check,
  ToggleLeft,
  Type,
  Repeat,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  ComponentProperty,
  ComponentPropertyType,
} from '../../types/editor-components';

// ============================================
// Types
// ============================================

interface AvailableElement {
  id: string;
  name: string;
}

interface ComponentPropertyEditorProps {
  /** Property to edit (null for creating new) */
  property: ComponentProperty | null;
  /** Available elements that can be targeted by this property */
  availableElements: AvailableElement[];
  /** Available components for instance swap (optional) */
  availableComponents?: { id: string; name: string }[];
  /** Callback when property is saved */
  onSave: (property: ComponentProperty) => void;
  /** Callback when editing is cancelled */
  onCancel: () => void;
}

// ============================================
// Constants
// ============================================

const PROPERTY_TYPE_OPTIONS: {
  value: ComponentPropertyType;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'boolean',
    label: 'Boolean',
    description: 'Toggle visibility of elements',
    icon: <ToggleLeft className="h-4 w-4" />,
  },
  {
    value: 'text',
    label: 'Text',
    description: 'Editable text content',
    icon: <Type className="h-4 w-4" />,
  },
  {
    value: 'instanceSwap',
    label: 'Instance Swap',
    description: 'Replace nested component',
    icon: <Repeat className="h-4 w-4" />,
  },
];

// ============================================
// Helper Functions
// ============================================

function generatePropertyId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================
// Component
// ============================================

export function ComponentPropertyEditor({
  property,
  availableElements,
  availableComponents = [],
  onSave,
  onCancel,
}: ComponentPropertyEditorProps) {
  // Form state
  const [name, setName] = useState(property?.name ?? '');
  const [type, setType] = useState<ComponentPropertyType>(property?.type ?? 'boolean');
  const [description, setDescription] = useState(property?.description ?? '');
  const [group, setGroup] = useState(property?.group ?? '');
  const [required, setRequired] = useState(property?.required ?? false);
  const [targetElementIds, setTargetElementIds] = useState<string[]>(
    property?.targetElementIds ?? []
  );
  const [allowedComponentIds, setAllowedComponentIds] = useState<string[]>(
    property?.allowedComponentIds ?? []
  );
  const [defaultValue, setDefaultValue] = useState<string | boolean>(
    property?.defaultValue ?? (type === 'boolean' ? true : '')
  );

  const isNew = !property;

  // Update default value when type changes
  const handleTypeChange = useCallback((newType: ComponentPropertyType) => {
    setType(newType);
    // Reset default value based on type
    if (newType === 'boolean') {
      setDefaultValue(true);
    } else {
      setDefaultValue('');
    }
    // Clear instance swap specific fields if not instanceSwap
    if (newType !== 'instanceSwap') {
      setAllowedComponentIds([]);
    }
  }, []);

  // Toggle target element selection
  const toggleTargetElement = useCallback((elementId: string) => {
    setTargetElementIds((prev) =>
      prev.includes(elementId)
        ? prev.filter((id) => id !== elementId)
        : [...prev, elementId]
    );
  }, []);

  // Toggle allowed component selection
  const toggleAllowedComponent = useCallback((componentId: string) => {
    setAllowedComponentIds((prev) =>
      prev.includes(componentId)
        ? prev.filter((id) => id !== componentId)
        : [...prev, componentId]
    );
  }, []);

  // Validation
  const isValid = useMemo(() => {
    if (!name.trim()) return false;
    if (targetElementIds.length === 0) return false;
    if (type === 'instanceSwap' && allowedComponentIds.length === 0) return false;
    return true;
  }, [name, targetElementIds, type, allowedComponentIds]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!isValid) return;

    const newProperty: ComponentProperty = {
      id: property?.id ?? generatePropertyId(),
      name: name.trim(),
      type,
      defaultValue,
      targetElementIds,
      description: description.trim() || undefined,
      group: group.trim() || undefined,
      required,
      ...(type === 'instanceSwap' && { allowedComponentIds }),
    };

    onSave(newProperty);
  }, [
    isValid,
    property,
    name,
    type,
    defaultValue,
    targetElementIds,
    description,
    group,
    required,
    allowedComponentIds,
    onSave,
  ]);

  return (
    <div className="space-y-4 p-4 bg-[#1e1e1e] rounded-lg border border-[#444444]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-200">
          {isNew ? 'Add Property' : 'Edit Property'}
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-400 hover:text-gray-200"
          onClick={onCancel}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Property Type */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">Type</Label>
        <Select value={type} onValueChange={(v) => handleTypeChange(v as ComponentPropertyType)}>
          <SelectTrigger className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#2c2c2c] border-[#444444]">
            {PROPERTY_TYPE_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-gray-200 focus:bg-[#444444] focus:text-white"
              >
                <div className="flex items-center gap-2">
                  {option.icon}
                  <div>
                    <span>{option.label}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      - {option.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Property Name */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Property name..."
          className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Description */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this property controls..."
          className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Group */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">Group (optional)</Label>
        <Input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="Property group..."
          className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Default Value */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">Default Value</Label>
        {type === 'boolean' ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="default-value-checkbox"
              checked={defaultValue as boolean}
              onCheckedChange={(checked) => setDefaultValue(checked === true)}
              className="border-[#444444] data-[state=checked]:bg-[#0d99ff]"
            />
            <label
              htmlFor="default-value-checkbox"
              className="text-sm text-gray-300 cursor-pointer"
            >
              {defaultValue ? 'Visible (true)' : 'Hidden (false)'}
            </label>
          </div>
        ) : (
          <Input
            value={defaultValue as string}
            onChange={(e) => setDefaultValue(e.target.value)}
            placeholder="Default value..."
            className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
          />
        )}
      </div>

      {/* Required */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="required-checkbox"
          checked={required}
          onCheckedChange={(checked) => setRequired(checked === true)}
          className="border-[#444444] data-[state=checked]:bg-[#0d99ff]"
        />
        <label
          htmlFor="required-checkbox"
          className="text-sm text-gray-300 cursor-pointer"
        >
          Required property
        </label>
      </div>

      {/* Target Elements */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-gray-400">
          Target Elements
          {targetElementIds.length > 0 && (
            <span className="ml-1 text-[#4fb8ff]">({targetElementIds.length} selected)</span>
          )}
        </Label>
        <div className="max-h-32 overflow-y-auto bg-[#2c2c2c] border border-[#444444] rounded-md p-2 space-y-1">
          {availableElements.length === 0 ? (
            <p className="text-xs text-gray-500 py-2 text-center">
              No elements available
            </p>
          ) : (
            availableElements.map((element) => (
              <div
                key={element.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  targetElementIds.includes(element.id)
                    ? 'bg-[#0d99ff]/20 border border-blue-600/40'
                    : 'hover:bg-[#444444]'
                )}
                onClick={() => toggleTargetElement(element.id)}
              >
                <Checkbox
                  checked={targetElementIds.includes(element.id)}
                  onCheckedChange={() => toggleTargetElement(element.id)}
                  className="border-[#4a4a4a] data-[state=checked]:bg-[#0d99ff]"
                />
                <span className="text-xs text-gray-300 truncate">{element.name}</span>
                <span className="text-[10px] text-gray-500 ml-auto truncate max-w-20">
                  {element.id}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Allowed Components (for Instance Swap) */}
      {type === 'instanceSwap' && (
        <div className="grid gap-1.5">
          <Label className="text-xs text-gray-400">
            Allowed Components
            {allowedComponentIds.length > 0 && (
              <span className="ml-1 text-[#4fb8ff]">({allowedComponentIds.length} selected)</span>
            )}
          </Label>
          <div className="max-h-32 overflow-y-auto bg-[#2c2c2c] border border-[#444444] rounded-md p-2 space-y-1">
            {availableComponents.length === 0 ? (
              <p className="text-xs text-gray-500 py-2 text-center">
                No components available for swap
              </p>
            ) : (
              availableComponents.map((component) => (
                <div
                  key={component.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                    allowedComponentIds.includes(component.id)
                      ? 'bg-[#0d99ff]/20 border border-blue-600/40'
                      : 'hover:bg-[#444444]'
                  )}
                  onClick={() => toggleAllowedComponent(component.id)}
                >
                  <Checkbox
                    checked={allowedComponentIds.includes(component.id)}
                    onCheckedChange={() => toggleAllowedComponent(component.id)}
                    className="border-[#4a4a4a] data-[state=checked]:bg-[#0d99ff]"
                  />
                  <span className="text-xs text-gray-300 truncate">{component.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#444444]">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-200"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isValid}
          className="bg-[#0d99ff] hover:bg-[#0c8ce9] text-white"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {isNew ? 'Add' : 'Update'}
        </Button>
      </div>
    </div>
  );
}

export default ComponentPropertyEditor;
