'use client';

/**
 * エディタ本体(FrontendVisualEditorInner)と共同編集の実体をつなぐ。
 *
 * io.collab が無ければ何もしない(実体を読み込まず、リスナーも張らない)。
 * あれば runtime.ts を動的に読み、
 * - 編集中のページが変わったら部屋を付け替える
 * - 初期化を終えた紙面をページの部屋の本文につなぐ(binding.ts)。履歴の present が変わるたびに送る
 * - 選択(anchorValueOf の値)・カーソル(紙面の px)・打鍵中の要素を awareness に載せる
 * - 他の人が送ったページの見るだけの紙面を、部屋の本文で読み直す(キャンバスのとき)
 * - 他人の選択枠とカーソルを紙面に描く(layer.ts)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type EditorCollab } from '../../io';
import { useEditorContext } from '../EditorContext';
import { useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';
import { anchorValueOf } from '../components/ppt/PptComments';
import { getCleanHtml } from '../utils/html-utils';
import type { CollabDocBinding, CollabRuntime } from './runtime';
import { COLLAB_DOCUMENT_READY_ATTR, COLLAB_DOCUMENT_READY_EVENT, type CollabDocumentReadyDetail } from './signals';
import { COLLAB_DISABLED, collabStore, setCollabFlusher } from './store';
import { checkCollabRoom } from './room';
import { colorFor } from './color';
import { useCollabLayer } from './layer';

/** 他の人の rev が続けて届いたとき、読み直しを 1 回にまとめる(ms) */
const REV_DEBOUNCE_MS = 500;
/** 部屋に本文が無いとき(書き戻し役の書いたファイルから読み直す)、書き戻しの 1.5 秒を待つ(ms) */
const REV_FILE_DELAY_MS = 2000;
/** 見るだけの紙面の本文を部屋から読む同時数 */
const READ_PARALLEL = 2;

export type CollabController = {
  config: EditorCollab;
  /** まだ送っていない変更を今すぐ送る */
  flush: () => void;
  undo: () => void;
  redo: () => void;
};

type ReadyDocument = CollabDocumentReadyDetail & { initialShared: string };

export function useCollab({ contentId, selectedIds }: { contentId: string | null; selectedIds: string[] }): CollabController | null {
  // エディタを開いている間は io.collab を読み直さない(途中で渡し直されても部屋を作り直さない)
  const [config] = useState<EditorCollab | null>(() => io().collab ?? null);
  const { getIframeDoc, html, setHtml, contentList } = useEditorContext();
  const multiPageCanvas = useMultiPageCanvasOptional();
  const [runtime, setRuntime] = useState<CollabRuntime | null>(null);
  const [ready, setReady] = useState<ReadyDocument | null>(null);
  const bindingRef = useRef<CollabDocBinding | null>(null);
  const setHtmlRef = useRef(setHtml);
  setHtmlRef.current = setHtml;
  const canvasRef = useRef(multiPageCanvas);
  canvasRef.current = multiPageCanvas;
  const contentListRef = useRef(contentList);
  contentListRef.current = contentList;
  const contentIdRef = useRef(contentId);
  contentIdRef.current = contentId;

  useEffect(() => {
    if (!config) return;
    // 中継が保存しない部屋名だと、繋がっているのに中身が消える。繋ぐ前に検査して、外れたら始めない
    const room = checkCollabRoom(config.projectRoom);
    if (!room.ok) {
      console.warn(`[collab] 部屋名が中継に保存されない形なので共同編集を始めません: ${room.reason}`);
      collabStore.set({
        enabled: true,
        self: { id: config.user.id, name: config.user.name || config.user.id, color: colorFor(config.user.id, config.user.color) },
        requireBridge: !!config.requireBridge,
        status: 'error',
        roomError: room.reason,
      });
      return () => collabStore.set(COLLAB_DISABLED);
    }
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

  // 初期化を終えた文書を受け取り、その時点の姿(種まきに使う)を控える。
  // 先に済んでいた(実体の読み込みより前だった)ときは印から拾う
  useEffect(() => {
    if (!config) return;
    const snapshot = (doc: Document) => {
      try {
        return config.encode ? config.encode(getCleanHtml(doc)) : getCleanHtml(doc);
      } catch {
        return '';
      }
    };
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<CollabDocumentReadyDetail>).detail;
      if (detail?.doc) setReady({ doc: detail.doc, contentId: detail.contentId, initialShared: snapshot(detail.doc) });
    };
    window.addEventListener(COLLAB_DOCUMENT_READY_EVENT, onReady);
    const doc = getIframeDoc();
    if (doc?.documentElement?.hasAttribute(COLLAB_DOCUMENT_READY_ATTR)) {
      const readyId = doc.documentElement.getAttribute(COLLAB_DOCUMENT_READY_ATTR) || null;
      setReady((prev) => (prev?.doc === doc ? prev : { doc, contentId: readyId, initialShared: snapshot(doc) }));
    }
    return () => window.removeEventListener(COLLAB_DOCUMENT_READY_EVENT, onReady);
  }, [config, getIframeDoc]);

  useEffect(() => {
    runtime?.setPage(contentId);
  }, [runtime, contentId]);

  // いま編集しているページの文書(ページ切替の途中は前の文書を使わない)
  const doc = ready && ready.contentId === contentId ? ready.doc : null;

  // 紙面 ⇄ ページの部屋の本文
  useEffect(() => {
    if (!runtime || !ready || !doc || !contentId) return;
    const binding = runtime.bind({
      doc,
      contentId,
      initialShared: ready.initialShared,
      onApplied: (artboardHtml) => setHtmlRef.current(artboardHtml),
    });
    if (!binding) return;
    bindingRef.current = binding;
    setCollabFlusher(() => binding.flush());
    return () => {
      setCollabFlusher(null);
      // 離れるページの見るだけの紙面を、部屋の本文の最新にしておく(共同編集中は保存しないので、保存後の追従が効かない)
      const shared = binding.sharedHtml();
      binding.destroy();
      if (bindingRef.current === binding) bindingRef.current = null;
      if (shared != null) canvasRef.current?.setPageHtml(contentId, shared);
    };
  }, [runtime, ready, doc, contentId]);

  // 自分の変更: 履歴の present が変わるたび(notifyIframeChange / pushHistory / setHtml)。打鍵は binding が input で拾う
  useEffect(() => {
    bindingRef.current?.scheduleSend();
  }, [html]);

  // 他の人が本文を送ったページの、見るだけの紙面を読み直す(キャンバスのとき)
  const hasCanvas = !!multiPageCanvas;
  useEffect(() => {
    if (!runtime || !config || !hasCanvas) return;
    let alive = true;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const queue: string[] = [];
    let running = 0;
    const pump = () => {
      while (alive && running < READ_PARALLEL && queue.length > 0) {
        const id = queue.shift()!;
        running += 1;
        void runtime
          .readShared(id)
          .then((shared) => {
            const canvas = canvasRef.current;
            if (!alive || !canvas || id === contentIdRef.current) return;
            if (shared != null) {
              canvas.setPageHtml(id, shared);
            } else if (io().loadContent) {
              // 部屋に本文が無い = 書き戻し役がファイルに書いたものを読む。書き終わるのを待ってから
              timers.set(`file:${id}`, setTimeout(() => canvasRef.current?.updatePageFrame(id, { html: null, stale: true }), REV_FILE_DELAY_MS));
            }
          })
          .finally(() => {
            running -= 1;
            pump();
          });
      }
    };
    const off = runtime.onRemoteRev((route) => {
      const id = contentListRef.current.find((c) => config.routeFor(c.id) === route)?.id;
      if (!id || id === contentIdRef.current) return;
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          if (!queue.includes(id)) queue.push(id);
          pump();
        }, REV_DEBOUNCE_MS),
      );
    });
    return () => {
      alive = false;
      off();
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [runtime, config, hasCanvas]);

  // 選択 → awareness
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
      runtime.setEditing(null);
    };
  }, [runtime, doc]);

  useCollabLayer(doc, !!runtime);

  return useMemo<CollabController | null>(
    () =>
      config
        ? {
            config,
            flush: () => bindingRef.current?.flush(),
            undo: () => bindingRef.current?.undo(),
            redo: () => bindingRef.current?.redo(),
          }
        : null,
    [config],
  );
}
