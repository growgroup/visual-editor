/**
 * Flexbox drag-to-reorder utilities
 * Concrete5-style element reordering in auto-layout containers
 */

/**
 * Information about a flex container
 */
export interface FlexContainerInfo {
  isFlexContainer: boolean;
  container: HTMLElement;
  direction: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  isReverse: boolean;
  children: HTMLElement[];
  childIndex: number;
  gap: number;
}

/**
 * Get information about the flex container of an element
 */
export function getFlexContainerInfo(element: HTMLElement): FlexContainerInfo | null {
  const parent = element.parentElement;
  if (!parent) return null;

  const style = window.getComputedStyle(parent);
  const display = style.display;

  if (display !== 'flex' && display !== 'inline-flex') {
    return null;
  }

  const direction = (style.flexDirection || 'row') as FlexContainerInfo['direction'];
  const isReverse = direction.includes('reverse');

  // Get child elements excluding UI elements
  const children = Array.from(parent.children).filter(child => {
    const el = child as HTMLElement;
    return !el.classList.contains('selection-box') &&
           !el.classList.contains('resize-handle') &&
           !el.classList.contains('flex-drop-indicator') &&
           el.tagName !== 'SCRIPT' &&
           el.tagName !== 'STYLE';
  }) as HTMLElement[];

  const childIndex = children.indexOf(element);
  const gap = parseFloat(style.gap) || 0;

  return {
    isFlexContainer: true,
    container: parent,
    direction,
    isReverse,
    children,
    childIndex,
    gap,
  };
}

/**
 * Check if drag should trigger flex reordering
 */
export function canReorderInFlex(element: HTMLElement): boolean {
  const info = getFlexContainerInfo(element);
  return info !== null && info.childIndex !== -1;
}

/**
 * Calculate the target drop index based on cursor position
 */
export function calculateDropIndex(
  parent: HTMLElement,
  cursorX: number,
  cursorY: number,
  iframeWindow: Window
): number {
  const style = iframeWindow.getComputedStyle(parent);
  const direction = style.flexDirection || 'row';
  const isColumn = direction === 'column' || direction === 'column-reverse';
  const isReverse = direction.includes('reverse');

  // Get child elements excluding UI elements
  const children = Array.from(parent.children).filter(child => {
    const el = child as HTMLElement;
    return !el.classList.contains('selection-box') &&
           !el.classList.contains('resize-handle') &&
           !el.classList.contains('flex-drop-indicator') &&
           el.tagName !== 'SCRIPT' &&
           el.tagName !== 'STYLE';
  }) as HTMLElement[];

  if (children.length === 0) return 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const rect = child.getBoundingClientRect();

    if (isColumn) {
      // For column layouts, check vertical position
      const childMidY = rect.top + rect.height / 2;
      if (cursorY < childMidY) {
        return isReverse ? children.length - i : i;
      }
    } else {
      // For row layouts, check horizontal position
      const childMidX = rect.left + rect.width / 2;
      if (cursorX < childMidX) {
        return isReverse ? children.length - i : i;
      }
    }
  }

  // Cursor is after all children
  return isReverse ? 0 : children.length;
}

/**
 * Show the drop indicator at the target position
 */
export function showFlexDropIndicator(
  iframeDoc: Document,
  parent: HTMLElement,
  targetIndex: number,
  currentDragElement?: HTMLElement
): void {
  // Remove existing indicator
  hideFlexDropIndicator(iframeDoc);

  const style = iframeDoc.defaultView?.getComputedStyle(parent);
  if (!style) return;

  // Use the same layout detection logic for consistency
  const { isColumn } = isColumnLayout(parent, iframeDoc);
  const gap = parseFloat(style.gap) || 0;

  // Get child elements excluding UI elements and the element being dragged
  const children = Array.from(parent.children).filter(child => {
    const el = child as HTMLElement;
    return !el.classList.contains('selection-box') &&
           !el.classList.contains('resize-handle') &&
           !el.classList.contains('flex-drop-indicator') &&
           el.tagName !== 'SCRIPT' &&
           el.tagName !== 'STYLE' &&
           el !== currentDragElement;
  }) as HTMLElement[];

  const indicator = iframeDoc.createElement('div');
  indicator.className = 'flex-drop-indicator';
  indicator.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 10000;
    background: #6366F1;
    border-radius: 1.5px;
    box-shadow: 0 0 6px rgba(99, 102, 241, 0.4);
    opacity: 0.9;
  `;

  // Add keyframes for nesting animation if not already present
  if (!iframeDoc.getElementById('drop-indicator-styles')) {
    const styleSheet = iframeDoc.createElement('style');
    styleSheet.id = 'drop-indicator-styles';
    styleSheet.textContent = `
      @keyframes nestingPulse {
        0%, 100% { opacity: 0.9; }
        50% { opacity: 0.7; }
      }
    `;
    iframeDoc.head.appendChild(styleSheet);
  }

  const parentRect = parent.getBoundingClientRect();
  const scrollLeft = iframeDoc.defaultView?.scrollX || 0;
  const scrollTop = iframeDoc.defaultView?.scrollY || 0;

  if (children.length === 0 || targetIndex === 0) {
    // Insert at beginning or empty container
    if (isColumn) {
      indicator.style.left = `${parentRect.left + scrollLeft}px`;
      indicator.style.top = `${parentRect.top + scrollTop}px`;
      indicator.style.width = `${parentRect.width}px`;
      indicator.style.height = '3px';
    } else {
      indicator.style.left = `${parentRect.left + scrollLeft}px`;
      indicator.style.top = `${parentRect.top + scrollTop}px`;
      indicator.style.width = '3px';
      indicator.style.height = `${parentRect.height}px`;
    }
  } else if (targetIndex >= children.length) {
    // Insert at end
    const lastChild = children[children.length - 1];
    const lastRect = lastChild.getBoundingClientRect();

    if (isColumn) {
      indicator.style.left = `${parentRect.left + scrollLeft}px`;
      indicator.style.top = `${lastRect.bottom + gap / 2 + scrollTop}px`;
      indicator.style.width = `${parentRect.width}px`;
      indicator.style.height = '3px';
    } else {
      indicator.style.left = `${lastRect.right + gap / 2 + scrollLeft}px`;
      indicator.style.top = `${parentRect.top + scrollTop}px`;
      indicator.style.width = '3px';
      indicator.style.height = `${parentRect.height}px`;
    }
  } else {
    // Insert between elements
    const targetChild = children[targetIndex];
    const targetRect = targetChild.getBoundingClientRect();

    if (isColumn) {
      indicator.style.left = `${parentRect.left + scrollLeft}px`;
      indicator.style.top = `${targetRect.top - gap / 2 + scrollTop}px`;
      indicator.style.width = `${parentRect.width}px`;
      indicator.style.height = '3px';
    } else {
      indicator.style.left = `${targetRect.left - gap / 2 + scrollLeft}px`;
      indicator.style.top = `${parentRect.top + scrollTop}px`;
      indicator.style.width = '3px';
      indicator.style.height = `${parentRect.height}px`;
    }
  }

  iframeDoc.body.appendChild(indicator);
}

/**
 * Hide and remove the drop indicator
 */
export function hideFlexDropIndicator(iframeDoc: Document): void {
  const indicators = iframeDoc.querySelectorAll('.flex-drop-indicator');
  indicators.forEach(indicator => indicator.remove());
}

/**
 * Perform the actual DOM reordering
 */
export function reorderFlexChild(
  parent: HTMLElement,
  element: HTMLElement,
  targetIndex: number
): boolean {
  // Safety check: element must be a child of parent
  if (element.parentElement !== parent) {
    console.warn('[flex-utils] reorderFlexChild: element is not a child of the specified parent');
    return false;
  }

  // Get child elements excluding UI elements
  const children = Array.from(parent.children).filter(child => {
    const el = child as HTMLElement;
    return !el.classList.contains('selection-box') &&
           !el.classList.contains('resize-handle') &&
           !el.classList.contains('flex-drop-indicator') &&
           !el.classList.contains('drag-ghost') &&
           !el.classList.contains('nesting-drop-indicator') &&
           el.tagName !== 'SCRIPT' &&
           el.tagName !== 'STYLE';
  }) as HTMLElement[];

  const currentIndex = children.indexOf(element);

  if (currentIndex === -1) {
    console.warn('[flex-utils] reorderFlexChild: element not found in valid children');
    return false;
  }

  if (currentIndex === targetIndex) {
    return false; // No change needed - element is already at target position
  }

  // Clamp target index to valid range
  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, children.length - 1));

  if (currentIndex === clampedTargetIndex) {
    return false; // No change needed after clamping
  }

  if (clampedTargetIndex >= children.length - 1 && currentIndex < children.length - 1) {
    // Move to end (but not if already at end)
    parent.appendChild(element);
  } else {
    // Insert at target position
    const targetElement = children[clampedTargetIndex];

    // Safety check: don't insert element before/after itself
    if (targetElement === element) {
      return false;
    }

    if (currentIndex < clampedTargetIndex) {
      // Moving forward: insert after target
      if (targetElement.nextSibling !== element) {
        targetElement.insertAdjacentElement('afterend', element);
      } else {
        return false; // Already in correct position
      }
    } else {
      // Moving backward: insert before target
      if (parent.children[clampedTargetIndex] !== element) {
        parent.insertBefore(element, targetElement);
      } else {
        return false; // Already in correct position
      }
    }
  }

  return true;
}

// ============================================================
// Enhanced Auto-Layout Drag Utilities (Ghost Clone Approach)
// ============================================================

/**
 * Get valid children of a container (excluding UI elements and placeholders)
 */
export function getValidChildren(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter(child => {
    const el = child as HTMLElement;
    return !el.classList.contains('selection-box') &&
           !el.classList.contains('resize-handle') &&
           !el.classList.contains('flex-drop-indicator') &&
           !el.classList.contains('drag-ghost') &&
           !el.classList.contains('auto-layout-drop-indicator') &&
           !el.classList.contains('drag-placeholder') &&
           !el.classList.contains('drop-placeholder') &&
           !el.dataset.dragUi &&
           el.tagName !== 'SCRIPT' &&
           el.tagName !== 'STYLE';
  }) as HTMLElement[];
}

/**
 * Drag state for auto-layout
 */
export interface AutoLayoutDragState {
  element: HTMLElement;
  ghost: HTMLElement;
  originalRect: DOMRect;
  originalParent: HTMLElement;
  originalIndex: number;
  currentDropIndex: number;
  /** Canvas zoom scale (1 = 100%) */
  scale: number;
}

/**
 * Create a clean clone of element for drag ghost
 */
function createCleanGhost(element: HTMLElement, iframeDoc: Document): HTMLElement {
  // Clone the element
  const ghost = element.cloneNode(true) as HTMLElement;

  // Remove all UI-related elements from the clone
  const uiSelectors = [
    '.selection-box',
    '.resize-handle',
    '.flex-drop-indicator',
    '.drag-ghost',
    '.auto-layout-drop-indicator',
    '[data-drag-ui]',
  ];
  uiSelectors.forEach(selector => {
    ghost.querySelectorAll(selector).forEach(el => el.remove());
  });

  // Remove any data attributes that might cause issues
  ghost.removeAttribute('data-selected');
  ghost.classList.remove('selected');

  return ghost;
}

/**
 * Start auto-layout drag - creates ghost clone and dims original element
 * @param element The element being dragged
 * @param iframeDoc The iframe document
 * @param scale Canvas zoom scale (1 = 100%, 1.5 = 150%, etc.)
 */
export function startAutoLayoutDrag(
  element: HTMLElement,
  iframeDoc: Document,
  scale: number = 1
): AutoLayoutDragState {
  const originalRect = element.getBoundingClientRect();
  const originalParent = element.parentElement!;

  // Get original index among siblings
  const siblings = getValidChildren(originalParent);
  const originalIndex = siblings.indexOf(element);

  // Create a clean ghost clone (preserves original classes)
  const ghost = createCleanGhost(element, iframeDoc);
  // Add drag-ghost class while preserving original classes for styling
  ghost.classList.add('drag-ghost');

  // When canvas is zoomed, getBoundingClientRect returns screen coords (post-scale).
  // We need to set ghost to unscaled size and apply scale transform so internal
  // content (fonts, etc.) scales correctly to match the zoomed canvas appearance.
  const unscaledWidth = originalRect.width / scale;
  const unscaledHeight = originalRect.height / scale;

  // Apply positioning/layering styles with zoom compensation
  // Use transform-origin: 0 0 so scaling happens from top-left corner (matches position)
  ghost.style.position = 'fixed';
  ghost.style.left = `${originalRect.left}px`;
  ghost.style.top = `${originalRect.top}px`;
  ghost.style.width = `${unscaledWidth}px`;
  ghost.style.height = `${unscaledHeight}px`;
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '100000';
  ghost.style.opacity = '0.9';
  ghost.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
  ghost.style.transformOrigin = '0 0';
  ghost.style.transform = `scale(${scale})`;
  ghost.style.margin = '0';

  iframeDoc.body.appendChild(ghost);

  // Subtle pickup animation (ghost only) - maintain scale while animating
  requestAnimationFrame(() => {
    ghost.style.transition = 'transform 0.15s ease-out, box-shadow 0.15s ease-out';
    ghost.style.transform = `scale(${scale * 1.01})`;
    ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
  });

  // Dim the original element (minimal styles - NO transform/transition to avoid affecting absolute mode)
  element.style.opacity = '0.4';
  element.dataset.dragging = 'true';

  return {
    element,
    ghost,
    originalRect,
    originalParent,
    originalIndex,
    currentDropIndex: originalIndex,
    scale,
  };
}

// Store previous position (kept for potential future use)
let prevDragX = 0;
let prevDragY = 0;

/**
 * Update ghost position to follow cursor (subtle movement, no rotation)
 */
export function updateDragPosition(
  state: AutoLayoutDragState,
  cursorX: number,
  cursorY: number
): void {
  const { ghost, originalRect, scale } = state;

  // The ghost's visual size on screen is originalRect.width/height (after scaling)
  // Center the ghost on cursor using screen dimensions
  const targetLeft = cursorX - originalRect.width / 2;
  const targetTop = cursorY - originalRect.height / 2;

  ghost.style.left = `${targetLeft}px`;
  ghost.style.top = `${targetTop}px`;
  // Keep the subtle scale applied with zoom compensation
  ghost.style.transform = `scale(${scale * 1.01})`;

  // Store current position for next frame (kept for potential future use)
  prevDragX = cursorX;
  prevDragY = cursorY;
}

/**
 * End auto-layout drag - move element to new position with animation
 */
export function endAutoLayoutDrag(
  state: AutoLayoutDragState,
  dropInfo: DropTargetInfo | null,
  iframeDoc: Document
): boolean {
  const { element, ghost, originalParent, originalIndex, scale } = state;

  // Debug logging
  console.log('[endAutoLayoutDrag] Starting:', {
    elementTag: element?.tagName,
    elementId: element?.id,
    elementClass: element?.className,
    hasParent: !!element?.parentElement,
    parentTag: element?.parentElement?.tagName,
    parentId: element?.parentElement?.id,
    originalParentTag: originalParent?.tagName,
    originalParentId: originalParent?.id,
    originalIndex,
    dropInfo: dropInfo ? {
      containerTag: dropInfo.container?.tagName,
      containerId: dropInfo.container?.id,
      position: dropInfo.position,
      index: dropInfo.index,
    } : null,
  });

  // Remove drop indicators
  hideFlexDropIndicator(iframeDoc);
  hideNestingIndicator(iframeDoc);

  // Reset position tracking
  prevDragX = 0;
  prevDragY = 0;

  // Subtle fade animation for ghost - maintain zoom scale
  ghost.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
  ghost.style.transform = `scale(${scale})`;
  ghost.style.opacity = '0.5';

  // Restore original element immediately (NO transition/transform - keep it simple to avoid affecting absolute mode)
  element.style.opacity = '';
  delete element.dataset.dragging;

  let moved = false;

  // Get the current parent of the element (should match originalParent in most cases)
  const currentParent = element.parentElement;

  console.log('[endAutoLayoutDrag] Before DOM operation:', {
    elementInDOM: element.isConnected,
    currentParentTag: currentParent?.tagName,
    currentParentId: currentParent?.id,
  });

  // Get artboard for validation
  const artboard = iframeDoc.querySelector('#artboard, .slide-artboard, #slide-artboard, [data-artboard]') as HTMLElement;

  // Determine if dropInfo points to the same parent as the original
  // Use multiple comparison methods for robustness
  const isSameParent = dropInfo && dropInfo.container && (
    dropInfo.container === originalParent ||
    dropInfo.container === currentParent ||
    (dropInfo.container && originalParent && dropInfo.container.isSameNode(originalParent)) ||
    // Also compare by ID if both have IDs
    (dropInfo.container.id && originalParent?.id && dropInfo.container.id === originalParent.id)
  );

  // Check if drop container is valid (inside artboard or is artboard)
  const isValidDropLocation = dropInfo && dropInfo.container && (
    dropInfo.container === artboard ||
    (artboard && artboard.contains(dropInfo.container)) ||
    dropInfo.container.id === 'artboard'
  );

  console.log('[endAutoLayoutDrag] isSameParent:', isSameParent, 'isValidDropLocation:', isValidDropLocation);

  if (!isValidDropLocation && dropInfo) {
    // Drop location is outside artboard - keep element in original position
    console.warn('[endAutoLayoutDrag] Invalid drop location (outside artboard), keeping element in place');
    // Don't move, element stays where it is
  } else if (dropInfo && isSameParent && originalParent) {
    // Same parent - reorder within the same container
    const targetIndex = dropInfo.index;
    console.log('[endAutoLayoutDrag] Same parent reorder:', { targetIndex, originalIndex });
    if (targetIndex !== originalIndex) {
      moved = reorderFlexChild(originalParent, element, targetIndex);
      console.log('[endAutoLayoutDrag] reorderFlexChild result:', moved);
    }
    // If targetIndex === originalIndex, no move needed (element stays in place)
  } else if (dropInfo && dropInfo.container && isValidDropLocation) {
    // Different parent but valid location - move to new container
    // Safety check: don't move into self or descendants
    console.log('[endAutoLayoutDrag] Different parent move:', {
      containerTag: dropInfo.container.tagName,
      containerId: dropInfo.container.id,
      isElementSelf: dropInfo.container === element,
      isDescendant: element.contains(dropInfo.container),
    });
    if (dropInfo.container !== element && !element.contains(dropInfo.container)) {
      moved = moveElementToContainer(element, dropInfo);
      console.log('[endAutoLayoutDrag] moveElementToContainer result:', moved);
    } else {
      console.warn('[flex-utils] Prevented moving element into itself or descendant');
    }
  } else {
    console.log('[endAutoLayoutDrag] No dropInfo or container, element stays in place');
  }

  console.log('[endAutoLayoutDrag] After DOM operation:', {
    elementInDOM: element.isConnected,
    hasParent: !!element.parentElement,
    parentTag: element.parentElement?.tagName,
    parentId: element.parentElement?.id,
  });

  // Safety check: Ensure element still has a valid parent
  // If element was orphaned somehow, re-attach it to the original parent or artboard
  if (!element.parentElement) {
    console.warn('[flex-utils] Element was orphaned during drag, re-attaching to original parent');
    if (originalParent && originalParent.isConnected) {
      originalParent.appendChild(element);
      moved = true; // Consider this a move since we're re-attaching
    } else if (currentParent && currentParent.isConnected) {
      currentParent.appendChild(element);
      moved = true;
    } else {
      // Fallback to artboard
      const artboard = iframeDoc.querySelector('#artboard, .slide-artboard, #slide-artboard, [data-artboard]') as HTMLElement;
      if (artboard) {
        artboard.appendChild(element);
        moved = true;
      } else {
        console.error('[flex-utils] Could not find a valid parent for orphaned element');
      }
    }
  }

  // Remove ghost after animation completes
  setTimeout(() => {
    ghost.style.opacity = '0';
    ghost.style.transform = 'scale(0.95)';
    setTimeout(() => ghost.remove(), 150);
  }, 50);

  return moved;
}

/**
 * Cancel auto-layout drag - restore everything with animation
 */
export function cancelAutoLayoutDrag(
  state: AutoLayoutDragState,
  iframeDoc: Document
): void {
  const { element, ghost, originalRect, scale } = state;

  // Reset position tracking
  prevDragX = 0;
  prevDragY = 0;

  // Remove drop indicators
  hideFlexDropIndicator(iframeDoc);
  hideNestingIndicator(iframeDoc);

  // Animate ghost back to original position with subtle transition - maintain zoom scale
  ghost.style.transition = 'all 0.2s ease-out';
  ghost.style.left = `${originalRect.left}px`;
  ghost.style.top = `${originalRect.top}px`;
  ghost.style.transform = `scale(${scale})`;
  ghost.style.opacity = '0.5';

  // Restore original element immediately (NO transition/transform)
  element.style.opacity = '';
  delete element.dataset.dragging;

  // Remove ghost after animation
  setTimeout(() => {
    ghost.style.opacity = '0';
    setTimeout(() => ghost.remove(), 150);
  }, 200);
}

/**
 * Check if element is inside a drag ghost
 */
function isInsideDragGhost(element: HTMLElement): boolean {
  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor.classList.contains('drag-ghost')) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/**
 * Check if an element is a valid drop container
 * Supports flex, grid, and block-level containers
 */
export function isValidDropContainer(element: HTMLElement, iframeDoc?: Document): boolean {
  const tagName = element.tagName.toLowerCase();

  // Skip if it's a UI element
  if (element.classList.contains('selection-box') ||
      element.classList.contains('resize-handle') ||
      element.classList.contains('drag-ghost') ||
      element.classList.contains('flex-drop-indicator') ||
      element.classList.contains('nesting-drop-indicator') ||
      element.dataset.dragUi) {
    return false;
  }

  // Skip if element is inside a drag ghost
  if (isInsideDragGhost(element)) {
    return false;
  }

  // Skip non-element tags
  if (tagName === 'script' || tagName === 'style' || tagName === 'link' ||
      tagName === 'br' || tagName === 'hr' || tagName === 'img' ||
      tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
      tagName === 'svg' || tagName === 'canvas' || tagName === 'video' || tagName === 'audio') {
    return false;
  }

  // Always allow these container tags
  const containerTags = [
    'div', 'section', 'article', 'main', 'aside', 'header', 'footer',
    'nav', 'ul', 'ol', 'li', 'figure', 'figcaption', 'form', 'fieldset',
    'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
    'details', 'summary', 'dialog', 'address', 'blockquote', 'pre', 'code'
  ];

  if (containerTags.includes(tagName)) {
    return true;
  }

  // Check if element is a layout container (flex, grid, or block with children)
  const win = element.ownerDocument?.defaultView || iframeDoc?.defaultView;
  if (win) {
    const style = win.getComputedStyle(element);
    const display = style.display;

    // Flex and grid containers are always valid drop targets
    if (display === 'flex' || display === 'inline-flex' ||
        display === 'grid' || display === 'inline-grid') {
      return true;
    }

    // Block-level elements that can contain children
    if (display === 'block' || display === 'inline-block' || display === 'flow-root') {
      return true;
    }
  }

  return false;
}

/**
 * Drop target information
 */
export interface DropTargetInfo {
  container: HTMLElement;
  position: 'before' | 'after' | 'inside';
  index: number;
  referenceElement: HTMLElement | null;
  /** True if this is a nesting operation (moving into a container) */
  isNesting?: boolean;
}

/**
 * Find the drop target at cursor position
 * Prioritizes sibling reordering over nesting
 */
export function findDropTarget(
  iframeDoc: Document,
  cursorX: number,
  cursorY: number,
  draggedElement: HTMLElement,
  _unused?: HTMLElement // kept for backward compatibility
): DropTargetInfo | null {
  const elementsAtPoint = iframeDoc.elementsFromPoint(cursorX, cursorY);
  const draggedParent = draggedElement.parentElement;

  // First pass: Look for sibling reordering in the same parent (highest priority)
  for (const el of elementsAtPoint) {
    const element = el as HTMLElement;

    // Skip invalid elements
    if (isSkippableElement(element, draggedElement)) {
      continue;
    }

    const parent = element.parentElement;

    // Prioritize same-parent reordering
    if (parent === draggedParent && parent) {
      const result = calculateSiblingDropPosition(
        element,
        parent,
        cursorX,
        cursorY,
        draggedElement,
        iframeDoc
      );
      if (result) {
        return result;
      }
    }
  }

  // Second pass: Look for any valid drop target
  for (const el of elementsAtPoint) {
    const element = el as HTMLElement;

    // Skip invalid elements
    if (isSkippableElement(element, draggedElement)) {
      continue;
    }

    const parent = element.parentElement;
    if (!parent || !isValidDropContainer(parent, iframeDoc)) {
      continue;
    }

    // Get valid children (excluding dragged element)
    const children = getValidChildren(parent).filter(c => c !== draggedElement);
    const elementIndex = children.indexOf(element);

    if (elementIndex === -1) {
      // Element is not a direct child - check for nesting into empty container
      // Only allow nesting if cursor is very centered in the element
      if (isValidDropContainer(element, iframeDoc) && shouldAllowNesting(element, cursorX, cursorY, draggedElement)) {
        const childrenOfElement = getValidChildren(element).filter(c => c !== draggedElement);
        if (childrenOfElement.length === 0) {
          return {
            container: element,
            position: 'inside',
            index: 0,
            referenceElement: null,
            isNesting: true, // Mark as nesting operation
          } as DropTargetInfo;
        }
      }
      continue;
    }

    // Calculate sibling drop position
    const result = calculateSiblingDropPosition(
      element,
      parent,
      cursorX,
      cursorY,
      draggedElement,
      iframeDoc
    );
    if (result) {
      return result;
    }
  }

  // Ultimate fallback: keep element in its original parent with its original position
  // This is now the first fallback to preserve the element's position when dropped outside valid targets
  const originalParent = draggedElement.parentElement;
  if (originalParent) {
    const allChildren = Array.from(originalParent.children);
    const currentIndex = allChildren.indexOf(draggedElement);
    // Return the original parent with the current index to preserve position
    return {
      container: originalParent,
      position: 'inside',
      index: currentIndex >= 0 ? currentIndex : 0,
      referenceElement: null,
    };
  }

  // Secondary fallback to artboard (only if element has no parent)
  const artboard = iframeDoc.querySelector('#artboard, .slide-artboard, #slide-artboard, [data-artboard]') as HTMLElement;
  if (artboard && artboard !== draggedElement && !draggedElement.contains(artboard)) {
    const children = getValidChildren(artboard).filter(c => c !== draggedElement);
    return {
      container: artboard,
      position: 'inside',
      index: children.length,
      referenceElement: null,
    };
  }

  return null;
}

/**
 * Check if element should be skipped during drop target search
 */
function isSkippableElement(element: HTMLElement, draggedElement: HTMLElement): boolean {
  // Skip dragged element and its descendants
  if (element === draggedElement || draggedElement.contains(element)) {
    return true;
  }

  // Skip UI elements
  if (element.classList.contains('selection-box') ||
      element.classList.contains('resize-handle') ||
      element.classList.contains('flex-drop-indicator') ||
      element.classList.contains('drag-ghost') ||
      element.classList.contains('nesting-drop-indicator') ||
      element.classList.contains('auto-layout-drop-indicator') ||
      element.dataset.dragging === 'true' ||
      element.dataset.dragUi === 'true') {
    return true;
  }

  // Skip elements inside drag ghost (ghost clone elements)
  // The ghost has class 'drag-ghost', but its children don't
  // So we need to check if any ancestor has the drag-ghost class
  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor.classList.contains('drag-ghost')) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}

/**
 * Check if nesting should be allowed based on cursor position
 * Only allows nesting when cursor is very centered in the element
 */
function shouldAllowNesting(
  element: HTMLElement,
  cursorX: number,
  cursorY: number,
  draggedElement: HTMLElement
): boolean {
  const rect = element.getBoundingClientRect();

  // Require cursor to be at least 40% into the element from all edges
  const minInset = 0.4;
  const insetX = rect.width * minInset;
  const insetY = rect.height * minInset;

  const isWellInside =
    cursorX > rect.left + insetX &&
    cursorX < rect.right - insetX &&
    cursorY > rect.top + insetY &&
    cursorY < rect.bottom - insetY;

  // Also check minimum size - don't nest into small elements
  const minSize = 80;
  const isLargeEnough = rect.width >= minSize && rect.height >= minSize;

  // Don't nest into elements that are similar size to dragged element
  const draggedRect = draggedElement.getBoundingClientRect();
  const sizeDifferenceThreshold = 1.5;
  const isSignificantlyLarger =
    rect.width > draggedRect.width * sizeDifferenceThreshold ||
    rect.height > draggedRect.height * sizeDifferenceThreshold;

  return isWellInside && isLargeEnough && isSignificantlyLarger;
}

/**
 * Determine if a container's layout direction is column-like
 * Uses multiple detection methods for robustness:
 * 1. Check flex-direction for flex containers
 * 2. Check grid-auto-flow for grid containers
 * 3. Check actual child positions as fallback
 */
function isColumnLayout(parent: HTMLElement, iframeDoc: Document): { isColumn: boolean; isReverse: boolean } {
  // Try to get computed style - use parent's ownerDocument for reliability
  const win = parent.ownerDocument?.defaultView || iframeDoc.defaultView;
  const style = win?.getComputedStyle(parent);

  if (style) {
    const display = style.display;

    // Flex container
    if (display === 'flex' || display === 'inline-flex') {
      const flexDirection = style.flexDirection || 'row';
      const isColumn = flexDirection === 'column' || flexDirection === 'column-reverse';
      const isReverse = flexDirection.includes('reverse');
      return { isColumn, isReverse };
    }

    // Grid container
    if (display === 'grid' || display === 'inline-grid') {
      // Check grid-auto-flow to determine primary direction
      const gridAutoFlow = style.gridAutoFlow || 'row';
      // Also check grid-template-columns/rows to infer layout
      const templateColumns = style.gridTemplateColumns || '';
      const templateRows = style.gridTemplateRows || '';

      // If only one column is defined, it's effectively a column layout
      const columnCount = templateColumns.split(/\s+/).filter(c => c && c !== 'none').length;
      const rowCount = templateRows.split(/\s+/).filter(r => r && r !== 'none').length;

      // grid-auto-flow: column means items flow in columns first
      if (gridAutoFlow.includes('column')) {
        return { isColumn: false, isReverse: false };
      }

      // If there's only 1 column defined, items stack vertically
      if (columnCount === 1 || (columnCount === 0 && rowCount > 1)) {
        return { isColumn: true, isReverse: false };
      }

      // Default for grid: items flow horizontally first (row)
      return { isColumn: false, isReverse: false };
    }
  }

  // For non-flex/grid containers (block, inline-block, etc.) or when style is unavailable,
  // detect layout direction from actual child positions
  const children = getValidChildren(parent);
  if (children.length >= 2) {
    const first = children[0].getBoundingClientRect();
    const second = children[1].getBoundingClientRect();

    // If children have similar X positions but different Y, it's column layout
    // If children have similar Y positions but different X, it's row layout
    const xDiff = Math.abs(first.left - second.left);
    const yDiff = Math.abs(first.top - second.top);

    // Use a threshold to determine which axis has more variance
    if (yDiff > xDiff + 10) {
      // Children are stacked vertically → column layout
      return { isColumn: true, isReverse: first.top > second.top };
    } else if (xDiff > yDiff + 10) {
      // Children are side by side → row layout
      return { isColumn: false, isReverse: first.left > second.left };
    }
  }

  // Default: block elements stack vertically
  return { isColumn: true, isReverse: false };
}

/**
 * Calculate drop position for sibling reordering
 */
function calculateSiblingDropPosition(
  element: HTMLElement,
  parent: HTMLElement,
  cursorX: number,
  cursorY: number,
  draggedElement: HTMLElement,
  iframeDoc: Document
): DropTargetInfo | null {
  const children = getValidChildren(parent).filter(c => c !== draggedElement);
  const elementIndex = children.indexOf(element);

  if (elementIndex === -1) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const { isColumn, isReverse } = isColumnLayout(parent, iframeDoc);

  // Use edge detection - check if cursor is in the first or second half
  let position: 'before' | 'after';

  if (isColumn) {
    const midY = rect.top + rect.height / 2;
    position = cursorY < midY ? 'before' : 'after';
  } else {
    const midX = rect.left + rect.width / 2;
    position = cursorX < midX ? 'before' : 'after';
  }

  // Adjust for reverse direction
  if (isReverse) {
    position = position === 'before' ? 'after' : 'before';
  }

  // Calculate the actual drop index
  let index = elementIndex;
  if (position === 'after') {
    index = elementIndex + 1;
  }

  return {
    container: parent,
    position,
    index,
    referenceElement: element,
  };
}

/**
 * Show drop indicator at target position
 * Shows a line for sibling reordering, or a border for nesting
 */
export function showDropIndicator(
  iframeDoc: Document,
  dropInfo: DropTargetInfo,
  draggedElement: HTMLElement
): void {
  // If nesting, show a container highlight instead of a line
  if (dropInfo.isNesting || dropInfo.position === 'inside') {
    hideFlexDropIndicator(iframeDoc);
    showNestingIndicator(iframeDoc, dropInfo.container);
  } else {
    hideNestingIndicator(iframeDoc);
    showFlexDropIndicator(iframeDoc, dropInfo.container, dropInfo.index, draggedElement);
  }
}

/**
 * Show nesting indicator (highlight the container)
 */
function showNestingIndicator(iframeDoc: Document, container: HTMLElement): void {
  hideNestingIndicator(iframeDoc);

  const rect = container.getBoundingClientRect();
  const scrollLeft = iframeDoc.defaultView?.scrollX || 0;
  const scrollTop = iframeDoc.defaultView?.scrollY || 0;

  const indicator = iframeDoc.createElement('div');
  indicator.className = 'nesting-drop-indicator';
  indicator.dataset.dragUi = 'true';
  indicator.style.cssText = `
    position: absolute;
    left: ${rect.left + scrollLeft}px;
    top: ${rect.top + scrollTop}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 9999;
    border: 2px dashed #10B981;
    border-radius: 8px;
    background: rgba(16, 185, 129, 0.05);
    box-sizing: border-box;
    animation: nestingPulse 2s ease-in-out infinite;
  `;

  // Ensure animation styles exist
  if (!iframeDoc.getElementById('drop-indicator-styles')) {
    const styleSheet = iframeDoc.createElement('style');
    styleSheet.id = 'drop-indicator-styles';
    styleSheet.textContent = `
      @keyframes nestingPulse {
        0%, 100% { opacity: 0.9; }
        50% { opacity: 0.7; }
      }
    `;
    iframeDoc.head.appendChild(styleSheet);
  }

  iframeDoc.body.appendChild(indicator);
}

/**
 * Hide nesting indicator
 */
function hideNestingIndicator(iframeDoc: Document): void {
  const indicators = iframeDoc.querySelectorAll('.nesting-drop-indicator');
  indicators.forEach(indicator => indicator.remove());
}

/**
 * Move element to a different container
 */
function moveElementToContainer(
  element: HTMLElement,
  dropInfo: DropTargetInfo
): boolean {
  const { container, position, index, referenceElement } = dropInfo;

  console.log('[moveElementToContainer] Called:', {
    elementTag: element.tagName,
    elementId: element.id,
    containerTag: container?.tagName,
    containerId: container?.id,
    position,
    index,
    referenceElementTag: referenceElement?.tagName,
  });

  // Safety check: don't move element into itself
  if (container === element || element.contains(container)) {
    console.warn('[flex-utils] Cannot move element into itself or its descendant');
    return false;
  }

  // Check if element is already at the correct position
  if (element.parentElement === container) {
    const children = getValidChildren(container).filter(c => c !== element);
    const currentIndex = Array.from(container.children).indexOf(element);

    // If the element is already in the correct position, skip DOM operation
    if (position === 'inside' && (index >= children.length || currentIndex === index)) {
      return false;
    }
  }

  if (position === 'inside' || !referenceElement) {
    // Insert at the end or beginning of empty container
    // Exclude the dragged element from children count
    const children = getValidChildren(container).filter(c => c !== element);
    if (index >= children.length) {
      container.appendChild(element);
    } else if (children[index] && children[index] !== element) {
      container.insertBefore(element, children[index]);
    } else {
      container.appendChild(element);
    }
  } else if (position === 'before') {
    // Don't insert before itself
    if (referenceElement !== element) {
      container.insertBefore(element, referenceElement);
    }
  } else {
    // position === 'after'
    // Don't insert after itself
    if (referenceElement !== element) {
      if (referenceElement.nextSibling && referenceElement.nextSibling !== element) {
        container.insertBefore(element, referenceElement.nextSibling);
      } else if (!referenceElement.nextSibling) {
        container.appendChild(element);
      }
      // If nextSibling === element, element is already in the correct position
    }
  }

  return true;
}

// ============================================================
// Legacy/Compatibility Functions
// ============================================================

export function showDropPlaceholder(): void {
  // No longer used - we use indicator line instead
}

export function removeDropPlaceholder(iframeDoc: Document): void {
  const placeholders = iframeDoc.querySelectorAll('.drop-placeholder, .drag-placeholder');
  placeholders.forEach(p => p.remove());
}

export function createDragGhost(): HTMLElement | null { return null; }
export function updateDragGhostPosition(): void {}
export function removeDragGhost(iframeDoc: Document): void {
  const ghosts = iframeDoc.querySelectorAll('.drag-ghost');
  ghosts.forEach(ghost => ghost.remove());
}
export function showAutoLayoutDropIndicator(): void {}
export function hideAutoLayoutDropIndicator(iframeDoc: Document): void {
  const indicators = iframeDoc.querySelectorAll('.auto-layout-drop-indicator');
  indicators.forEach(indicator => indicator.remove());
}
export function moveElementToParent(element: HTMLElement, dropInfo: DropTargetInfo): boolean {
  return moveElementToContainer(element, dropInfo);
}
