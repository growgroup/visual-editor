'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { HistoryState, MAX_HISTORY_SIZE, HISTORY_DEBOUNCE_MS } from '../types/editor';

interface UseEditorHistoryOptions {
  maxHistorySize?: number;
  debounceMs?: number;
}

interface UseEditorHistoryReturn {
  html: string;
  setHtml: (html: string) => void;
  pushState: (html: string, selectedId?: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;
  currentState: HistoryState;
}

export function useEditorHistory(
  initialHtml: string,
  options: UseEditorHistoryOptions = {}
): UseEditorHistoryReturn {
  const {
    maxHistorySize = MAX_HISTORY_SIZE,
    debounceMs = HISTORY_DEBOUNCE_MS,
  } = options;

  // History stacks
  const [past, setPast] = useState<HistoryState[]>([]);
  const [present, setPresent] = useState<HistoryState>({
    html: initialHtml,
    selectedElementId: null,
    timestamp: Date.now(),
  });
  const [future, setFuture] = useState<HistoryState[]>([]);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<HistoryState | null>(null);

  // Reset history when initial HTML changes significantly (e.g., loading new slide)
  useEffect(() => {
    // Only reset if the initial HTML is significantly different
    // This prevents resetting during normal edits
    if (past.length === 0 && future.length === 0 && present.html !== initialHtml) {
      setPresent({
        html: initialHtml,
        selectedElementId: null,
        timestamp: Date.now(),
      });
    }
  }, [initialHtml]);

  // Push new state to history with debouncing
  const pushState = useCallback((html: string, selectedId?: string | null) => {
    // If HTML hasn't changed, don't push
    if (html === present.html) return;

    const newState: HistoryState = {
      html,
      selectedElementId: selectedId ?? present.selectedElementId,
      timestamp: Date.now(),
    };

    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Store pending state
    pendingStateRef.current = newState;

    // Debounce the history push
    debounceTimerRef.current = setTimeout(() => {
      if (pendingStateRef.current) {
        setPast(prev => {
          const newPast = [...prev, present];
          // Trim history if it exceeds max size
          if (newPast.length > maxHistorySize) {
            return newPast.slice(newPast.length - maxHistorySize);
          }
          return newPast;
        });
        setPresent(pendingStateRef.current);
        setFuture([]); // Clear redo stack on new action
        pendingStateRef.current = null;
      }
    }, debounceMs);
  }, [present, maxHistorySize, debounceMs]);

  // Immediate push (bypasses debouncing) - useful for discrete actions
  const pushStateImmediate = useCallback((html: string, selectedId?: string | null) => {
    // Clear any pending debounced state
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStateRef.current = null;

    if (html === present.html) return;

    const newState: HistoryState = {
      html,
      selectedElementId: selectedId ?? present.selectedElementId,
      timestamp: Date.now(),
    };

    setPast(prev => {
      const newPast = [...prev, present];
      if (newPast.length > maxHistorySize) {
        return newPast.slice(newPast.length - maxHistorySize);
      }
      return newPast;
    });
    setPresent(newState);
    setFuture([]);
  }, [present, maxHistorySize]);

  // Undo action
  const undo = useCallback(() => {
    // Flush any pending state first
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);

    setPast(newPast);
    setPresent(previous);
    setFuture([present, ...future]);
  }, [past, present, future]);

  // Redo action
  const redo = useCallback(() => {
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    setPast([...past, present]);
    setPresent(next);
    setFuture(newFuture);
  }, [past, present, future]);

  // Clear all history
  const clearHistory = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStateRef.current = null;
    setPast([]);
    setFuture([]);
  }, []);

  // Set HTML without pushing to history (for external updates)
  const setHtml = useCallback((html: string) => {
    setPresent(prev => ({
      ...prev,
      html,
      timestamp: Date.now(),
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    html: present.html,
    setHtml,
    pushState: pushStateImmediate, // Use immediate for discrete actions
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    clearHistory,
    currentState: present,
  };
}

export default useEditorHistory;
