'use client';

/**
 * エディタ本体(FrontendVisualEditorInner)と共同編集の実体をつなぐ。
 *
 * io.collab が無ければ何もしない(実体を読み込まず、リスナーも張らない)。
 * あれば runtime.ts を動的に読み、
 * - 編集中のページが変わったら部屋を付け替える
 * - 選択(anchorValueOf の値)・カーソル(紙面の px)・打鍵中の要素を awareness に載せる
 */

import { useEffect, useState } from 'react';
import { io, type EditorCollab } from '../../io';
import { anchorValueOf } from '../components/ppt/PptComments';
import type { CollabRuntime } from './runtime';
import { COLLAB_DOCUMENT_READY_ATTR, COLLAB_DOCUMENT_READY_EVENT, type CollabDocumentReadyDetail } from './signals';

export type CollabController = {
  config: EditorCollab;
  /** 実体。動的な読み込みが終わるまで null */
  runtime: CollabRuntime | null;
  /** 初期化を終えた編集中の文書と、そのときのページ */
  ready: CollabDocumentReadyDetail | null;
};

export function useCollab({
  contentId,
  getIframeDoc,
  selectedIds,
}: {
  contentId: string | null;
  getIframeDoc: () => Document | null;
  selectedIds: string[];
}): CollabController | null {
  // エディタを開いている間は io.collab を読み直さない(途中で渡し直されても部屋を作り直さない)
  const [config] = useState<EditorCollab | null>(() => io().collab ?? null);
  const [runtime, setRuntime] = useState<CollabRuntime | null>(null);
  const [ready, setReady] = useState<CollabDocumentReadyDetail | null>(null);

  useEffect(() => {
    if (!config) return;
    let alive = true;
    let created: CollabRuntime | null = null;
    import('./runtime').then(
      (m) => {
        if (!alive) return;
        created = m.createCollabRuntime(config);
        setRuntime(created);
      },
      (e) => console.warn('[collab] 共同編集を始められませんでした:', e),
    );
    return () => {
      alive = false;
      created?.destroy();
    };
  }, [config]);

  // 初期化を終えた文書を受け取る。先に済んでいた(実体の読み込みが後だった)ときは印から拾う
  useEffect(() => {
    if (!config) return;
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<CollabDocumentReadyDetail>).detail;
      if (detail?.doc) setReady({ doc: detail.doc, contentId: detail.contentId });
    };
    window.addEventListener(COLLAB_DOCUMENT_READY_EVENT, onReady);
    const doc = getIframeDoc();
    if (doc?.documentElement?.hasAttribute(COLLAB_DOCUMENT_READY_ATTR)) {
      setReady((prev) => (prev?.doc === doc ? prev : { doc, contentId: doc.documentElement.getAttribute(COLLAB_DOCUMENT_READY_ATTR) || contentId }));
    }
    return () => window.removeEventListener(COLLAB_DOCUMENT_READY_EVENT, onReady);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, getIframeDoc]);

  useEffect(() => {
    runtime?.setPage(contentId);
  }, [runtime, contentId]);

  // 選択 → awareness(文書が今のページのものになってから)
  const doc = ready && ready.contentId === contentId ? ready.doc : null;
  const selectionKey = selectedIds.join('\n');
  useEffect(() => {
    if (!runtime) return;
    const artboard = doc?.getElementById('artboard');
    if (!artboard) {
      runtime.setSelection([]);
      return;
    }
    const anchors: string[] = [];
    for (const id of selectedIds) {
      const el = artboard.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
      const anchor = el ? anchorValueOf(artboard, el) : null;
      if (anchor && !anchors.includes(anchor)) anchors.push(anchor);
    }
    runtime.setSelection(anchors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, doc, selectionKey]);

  // カーソル(紙面の px)と打鍵中の要素 → awareness
  useEffect(() => {
    if (!runtime || !doc) return;
    const artboard = doc.getElementById('artboard');
    if (!artboard) return;
    const onMove = (e: PointerEvent) => {
      const r = artboard.getBoundingClientRect();
      const scale = r.width / (artboard.offsetWidth || 1) || 1;
      runtime.setCursor({ x: Math.round((e.clientX - r.left) / scale), y: Math.round((e.clientY - r.top) / scale) });
    };
    const onLeave = () => runtime.setCursor(null);
    const updateEditing = () => {
      const el = doc.querySelector<HTMLElement>('#artboard [contenteditable="true"]');
      runtime.setEditing(el ? anchorValueOf(artboard, el) : null);
    };
    // focusout の時点ではまだ contenteditable が外れていないので、外れてから読む
    const onFocusOut = () => setTimeout(updateEditing, 0);
    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.documentElement.addEventListener('pointerleave', onLeave);
    doc.addEventListener('focusin', updateEditing);
    doc.addEventListener('focusout', onFocusOut);
    return () => {
      doc.removeEventListener('pointermove', onMove);
      doc.documentElement.removeEventListener('pointerleave', onLeave);
      doc.removeEventListener('focusin', updateEditing);
      doc.removeEventListener('focusout', onFocusOut);
      runtime.setCursor(null);
    };
  }, [runtime, doc]);

  return config ? { config, runtime, ready } : null;
}
