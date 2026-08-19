'use client';

/**
 * MasterComponentEditor - Dialog for editing master component definitions
 *
 * Features:
 * - Edit name, category, description, tags
 * - Preview the component (rendered from rootElement)
 * - Manage variants
 * - Add/remove exposed properties (ComponentProperty)
 * - Save/Cancel/Delete actions with confirmation
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
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
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Badge } from '../../components/ui/badge';
import {
  Settings,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Component as ComponentIcon,
  Layers,
  ToggleLeft,
  Type,
  Repeat,
  X,
  Eye,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  MasterComponent,
  ComponentProperty,
  ComponentVariant,
  ComponentElement,
  ComponentLibraryCategory,
} from '../../types/editor-components';
import { ComponentPropertyEditor } from './ComponentPropertyEditor';
import { renderComponentElement } from '../utils/component-renderer';

// ============================================
// Types
// ============================================

interface MasterComponentEditorProps {
  /** Master component to edit (null for creating new) */
  master: MasterComponent | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback when component is saved */
  onSave: (master: MasterComponent) => Promise<void>;
  /** Callback when component is deleted (optional) */
  onDelete?: (masterId: string) => Promise<void>;
  /** Available categories for the component */
  categories: ComponentLibraryCategory[];
  /** Available components for instance swap properties (optional) */
  availableComponents?: { id: string; name: string }[];
  /** Callback to open variant editor (optional) */
  onEditVariant?: (variant: ComponentVariant) => void;
}

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract available elements from a ComponentElement tree for targeting
 */
function extractAvailableElements(
  element: ComponentElement,
  path: string = ''
): { id: string; name: string }[] {
  const results: { id: string; name: string }[] = [];

  const displayName = element.displayName ||
    element.textContent?.substring(0, 20) ||
    `${element.tagName}#${element.id.substring(0, 8)}`;

  results.push({
    id: element.id,
    name: displayName,
  });

  element.children.forEach((child, index) => {
    const childPath = path ? `${path}.children.${index}` : `children.${index}`;
    results.push(...extractAvailableElements(child, childPath));
  });

  return results;
}

/**
 * Get property type icon
 */
function getPropertyTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'boolean':
      return <ToggleLeft className="h-3.5 w-3.5" />;
    case 'text':
      return <Type className="h-3.5 w-3.5" />;
    case 'instanceSwap':
      return <Repeat className="h-3.5 w-3.5" />;
    default:
      return <Settings className="h-3.5 w-3.5" />;
  }
}

// ============================================
// Preview Component
// ============================================

interface ComponentPreviewProps {
  element: ComponentElement | undefined;
}

function ComponentPreview({ element }: ComponentPreviewProps) {
  const [previewHtml, setPreviewHtml] = useState<string>('');

  useEffect(() => {
    if (!element) {
      setPreviewHtml('');
      return;
    }

    try {
      const htmlElement = renderComponentElement(element);
      setPreviewHtml(htmlElement.outerHTML);
    } catch (error) {
      console.error('[ComponentPreview] Failed to render:', error);
      setPreviewHtml('<div class="text-red-500 text-xs">Preview failed</div>');
    }
  }, [element]);

  if (!element) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <ComponentIcon className="h-8 w-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">No preview available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 flex items-center justify-center">
      <div
        className="component-preview-container"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    </div>
  );
}

// ============================================
// Property Item Component
// ============================================

interface PropertyItemProps {
  property: ComponentProperty;
  onEdit: () => void;
  onDelete: () => void;
}

function PropertyItem({ property, onEdit, onDelete }: PropertyItemProps) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-[#2c2c2c] rounded-lg group">
      <div className="flex items-center justify-center w-6 h-6 rounded bg-[#444444] text-gray-400">
        {getPropertyTypeIcon(property.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200 truncate">{property.name}</span>
          <Badge variant="outline" className="text-[10px] h-4 border-[#4a4a4a] text-gray-400">
            {property.type}
          </Badge>
          {property.required && (
            <Badge variant="outline" className="text-[10px] h-4 border-red-500/50 text-red-400">
              required
            </Badge>
          )}
        </div>
        {property.description && (
          <p className="text-xs text-gray-500 truncate">{property.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-400 hover:text-gray-200"
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-400 hover:text-red-400"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Variant Item Component
// ============================================

interface VariantItemProps {
  variant: ComponentVariant;
  isDefault: boolean;
  onEdit?: () => void;
}

function VariantItem({ variant, isDefault, onEdit }: VariantItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 px-3 rounded-lg group cursor-pointer transition-colors',
        isDefault ? 'bg-[#0d99ff]/10 border border-blue-600/30' : 'bg-[#2c2c2c] hover:bg-[#353535]'
      )}
      onClick={onEdit}
    >
      <div className="flex items-center justify-center w-6 h-6 rounded bg-[#444444] text-gray-400">
        <Layers className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200 truncate">{variant.name}</span>
          {isDefault && (
            <Badge className="text-[10px] h-4 bg-[#0d99ff]/20 text-[#4fb8ff] border-blue-600/30">
              default
            </Badge>
          )}
        </div>
        {variant.propertyValues && Object.keys(variant.propertyValues).length > 0 && (
          <p className="text-xs text-gray-500 truncate">
            {Object.entries(variant.propertyValues)
              .map(([key, value]) => `${key}=${value}`)
              .join(', ')}
          </p>
        )}
      </div>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-400 hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function MasterComponentEditor({
  master,
  open,
  onOpenChange,
  onSave,
  onDelete,
  categories,
  availableComponents = [],
  onEditVariant,
}: MasterComponentEditorProps) {
  // Form state
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [exposedProperties, setExposedProperties] = useState<ComponentProperty[]>([]);
  const [variants, setVariants] = useState<ComponentVariant[]>([]);
  const [defaultVariantId, setDefaultVariantId] = useState('');

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [showPropertyEditor, setShowPropertyEditor] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({
    variants: true,
    properties: true,
  });

  const isNew = !master;

  // Initialize form when master changes
  useEffect(() => {
    if (master) {
      setName(master.name);
      setCategoryId(master.categoryId);
      setDescription(master.description || '');
      setTags(master.tags || []);
      setExposedProperties(master.exposedProperties || []);
      setVariants(master.variants || []);
      setDefaultVariantId(master.defaultVariantId);
    } else {
      // Reset for new component
      setName('');
      setCategoryId(categories[0]?.id || '');
      setDescription('');
      setTags([]);
      setExposedProperties([]);
      setVariants([]);
      setDefaultVariantId('');
    }
    setEditingPropertyId(null);
    setShowPropertyEditor(false);
    setTagInput('');
  }, [master, categories, open]);

  // Get default variant for preview
  const defaultVariant = useMemo(() => {
    return variants.find((v) => v.id === defaultVariantId) || variants[0];
  }, [variants, defaultVariantId]);

  // Get available elements for property targeting
  const availableElements = useMemo(() => {
    if (!defaultVariant?.rootElement) return [];
    return extractAvailableElements(defaultVariant.rootElement);
  }, [defaultVariant]);

  // Validation
  const isValid = useMemo(() => {
    if (!name.trim()) return false;
    if (!categoryId) return false;
    if (variants.length === 0) return false;
    return true;
  }, [name, categoryId, variants]);

  // Toggle section
  const toggleSection = useCallback((section: 'variants' | 'properties') => {
    setSectionsOpen((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  // Handle adding a tag
  const handleAddTag = useCallback(() => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags((prev) => [...prev, trimmedTag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  // Handle removing a tag
  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  // Handle tag input key down
  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag]
  );

  // Handle property save
  const handlePropertySave = useCallback((property: ComponentProperty) => {
    setExposedProperties((prev) => {
      const existingIndex = prev.findIndex((p) => p.id === property.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = property;
        return next;
      }
      return [...prev, property];
    });
    setEditingPropertyId(null);
    setShowPropertyEditor(false);
  }, []);

  // Handle property delete
  const handlePropertyDelete = useCallback((propertyId: string) => {
    setExposedProperties((prev) => prev.filter((p) => p.id !== propertyId));
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!isValid) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const updatedMaster: MasterComponent = {
        id: master?.id || generateId(),
        name: name.trim(),
        categoryId,
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        variants,
        defaultVariantId: defaultVariantId || variants[0]?.id || '',
        exposedProperties,
        createdAt: master?.createdAt || now,
        updatedAt: now,
        websiteId: master?.websiteId || '',
        version: (master?.version || 0) + 1,
      };

      await onSave(updatedMaster);
      onOpenChange(false);
    } catch (error) {
      console.error('[MasterComponentEditor] Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [
    isValid,
    master,
    name,
    categoryId,
    description,
    tags,
    variants,
    defaultVariantId,
    exposedProperties,
    onSave,
    onOpenChange,
  ]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!master?.id || !onDelete) return;

    setIsSaving(true);
    try {
      await onDelete(master.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
    } catch (error) {
      console.error('[MasterComponentEditor] Delete failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [master, onDelete, onOpenChange]);

  // Currently editing property
  const editingProperty = useMemo(() => {
    if (!editingPropertyId) return null;
    return exposedProperties.find((p) => p.id === editingPropertyId) || null;
  }, [editingPropertyId, exposedProperties]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col bg-[#2c2c2c] border-[#444444] text-gray-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {isNew ? 'Create Component' : `Edit Component: "${master?.name}"`}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {isNew
                ? 'Define a new reusable component for your design system.'
                : 'Modify the component definition. Changes will affect all instances.'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                {/* Name */}
                <div className="grid gap-1.5">
                  <Label className="text-xs text-gray-400">Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Component name..."
                    className="h-9 bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
                  />
                </div>

                {/* Category */}
                <div className="grid gap-1.5">
                  <Label className="text-xs text-gray-400">Category</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="h-9 bg-[#2c2c2c] border-[#444444] text-gray-200">
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2c2c2c] border-[#444444]">
                      {categories.map((cat) => (
                        <SelectItem
                          key={cat.id}
                          value={cat.id}
                          className="text-gray-200 focus:bg-[#444444] focus:text-white"
                        >
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Description */}
              <div className="grid gap-1.5">
                <Label className="text-xs text-gray-400">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this component does..."
                  className="h-20 resize-none bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
                />
              </div>

              {/* Tags */}
              <div className="grid gap-1.5">
                <Label className="text-xs text-gray-400">Tags</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="bg-[#444444] text-gray-300 hover:bg-[#4a4a4a] cursor-pointer"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      {tag}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add tag..."
                    className="h-8 text-sm bg-[#2c2c2c] border-[#444444] text-gray-200 placeholder:text-gray-500"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    className="border-[#444444] text-gray-300 hover:bg-[#444444]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Preview */}
              <div className="grid gap-1.5">
                <Label className="text-xs text-gray-400 flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Label>
                <div className="h-32 bg-[#1e1e1e] border border-[#444444] rounded-lg overflow-hidden">
                  <ComponentPreview element={defaultVariant?.rootElement} />
                </div>
              </div>

              {/* Variants Section */}
              <Collapsible
                open={sectionsOpen.variants}
                onOpenChange={() => toggleSection('variants')}
              >
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium text-gray-300 hover:text-gray-100">
                  <span className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-gray-500" />
                    Variants
                    <span className="text-xs text-gray-500 font-normal">
                      ({variants.length})
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 text-gray-500 transition-transform',
                      sectionsOpen.variants && 'rotate-90'
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-2">
                    {variants.length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-4">
                        No variants defined
                      </p>
                    ) : (
                      variants.map((variant) => (
                        <VariantItem
                          key={variant.id}
                          variant={variant}
                          isDefault={variant.id === defaultVariantId}
                          onEdit={onEditVariant ? () => onEditVariant(variant) : undefined}
                        />
                      ))
                    )}
                    {onEditVariant && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-dashed border-[#444444] text-gray-400 hover:text-gray-200 hover:bg-[#2c2c2c]"
                        onClick={() => {
                          // Create empty variant and open editor
                          const newVariant: ComponentVariant = {
                            id: generateId(),
                            name: `Variant ${variants.length + 1}`,
                            rootElement: defaultVariant?.rootElement || {
                              id: generateId(),
                              tagName: 'div',
                              attributes: {},
                              className: '',
                              children: [],
                              overridable: {
                                text: true,
                                fill: true,
                                stroke: true,
                                visibility: true,
                                image: true,
                              },
                              styles: {},
                            },
                          };
                          setVariants((prev) => [...prev, newVariant]);
                          onEditVariant(newVariant);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Variant
                      </Button>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Exposed Properties Section */}
              <Collapsible
                open={sectionsOpen.properties}
                onOpenChange={() => toggleSection('properties')}
              >
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium text-gray-300 hover:text-gray-100">
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-gray-500" />
                    Exposed Properties
                    <span className="text-xs text-gray-500 font-normal">
                      ({exposedProperties.length})
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 text-gray-500 transition-transform',
                      sectionsOpen.properties && 'rotate-90'
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-2">
                    {/* Property Editor */}
                    {(showPropertyEditor || editingPropertyId) && (
                      <ComponentPropertyEditor
                        property={editingProperty}
                        availableElements={availableElements}
                        availableComponents={availableComponents}
                        onSave={handlePropertySave}
                        onCancel={() => {
                          setShowPropertyEditor(false);
                          setEditingPropertyId(null);
                        }}
                      />
                    )}

                    {/* Property List */}
                    {!showPropertyEditor && !editingPropertyId && (
                      <>
                        {exposedProperties.length === 0 ? (
                          <p className="text-xs text-gray-500 text-center py-4">
                            No exposed properties
                          </p>
                        ) : (
                          exposedProperties.map((property) => (
                            <PropertyItem
                              key={property.id}
                              property={property}
                              onEdit={() => setEditingPropertyId(property.id)}
                              onDelete={() => handlePropertyDelete(property.id)}
                            />
                          ))
                        )}

                        {/* Add Property Buttons */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-dashed border-[#444444] text-gray-400 hover:text-gray-200 hover:bg-[#2c2c2c]"
                            onClick={() => setShowPropertyEditor(true)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Add Property
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          {/* Footer */}
          <DialogFooter className="flex items-center justify-between pt-4 border-t border-[#444444]">
            <div>
              {!isNew && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSaving}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
                className="text-gray-400 hover:text-gray-200"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!isValid || isSaving}
                className="bg-[#0d99ff] hover:bg-[#0c8ce9] text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="bg-[#2c2c2c] border-[#444444]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-200">Delete Component</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Are you sure you want to delete &quot;{master?.name}&quot;? This action cannot be
              undone. All instances of this component will be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-[#444444] text-gray-300 hover:bg-[#444444]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default MasterComponentEditor;
