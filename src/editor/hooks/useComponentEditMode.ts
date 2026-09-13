import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorContext, useEditorComponents } from '../EditorContext';
import { htmlElementToComponentElement } from '../contexts/EditorComponentsContext';
import { renderComponentElement } from '../utils/component-renderer';
import { propagateMasterChanges } from '../utils/component-sync';
import { buildDomTree } from '../utils/dom-utils';
import { applyLockInside, detachPart, partInfoOf, unlockPartDescendants } from '../parts';
import { toast } from 'sonner';
import type { MasterComponent, ComponentInstance } from '../../types/editor-components';
import { debugLog } from '../utils/debug';

interface UseComponentEditModeProps {
  contentId?: string;
  closeContextMenu: () => void;
}

interface UseComponentEditModeReturn {
  // Panel state
  isComponentPanelOpen: boolean;
  setIsComponentPanelOpen: (open: boolean) => void;
  selectedMasterComponentId: string | null;
  setSelectedMasterComponentId: (id: string | null) => void;
  // Master editor
  editingMasterComponent: MasterComponent | null;
  isMasterEditorOpen: boolean;
  setIsMasterEditorOpen: (open: boolean) => void;
  setEditingMasterComponent: (c: MasterComponent | null) => void;
  // Component edit mode
  isComponentEditMode: boolean;
  editingComponentId: string | null;
  // Create component dialog
  createComponentDialogOpen: boolean;
  setCreateComponentDialogOpen: (open: boolean) => void;
  newComponentName: string;
  setNewComponentName: (name: string) => void;
  newComponentCategory: string;
  setNewComponentCategory: (category: string) => void;
  // Computed
  selectedElementInstance: ComponentInstance | null;
  isComponentInstance: boolean;
  hasOverrides: boolean;
  /** 選択要素が部品(data-part)のインスタンスか */
  isPartInstance: boolean;
  /** 「名前 vN」。インスタンスでなければ空 */
  partLabel: string;
  // Handlers
  handleCreateComponent: () => void;
  handleConfirmCreateComponent: () => Promise<void>;
  handleEditMasterComponent: (masterId: string) => void;
  handleSaveMasterComponent: (updatedMaster: MasterComponent) => Promise<void>;
  handleDeleteMasterComponent: (masterId: string) => Promise<void>;
  enterComponentEditMode: (masterId: string) => void;
  exitComponentEditMode: (save: boolean) => Promise<void>;
  handleGoToMainComponent: () => void;
  handleDetachInstance: () => void;
  handleResetOverrides: () => Promise<void>;
  handlePushOverridesToMain: () => void;
  /** 部品から切り離す(出自の記録を外して普通の HTML にする) */
  handleDetachPart: () => void;
  /** インスタンスの今の姿で定義を更新する(版 +1) */
  handleUpdatePart: () => Promise<void>;
}

/**
 * コンポーネント編集モード管理フック
 * マスターコンポーネントの作成・編集・削除、インスタンス操作、
 * コンポーネントパネル・エディタ状態を管理
 */
export function useComponentEditMode({
  contentId,
  closeContextMenu,
}: UseComponentEditModeProps): UseComponentEditModeReturn {
  const {
    iframeRef,
    selectedElement,
    setSelectedElement,
    setSelectedElementIds,
    setDomTree,
    setExpandedNodes,
    getIframeDoc,
    notifyIframeChange,
  } = useEditorContext();

  const {
    masterComponents,
    componentInstances,
    componentLibrary,
    createMasterComponent,
    createInstance,
    updateInstance,
    getInstanceByDomId,
    getMasterComponent,
    detachInstance,
    resetAllOverrides,
    updateMasterComponent,
    deleteMasterComponent,
    pendingNavigationTarget,
    clearNavigationRequest,
    partsMode,
    getPartDef,
    savePartFromElement,
    updatePartFromElement,
  } = useEditorComponents();

  // コンポーネントパネル状態
  const [isComponentPanelOpen, setIsComponentPanelOpen] = useState(false);
  // 選択中のマスターコンポーネントID（「メインコンポーネントに移動」機能用）
  const [selectedMasterComponentId, setSelectedMasterComponentId] = useState<string | null>(null);
  // マスターコンポーネントエディタ（メタデータ編集用ダイアログ）状態
  const [editingMasterComponent, setEditingMasterComponent] = useState<MasterComponent | null>(null);
  const [isMasterEditorOpen, setIsMasterEditorOpen] = useState(false);

  // コンポーネント編集モード（キャンバス内でマスターを直接編集）
  const [isComponentEditMode, setIsComponentEditMode] = useState(false);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const originalPageHtmlRef = useRef<string | null>(null);

  // コンポーネント作成ダイアログ状態
  const [createComponentDialogOpen, setCreateComponentDialogOpen] = useState(false);
  const [newComponentName, setNewComponentName] = useState('');
  const [newComponentCategory, setNewComponentCategory] = useState('');

  // Handle navigation request from property panel ("Go to Main Component")
  useEffect(() => {
    if (pendingNavigationTarget) {
      setIsComponentPanelOpen(true);
      setSelectedMasterComponentId(pendingNavigationTarget);
      clearNavigationRequest();
    }
  }, [pendingNavigationTarget, clearNavigationRequest]);

  // Check if selected element is a component instance
  const selectedElementInstance = useMemo(() => {
    if (!selectedElement?.id) return null;
    return getInstanceByDomId(selectedElement.id);
  }, [selectedElement?.id, getInstanceByDomId]);

  const isComponentInstance = !!selectedElementInstance;

  const hasOverrides = useMemo(() => {
    if (!selectedElementInstance) return false;
    return selectedElementInstance.overrides.length > 0;
  }, [selectedElementInstance]);

  // 部品(data-part)のインスタンスか。状態は持たず、その時点の DOM の属性で決める
  const selectedPart = useMemo(() => {
    if (!selectedElement?.id) return null;
    const doc = getIframeDoc();
    const el = doc?.querySelector(`[data-element-id="${selectedElement.id}"]`);
    return partInfoOf(el);
  }, [selectedElement, getIframeDoc]);
  const isPartInstance = !!selectedPart;
  const partLabel = useMemo(() => {
    if (!selectedPart) return '';
    const def = getPartDef(selectedPart.id);
    return `${def?.name || selectedPart.id} v${selectedPart.version}`;
  }, [selectedPart, getPartDef]);

  // Create component from selected element
  const handleCreateComponent = useCallback(() => {
    if (!selectedElement?.id || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const element = iframeDoc.querySelector(`[data-element-id="${selectedElement.id}"]`) as HTMLElement;
    if (!element) return;

    // Open dialog to get component name and category
    setCreateComponentDialogOpen(true);
  }, [selectedElement?.id, iframeRef]);

  const handleConfirmCreateComponent = useCallback(async () => {
    if (!selectedElement?.id || !iframeRef.current || !newComponentName.trim() || !contentId) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const element = iframeDoc.querySelector(`[data-element-id="${selectedElement.id}"]`) as HTMLElement;
    if (!element) return;

    // 部品モード: 選択要素を HTML の定義として利用側へ保存し、その場でインスタンスにする
    if (partsMode) {
      try {
        const def = await savePartFromElement(element, {
          name: newComponentName.trim(),
          category: newComponentCategory || undefined,
        });
        applyLockInside(element);
        notifyIframeChange(true);
        setCreateComponentDialogOpen(false);
        setNewComponentName('');
        setNewComponentCategory('');
        closeContextMenu();
        toast.success(`部品「${def.name ?? def.id}」として保存しました`, {
          description: `parts/${def.id}.html。スロット(data-slot)の外は編集できなくなります(切り離すと戻ります)`,
        });
      } catch (error) {
        console.error('Failed to save part:', error);
        toast.error('部品の保存に失敗しました');
      }
      return;
    }

    try {
      // Debug: Log the original element
      debugLog('[handleConfirmCreateComponent] Original element:', {
        tagName: element.tagName,
        className: element.className,
        innerHTML: element.innerHTML.substring(0, 200),
        outerHTML: element.outerHTML.substring(0, 300),
        childrenCount: element.children.length,
        textContent: element.textContent?.substring(0, 100),
      });

      // Create the master component
      const component = createMasterComponent(element, newComponentName.trim(), newComponentCategory || 'content');
      debugLog('[handleConfirmCreateComponent] Created component:', {
        id: component.id,
        name: component.name,
        variantsCount: component.variants.length,
        defaultVariantId: component.defaultVariantId,
        rootElement: component.variants[0]?.rootElement ? {
          tagName: component.variants[0].rootElement.tagName,
          className: component.variants[0].rootElement.className,
          childrenCount: component.variants[0].rootElement.children.length,
          textContent: component.variants[0].rootElement.textContent?.substring(0, 100),
        } : 'NO ROOT ELEMENT',
      });

      // Calculate position from original element BEFORE creating instance
      // Note: Can't use `parseFloat(style) || fallback` because 0 is falsy
      const rect = element.getBoundingClientRect();
      const iframeRect = iframeRef.current!.getBoundingClientRect();
      const styleLeft = element.style.left ? parseFloat(element.style.left) : NaN;
      const styleTop = element.style.top ? parseFloat(element.style.top) : NaN;
      const positionX = !isNaN(styleLeft) ? styleLeft : (rect.left - iframeRect.left);
      const positionY = !isNaN(styleTop) ? styleTop : (rect.top - iframeRect.top);

      // Create an instance of the component to replace the original element
      // Pass the component directly since state update is async
      // Pass position directly to createInstance to avoid React state batching race condition
      const instance = createInstance(
        component.id,
        undefined,
        contentId,
        component,
        undefined,  // customDomElementId
        undefined,  // initialOverrides
        undefined,  // initialPropertyValues
        { x: positionX, y: positionY }  // initialPosition
      );
      if (instance) {
        debugLog('[handleConfirmCreateComponent] Created instance:', {
          id: instance.id,
          domElementId: instance.domElementId,
          variantId: instance.variantId,
          position: instance.position,
        });

        // Render the instance to DOM (position will be applied from instance.position)
        const { renderInstance } = await import('../utils/component-renderer');
        const instanceElement = renderInstance(component, instance, iframeDoc);

        debugLog('[handleConfirmCreateComponent] Rendered instance element:', {
          tagName: instanceElement.tagName,
          className: instanceElement.className,
          innerHTML: instanceElement.innerHTML.substring(0, 200),
          outerHTML: instanceElement.outerHTML.substring(0, 300),
        });

        // Replace the original element with the instance
        element.parentNode?.replaceChild(instanceElement, element);

        // Update selection to the new instance using proper element info extraction
        const { extractElementInfo } = await import('../utils/style-utils');
        const elementInfo = extractElementInfo(instanceElement, iframeDoc);
        if (elementInfo) {
          setSelectedElement(elementInfo);
          setSelectedElementIds([instance.domElementId]);
          instanceElement.classList.add('selected');
        }

        // Update history
        notifyIframeChange(true);

        debugLog('[handleConfirmCreateComponent] Replaced element with instance:', instance.id);
      }

      setCreateComponentDialogOpen(false);
      setNewComponentName('');
      setNewComponentCategory('');
      closeContextMenu();
      toast.success(`コンポーネント "${newComponentName}" を作成しました`);
    } catch (error) {
      console.error('Failed to create component:', error);
      toast.error('コンポーネントの作成に失敗しました');
    }
  }, [selectedElement?.id, iframeRef, newComponentName, newComponentCategory, createMasterComponent, createInstance, contentId, notifyIframeChange, closeContextMenu, setSelectedElement, setSelectedElementIds, partsMode, savePartFromElement]);

  // Open master component editor
  const handleEditMasterComponent = useCallback((masterId: string) => {
    const master = getMasterComponent(masterId);
    if (master) {
      setEditingMasterComponent(master);
      setIsMasterEditorOpen(true);
    }
  }, [getMasterComponent]);

  // Save master component changes
  const handleSaveMasterComponent = useCallback(async (updatedMaster: MasterComponent) => {
    try {
      updateMasterComponent(updatedMaster.id, updatedMaster);
      setIsMasterEditorOpen(false);
      setEditingMasterComponent(null);
      toast.success('コンポーネントを保存しました');
    } catch (error) {
      console.error('Failed to save master component:', error);
      toast.error('コンポーネントの保存に失敗しました');
      throw error;
    }
  }, [updateMasterComponent]);

  // Delete master component
  const handleDeleteMasterComponent = useCallback(async (masterId: string) => {
    try {
      deleteMasterComponent(masterId);
      setIsMasterEditorOpen(false);
      setEditingMasterComponent(null);
      toast.success('コンポーネントを削除しました');
    } catch (error) {
      console.error('Failed to delete master component:', error);
      toast.error('コンポーネントの削除に失敗しました');
      throw error;
    }
  }, [deleteMasterComponent]);

  // Enter component edit mode - directly edit the master component in the canvas
  const enterComponentEditMode = useCallback((masterId: string) => {
    const master = getMasterComponent(masterId);
    if (!master) {
      toast.error('コンポーネントが見つかりません');
      return;
    }

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // Save current page HTML
    const artboard = iframeDoc.getElementById('artboard');
    if (artboard) {
      originalPageHtmlRef.current = artboard.innerHTML;

      // DEBUG: Log what instances are being saved
      debugLog('[enterComponentEditMode] ========== SAVING PAGE HTML ==========');
      const instancesToSave = artboard.querySelectorAll('[data-component-instance]');
      debugLog('[enterComponentEditMode] Saving', instancesToSave.length, 'instances');
      instancesToSave.forEach((inst, idx) => {
        debugLog(`[enterComponentEditMode] Instance ${idx} text being saved:`, inst.textContent?.substring(0, 100));
      });
    }

    // Get the default variant's root element
    const defaultVariant = master.variants.find(v => v.id === master.defaultVariantId);
    if (!defaultVariant?.rootElement) {
      toast.error('コンポーネントの構造が見つかりません');
      return;
    }

    // Render the component element to HTML
    const componentElement = renderComponentElement(defaultVariant.rootElement, iframeDoc);

    // Clear the artboard and add the component
    if (artboard) {
      artboard.innerHTML = '';
      // Add padding/centering wrapper
      const wrapper = iframeDoc.createElement('div');
      wrapper.style.cssText = 'padding: 40px; display: flex; align-items: flex-start; justify-content: center; min-height: 100%;';
      wrapper.appendChild(componentElement);
      artboard.appendChild(wrapper);
    }

    // Add class to body to indicate component edit mode (used by selection hooks)
    iframeDoc.body.classList.add('component-edit-mode');

    // Set edit mode state
    setIsComponentEditMode(true);
    setEditingComponentId(masterId);

    // Clear selection
    setSelectedElement(null);
    setSelectedElementIds([]);

    // Rebuild DOM tree
    const tree = buildDomTree(iframeDoc);
    setDomTree(tree);
    setExpandedNodes(new Set(tree.map((n: { id: string }) => n.id)));

    toast.success(`コンポーネント「${master.name}」を編集中`);
    closeContextMenu();
  }, [getMasterComponent, getIframeDoc, setSelectedElement, setSelectedElementIds, setDomTree, setExpandedNodes, closeContextMenu]);

  // Exit component edit mode
  const exitComponentEditMode = useCallback(async (save: boolean) => {
    if (!editingComponentId) return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // Store the updated master component for syncing after page restore
    let updatedMaster: MasterComponent | null = null;

    if (save) {
      // Get the master component
      const master = getMasterComponent(editingComponentId);
      if (!master) {
        toast.error('コンポーネントが見つかりません');
        return;
      }

      // Get the edited element from the artboard
      const artboard = iframeDoc.getElementById('artboard');
      const wrapper = artboard?.firstElementChild as HTMLElement;
      const editedElement = wrapper?.firstElementChild as HTMLElement;

      if (editedElement) {
        // Convert back to ComponentElement
        const newRootElement = htmlElementToComponentElement(editedElement);

        // Find and update the default variant
        const updatedVariants = master.variants.map(v => {
          if (v.id === master.defaultVariantId) {
            return { ...v, rootElement: newRootElement };
          }
          return v;
        });

        // Update the master component
        try {
          updateMasterComponent(master.id, {
            variants: updatedVariants,
            updatedAt: new Date().toISOString(),
          });

          // Store for syncing after page restore
          updatedMaster = {
            ...master,
            variants: updatedVariants,
            updatedAt: new Date().toISOString(),
          };

          toast.success('コンポーネントを保存しました');
        } catch (error) {
          console.error('Failed to save component:', error);
          toast.error('コンポーネントの保存に失敗しました');
        }
      }
    }

    // Restore original page HTML
    const artboard = iframeDoc.getElementById('artboard');

    // DEBUG: Log what we're about to restore
    debugLog('[exitComponentEditMode] ========== HTML RESTORE DEBUG ==========');
    debugLog('[exitComponentEditMode] originalPageHtmlRef exists:', originalPageHtmlRef.current !== null);
    if (originalPageHtmlRef.current) {
      // Extract instance text from saved HTML for debugging
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = originalPageHtmlRef.current;
      const savedInstances = tempDiv.querySelectorAll('[data-component-instance]');
      debugLog('[exitComponentEditMode] Saved HTML has', savedInstances.length, 'instances');
      savedInstances.forEach((inst, idx) => {
        debugLog(`[exitComponentEditMode] Saved instance ${idx} text:`, inst.textContent?.substring(0, 100));
      });
    }

    if (artboard && originalPageHtmlRef.current !== null) {
      artboard.innerHTML = originalPageHtmlRef.current;
      originalPageHtmlRef.current = null;

      // DEBUG: Log what's in the DOM after restore
      const restoredInstances = artboard.querySelectorAll('[data-component-instance]');
      debugLog('[exitComponentEditMode] After restore, DOM has', restoredInstances.length, 'instances');
      restoredInstances.forEach((inst, idx) => {
        debugLog(`[exitComponentEditMode] Restored instance ${idx} text:`, inst.textContent?.substring(0, 100));
      });
    }

    // Sync all instances with the updated master component
    if (updatedMaster && save) {
      // Get all instances as an array
      const instancesArray = Array.from(componentInstances.values());

      // Debug: Log the updated master and instances
      debugLog('[exitComponentEditMode] ========== SYNC DEBUG ==========');
      debugLog('[exitComponentEditMode] Updated master:', {
        id: updatedMaster.id,
        name: updatedMaster.name,
        variantsCount: updatedMaster.variants.length,
      });

      // Log master's text content
      const defaultVariant = updatedMaster.variants.find(v => v.id === updatedMaster.defaultVariantId);
      if (defaultVariant) {
        debugLog('[exitComponentEditMode] Master rootElement:', {
          tagName: defaultVariant.rootElement.tagName,
          textContent: defaultVariant.rootElement.textContent?.substring(0, 100),
          innerHTML: defaultVariant.rootElement.innerHTML?.substring(0, 100),
          childrenCount: defaultVariant.rootElement.children.length,
        });
      }

      debugLog('[exitComponentEditMode] Instances to sync:', instancesArray.map(i => ({
        id: i.id,
        masterComponentId: i.masterComponentId,
        domElementId: i.domElementId,
        isDetached: i.isDetached,
        existingOverrides: i.overrides.length,
      })));

      // Debug: Check if instances exist in restored DOM
      const artboardForSync = iframeDoc.getElementById('artboard');
      if (artboardForSync) {
        const instanceElements = artboardForSync.querySelectorAll(`[data-component-master="${updatedMaster.id}"]`);
        debugLog('[exitComponentEditMode] Instance elements in DOM:', instanceElements.length);
        instanceElements.forEach((el, i) => {
          debugLog(`[exitComponentEditMode] DOM instance ${i}:`, {
            instanceId: el.getAttribute('data-component-instance'),
            masterId: el.getAttribute('data-component-master'),
            elementId: el.getAttribute('data-element-id'),
            textContent: el.textContent?.substring(0, 100),
          });
        });
      }

      // Propagate master changes to all instances in the DOM
      const syncResult = propagateMasterChanges(updatedMaster, instancesArray, iframeDoc);
      debugLog('[exitComponentEditMode] Synced instances:', syncResult);

      // Persist updated instances with their newly detected overrides
      if (syncResult.updatedInstances.length > 0) {
        debugLog('[exitComponentEditMode] Persisting updated instances with overrides:',
          syncResult.updatedInstances.map(i => ({
            id: i.id,
            overridesCount: i.overrides.length,
          }))
        );
        for (const updatedInst of syncResult.updatedInstances) {
          updateInstance(updatedInst.id, {
            overrides: updatedInst.overrides,
            variantId: updatedInst.variantId,
          });
        }
      }

      if (syncResult.updatedCount > 0) {
        toast.success(`${syncResult.updatedCount}個のインスタンスを更新しました`);
      }
    }

    // Remove component edit mode class from body
    iframeDoc.body.classList.remove('component-edit-mode');

    // Clear edit mode state
    setIsComponentEditMode(false);
    setEditingComponentId(null);
    setSelectedElement(null);
    setSelectedElementIds([]);

    // Rebuild DOM tree
    const tree = buildDomTree(iframeDoc);
    setDomTree(tree);
    setExpandedNodes(new Set(tree.map((n: { id: string }) => n.id)));

    // Notify change
    notifyIframeChange(true);
  }, [editingComponentId, getMasterComponent, getIframeDoc, updateMasterComponent, updateInstance, componentInstances, setSelectedElement, setSelectedElementIds, setDomTree, setExpandedNodes, notifyIframeChange]);

  // Go to main component - enters component edit mode to directly edit the master in canvas
  const handleGoToMainComponent = useCallback(() => {
    if (!selectedElementInstance) return;
    debugLog('Go to main component:', selectedElementInstance.masterComponentId);
    enterComponentEditMode(selectedElementInstance.masterComponentId);
  }, [selectedElementInstance, enterComponentEditMode]);

  // Detach instance
  const handleDetachInstance = useCallback(() => {
    if (!selectedElementInstance) return;
    try {
      // Get the rendered HTML element from the detach operation
      const detachedElement = detachInstance(selectedElementInstance.id);

      // Find and replace the instance element in the DOM
      const iframeDoc = getIframeDoc();
      if (iframeDoc && detachedElement) {
        const existingElement = iframeDoc.querySelector(`[data-element-id="${selectedElementInstance.domElementId}"]`);
        if (existingElement) {
          // Remove component-related attributes from the detached element
          detachedElement.removeAttribute('data-component-instance');
          detachedElement.removeAttribute('data-component-master');

          // Preserve position from existing element
          const existingStyle = existingElement.getAttribute('style');
          if (existingStyle) {
            detachedElement.setAttribute('style', existingStyle);
          }

          // Replace with detached element
          existingElement.replaceWith(detachedElement);

          // Notify change
          notifyIframeChange(true);
        }
      }

      debugLog('Detached instance:', selectedElementInstance.id);
      closeContextMenu();
      toast.success('インスタンスを解除しました');
    } catch (error) {
      console.error('Failed to detach instance:', error);
      toast.error('インスタンスの解除に失敗しました');
    }
  }, [selectedElementInstance, detachInstance, getIframeDoc, notifyIframeChange, closeContextMenu]);

  // Reset all overrides
  const handleResetOverrides = useCallback(async () => {
    if (!selectedElementInstance) return;
    try {
      resetAllOverrides(selectedElementInstance.id);

      // Re-render the instance in the DOM
      const master = getMasterComponent(selectedElementInstance.masterComponentId);
      const iframeDoc = getIframeDoc();
      if (master && iframeDoc) {
        const existingElement = iframeDoc.querySelector(`[data-element-id="${selectedElementInstance.domElementId}"]`);
        if (existingElement) {
          // Get the reset instance (with no overrides)
          const resetInstance = { ...selectedElementInstance, overrides: [], propertyValues: {} };
          const { renderInstance } = await import('../utils/component-renderer');
          const newElement = renderInstance(master, resetInstance, iframeDoc);

          // Preserve position from existing element
          const existingStyle = existingElement.getAttribute('style');
          if (existingStyle) {
            newElement.setAttribute('style', existingStyle);
          }

          // Replace the old element
          existingElement.replaceWith(newElement);

          // Notify change
          notifyIframeChange(true);
        }
      }

      debugLog('Reset overrides for instance:', selectedElementInstance.id);
      closeContextMenu();
      toast.success('オーバーライドをリセットしました');
    } catch (error) {
      console.error('Failed to reset overrides:', error);
      toast.error('オーバーライドのリセットに失敗しました');
    }
  }, [selectedElementInstance, resetAllOverrides, getMasterComponent, getIframeDoc, notifyIframeChange, closeContextMenu]);

  // Push overrides to main (placeholder - requires more complex implementation)
  const handlePushOverridesToMain = useCallback(() => {
    if (!selectedElementInstance) return;
    debugLog('Push overrides to main - not yet implemented');
    closeContextMenu();
    toast.info('この機能は現在開発中です');
  }, [selectedElementInstance, closeContextMenu]);

  // 部品から切り離す: 出自の記録(data-part)だけ外し、ロックされていた子孫を編集できるようにする
  const handleDetachPart = useCallback(() => {
    if (!selectedElement?.id) return;
    const doc = getIframeDoc();
    const el = doc?.querySelector(`[data-element-id="${selectedElement.id}"]`) as HTMLElement | null;
    if (!doc || !el || !partInfoOf(el)) return;
    detachPart(el);
    unlockPartDescendants(el);
    notifyIframeChange(true);
    // 部品バッジを消すため、選択情報を作り直す
    void import('../utils/style-utils').then(({ extractElementInfo }) => {
      const info = extractElementInfo(el, doc);
      if (info) setSelectedElement(info);
    });
    closeContextMenu();
    toast.success('部品から切り離しました', {
      description: 'この要素は普通の HTML になり、部品の更新の対象から外れます',
    });
  }, [selectedElement?.id, getIframeDoc, notifyIframeChange, setSelectedElement, closeContextMenu]);

  // インスタンスの今の姿で定義を更新する(版 +1)。他ページへの反映は利用側(io.savePart の実装)が行う
  const handleUpdatePart = useCallback(async () => {
    if (!selectedElement?.id) return;
    const doc = getIframeDoc();
    const el = doc?.querySelector(`[data-element-id="${selectedElement.id}"]`) as HTMLElement | null;
    if (!el) return;
    try {
      const def = await updatePartFromElement(el);
      if (!def) return;
      notifyIframeChange(true);
      closeContextMenu();
      toast.success(`部品「${def.name ?? def.id}」を v${def.version} に更新しました`);
    } catch (error) {
      console.error('Failed to update part:', error);
      toast.error('部品の更新に失敗しました');
    }
  }, [selectedElement?.id, getIframeDoc, updatePartFromElement, notifyIframeChange, closeContextMenu]);

  return {
    // Panel state
    isComponentPanelOpen,
    setIsComponentPanelOpen,
    selectedMasterComponentId,
    setSelectedMasterComponentId,
    // Master editor
    editingMasterComponent,
    isMasterEditorOpen,
    setIsMasterEditorOpen,
    setEditingMasterComponent,
    // Component edit mode
    isComponentEditMode,
    editingComponentId,
    // Create component dialog
    createComponentDialogOpen,
    setCreateComponentDialogOpen,
    newComponentName,
    setNewComponentName,
    newComponentCategory,
    setNewComponentCategory,
    // Computed
    selectedElementInstance,
    isComponentInstance,
    hasOverrides,
    isPartInstance,
    partLabel,
    // Handlers
    handleCreateComponent,
    handleConfirmCreateComponent,
    handleEditMasterComponent,
    handleSaveMasterComponent,
    handleDeleteMasterComponent,
    enterComponentEditMode,
    exitComponentEditMode,
    handleGoToMainComponent,
    handleDetachInstance,
    handleResetOverrides,
    handlePushOverridesToMain,
    handleDetachPart,
    handleUpdatePart,
  };
}
